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

## Continuar em outra máquina
Todo o trabalho vive no Git — nada essencial fica só no disco local. Para retomar noutro
computador:

```
git clone https://github.com/titoviveiros-cmd/king.git
cd king
git checkout feat/placar-audio-responsividade   # branch de trabalho atual
npm install
npm test
npm run dev
```

Antes de trocar de máquina, na que você está deixando:

```
git status          # precisa estar limpo
git push            # a branch precisa estar no remoto
```

O que **não** vem no clone e é normal:
- `node_modules/` — resolvido pelo `npm install`.
- Regra de firewall e IP da rede local, se você testa no celular. São por máquina; veja
  "Testar no celular" abaixo.
- Preferências de áudio (Música / Efeitos / Vibração) — ficam no navegador de cada aparelho.

## Testar no celular (mesma rede Wi-Fi)
Por padrão o `npm run dev` escuta **só nesta máquina** (`127.0.0.1:5173`): ninguém na rede alcança o
servidor de desenvolvimento. Para abrir no celular, ligue a rede local **só durante o teste**:

```
$env:KING_DEV_LAN = "1"; npm run dev
```

(No Git Bash: `KING_DEV_LAN=1 npm run dev`.) Aí o terminal mostra `Network: http://SEU-IP:5173/` — é
esse que se abre no celular, **com `http://` explícito** (o Safari tenta HTTPS sozinho e falha).
Qualquer outro valor (ou nenhum) mantém o servidor restrito a esta máquina.

Regras para a exceção de rede local:
- Só em **Wi-Fi privado** (casa/escritório), nunca em rede pública ou compartilhada.
- Firewall do Windows limitado à **sub-rede local** (`-RemoteAddress LocalSubnet`) e ao perfil Privado.
  No PowerShell **como Administrador**:

```
Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private
New-NetFirewallRule -DisplayName "KING dev server (Vite 5173)" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private -RemoteAddress LocalSubnet
```

- **Depois do teste**, remova a exceção e feche o terminal (ou `Remove-Item Env:KING_DEV_LAN`):

```
Remove-NetFirewallRule -DisplayName "KING dev server (Vite 5173)"
```

`?seed=N` na URL fixa a semente e reproduz uma partida idêntica — o motor é determinístico.
Útil para revisar uma tela específica ou reproduzir um bug relatado.

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
- 🔵 Fase 4–5 — apresentação: base jogável, **Placar entre-mãos** (congelado) e **Placar Final**
  (em validação), áudio procedural e responsividade.
- 🔵 **Milestone 2** (branch `feat/quality-infrastructure`): CI no GitHub Actions, Playwright de
  layout em 7 viewports, preview na Vercel, score ao vivo por vaza e game feel das mãos
  negativas (selo do castigo). **149 testes** — 66 motor + 17 web + 66 layout.
- ⏭️ Próximo milestone aprovado: **Bot Normal V1** (heurístico), depois multiplayer autoritativo.
- ⏳ Fase 6 multiplayer → Fase 9 release.

## Invariantes garantidas pelos testes
Deck 52 únicos · deal 4×13 · servir/baldar · regra do K♥ · checksums **−1300 / +1300 / 0** ·
cada jogador escolhe 1 trunfo · jogada ilegal rejeitada pela autoridade.
