# KING — Plano de Testes

> Status: **executados e verdes** — `npm test` roda os dois workspaces
> (`packages/engine/src/*.test.ts` + `apps/web/src/**/*.test.ts`).

## Invariantes obrigatórias (seção 60)
| Invariante | Onde |
|-----------|------|
| Deck: 52 cartas únicas | `cards.test.ts` |
| Deal: 4×13 = 52, sem duplicata | `cards.test.ts`, `match.test.ts` |
| Servir: não baldar tendo o naipe | `rules.test.ts` |
| Vaza = 4 cartas; mão = 13 vazas | implícito nos totais (`match.test.ts`) |
| Partida = 10 mãos | `match.test.ts` (`history.length === 10`) |
| Checksum negativo = −1300 | `match.test.ts` |
| Checksum positivo = +1300 | `match.test.ts` |
| Checksum final = 0 | `match.test.ts` (60 sementes) |
| Cada jogador escolhe 1 trunfo | `match.test.ts` |
| Explicação da mão bate com a pontuação | `contracts.test.ts` (`handBreakdown` × `scoreHand`) |
| Ranking anterior + delta = ranking atual | `match.test.ts` (`handSummary`) |

## Testes por contrato (seção 61)
- **no-tricks / no-hearts / no-queens / no-men / no-king / no-last-two / positive** →
  `contracts.test.ts` valida o incremento de cada regra.
- **King** contabilizado **exatamente uma vez** (−160 a um só jogador) → `match.test.ts`.
- **Duas últimas:** só as vazas 12 e 13 pontuam → `contracts.test.ts`.
- **Cada mão distribui exatamente o total do contrato** → `match.test.ts` (prova implícita de
  que houve 13 vazas e nenhuma dupla contagem).

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
