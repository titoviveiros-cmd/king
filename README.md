# KING — jogo de cartas multiplayer (web + app)

Segundo título da **família criativa do Verbete**. Jogo de vazas para 4 jogadores, 10 mãos
(6 negativas + 4 positivas). Monorepo. Stack: React + TypeScript (web) + Capacitor (app);
servidor Colyseus (multiplayer, fase futura). Orientação de gameplay: **Landscape**.

## Pré-requisito
**Node.js LTS** (>= 18). Confira com `node -v` / `npm -v`.

## Rodar
```
npm install     # instala os workspaces
npm test        # testes do motor + do adaptador web (Vitest) — inclui os checksums do KING
npm run dev     # base web jogável (React) em http://localhost:5173
```

## Estrutura
```
packages/engine   Rule Engine puro (TypeScript). Simula partida inteira sem tela.
                  cards · contracts · rules · match · sim  (+ testes *.test.ts)
apps/web          Base web React + Vite (visual definitivo pendente de validação).
docs/             Documentação formal (design, regras, arquitetura, testes).
demo/             Protótipo visual antigo (genérico) — será substituído pela identidade KING.
```

## Documentação (`docs/`)
- [KING-GAME-DESIGN.md](docs/KING-GAME-DESIGN.md) — bíblia de design (visão, DNA, telas, UX).
- [KING-RULES.md](docs/KING-RULES.md) — regras oficiais (fonte de verdade).
- [KING-ARCHITECTURE.md](docs/KING-ARCHITECTURE.md) — camadas, API do motor, multiplayer.
- [KING-TEST-PLAN.md](docs/KING-TEST-PLAN.md) — invariantes e checksums.

## Estado (fases do Prompt Mestre)
- ✅ Fase 1 — Documentação formal.
- ✅ Fase 2 — Rule Engine (testes **executados e verdes**).
- ✅ Fase 3 — simulação em massa (`stress.test.ts`).
- 🔵 Fase 4–5 — apresentação: base jogável (1 humano + 3 bots) + **Placar entre-mãos**.
- ⏳ Fase 6 multiplayer → Fase 9 release.

## Invariantes garantidas pelos testes
Deck 52 únicos · deal 4×13 · servir/baldar · regra do K♥ · checksums **−1300 / +1300 / 0** ·
cada jogador escolhe 1 trunfo · jogada ilegal rejeitada pela autoridade.
