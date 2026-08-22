# KING — Plano de Testes

> Status: **executados e verdes**. `npm test` roda os dois workspaces
> (`packages/engine/src/*.test.ts` + `apps/web/src/**/*.test.ts`) e `npm run test:e2e` roda o
> Playwright de layout. `npm run ci` encadeia os três.
>
> **Contagem no encerramento do Milestone 2:** 66 motor + 17 web + 66 layout = **149 testes**.
>
> **CI validado de verdade:** GitHub Actions executa em toda PR e nos pushes de `main` e
> `feat/**`. A execução do HEAD `10e5c6e` concluiu **verde em 137s** com todos os passos —
> `npm ci`, testes, build, instalação do Chromium e layout. Não houve travamento na instalação
> do navegador; nenhuma flexibilização do workflow foi necessária.

## Invariantes obrigatórias (seção 60)
| Invariante | Onde |
|-----------|------|
| Deck: 52 cartas únicas | `cards.test.ts` |
| Deal: 4×13 = 52, sem duplicata | `cards.test.ts`, `match.test.ts` |
| Servir: não baldar tendo o naipe | `rules.test.ts` |
| Vaza = 4 cartas; mão = **até** 13 vazas | `encerramento.test.ts` (contrato a contrato) |
| M1, M6 e M7–M10 sempre chegam à 13ª vaza | `encerramento.test.ts` |
| M2–M5 encerram quando o contrato se resolve | `encerramento.test.ts` |
| Cartas abandonadas nunca contam como jogadas | `encerramento.test.ts` |
| Partida = 10 mãos | `match.test.ts` (`history.length === 10`) |
| Checksum negativo = −1300 | `match.test.ts` |
| Checksum positivo = +1300 | `match.test.ts` |
| Checksum final = 0 | `match.test.ts` (60 sementes) |
| Cada jogador escolhe 1 trunfo | `match.test.ts` |
| Explicação da mão bate com a pontuação | `contracts.test.ts` (`handBreakdown` × `scoreHand`) |
| Ranking anterior + delta = ranking atual | `match.test.ts` (`handSummary`) |
| **Dados do Placar Final indexados por assento** (regressão `ranking × seat`) | `placarFinalDados.test.ts` |

## Testes por contrato (seção 61)
- **no-tricks / no-hearts / no-queens / no-men / no-king / no-last-two / positive** →
  `contracts.test.ts` valida o incremento de cada regra.
- **King** contabilizado **exatamente uma vez** (−160 a um só jogador) → `match.test.ts`.
- **Duas últimas:** só as vazas 12 e 13 pontuam → `contracts.test.ts`.
- **Cada mão distribui exatamente o total do contrato** → `match.test.ts`. Isso vale **também**
  no encerramento antecipado: ele só ocorre quando a última carta penalizada já saiu, então nada
  é perdido. Prova por contrato em `encerramento.test.ts`.

## Testes de trunfo (seção 62)
- Sem trunfo, um trunfo, múltiplos trunfos, obrigação de servir, "Sem Trunfo" → `rules.test.ts`.

## Regra do Rei de Copas (mão 5)
- Copas puxada + K♥ ⇒ forçado a jogar o K♥.
- Sem o naipe puxado + K♥ ⇒ forçado a descartar o K♥.
- Sem o K♥ ⇒ segue normalmente. → `rules.test.ts`.

## Autoridade / determinismo
- Jogada fora de turno é rejeitada; positiva bloqueia jogadas antes do trunfo → `match.test.ts`.
- Mesma semente ⇒ mesmo resultado → `match.test.ts`.
- Empate ⇒ mesma posição (sem desempate inventado) → `match.test.ts`.

## Fase 3 — Simulação em massa (a fazer com Node)
Rodar milhares de partidas via `simulateMatch` procurando: deadlocks, jogadas impossíveis,
checksum errado, estados inválidos, mãos incompletas, pontuação impossível.

## Estatísticas da partida
- `matchStats` agrega o histórico sem recalcular regra: melhor/pior mão por assento, negativas
  ilesas, dono do K♥, maior mão da partida e margem da liderança → `stats.test.ts`.
- Invariante checada: as vazas positivas dos 4 assentos somam **52** (4 mãos × 13).

## Placar Final — indexação por assento (regressão `ranking × seat` registrada ✅)
`rankings()` devolve as linhas **ordenadas por posição**. Usar esse array como índice de
jogador troca a pontuação entre jogadores — foi um bug que chegou à tela do Tito: o 2º colocado
exibia o número do 3º. Todo vetor do Placar Final passa por `placarFinalDados.ts`, que só
produz vetores **indexados por assento**, com regressão em `placarFinalDados.test.ts`
(inclui um ranking com assentos fora de ordem, exatamente o caso do bug).

**Regra arquitetural associada:** `seat` é a identidade estável do jogador; ranking/posição é
só ordenação de apresentação; nunca indexar dado persistente ou de gameplay pela posição visual
do ranking. Ver [KING-ARCHITECTURE.md](KING-ARCHITECTURE.md#identidade-do-jogador-seat--regra-arquitetural).

**Cobertura (`placarFinalDados.test.ts`, 6 testes):** `scoresPorAssento` reindexa por assento a
partir de um ranking com assentos fora de ordem; os saldos "antes" (total − delta) também ficam
por assento; a interpolação da contagem animada preserva os extremos; numa partida real, o vetor
por assento é idêntico a `m.cumulative` e **soma 0**.

## Mesa — pontuação pública AO VIVO por assento (`liveScores`)
O card de cada jogador na Mesa incorpora o delta **no instante em que a vaza é resolvida** — sem
esperar fim de mão/fase. A fonte é `liveScores(m)` no motor = `m.cumulative` (consolidado) **+**
`scoreHand` sobre as vazas **já resolvidas** da mão em curso; ao encerrar a mão o parcial zera e
`liveScores == cumulative` (sem dupla contagem). Nenhuma regra nova na UI — a Presentation só lê.
- **Motor** (`match.test.ts`): a cada vaza resolvida, `liveScores == cumulativo + scoreHand(vazas
  resolvidas)` nas 10 mãos, e `== cumulative` ao encerrar; prova tabelada de que o delta por
  contrato (M1 −20/vaza … M7–10 +25/vaza) chega ao vencedor no instante da vaza.
- **Mesa** (`mesaScore.test.tsx`): renderiza a Mesa real vaza a vaza e confere, por **assento**,
  card == `liveScores` — Mão 1 incremental (−20 ao vencedor, outro mantém), acúmulo entre mãos
  (não reinicia) e +25 imediato na fase positiva.

## Placar entre-mãos (apresentação sobre o motor)
- `handBreakdown` explica CADA contrato (unidades capturadas × pontos) e é comparado célula a
  célula com `scoreHand` → `contracts.test.ts`.
- `handSummary` entrega ao Placar: delta da mão, ranking antes/depois, trunfo + quem escolheu,
  encerramento antecipado e próximo contrato → `match.test.ts`.
- O adaptador da UI vê **um placar por mão**, na ordem, com os checksums preservados →
  `apps/web/src/game/kingGame.test.ts`.

## Testes multiplayer (Fase 6, seção 63)
4 humanos; humanos + bots; disconnect; reconnect; timeout; app em background; ação duplicada;
ação atrasada; ação fora de turno; tentativa ilegal; host sai; jogador retorna.

## Como rodar (após instalar o Node.js LTS)
```
npm install
npm test
```
