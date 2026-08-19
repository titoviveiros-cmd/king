# KING — Arquitetura

## Princípio
Camadas isoladas; lógica crítica nunca no cliente. O **servidor é a autoridade**: decide
distribuição, vazas, pontuação, turno, trunfo e vencedor. O cliente apenas **representa**.

## Camadas (seção 58 do Prompt Mestre)
| Camada | Responsabilidade | Estado |
|--------|------------------|--------|
| **Game Engine** | Regras puras, determinísticas, testáveis. Sem UI/rede. | ✅ implementado (`packages/engine`) |
| **Multiplayer Engine** | Salas, matchmaking, sincronização autoritativa, reconexão, timeout. | ⏳ Fase 6 (`apps/server`, Colyseus) |
| **Presentation** | UI, game feel, animações, partículas. | ⏳ Fase 4–5 (`apps/web`, React) |
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
