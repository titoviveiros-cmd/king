# KING — Sequência (streak v1, Fase 6A)

> **ROLLOUT: OFF. Production ainda está sem streak.**
> A migração `supabase/migrations/20261001120000_sequencia.sql` está **preparada e testada, mas
> NÃO foi aplicada** no projeto Supabase de Production. O código web está na branch
> `feat/streak-v1`, **sem merge na `main` e sem publicação**. Nada do que está descrito abaixo
> existe em Production até o Tito aplicar a migração e publicar a web (§11).

## 1. Definição

**Sequência** = número de **dias consecutivos** do calendário de São Paulo em que o jogador
recebeu **pelo menos um crédito de XP positivo**: durável, autoritativo e idempotente, gravado
por `king_private.creditar_partida` (Fase 4D).

| Situação | Resultado |
|---|---|
| primeiro dia qualificado | **1** |
| qualificou ontem | **+1** |
| já qualificou hoje (2ª, 3ª… partida do dia) | **igual**: o XP entra normalmente, mas a sequência não muda |
| um ou mais dias sem qualificar | a próxima qualificação **recomeça em 1** |
| recorde | `recorde = max(recorde, atual)`: nunca diminui |

**Não existe** congelamento, dia de graça, recuperação paga, bônus, moeda, prêmio nem
notificação push. Um dia sem jogar quebra a sequência; um teste e uma mutação garantem isso
(`seq-dia-de-graca`).

## 2. Fuso

O dia é o de **`America/Sao_Paulo`**, a mesma referência da redução após 6 partidas no dia
(regra M2). O instante usado é o **fim da partida** (`terminada_em`), registrado pelo servidor da
partida. Nem o relógio nem o resultado do cliente entram na conta.

- `public.dia_de_sao_paulo(timestamptz)` é a definição única do dia da sequência.
- 23:59 → 00:00 em São Paulo é dia seguinte (S5). 02:30 UTC ainda é o dia anterior em São Paulo
  (S6). Calcular em UTC é uma mutação que os testes matam (`seq-em-utc`).

## 3. Elegibilidade

A sequência **reaproveita** a elegibilidade autoritativa do XP. Ela não tem regra própria de quem
conta: **conta quem recebeu XP positivo**.

| CONTA | NÃO CONTA |
|---|---|
| partida **online** | modo **local / solo** (não passa pelo servidor e não gera XP) |
| jogador **humano** com identidade permanente | **bots** (o banco recusa id que não seja de jogador) |
| crédito de XP **> 0** efetivamente gravado | partida **sem XP** (`xp_delta = 0`) |
| mesma elegibilidade de `creditar_partida` (2+ humanos, participação ≥ 60%, conectado no fim) | **abandono** e **participação insuficiente** (`participou = false` → 0 XP) |
| | partida **sobreposta** a outra do mesmo jogador (0 XP) |
| | **evento duplicado** e **retry** do mesmo crédito (idempotentes: nada muda) |
| | simples **abertura do app** (`app_open`) e **tutorial**: não geram crédito nenhum |

**Decisão de produto (Tito, 01/10/2026): partidas locais/solo NÃO contam.** O modo local não passa
pelo servidor e não gera XP autoritativo. Contá-lo exigiria confiar no cliente ou criar uma
validação nova só para a sequência. Por isso:

- não existe exceção no cliente para o solo;
- não existe endpoint de sequência;
- o cliente não envia relógio nem resultado.

Onde isso está amarrado:

| Camada | Proteção | Prova |
|---|---|---|
| servidor | `resultadoParaCredito` devolve `null` com menos de 2 humanos | `resultado.test.ts` + mutação "servidor credita partida SOLO" |
| banco | `creditar_partida` recusa `p_humanos < 2`; a tabela exige `humanos between 2 and 4` | S10b + mutação `seq-conta-solo` |
| sequência | só dias com `xp_delta > 0` no ledger | S10 + mutação `seq-sem-xp` |
| web | o Placar local não mostra sequência; o convite do estado zero diz **"jogue online"** | `progresso.test.tsx` + mutação "convite sem 'online'" |

## 4. Armazenada × efetiva

`public.progresso` guarda um **retrato**:

- `sequencia_atual`: a corrida que termina no último dia qualificado;
- `sequencia_recorde`;
- `sequencia_ultimo_dia`;
- `sequencia_partida`: a primeira partida, na ordem do ledger, que qualificou esse dia.

O retrato envelhece. Quem qualificou pela última vez anteontem tem `sequencia_atual = 5` gravado,
mas está com a sequência quebrada. Por isso a view `meu_progresso` devolve o valor **efetivo**,
calculado com o relógio do **banco** (`now()`):

| Coluna da view | Significado |
|---|---|
| `sequencia_atual` | efetiva: o retrato se o último dia é hoje ou ontem; senão **0** |
| `sequencia_recorde` | recorde |
| `sequencia_hoje` | o dia de hoje (São Paulo) já conta? |
| `sequencia_ultimo_dia` | último dia qualificado |
| `sequencia_partida` | a partida que qualificou esse dia. O Placar Final compara com a sua |

As 5 colunas antigas de `meu_progresso` continuam iguais em nome, tipo e ordem. As novas entram no
fim (S13).

## 5. Idempotência e ordem de chegada

A sequência é **derivada do ledger** (`xp_eventos` ⨝ `king_private.partidas`), e não um contador
"+1". O crédito chega pelo outbox do servidor, que pode atrasar e reordenar: a partida de ontem pode
chegar depois da de hoje. Por isso ela é recalculada a partir de **todos** os dias com XP positivo
do jogador, como "ilhas" de dias consecutivos. Daí decorre:

- **mesmo evento duas vezes, retry do outbox, reconexão:** a partida já existe →
  `creditar_partida` devolve o que já foi gravado e não insere nada → o gatilho não roda → nada
  muda (S7, S8).
- **duas partidas válidas no mesmo dia:** a 2ª entra no mesmo dia → a contagem é por **dia
  distinto** → igual (S2). `sequencia_partida` continua sendo a 1ª.
- **crédito atrasado:** o dia dele entra no lugar certo (S9).
- **duas partidas simultâneas do mesmo jogador:** a trava por jogador de `creditar_partida`
  serializa as duas. O gatilho roda depois dela, e cada recálculo vê o que a outra já gravou (S11).
- **conferência geral:** 60 partidas sorteadas, 6 jogadores, chegada fora de ordem. O retrato
  gravado é igual a um **oráculo independente em JavaScript** que aplica a regra do produto
  (S14).

## 6. Relação com o XP

- **Mesma transação.** Um gatilho `AFTER INSERT ... FOR EACH STATEMENT` em `public.xp_eventos`
  recalcula a sequência dos jogadores lançados. Ele roda dentro da chamada de `creditar_partida`,
  depois da trava por jogador. XP e sequência são gravados juntos ou não são gravados: não há
  como divergirem.
- **`creditar_partida` não mudou.** Nenhuma linha da função de crédito foi tocada. A regra de XP,
  a trava, a idempotência e as 10 mutações antigas continuam valendo como estavam.
- **XP reduzido conta.** Da 7ª partida do dia em diante o XP cai para 25%, mas continua positivo:
  o dia já estava qualificado de qualquer forma.

## 7. Modelo de dados (migração `20261001120000_sequencia.sql`)

| Objeto | O quê |
|---|---|
| `public.progresso` + 4 colunas | `sequencia_atual`, `sequencia_recorde`, `sequencia_ultimo_dia`, `sequencia_partida`. Checks: não negativa; recorde ≥ atual; "nunca qualificou" é um estado só |
| `public.dia_de_sao_paulo(timestamptz)` | o dia de São Paulo, definição única |
| `king_private.sequencia_de(uuid)` | sequência derivada do ledger (atual, recorde, último dia, partida) |
| `king_private.sequencia_apos_lancamento()` + gatilho `xp_eventos_sequencia` | recalcula quem foi lançado |
| `public.sequencia_efetiva(...)`, `public.sequencia_qualificada_hoje(...)` | puras e com o instante como parâmetro: os testes fixam o relógio |
| `public.meu_progresso` | + 5 colunas no fim (§4) |
| backfill | quem já tem XP nasce com o retrato igual ao ledger (S16) |

**Nenhuma** tabela pública nova, nenhuma política RLS nova e nenhum GRANT de escrita.

## 8. Segurança (auditoria das funções novas, S15)

- `search_path = ''` em todas; nomes sempre qualificados com o schema.
- Dono: `king_progress_owner` (NOLOGIN), como as tabelas. **Nenhuma** é `SECURITY DEFINER`: o
  gatilho roda com os privilégios de quem insere no ledger, e só `creditar_partida` insere.
- EXECUTE:
  - nunca para `PUBLIC`, `anon` ou `king_server`;
  - `authenticated` só nas três funções puras, que a view chama e que não leem dado nenhum;
  - `sequencia_de` e a função do gatilho são só do dono.
- Isolamento: a view é `security_invoker` e lê `progresso` pelo RLS de leitura própria. Ninguém
  enxerga a sequência de outro (T17, S13).
- Escrita: o jogador não altera a própria sequência, e `king_server` não escreve em tabela
  nenhuma (S15).
- `king_server` continua com a **única** porta que tinha: EXECUTE em `creditar_partida`.

## 9. Interface

- **Home:** a sequência entra na lateral do card de progresso, numa pilha da altura do badge de
  nível. O card não cresce: o Playwright compara a altura com e sem a sequência.

  | Estado | Texto |
  |---|---|
  | sequência ativa | `🔥 Sequência N dias` (ouro se hoje já conta, tom neutro se ainda não) |
  | recorde maior que a atual (e ≥ 2) | `Recorde: N dias` |
  | estado zero | `🔥 Comece hoje: jogue online` |

  O convite diz **online** de propósito: partida contra os bots não conta. Não há linguagem
  punitiva ("perdeu", "quebrou", contagem regressiva); um teste proíbe.
- **Placar Final:** `🔥 Sequência: N dias` na linha do XP, **só** quando `sequencia_partida` é esta
  partida. Se o dia já tinha sido qualificado, nada aparece, e nenhum avanço é fingido. Sem
  modal; a revanche não é interrompida.
- **Banco sem a migração:** a leitura pede `select=*` e recebe as 5 colunas de sempre. O card fica
  **igual ao de antes** (sem convite e sem zero inventado). Por isso a ordem do rollout é livre
  (§11).
- **Analytics:** **nenhum** evento novo (sem `streak_started`, `streak_incremented` ou
  `streak_broken`). Um teste de estrutura proíbe.
- **Relógio do aparelho:** irrelevante. O cliente não usa `Date` nos módulos da sequência, e um
  teste adultera o relógio e confere que a tela não muda.

## 10. Fail-open

- Supabase fora do ar, lento ou sessão vencida: a Home é a de sempre, sem card (Playwright de
  progresso, inalterado).
- O crédito de XP segue o caminho da 4D (outbox + disjuntor + retry). A sequência não criou
  infraestrutura de retry nova: ela viaja dentro do mesmo crédito.
- **Risco aceito:** como o gatilho está na transação do crédito, um defeito nele faria o crédito
  inteiro falhar. As pendências ficariam no outbox, sem perda e sem travar partida, até a
  correção ou o rollback (§11.3). Isso é deliberado: um XP gravado sem a sequência seria a
  divergência que a regra proíbe.

## 11. Rollout (quando autorizado; NADA disto foi feito)

### 11.1 Ordem

As duas ordens são seguras:

- **migração antes da web:** a web publicada ignora as colunas novas;
- **web antes da migração:** a web nova lê `*` e, sem as colunas, mostra o card de antes.

Recomendado: **migração primeiro, web depois**.

### 11.2 Aplicar a migração

O Tito aplica pelo **SQL Editor do Dashboard**, colando o arquivo inteiro.

- A migração usa `ALTER TABLE ... ADD COLUMN` com default constante, que no Postgres 11+ não
  reescreve a tabela.
- A trava de `progresso` dura só a migração: segundos, com a base atual. O crédito que chegar
  durante esse tempo espera e segue.

Conferências **somente leitura** depois de aplicar (todas devem dar o indicado):

```sql
-- 1. o gatilho está ativo → 'O'
select tgenabled from pg_trigger where tgname = 'xp_eventos_sequencia';
-- 2. retrato = ledger, para todo mundo → 0
select count(*) from public.progresso g
 cross join lateral king_private.sequencia_de(g.player_id) s
 where (g.sequencia_atual, g.sequencia_ultimo_dia, g.sequencia_partida)
       is distinct from (s.atual, s.ultimo_dia, s.partida)
    or g.sequencia_recorde < s.recorde;
-- 3. a view mantém as colunas antigas na frente → player_id, xp_total, nivel, xp_no_nivel, xp_do_nivel, sequencia_…
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'meu_progresso' order by ordinal_position;
```

### 11.3 Rollback

`supabase/rollback/20261001120000_sequencia_rollback.sql` fica fora de `migrations/`, então
nenhum `db push` o aplica.

- O que ele faz: devolve a view às 5 colunas, remove o gatilho, as funções e as colunas.
- O que ele **não** toca: XP e ledger.
- Reaplicar a migração depois refaz o retrato a partir do ledger.

Tudo isso está provado no S17.

## 12. Testes

| Onde | O quê |
|---|---|
| `scripts/testar-progresso-sql.mjs` (Postgres 17 real) | S1–S17, descritos abaixo; mais T1–T23 de XP, inalterados e verdes |
| `scripts/testar-progresso-sql.mjs --provas` | 18 mutações (10 de XP + 8 de sequência), todas mortas |
| `apps/server/src/progresso/resultado.test.ts` | partida solo não chega ao crédito |
| `apps/web/src/auth/progresso.test.ts` | leitura com e sem a migração, dado estranho, relógio adulterado, `select=*` |
| `apps/web/src/game/xpDaPartida.test.ts` | o Placar só mostra a sequência da partida que qualificou; reload e duas abas dão o mesmo número |
| `apps/web/src/ui/progresso.test.tsx` | textos (singular, zero, recorde), sem punição, sem sugerir solo, Placar local sem sequência, nada de relógio, armazenamento ou evento |
| `apps/web/tests-progresso/progresso.spec.ts` | Home com sequência no pior caso a 667×375, 740×360, 852×393, 852×300, 1600×900 e toque: cabe e não cresce |
| `apps/web/tests/placarFinal.spec.ts` | Placar com XP + sequência no pior caso, em todos os 13 viewports da suíte |
| `scripts/mutar-sequencia.mjs --e2e` | 13 mutações web/servidor + 4 de layout (estouro real medido), todas mortas |

Os testes SQL de sequência, um a um:

- **S1–S4:** primeiro dia, mesmo dia, dia seguinte, buraco e recorde;
- **S5–S6:** virada de dia e UTC × São Paulo;
- **S7–S8:** duplicata e retry do outbox, com os módulos reais do servidor;
- **S9:** crédito atrasado;
- **S10–S10b:** elegibilidade;
- **S11:** concorrência;
- **S12–S13:** valor efetivo, com relógio fixo e com o relógio do banco;
- **S14:** oráculo independente;
- **S15:** segurança;
- **S16:** aplicação sobre o banco de hoje;
- **S17:** rollback.

As 8 mutações SQL de sequência, uma a uma:

| Mutação | Defeito que ela simula | Morre em |
|---|---|---|
| `seq-sem-trava-do-dia` | contar partidas em vez de dias | S2, S11 |
| `seq-qualquer-data` | "ontem" vira "qualquer dia" | S4, S9 |
| `seq-sem-reset` | a corrida antiga continua viva | S12, S13 |
| `seq-dia-de-graca` | um dia sem jogar não quebra | S12 |
| `seq-aceita-duplicata` | o reenvio lança de novo | S7, S8 |
| `seq-sem-xp` | 0 XP qualifica o dia | S10 |
| `seq-em-utc` | o dia calculado em UTC | S5, S6, S12 |
| `seq-conta-solo` | crédito com 1 humano | S10b |

Sobre `seq-aceita-duplicata`: mesmo com o reenvio lançando de novo no ledger, a sequência não
dobraria, porque conta dias distintos. Quem reprova é o invariante completo (XP + ledger +
sequência) dos testes S7 e S8.

## 13. Red team

| Ataque / situação | O que acontece | Prova |
|---|---|---|
| duas abas no Placar | as duas leem a mesma linha do banco: mesmo número | `xpDaPartida.test.ts` |
| refresh no Placar Final | relê `sequencia_partida`: mesmo resultado, sem "+1" novo | idem |
| reconexão | o fim da partida é entregue uma vez só (`progressoDaPartida.test.ts`); mesmo se viesse de novo, o `partidaId` é o mesmo | T2, S7 |
| retry do outbox | idempotente | S8, T21 |
| evento duplicado | idempotente | S7 |
| duas partidas simultâneas | trava por jogador; o dia conta uma vez; dias seguidos somam | S11 |
| virada do dia | 23:59 → 00:00 em São Paulo é dia seguinte; UTC não interfere | S5, S6, S12 |
| relógio do cliente adulterado | não entra em lugar nenhum; o dia vem de `terminada_em` (servidor) e o "hoje" de `now()` (banco) | `progresso.test.ts`, `progresso.test.tsx` |
| cliente tenta escrever a sequência | sem GRANT, sem política, sem RPC | S15, T14–T16 |
| solo / bots | não chegam ao crédito | S10b, `resultado.test.ts` |

## 14. Riscos residuais

1. **Defeito no gatilho bloqueia créditos** (§10), sem perda de dado. Mitigação: S1–S17, 18
   mutações SQL, rollback testado.
2. **Relógio do servidor da partida.** O dia vem de `terminada_em`, que o servidor da partida
   marca. Um relógio de VPS muito errado deslocaria dias. O banco já recusa fim no futuro
   (> 5 min).
3. **Custo do recálculo.** Ele percorre o histórico de XP positivo do jogador a cada crédito, e
   o índice `xp_eventos_por_jogador` cobre a busca. Com milhares de partidas por jogador continua
   na casa dos milissegundos, mas vale medir se algum dia houver contas com dezenas de milhares.
4. **Backfill conta o passado.** Quem já jogou online em dias seguidos antes do rollout aparece
   com a sequência real desde o primeiro acesso. Isso é coerente com a definição, porque o
   ledger é a verdade, e o próximo crédito recalcularia do ledger de qualquer forma.
5. **Placar online medido por injeção.** O bloco XP + sequência é medido no Placar local com o
   markup real do componente. A coluna de dados é a mesma nos dois modos, mas uma partida online
   inteira com crédito real não está na suíte de layout. Antes do rollout, vale uma conferência
   visual numa partida online de Preview.
