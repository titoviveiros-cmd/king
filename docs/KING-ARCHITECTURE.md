# KING — Arquitetura

## Princípio
Camadas isoladas; lógica crítica nunca no cliente. O **servidor é a autoridade**: decide
distribuição, vazas, pontuação, turno, trunfo e vencedor. O cliente apenas **representa**.

## Camadas (seção 58 do Prompt Mestre)
| Camada | Responsabilidade | Estado |
|--------|------------------|--------|
| **Game Engine** | Regras puras, determinísticas, testáveis. Sem UI/rede. | ✅ implementado (`packages/engine`) |
| **Multiplayer Engine** | Salas, matchmaking, sincronização autoritativa, reconexão, timeout. | ⏳ Fase 6 (`apps/server`, Colyseus) |
| **Presentation** | UI, game feel, animações, partículas. | 🔵 Fase 4–5 em curso (`apps/web`, React) — ritmo em `game/timings.ts` |
| **Audio** | Música / efeitos / haptics (controles separados). | ✅ implementado (`apps/web/src/audio`, procedural) |
| **Persistence** | Perfil, XP, progressão, cosméticos. | ⏳ Fase 7 |
| **Analytics** | Eventos desacoplados. | ⏳ Fase 7 |
| **Social** | Amigos, convites, emotes, compartilhamento. | ⏳ Fase 7 |

## Stack (decidida)
- **Web:** React + TypeScript + Vite. Empacotamento em app via **Capacitor** (Android/iOS),
  mesma base de código. Orientação de gameplay: **Landscape**.
- **Servidor:** Node.js + **Colyseus** (salas em tempo real, sincronização de estado, reconexão).
- **Monorepo:** npm workspaces (`packages/*`, `apps/*`).

## Game Engine (`packages/engine`) — API pública
Motor puro; simula partida inteira **sem renderizar tela**. Determinístico por semente.

| Função | Papel |
|--------|-------|
| `createMatch(players, seed)` | Cria a partida; define assentos e P0. |
| `startNextHand(m)` | Embaralha (determinístico) e distribui a próxima das 10 mãos. |
| `selectTrump(m, seat, trump)` | Escolha de trunfo nas mãos positivas (só o assento da rotação). |
| `legalCardsFor(m, seat)` | Cartas legais do jogador da vez (servir/baldar/contrato). |
| `playCard(m, seat, card)` | Valida e aplica a jogada; resolve a vaza; avança. Lança erro se ilegal. |
| `rankings(m)` | Classificação com empate = mesma posição. |
| `rankFrom(players, cum, neg, pos)` | Classifica quaisquer saldos (usado p/ o ranking **anterior** à mão). |
| `handBreakdown(kind, tricks)` | Explica a pontuação: o que cada assento capturou e quanto valeu. |
| `handSummary(m)` | Pacote do **Placar entre-mãos**: delta, ranking antes/depois, trunfo, próximo contrato. |
| `matchStats(m)` | Destaques da partida: melhor/pior mão, negativas ilesas, quem levou o K♥, margem. |
| `matchWinners(m)` | Assento(s) campeão(ões). |
| `publicView(m, seat)` | **Visão redigida** para o cliente (informação oculta — sem mãos alheias). |
| `simulateMatch(m, rng)` | Driver de simulação legal-aleatória (Fase 3 / testes). |

> O Placar **não recalcula nada**: `handSummary` é a fonte única do que aparece entre as mãos
> (e no fim da partida). A apresentação só formata texto pt-BR.

Módulos: `cards.ts` (baralho/força), `contracts.ts` (10 contratos + pontuação), `stats.ts` (destaques),
`rules.ts` (legalidade + resolução de vaza), `match.ts` (máquina de estado), `sim.ts` (simulação).

## Identidade do jogador (`seat`) — regra arquitetural
Regra **invariante** de todo o KING (motor, UI e futuro multiplayer/persistência):

- **`seat` (0–3) é a identidade estável do jogador.** Toda estrutura de dados — mão, pontuação,
  cumulativo, negativas/positivas, avatar, nome, estatísticas, snapshot de reconexão — é
  **indexada por assento**. O assento não muda durante a partida.
- **Ranking / posição é SOMENTE ordenação de apresentação.** `rankings(m)` devolve as linhas
  **ordenadas por classificação** (1º, 2º, …), com empate = mesma posição. Essa ordem serve
  apenas para desenhar a lista na tela.
- **NUNCA indexar dado persistente ou de gameplay pela posição visual do ranking.** Usar o índice
  de uma linha de `rankings()` como se fosse o assento **troca os dados entre jogadores**. Cada
  `RankRow` carrega o seu `seat` — é por ele que se buscam nome, avatar, cor e pontuação.

> **Origem da regra (regressão real):** um vetor do Placar Final foi indexado pela posição do
> ranking em vez do assento e a pontuação de dois jogadores apareceu trocada na tela do Tito.
> Correção: todo vetor do Placar Final passa por
> [`placarFinalDados.ts`](../apps/web/src/ui/placarFinalDados.ts) (só produz vetores **por
> assento**), com regressão em `placarFinalDados.test.ts`. Ver [KING-TEST-PLAN.md](KING-TEST-PLAN.md).

## Multiplayer autoritativo (Fase 6)
- Fluxo por sala: o servidor mantém `MatchState`; clientes enviam **intenções** (`playCard`,
  `selectTrump`) e recebem `publicView` + eventos.
- **Informação oculta:** cada cliente recebe só a própria mão + o que é público. Nunca enviar
  as mãos dos adversários (nem "escondidas" no frontend).
- **Segurança (seção 64):** nunca confiar em pontuação, carta, ordem, timer ou resultado
  vindos do cliente. Validar tudo na autoridade (`playCard` já lança erro em jogada ilegal).

## Reconexão (seção 39)
Tratada como funcionalidade central: autenticar → localizar partida → obter **snapshot
autoritativo** (`publicView`) → reconstruir mesa → reorganizar cartas → retomar estado.
Mensagem "Reconectando à partida…" (nunca `WebSocket disconnected`).

## Lobby / Ready (sala privada) — regra oficial
Fonte única de verdade UI × multiplayer:
- A sala tem **exatamente 4 assentos**.
- Cada **jogador humano** precisa marcar **PRONTO**.
- **Bots** são **automaticamente prontos** ao entrar.
- Apenas o **anfitrião** pode iniciar.
- **COMEÇAR** só habilita quando **os 4 assentos estão ocupados E todos os humanos estão prontos**.
- Assento vazio comunica disponibilidade com **ação principal "Convidar"** + ação secundária
  discreta **"Adicionar bot"** (convidar pessoa ≠ adicionar IA).
- Status contextual abaixo do CTA é **dinâmico e não técnico** (ex.: "2 vagas disponíveis",
  "Aguardando Bia ficar pronta…", "Todos prontos!").
- Entrada/saída de jogador preserva o motion: entra → card com pop/stagger + som social curto;
  sai → saída suave; bot adicionado → feedback próprio, distinto de humano.

## Timeout (seção 40)
Política parametrizável: tempo normal → aviso → crítico → ação após timeout. Nunca travar a
partida indefinidamente; nunca curto a ponto de prejudicar iniciantes.

## Roadmap aprovado (auditoria de 18/08/2026)
1. **Concluir o milestone atual:** validação do Placar Final + **avaliação auditiva do áudio em
   aparelho real** + último ciclo de testes/build. Só então PR e integração à `main`.
2. **Bot Normal V1** — próxima prioridade, **antes do multiplayer**. Heurístico e suficiente:
   compreender contratos, evitar penalidades, buscar vazas positivas e escolher trunfo
   racionalmente. **Não overengineer** (nada de busca em árvore ou modelo de oponente).
3. **Multiplayer autoritativo** (Colyseus) — prioridade imediata depois do Bot Normal.

> **Trava explícita antes do multiplayer:** a identidade sonora **não pode ser congelada** antes
> de o áudio ser ouvido em aparelho real. A arquitetura sonora foi construída tecnicamente, mas
> ainda não houve julgamento estético por ouvido. Isso **não bloqueia** o Bot Normal.

## Bots (seção 41)
Usam a **mesma API do motor** e **nunca** informação oculta (isso seria cheat). "Bot Normal":
respeita regras, serve/balda corretamente, entende o contrato, evita penalidades, busca vazas
positivas e escolhe trunfo racionalmente. O driver `sim.ts` é a base técnica (ainda não é o bot final).

## Determinismo
Embaralhamento por semente (`createRng`, mulberry32) combinada com o número da mão. Mesma
semente ⇒ mesma partida — essencial para testes, reprodução de bugs e autoridade.

A base web expõe isso em `?seed=N`: fixa a semente da partida solo. Serve para reproduzir um
bug relatado e para revisar uma tela específica sem depender de sorte (foi assim que o cenário
de vitória do jogador local foi montado para validar o Placar Final).
