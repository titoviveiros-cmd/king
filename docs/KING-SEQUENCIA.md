# KING — Sequência (streak v1, Fase 6A)

> **ROLLOUT: OFF. Production ainda está sem streak.**
> A migração `supabase/migrations/20261001120000_sequencia.sql` está **preparada e testada, mas
> NÃO foi aplicada** no projeto Supabase de Production. O código web está na branch
> `feat/streak-v1`, **sem merge na `main` e sem publicação**. Nada do que está descrito abaixo
> existe em Production até o Tito aplicar a migração e publicar a web (§11).

> **Sem backfill histórico. A sequência passa a existir apenas a partir do rollout da feature.**
> Partidas e XP anteriores à aplicação da migração não criam sequência nem recorde, não definem
> último dia e não são reinterpretados nem reconstruídos a partir do ledger. Logo depois da
> migração, todo jogador está com sequência 0, recorde 0, sem dia e sem partida. O primeiro
> crédito elegível depois dela dá 1 (§5.1).

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

A sequência é **derivada do ledger posterior ao rollout** (`xp_eventos` ⨝ `king_private.partidas`,
a partir do marco do §5.1), e não um contador "+1". O crédito chega pelo outbox do servidor, que
pode atrasar e reordenar: a partida de ontem pode chegar depois da de hoje. Por isso ela é
recalculada a partir dos dias com XP positivo **desde o rollout**, como "ilhas" de dias
consecutivos. Daí decorre:

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

### 5.1 O marco do rollout — por que não há backfill

Havia dois caminhos de backfill na primeira versão. **Os dois foram removidos.**

1. **Explícito:** um `UPDATE` no fim da migração preenchia a sequência pelo ledger. Saiu.
2. **Implícito:** o gatilho recalcula pelo ledger. Mesmo sem o `UPDATE`, o primeiro crédito
   pós-rollout de quem já jogou reconstruiria o histórico. Remover só o `UPDATE` **não bastaria**.

A migração grava um **marco** em `king_private.sequencia_inicio` (uma linha, privada):

- `inicio`: o instante da aplicação (`now()`);
- `ultimo_evento_anterior`: o maior id do ledger naquele instante.

Um lançamento só qualifica dia se, ao mesmo tempo:

| Condição | O que ela barra |
|---|---|
| `id > ultimo_evento_anterior` | XP lançado antes do rollout, inclusive de partida com início marcado depois do marco (relógio do servidor adiantado) |
| `iniciada_em >= inicio` | partida **anterior** ao rollout: crédito **atrasado** (outbox) de partida que já tinha terminado, e partida que **atravessou** o rollout (começou antes, terminou depois). O XP entra normalmente, a sequência não |
| `motivo = 'partida_concluida'` e partida com `humanos >= 2` | qualquer origem de XP que não seja partida online (§8.1) |

Sem marco, não há sequência: a ausência dele falha **fechado**. O que acontece depois do rollout
segue a regra normal, sem mudança (S1–S15).

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
| `king_private.sequencia_inicio` | o **marco** do rollout (§5.1): uma linha, privada, com RLS, sem GRANT para ninguém |
| `king_private.sequencia_de(uuid)` | sequência derivada do ledger **pós-marco** (atual, recorde, último dia, partida) |
| `king_private.sequencia_apos_lancamento()` + gatilho `xp_eventos_sequencia` | recalcula quem foi lançado |
| `public.sequencia_efetiva(...)`, `public.sequencia_qualificada_hoje(...)` | puras e com o instante como parâmetro: os testes fixam o relógio |
| `public.meu_progresso` | + 5 colunas no fim (§4) |
| **sem backfill** | nenhum `UPDATE` retrospectivo: as colunas nascem 0, 0, NULL, NULL para todo mundo (S16) |

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
- O marco (`king_private.sequencia_inicio`) é do dono, com RLS e sem nenhum privilégio para
  `anon`, `authenticated`, `service_role` ou `king_server`.

### 8.1 Quem escreve no ledger (a sequência nasce dele) — S18, S19

**Invariante de hoje: o único escritor do ledger é `creditar_partida`**, e o único `motivo` é
`'partida_concluida'`. Provado no Postgres real (S18):

- nenhuma escrita direta (INSERT, UPDATE, DELETE, TRUNCATE) em `xp_eventos` para `anon`,
  `authenticated`, `service_role` ou `king_server`;
- uma única função insere no ledger: `king_private.creditar_partida`;
- a lista de funções `SECURITY DEFINER` é fechada: `creditar_partida` e `criar_player`, o gatilho
  da identidade, que só cria o perfil. Uma função privilegiada nova derruba o teste;
- só `king_server` executa o crédito;
- **varredura de TODAS as migrações do repositório**, inclusive as futuras: um `INSERT` novo no
  ledger, um GRANT de escrita ou um motivo novo derruba o teste e obriga a revisar a sequência.

A sequência **não depende só dessa invariante**. Ela exige motivo de partida **e** partida com
2+ humanos (§5.1). O S19 simula uma origem futura (um bônus com motivo novo) e uma partida solo
gravada por um escritor futuro: nenhuma qualifica dia. As mutações `seq-qualquer-origem` e
`seq-solo-no-recalculo` morrem ali.

Quem tem o papel `postgres` (o SQL Editor do Dashboard) pode escrever em qualquer tabela. Isso
é acesso de operação, fora do caminho da aplicação. Para conferir em Production, só leitura:

```sql
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'xp_eventos' order by 1, 2;
-- esperado: só SELECT para authenticated (além do dono king_progress_owner)
```

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

O Tito aplica pelo **SQL Editor do Dashboard**: cola `begin;`, o arquivo inteiro e `commit;`.
Assim a aplicação é tudo ou nada; o arquivo em si não traz `begin`/`commit`, como a migração do
progresso, porque o `db push` já abre a própria transação.

- A migração usa `ALTER TABLE ... ADD COLUMN` com default constante, que no Postgres 11+ não
  reescreve a tabela.
- A trava de `progresso` dura só a migração: segundos, com a base atual. O crédito que chegar
  durante esse tempo espera e segue.
- O Supabase recarrega sozinho o cache de esquema da API depois de DDL. Se as colunas novas não
  aparecerem em `meu_progresso` pela API, rodar `notify pgrst, 'reload schema';`.

Conferências **somente leitura** depois de aplicar (todas devem dar o indicado):

```sql
-- 1. o gatilho está ativo → 'O'
select tgenabled from pg_trigger where tgname = 'xp_eventos_sequencia';
-- 2. SEM BACKFILL: ninguém com sequência logo depois da migração → 0
select count(*) from public.progresso
 where sequencia_atual <> 0 or sequencia_recorde <> 0
    or sequencia_ultimo_dia is not null or sequencia_partida is not null;
-- 3. o marco gravado → uma linha: o instante da aplicação e o último lançamento anterior
select inicio, ultimo_evento_anterior, (select max(id) from public.xp_eventos) as maior_id_agora
  from king_private.sequencia_inicio;
-- 4. a view mantém as colunas antigas na frente → player_id, xp_total, nivel, xp_no_nivel, xp_do_nivel, sequencia_…
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'meu_progresso' order by ordinal_position;
```

Mais tarde, a qualquer momento, o retrato deve bater com o ledger pós-marco (esperado 0):

```sql
select count(*) from public.progresso g
 cross join lateral king_private.sequencia_de(g.player_id) s
 where (g.sequencia_atual, g.sequencia_ultimo_dia, g.sequencia_partida)
       is distinct from (s.atual, s.ultimo_dia, s.partida)
    or g.sequencia_recorde < s.recorde;
```

### 11.3 Rollback

`supabase/rollback/20261001120000_sequencia_rollback.sql` fica fora de `migrations/`, então
nenhum `db push` o aplica.

- O que ele faz: devolve a view às 5 colunas, remove o gatilho, as funções, o marco e as
  colunas. Só objetos da sequência.
- O que ele **não** toca: XP e ledger. Ele não recalcula nada.
- **Reaplicar a migração depois NÃO reconstrói nada.** Ela grava um marco novo. Tudo o que veio
  antes dele vira histórico: o histórico de antes da 1ª aplicação, o que contou durante ela e o
  que foi creditado com a sequência fora do ar. Todo mundo volta a 0, e o 1º crédito seguinte
  dá 1.

Tudo isso está provado no S17 (migração → rollback → migração).

## 12. Testes

| Onde | O quê |
|---|---|
| `scripts/testar-progresso-sql.mjs` (Postgres 17 real) | S1–S19, descritos abaixo; mais T1–T23 de XP, inalterados e verdes |
| `scripts/testar-progresso-sql.mjs --provas` | 26 mutações (10 de XP + 16 de sequência e do ledger), todas mortas |
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
- **S16:** **sem backfill**: a migração é aplicada de verdade sobre um banco com XP histórico.
  Todos ficam zerados, o 1º crédito depois dá 1, e nada anterior ao rollout entra (nem crédito
  atrasado, nem XP lançado antes);
- **S17:** migração → rollback → migração, sem tocar XP nem ledger e **sem reconstruir nada**;
- **S18:** escritores do ledger, no catálogo e em todas as migrações do repositório;
- **S19:** XP que não vem de partida online (bônus futuro, solo) não qualifica dia.

Nos testes de calendário (S1–S15), o banco foi "lançado" em 01/01/2026 e as partidas são de
março. É preciso, porque o crédito não aceita fim no futuro. S16 e S17 usam o relógio real.

As 16 mutações SQL de sequência e do ledger, uma a uma:

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
| `seq-backfill` | a migração volta a preencher pelo histórico (marco no começo dos tempos + `UPDATE` retroativo) | S16, S17 |
| `seq-historico-no-recalculo` | o gatilho ignora o marco e reconstrói o histórico no 1º crédito | S16 |
| `seq-xp-anterior-ao-rollout` | XP lançado antes do rollout passa a contar | S16 |
| `seq-partida-anterior-ao-rollout` | crédito atrasado de partida pré-rollout passa a contar | S16 |
| `seq-qualquer-origem` | XP que não é de partida qualifica o dia | S19 |
| `seq-solo-no-recalculo` | partida solo gravada por outro escritor qualifica o dia | S19 |
| `ledger-segundo-escritor` | nasce outra função que insere no ledger | S18 |
| `ledger-escrita-service-role` | `service_role` ganha INSERT no ledger | S18 |

Sobre `seq-aceita-duplicata`: mesmo com o reenvio lançando de novo no ledger, a sequência não
dobraria, porque conta dias distintos. Quem reprova é o invariante completo (XP + ledger +
sequência) dos testes S7 e S8.

Sobre `seq-backfill`: um `UPDATE` retroativo **sozinho** já não reconstruiria nada, porque o
marco o neutraliza. Por isso a mutação faz as duas coisas: põe o marco no começo dos tempos e
acrescenta o `UPDATE`. É assim que um backfill de verdade teria de ser escrito, e é isso que o
S16 pega.

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
| XP histórico "virar" sequência | não vira: marco do rollout | S16, S17 |
| outra origem de XP no futuro | não qualifica dia sem mudança explícita | S18, S19 |

## 14. Riscos residuais

1. **Defeito no gatilho bloqueia créditos** (§10), sem perda de dado. Mitigação: S1–S19, 26
   mutações SQL, rollback testado.
2. **Relógio do servidor da partida.** O dia vem de `terminada_em`, que o servidor da partida
   marca. Um relógio de VPS muito errado deslocaria dias. O banco já recusa fim no futuro
   (> 5 min).
3. **Custo do recálculo.** Ele percorre os lançamentos do jogador a cada crédito (os
   pré-rollout são lidos e descartados pelo marco). O índice `xp_eventos_por_jogador` cobre a
   busca. Com milhares de partidas por jogador continua na casa dos milissegundos, mas vale
   medir se algum dia houver contas com dezenas de milhares.
4. **Recomeço do zero no rollout.** Quem jogou online em dias seguidos antes do rollout começa
   em 0, como decidido. A Home mostra o convite até o 1º crédito depois do rollout. Não há texto
   que sugira perda.
5. **Partida que atravessa o rollout não conta.** Quem estiver no meio de uma partida no
   instante da migração recebe o XP dela normalmente, mas a sequência só começa na partida
   seguinte. É a leitura estrita de "partida anterior ao rollout não cria sequência" (S16).
6. **Placar online medido por injeção.** O bloco XP + sequência é medido no Placar local com o
   markup real do componente. A coluna de dados é a mesma nos dois modos, mas uma partida online
   inteira com crédito real não está na suíte de layout. Antes do rollout, vale uma conferência
   visual numa partida online de Preview.
