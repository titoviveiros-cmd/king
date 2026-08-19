# KING — Regras Oficiais (fonte de verdade)

> Estas regras são a **fonte de verdade do produto**. Não substituir por variantes da
> internet. Não adicionar modos do King tradicional (duplas, leilão, nulos, jogar para baixo,
> negociação de vazas, variações regionais, torneio) sem autorização.

## 1. Estrutura
- **4 jogadores**, todos contra todos (sem parcerias).
- Baralho **padrão de 52 cartas**; **13 cartas** por jogador; todas as 52 usadas em cada mão.
- Uma **partida = 10 mãos**. Cada mão = **13 vazas**.
- **6 mãos negativas** (evitar pontos) + **4 mãos positivas** (buscar pontos).

## 2. Hierarquia das cartas
`A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2` (implementada em `RANK_ORDER`).

## 3. Assentos, dealer e ordem (determinístico)
- Os 4 jogadores ocupam os assentos **0..3** na ordem em que a partida é criada.
  **P0 = assento 0** (definido pela camada que cria a partida: servidor/matchmaking; fixo em solo).
- **Dealer inicial = P0.** Dealer da mão `h` = `(0 + (h−1)) mod 4`.
- A **1ª vaza** de cada mão é aberta pelo jogador **à esquerda do dealer** = `(dealer+1) mod 4`.
- Vazas seguintes: abre **quem venceu a vaza anterior**.
- Ordem de jogo dentro da vaza: o abridor e depois em sentido horário (`+1 mod 4`).

## 4. Servir e baldar
- Uma vaza começa quando o abridor joga uma carta, que define o **naipe puxado**.
- **Servir (obrigatório):** se o jogador tem o naipe puxado, só pode jogar cartas desse naipe.
- **Baldar:** se não tem o naipe puxado, pode jogar qualquer carta (respeitando o contrato).
- A UI deve tornar cartas ilegais **indisponíveis**; o servidor **revalida** sempre.

## 5. Vencedor da vaza
- **Sem trunfo** (todas as negativas e "Sem Trunfo"): vence a **maior carta do naipe puxado**.
  Cartas baldadas de outros naipes **não** vencem.
- **Com trunfo** (positivas com trunfo): se houve trunfo na vaza, vence o **maior trunfo**;
  senão, a maior do naipe puxado. Trunfo **não** dispensa de servir.

## 6. Mãos negativas (1–6) e pontuação

| # | Contrato | Penalidade | Total da mão |
|---|----------|-----------|--------------|
| 1 | Não pegar Vazas | −20 por vaza | **−260** |
| 2 | Não pegar Copas | −20 por carta de Copas | **−260** |
| 3 | Não pegar Damas | −50 por Dama (4) | **−200** |
| 4 | Não pegar Reis e Valetes | −30 por carta (8) | **−240** |
| 5 | Não pegar o Rei de Copas | −160 a quem levar a vaza do K♥ | **−160** |
| 6 | Não pegar as duas últimas | −90 na 12ª e −90 na 13ª | **−180** |

### Restrições especiais
- **Não abrir Copas** (apenas mãos **2 e 5**): não pode **abrir** uma vaza com Copas
  enquanto tiver carta de outro naipe. (Nas mãos 1, 3, 4 e 6 **não** há essa restrição.)
- **Regra do Rei de Copas (mão 5)** — o K♥ deve ser jogado na **primeira oportunidade legal**:
  1. Se **Copas é puxada** e o jogador tem o K♥, é **forçado a jogar o K♥** (mesmo com outras copas).
  2. Se o jogador está **sem o naipe puxado** (vai descartar) e tem o K♥, é **forçado a descartá-lo**.
  - Nenhuma animação pode revelar antecipadamente quem tem o K♥.
- **Encerramento antecipado (regra geral das negativas):** uma mão negativa **termina assim que
  TODAS as suas cartas penalizadas já foram capturadas** — pois não há mais pontos em disputa.
  Aplica-se a: **Mão 2** (as 13 Copas), **Mão 3** (as 4 Damas), **Mão 4** (os 8 Homens) e **Mão 5**
  (o K♥). As mãos **1** (não fazer vazas) e **6** (duas últimas) e as **positivas** sempre jogam as
  **13 vazas**. Ao encerrar, segue-se direto para a próxima mão.

## 7. Mãos positivas (7–10)
- Cada vaza vale **+25** ao vencedor → **+325 por mão**, **+1300** nas quatro.
- **Escolha de trunfo:** o jogador beneficiado, após receber as 13 cartas, escolhe
  ♥ / ♦ / ♣ / ♠ ou **Sem Trunfo**. Os demais veem após a confirmação.
- **Rotação determinística:** M7→P0, M8→P1, M9→P2, M10→P3 — cada jogador escolhe **exatamente uma vez**.

## 8. Checksums (invariantes matemáticas — testes obrigatórios)
- Negativas: `−260 −260 −200 −240 −160 −180 = **−1300**`.
- Positivas: `4 × 325 = **+1300**`.
- **Partida completa:** `sum(finalScores) === 0`. Se não for zero, a partida é **inconsistente** —
  **nunca corrigir em silêncio**; descobrir a causa.

## 9. Vencedor e desempate
- Após a 10ª mão, vence **a maior pontuação final** (saldo = positivos + negativos).
- **Desempate:** *não definido neste momento.* Em caso de igualdade na maior pontuação,
  **registrar empate** na colocação. Critério competitivo de desempate será definido depois —
  não inventar.

## 10. Escopo — NÃO implementar (sem autorização)
Duplas, leilão de benefícios, nulos, jogar para baixo, negociação de vazas, variações
regionais, modalidades de torneio. Poderão ser avaliados futuramente como modos adicionais.
