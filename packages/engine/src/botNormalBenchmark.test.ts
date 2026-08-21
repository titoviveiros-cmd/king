// BATERIA DIAGNÓSTICA (ETAPA 3A) — Bot Normal V1 (c62f5e3) × Baseline. NÃO altera produção.
// Isolado: só roda com BENCH=1 (it.runIf), fora da suíte normal/CI. Mede, não ajusta.
//   BENCH=1 npx vitest run packages/engine/src/botNormalBenchmark.test.ts
import { describe, it, expect } from "vitest";
import { sameCard } from "./cards.js";
import { HAND_CONTRACTS, type Seat, type Trump } from "./contracts.js";
import { createMatch, startNextHand, selectTrump, playCard, legalCardsFor, type MatchState } from "./match.js";
import { chooseBotCard, chooseBotTrump } from "./bot.js";
import { buildBotView } from "./botView.js";
import { chooseNormalCard, chooseNormalTrump } from "./botNormal.js";

/**
 * Leitura do ambiente com tipagem LOCAL. O tsconfig do motor alcança os `.test.ts` e o projeto
 * não tem `@types/node`, então `process` não existe para o TypeScript aqui — era o que deixava
 * o build vermelho. `globalThis.process.env` é exatamente o mesmo objeto em runtime: nenhum
 * valor, default ou comportamento muda; só o compilador passa a ter um tipo para olhar.
 */
const ENV: Record<string, string | undefined> =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const RUN = ENV.BENCH === "1";

/**
 * Intervalo de seeds vindo de fora — única mudança funcional em relação à ETAPA 3A.
 * Defaults preservam exatamente o comportamento original: seeds 1..1000.
 *   calibração: BENCH=1                                        (1..1000)
 *   holdout:    BENCH=1 BENCH_SEED_START=10001 BENCH_SEED_COUNT=1000   (10001..11000)
 * Nada mais muda: geração das partidas, pareamento, métricas, IC95 e invariantes são os mesmos.
 */
function envInt(name: string, def: number): number {
  const raw = ENV[name];
  if (raw === undefined || raw.trim() === "") return def;
  const t = raw.trim();
  if (!/^\d+$/.test(t)) throw new Error(`${name} inválido: "${raw}". Use um inteiro positivo (>= 1).`);
  const v = Number(t);
  if (!Number.isSafeInteger(v) || v < 1) throw new Error(`${name} inválido: "${raw}". Deve ser inteiro >= 1.`);
  return v;
}
const SEED_START = envInt("BENCH_SEED_START", 1);
const SEED_COUNT = envInt("BENCH_SEED_COUNT", 1000);
const SEED_END = SEED_START + SEED_COUNT - 1;   // start=10001, count=1000 ⇒ end=11000
const N = SEED_COUNT;
const SEATS = [0, 1, 2, 3] as const;
const TRUMPS: Trump[] = ["spades", "hearts", "diamonds", "clubs", "no-trump"];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => sum(a) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1)); };
function ic95(a: number[]) { const m = mean(a), s = sd(a), e = 1.96 * s / Math.sqrt(a.length); return { mean: m, lo: m - e, hi: m + e, sd: s }; }
function quantile(a: number[], q: number) { const b = [...a].sort((x, y) => x - y); const i = (b.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? b[lo] : b[lo] + (b[hi] - b[lo]) * (i - lo); }
const f2 = (x: number) => x.toFixed(2);
function verdict(v: { lo: number; hi: number }) { return v.lo > 0 ? "MELHOR" : v.hi < 0 ? "PIOR" : "NEUTRO/INCONCLUSIVO"; }

interface MatchResult { final: number[]; hands: number[][]; trumps: { hand: number; seat: Seat; trump: Trump }[]; }

/** Joga uma partida completa; normalSeat=-1 ⇒ 4×Baseline. Valida legalidade e invariantes (PARE em falha). */
function playMatch(seed: number, normalSeat: number): MatchResult {
  const m: MatchState = createMatch(["P0", "P1", "P2", "P3"], seed);
  const trumps: MatchResult["trumps"] = [];
  for (let hn = 1; hn <= 10; hn++) {
    startNextHand(m);
    while (m.hand!.awaitingTrumpFrom !== null) {
      const ch = m.hand!.awaitingTrumpFrom as Seat;
      const t = ch === normalSeat ? chooseNormalTrump(buildBotView(m, ch).hand) : chooseBotTrump(m, ch);
      trumps.push({ hand: hn, seat: ch, trump: t });
      selectTrump(m, ch, t);
    }
    let guard = 0;
    while (m.hand!.handScores === null) {
      const s = m.hand!.turn as Seat;
      const legal = legalCardsFor(m, s);
      const card = s === normalSeat ? chooseNormalCard(buildBotView(m, s)) : chooseBotCard(m, s);
      if (!legal.some((l) => sameCard(l, card))) throw new Error(`ILEGAL seed=${seed} normalSeat=${normalSeat} mão=${hn} seat=${s}`);
      playCard(m, s, card);
      if (++guard > 60) throw new Error(`DEADLOCK seed=${seed} normalSeat=${normalSeat} mão=${hn}`);
    }
    const hs = m.history[m.history.length - 1].handScores;
    if (sum(hs) !== HAND_CONTRACTS[hn].handTotal) throw new Error(`CHECKSUM mão=${hn} seed=${seed} normalSeat=${normalSeat}`);
  }
  if (!m.finished) throw new Error(`NÃO TERMINOU seed=${seed}`);
  if (sum(m.cumulative) !== 0) throw new Error(`FINAL≠0 seed=${seed} normalSeat=${normalSeat}`);
  if (sum(m.negatives) !== -1300) throw new Error(`NEG≠-1300 seed=${seed}`);
  if (sum(m.positives) !== 1300) throw new Error(`POS≠+1300 seed=${seed}`);
  return { final: m.cumulative.slice(), hands: m.history.map((h) => h.handScores.slice()), trumps };
}

function rankOf(final: number[], seat: number) {
  const v = final[seat], max = Math.max(...final), min = Math.min(...final);
  const position = final.filter((x) => x > v).length + 1;
  const firstCount = final.filter((x) => x === max).length;
  return { position, isFirst: v === max, isLast: v === min, winCredit: v === max ? 1 / firstCount : 0 };
}

describe(`BENCH — Bot Normal V1 × Baseline (seeds ${SEED_START}..${SEED_END})`, () => {
  it.runIf(RUN)("5000 partidas: deltas pareados, IC95, 10 mãos, trunfo, invariantes", () => {
    const t0 = Date.now();
    const dFinalAll: number[] = [], dNegAll: number[] = [], dPosAll: number[] = [], vsAvg3All: number[] = [], chooserDeltaAll: number[] = [];
    const dHandAll: number[][] = Array.from({ length: 10 }, () => []);
    const seedFinal: number[] = [], seedNeg: number[] = [], seedPos: number[] = [], seedChooser: number[] = [];
    const seedHand: number[][] = Array.from({ length: 10 }, () => []);
    const normHandSum = Array(10).fill(0), baseHandSum = Array(10).fill(0);
    const rankPos: number[] = [], winCredit: number[] = []; let firsts = 0, top2 = 0, lasts = 0, games = 0;
    const trumpFreq: Record<string, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0, "no-trump": 0 };
    const perTrump: Record<string, { count: number; score: number; tricks: number; delta: number }> =
      { spades: { count: 0, score: 0, tricks: 0, delta: 0 }, hearts: { count: 0, score: 0, tricks: 0, delta: 0 }, diamonds: { count: 0, score: 0, tricks: 0, delta: 0 }, clubs: { count: 0, score: 0, tricks: 0, delta: 0 }, "no-trump": { count: 0, score: 0, tricks: 0, delta: 0 } };
    const baseSeat = SEATS.map(() => ({ final: 0, pos: 0, credit: 0 }));
    let matches = 0;

    for (let seed = SEED_START; seed <= SEED_END; seed++) {
      const base = playMatch(seed, -1); matches++;
      for (const s of SEATS) { baseSeat[s].final += base.final[s]; const r = rankOf(base.final, s); baseSeat[s].pos += r.position; baseSeat[s].credit += r.winCredit; }
      const ch = SEATS.map((k) => { const r = playMatch(seed, k); matches++; return r; });

      const dF: number[] = [], dN: number[] = [], dP: number[] = [], dC: number[] = [];
      const dH: number[][] = Array.from({ length: 10 }, () => []);
      for (const k of SEATS) {
        const c = ch[k];
        const df = c.final[k] - base.final[k];
        let neg = 0, pos = 0, check = 0;
        for (let h = 0; h < 10; h++) {
          const d = c.hands[h][k] - base.hands[h][k];
          dH[h].push(d); dHandAll[h].push(d); normHandSum[h] += c.hands[h][k]; baseHandSum[h] += base.hands[h][k];
          check += d; if (h < 6) neg += d; else pos += d;
        }
        if (Math.abs(df - check) > 1e-9 || Math.abs(df - (neg + pos)) > 1e-9) throw new Error(`SANITY delta seed=${seed} seat=${k}`);
        dF.push(df); dN.push(neg); dP.push(pos); dFinalAll.push(df); dNegAll.push(neg); dPosAll.push(pos);
        const r = rankOf(c.final, k); rankPos.push(r.position); winCredit.push(r.winCredit); if (r.isFirst) firsts++; if (r.position <= 2) top2++; if (r.isLast) lasts++; games++;
        vsAvg3All.push(c.final[k] - (sum(c.final) - c.final[k]) / 3);
        const dh = 6 + k; // mão em que o assento k é o chooser (M7→0 … M10→3)
        const tc = c.trumps.find((t) => t.seat === k && t.hand === 7 + k)!.trump;
        const cd = c.hands[dh][k] - base.hands[dh][k];
        dC.push(cd); chooserDeltaAll.push(cd);
        trumpFreq[tc]++; perTrump[tc].count++; perTrump[tc].score += c.hands[dh][k]; perTrump[tc].tricks += c.hands[dh][k] / 25; perTrump[tc].delta += cd;
      }
      seedFinal.push(mean(dF)); seedNeg.push(mean(dN)); seedPos.push(mean(dP)); seedChooser.push(mean(dC));
      for (let h = 0; h < 10; h++) seedHand[h].push(mean(dH[h]));
    }

    const secs = (Date.now() - t0) / 1000;
    const finIC = ic95(seedFinal), negIC = ic95(seedNeg), posIC = ic95(seedPos), chIC = ic95(seedChooser);
    const L: string[] = [];
    L.push("========== BENCH Bot Normal V1 (c62f5e3) × Baseline ==========");
    L.push(`seeds=${SEED_START}..${SEED_END} (${N}) | partidas=${matches} (${N} all-Baseline + ${4 * N} challenger) | tempo=${f2(secs)}s | ${f2(matches / secs)} partidas/s | ${f2((secs * 1000) / matches)} ms/partida`);
    L.push(`INVARIANTES: ${matches}/${5 * N} ok (nenhuma ilegal/exceção/deadlock; 10 mãos; −1300/+1300/0). SANITY deltas: ok (Δfinal=ΣΔmãos=Δneg+Δpos).`);
    L.push("");
    L.push("TABELA EXECUTIVA");
    L.push("MÉTRICA | NORMAL(méd) | BASELINE(méd) | DELTA(méd) | IC95 | LEITURA");
    const nFinalMean = mean(dFinalAll); // = média do Normal pareado − baseline; baseline ref final médio por seat ≈ 0
    L.push(`Score final | ${f2(nFinalMean)} (Δ) | 0.00 (ref) | ${f2(finIC.mean)} | [${f2(finIC.lo)}, ${f2(finIC.hi)}] | ${verdict(finIC)}`);
    L.push(`Fase negativa | Δ | ref | ${f2(negIC.mean)} | [${f2(negIC.lo)}, ${f2(negIC.hi)}] | ${verdict(negIC)}`);
    L.push(`Fase positiva | Δ | ref | ${f2(posIC.mean)} | [${f2(posIC.lo)}, ${f2(posIC.hi)}] | ${verdict(posIC)}`);
    L.push(`Chooser (mão do trunfo do Normal) | Δ | ref | ${f2(chIC.mean)} | [${f2(chIC.lo)}, ${f2(chIC.hi)}] | ${verdict(chIC)}`);
    L.push("");
    L.push(`Δ FINAL — distribuição (${4 * N} obs) + inferência (${N} médias por seed)`);
    L.push(`média=${f2(finIC.mean)} IC95=[${f2(finIC.lo)}, ${f2(finIC.hi)}] SD(seed)=${f2(finIC.sd)}`);
    L.push(`mediana=${f2(quantile(dFinalAll, .5))} min=${f2(Math.min(...dFinalAll))} max=${f2(Math.max(...dFinalAll))} SD(obs)=${f2(sd(dFinalAll))}`);
    L.push(`p5=${f2(quantile(dFinalAll, .05))} p25=${f2(quantile(dFinalAll, .25))} p50=${f2(quantile(dFinalAll, .5))} p75=${f2(quantile(dFinalAll, .75))} p95=${f2(quantile(dFinalAll, .95))}`);
    L.push("");
    L.push("TABELA DAS 10 MÃOS (por seed/seat pareado)");
    L.push("Mão | contrato | Normal(méd) | Baseline(méd) | Δ méd | IC95 | leitura");
    for (let h = 0; h < 10; h++) {
      const hic = ic95(seedHand[h]);
      L.push(`M${h + 1} | ${HAND_CONTRACTS[h + 1].label} | ${f2(normHandSum[h] / (4 * N))} | ${f2(baseHandSum[h] / (4 * N))} | ${f2(hic.mean)} | [${f2(hic.lo)}, ${f2(hic.hi)}] | ${verdict(hic)}`);
    }
    L.push("");
    L.push(`RANKING do Normal (${4 * N} challenger)`);
    L.push(`posição média=${f2(mean(rankPos))} | %1º(qualquer)=${f2(100 * firsts / games)}% | win-credit=${f2(100 * mean(winCredit))}% | %top2=${f2(100 * top2 / games)}% | %último=${f2(100 * lasts / games)}%`);
    L.push(`(controle: 4 bots equivalentes ⇒ ~25% win-credit)`);
    L.push(`Normal × média dos 3 Baselines da própria partida: méd=${f2(mean(vsAvg3All))} (secundária)`);
    L.push("");
    L.push(`ESCOLHA DE TRUNFO do Normal (${4 * N} escolhas, 1 por challenger)`);
    const totT = sum(TRUMPS.map((t) => trumpFreq[t]));
    for (const t of TRUMPS) L.push(`${t}: ${trumpFreq[t]} (${f2(100 * trumpFreq[t] / totT)}%)`);
    L.push("");
    L.push("DESEMPENHO POR TIPO DE TRUNFO (mão em que o Normal escolheu)");
    L.push("trunfo | n | score méd | vazas méd | Δ méd vs baseline pareado");
    for (const t of TRUMPS) { const p = perTrump[t]; if (p.count) L.push(`${t} | ${p.count} | ${f2(p.score / p.count)} | ${f2(p.tricks / p.count)} | ${f2(p.delta / p.count)}`); else L.push(`${t} | 0 | — | — | —`); }
    L.push("");
    L.push(`VIÉS DE ASSENTO — ${N} partidas all-Baseline`);
    L.push("seat | score final méd | posição méd | win-credit");
    for (const s of SEATS) L.push(`seat${s} | ${f2(baseSeat[s].final / N)} | ${f2(baseSeat[s].pos / N)} | ${f2(100 * baseSeat[s].credit / N)}%`);
    L.push("");
    // classificação provisória
    const anyPhaseRegr = negIC.hi < 0 || posIC.hi < 0;
    const anyHandRegr = seedHand.some((sh) => ic95(sh).hi < 0);
    let cls: string;
    if (finIC.mean > 0 && finIC.lo > 0 && !anyPhaseRegr && !anyHandRegr) cls = "VERDE";
    else if (finIC.mean <= 0 || finIC.hi <= 0) cls = "VERMELHO";
    else cls = "AMARELO";
    L.push(`CLASSIFICAÇÃO PROVISÓRIA (informativa): ${cls}`);
    L.push(`  (regressão de fase significativa? ${anyPhaseRegr}; alguma mão PIOR? ${anyHandRegr})`);
    L.push("==============================================================");
    console.log("\n" + L.join("\n") + "\n");

    expect(matches).toBe(5 * N);
  }, 900_000);
});
