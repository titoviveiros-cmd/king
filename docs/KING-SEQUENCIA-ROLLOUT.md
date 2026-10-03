# KING — Roteiro do rollout da sequência (Fase 6B)

> **NADA DESTE ROTEIRO FOI EXECUTADO. Production ainda está sem streak.**
> Ele só começa com autorização explícita do Tito. Cada checkpoint tem critério de PARAR.
> Regra, desenho e testes: `docs/KING-SEQUENCIA.md`.

## O que muda em Production

| Onde | O que muda | Quem faz |
|---|---|---|
| Supabase (banco) | a migração `20261001120000_sequencia.sql`, pelo arquivo único `supabase/rollout/sequencia-aplicar.sql` | **Tito**, no SQL Editor |
| `main` | fast-forward puro até o SHA aprovado da `feat/streak-v1` | eu, com autorização |
| Vercel Production | o deploy automático da `main` | automático |
| VPS (servidor do jogo) | **nada**: a sequência nasce de um gatilho no banco, e `creditar_partida` não mudou | ninguém |

Ordem recomendada: **banco primeiro, web depois**. A ordem inversa também é segura; está provada
nas duas direções (§ Provas).

## CHECKPOINT 1 — antes da migração

**Eu (Git, só leitura):**

```bash
git fetch origin
git rev-parse origin/feat/streak-v1      # = SHA aprovado na devolutiva da 6B
git rev-parse origin/main                # = c1b8162 (ou o SHA que estiver aprovado)
git merge-base --is-ancestor origin/main origin/feat/streak-v1 && echo "main é ancestral: fast-forward possível"
gh run list --branch feat/streak-v1 --limit 1   # CI do SHA aprovado: completed / success, sem flaky
```

**Tito (SQL Editor, SOMENTE LEITURA):** colar `supabase/rollout/sequencia-checkpoint-1-antes.sql` e
rodar. Mandar a linha que aparecer.

| Coluna | Esperado |
|---|---|
| `pronto_para_aplicar` | `true` |
| `marco_ja_existe`, `colunas_de_sequencia` | `false`, `0` |
| `progresso_divergente_do_ledger` | `0` |
| `colunas_de_meu_progresso` | `player_id,xp_total,nivel,xp_no_nivel,xp_do_nivel` |
| `permissoes_no_ledger` | só `authenticated:SELECT` |
| `security_definer` | anotar: a migração não pode mudar esta lista |

**PARAR** se qualquer linha divergir.

## CHECKPOINT 2 — a migração

**Tito:** abrir `supabase/rollout/sequencia-aplicar.sql` **do SHA aprovado**, copiar o arquivo
**inteiro**, colar no SQL Editor e rodar **uma vez**.

O arquivo é UMA transação:
1. `begin`;
2. trava contra crédito e foto do "antes";
3. a migração, com texto idêntico ao arquivo oficial (um teste garante);
4. oito conferências;
5. `commit`.

- **Deu certo:** a última tela mostra uma linha **`SEQUÊNCIA APLICADA E CONFERIDA`**.
  - `jogadores_com_sequencia = 0`.
  - `ultimo_evento_anterior` igual ao `maior_lancamento` do checkpoint 1, ou maior, se entrou
    crédito entre os dois.
- **Deu errado:** aparece `CONFERÊNCIA n FALHOU …` ou `ROLLOUT ABORTADO …`. **Nada foi gravado.**
  Rodar `rollback;` sozinho, para limpar a sessão, mandar a mensagem e **PARAR**.

Durante os poucos segundos da transação, nenhum crédito de XP confirma: ele espera e segue sozinho.
Partida não trava, e a leitura da Home espera no máximo o tempo da transação.

## CHECKPOINT 3 — logo depois da migração

**Tito (SQL Editor, SOMENTE LEITURA):** rodar `supabase/rollout/sequencia-checkpoint-3-depois.sql`.

| Coluna | Esperado |
|---|---|
| `tudo_certo` | `true` (marco único e coerente, gatilhos ligados, permissões, porta do servidor) |
| `jogadores_com_sequencia` | `0`: **ninguém nasceu com sequência** |
| `xp_total`, `lancamentos`, `xp_no_ledger` | os do checkpoint 1 (ou maiores, só por crédito novo) |
| `progresso_divergente_do_ledger`, `retrato_divergente_do_ledger` | `0`, `0` |
| `partidas_a_partir_de` | **anotar**: só conta partida iniciada a partir deste instante (marco + 5 min de margem de relógio) |

**PARAR** se `tudo_certo` não for `true`.

## CHECKPOINT 4 — a aplicação

1. **Fast-forward puro da `main`** (eu): `git merge --ff-only` até o SHA aprovado e `git push origin main`.
   - Sem merge commit, sem rebase e sem force push.
   - Depois, conferir `main = feat/streak-v1`.
2. **Deploy:** aguardar o deployment de Production da Vercel ficar Ready, com o SHA aprovado.
3. **Smoke:**
   - apex e `www` respondem;
   - Home e `/privacidade` abrem;
   - o Google continua oculto;
   - o console fica sem erro;
   - sem sessão, nenhuma chamada ao Supabase.
4. **Partida online real controlada**, iniciada **depois de `partidas_a_partir_de`**. Quem joga é o
   Tito, em dois aparelhos ou com outra pessoa; **eu não crio usuário de teste em Production**.
   - Placar Final: `+N XP` e **`🔥 Sequência: 1 dia`**.
   - Home: **`🔥 Sequência 1 dia`**, em ouro.
   - Refresh no Placar: o mesmo número.
   - 2ª partida no mesmo dia: XP, e **nenhuma** linha de sequência.
   - Repetir o checkpoint 3: `retrato_divergente_do_ledger = 0` e `progresso_divergente_do_ledger = 0`.

## CHECKPOINT 5 — rollback (pronto; NÃO executar se tudo estiver saudável)

- **Banco:** colar `supabase/rollback/20261001120000_sequencia_rollback.sql` **inteiro** e rodar uma vez.
  - Última tela: **`SEQUÊNCIA REMOVIDA E CONFERIDA`**.
  - Ele remove só os objetos da sequência. XP, ledger e partidas ficam intactos (ele confere antes
    do commit), e nada é recalculado.
- **Web:** pelo "Instant Rollback" da Vercel para o deployment anterior. Não precisa mexer no Git e
  não há force push.
- **Ordem:** livre, porque a web nova funciona sem as colunas novas (prova "compat"). Recomendado:
  - banco primeiro, se o problema estiver no banco;
  - web primeiro, se estiver na tela.
- **Reaplicar depois:** grava um **marco novo**. A sequência recomeça do zero, e nada antigo é
  reconstruído.

## Segurança do rollout (H)

**Operações destrutivas ou irreversíveis no rollout: nenhuma.** A migração é aditiva:

| Operação | Natureza |
|---|---|
| `ALTER TABLE progresso ADD COLUMN ×4` (default constante, sem reescrita) + 3 `CHECK` | aditiva; o rollback remove |
| `CREATE TABLE king_private.sequencia_inicio` (o marco) + 2 gatilhos de imutabilidade | aditiva; o rollback remove |
| `CREATE FUNCTION ×6`, `CREATE TRIGGER xp_eventos_sequencia` | aditiva; o rollback remove |
| `CREATE OR REPLACE VIEW meu_progresso` (as 5 colunas de antes intactas + 5 no fim) | compatível; o rollback recria a original |
| `GRANT/REVOKE` em objetos novos e na view (a view mantém os mesmos privilégios de antes) | sem abertura |
| `LOCK TABLE progresso` durante a transação | temporária |

- O **marco** é imutável enquanto existir, de propósito. Refazer exige rollback e nova aplicação, à
  vista, e a sequência recomeça do zero.
- O **rollback** é destrutivo **só para os dados da sequência**: perde-se o retrato. XP, ledger e
  partidas nunca.

| Exigência | Como está garantida |
|---|---|
| Sem `service_role` | ninguém o usa: nem a web, nem o servidor, nem o rollout. O SQL Editor usa o papel do Dashboard. A conferência 6 prova que ele não escreve no ledger, no progresso nem no marco |
| Sem novos writes públicos | conferência 6: nenhuma escrita para `anon`, `authenticated`, `service_role` ou `king_server` em progresso, ledger ou marco |
| `anon` sem execute | conferência 7: nenhuma função nova executável por `anon` |
| `authenticated` só leitura autorizada | `SELECT` em `meu_progresso` (próprio, pelo RLS) e `EXECUTE` só nas 3 funções puras de data; nada privado |
| `king_server` só a porta necessária | segue com EXECUTE só em `creditar_partida`; nenhuma função nova para ele (conferência 7) |
| Nenhuma função privilegiada nova | conferência 8: a lista de `SECURITY DEFINER` em `public`/`king_private` não muda |
| Sem auth, Google e analytics novos | nenhuma linha de auth, Google ou evento de analytics nesta fase |
| VPS intocada | o servidor do jogo não muda |

## Provas (locais, Postgres real)

| O quê | Onde |
|---|---|
| o arquivo do rollout é a migração verbatim; com backfill, aborta sem gravar nada; colado duas vezes, recusa | S23 |
| ensaio completo com os arquivos de verdade: base realista (histórico, sem XP, outbox antigo, partida atravessando o marco) → aplicar → créditos → rollback → reaplicar | S22 |
| migração → rollback → migração, sem reconstrução | S17 |
| concorrência no instante do marco (crédito em curso; crédito chegando durante a migração) | S21, S21b |
| marco único e imutável | S20 |
| partida online inteira, com crédito e sequência reais, Placar e Home nos 4 viewports | `npm run test:e2e:sequencia` (apps/web) |
| web nova contra o banco de hoje, sem a migração | `npm run test:e2e:sequencia:compat` (apps/web) |
