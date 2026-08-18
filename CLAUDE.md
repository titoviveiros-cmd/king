# KING — Projeto (contexto para o Claude Code)

KING é o **2º jogo da família criativa do Verbete** (mesmo criador — "irmãos, não gêmeos").
Jogo de **vazas, 4 jogadores, todos contra todos**, baralho de 52 cartas, 13 por jogador,
**10 mãos** (6 negativas + 4 positivas). Premium, **mobile-first, multiplayer-first, landscape**.
Idioma: **pt-BR**.

## Fontes de verdade (LER antes de agir)
- `docs/KING-RULES.md` — **regras oficiais** (não alterar nem usar variantes da internet).
- `docs/KING-GAME-DESIGN.md` — bíblia de design (visão, DNA, telas, UX).
- `docs/KING-ARCHITECTURE.md` — camadas, API do motor, multiplayer, **regra de ready** do lobby.
- `docs/KING-TEST-PLAN.md` — invariantes e checksums.
- `docs/VERBETE-GAME-DNA.md` — DNA herdado do Verbete (ratificado).
- `docs/KING-DESIGN-SYSTEM.md` — **design system oficial** (Home/Lobby/Mesa congelados, tokens, motion).

## Decisões já congeladas
- **Stack:** monorepo **npm workspaces** → `packages/engine` (motor TS puro, testável),
  `apps/web` (React + Vite), futuro `apps/server` (Colyseus, multiplayer) + **Capacitor** (app).
- **Regras-chave:** hierarquia A>K>Q>J>10>…>2; **K♥ na mão 5 = forçado a jogar o Rei**; proibido
  abrir Copas (só mãos 2 e 5); rotação de trunfo **M7→P0 … M10→P3**; **empate = empate**;
  checksums **−1300 / +1300 / 0** (testes obrigatórios).
- **Tipografia:** **Gabarito** (display) + **Nunito** (corpo). **Paleta imperial** (Noite Imperial,
  Roxo Real, Violeta Glow, Ouro Coroa; **turquesa = positivo**, magenta = tensão/King). Botão *candy*;
  motion `floatIdle` / `glowPulse` / `riseIn`. Sem feltro verde, sem cassino.
- **Personagem "O Rei":** congelado (híbrido Estrategista×Carismático, barbeado, coroa-símbolo V+gema).
  Arte final 2.5D é etapa futura.
- **Telas oficiais congeladas:** Home, Lobby, Mesa (arquitetura). Landscape em toda a app.

## Como rodar (requer Node.js LTS)
```
npm install     # workspaces
npm test        # motor + checksums do KING
npm run dev     # base web
```

## Processo de trabalho (importante)
- Apresentar propostas e **aguardar validação** antes de mudanças grandes/irreversíveis.
- **Não** derivar várias telas de uma vez — uma por vez, com aprovação.
- **Nunca** alterar regras/pontuação/identidade em silêncio — propor antes.
- **Verbete** = referência de DNA, **somente leitura**, nunca copiar telas/assets.
- Estado atual e próximos passos: ver os `docs/` (a Mesa e a prova de game feel são os checkpoints
  mais recentes).
