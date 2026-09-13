/**
 * O PRAZO NO INSTANTE EM QUE A JOGADA HUMANA FICA POSSÍVEL — medido na Mesa real.
 *
 * ══ O CONTRATO ══
 *
 * O servidor pode proteger o tempo enquanto o jogador AINDA NÃO pode agir. Mas, no instante em que
 * a carta fica clicável, o que resta tem de ser o prazo nominal — nem inflado (o jogador vendo 26s,
 * 27s), nem erodido (o jogador perdendo meio segundo por nada).
 *
 *   "clicável" = `.hand .card[role=button]`. `CardView` só põe `role` quando há `onClick`, e a Mesa
 *                só dá `onClick` com `humanTurn && isLegal && !travado`.
 *   "restante" = o TURN_CLOCK capturado DENTRO da página antes de o SDK processá-lo, com o mesmo
 *                `Date.now()` do observador de DOM: um relógio só, sem IPC entre as duas pontas.
 *
 * ══ POR QUE ESTE ARQUIVO EXISTE ══
 *
 * A verificação operacional da VPS mostrou 26279ms. Investigado localmente:
 *
 *   1. aquele número não era da mão 10 (o verificador lia um relógio da mão 9);
 *   2. mas o fenômeno é real em OUTRO lugar: quando o humano LIDERA a vaza seguinte, a carta fica
 *      clicável durante a pausa de leitura (decisão deliberada da Mesa), enquanto o servidor
 *      soma a pausa inteira ao prazo (8064014). Medido: +620ms após vaza comum, +2177ms após bucha.
 *
 * E havia um segundo defeito, do outro lado: a fila do cliente era um `setInterval` re-armado a
 * cada TURN_CLOCK, e toda decisão aparecia ~520ms depois de o prazo começar a correr (medido:
 * 523–1048ms abaixo do nominal). Corrigidos os dois — a fila apresenta no instante em que pode, e
 * o servidor espelha essa fila para somar exatamente o tempo em que a decisão ainda não está na
 * tela —, este arquivo exige TETO e PISO.
 *
 * ══ MARGENS — medidas, e assimétricas por um motivo físico ══
 *
 * Dispersão real com as duas correções, no instante clicável:
 *
 *   · 5 rodadas deste arquivo (29 decisões na primeira medição): −15ms a +9ms;
 *   · sonda de 10 minutos, 2 humanos + 2 bots (165 decisões): −115ms a +15ms — os piores, 64–115ms
 *     ABAIXO, todos na mão 1, com a página ainda aquecendo.
 *
 * O ruído é UNILATERAL: renderização, coleta de lixo e agendamento só ATRASAM a tela em relação ao
 * modelo; nada a adianta. Por isso as margens não são iguais:
 *
 *   TETO 150ms — dez vezes o maior excesso medido (+15ms), e 468ms abaixo do menor desvio do
 *                defeito A (pausa somada ao líder: +618ms);
 *   PISO 250ms — 135ms de folga sobre o pior atraso medido (−115ms), e 273ms antes do menor
 *                desvio do defeito B (fila re-armada pelo relógio: −523ms).
 *
 * Nenhuma das duas é "centenas de tolerância": cada uma fica mais perto do ruído que do defeito.
 */
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { criarSala, entrarNaSala } from "./helpers/multiplayer.js";

const require = createRequire(import.meta.url);
const { unpack } = require("@colyseus/msgpackr") as { unpack: (b: Buffer) => unknown };

const APARELHO = { width: 800, height: 360 };
const NOMINAL = 25_000;
/** Ver "MARGENS" no cabeçalho: medidas, e assimétricas porque o ruído só atrasa. */
const TETO_MS = 150;
const PISO_MS = 250;
const ORCAMENTO_MS = 9 * 60_000;

const INIT = () => {
  const w = window as unknown as { __quadros: { t: number; b: number[] }[]; __jogavel: unknown[] };
  w.__quadros = [];
  w.__jogavel = [];
  const ALVOS = ["TURN_CLOCK", "SERVER_WELCOME"];
  const Original = window.WebSocket;
  class Espiao extends Original {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("message", (ev: MessageEvent) => {
        const d = ev.data;
        if (!(d instanceof ArrayBuffer)) return;
        const u = new Uint8Array(d);
        if (u[0] !== 13) return;
        const p = u[1];
        let len = 0;
        let ini = 0;
        if ((p & 0xe0) === 0xa0) { len = p & 0x1f; ini = 2; } else if (p === 0xd9) { len = u[2]; ini = 3; } else return;
        let tipo = "";
        for (let i = ini; i < ini + len; i++) tipo += String.fromCharCode(u[i]);
        if (!ALVOS.includes(tipo)) return;
        w.__quadros.push({ t: Date.now(), b: Array.from(u) });
      });
    }
  }
  (window as unknown as { WebSocket: typeof WebSocket }).WebSocket = Espiao as unknown as typeof WebSocket;
  document.addEventListener("DOMContentLoaded", () => {
    let antes = false;
    new MutationObserver(() => {
      const agora = document.querySelectorAll(".hand .card[role=button]").length > 0;
      if (agora && !antes) {
        const hud = document.querySelector(".hud")?.textContent ?? "";
        w.__jogavel.push({
          t: Date.now(),
          mao: Number(/M[ÃA]O\s*(\d+)/i.exec(hud)?.[1] ?? 0),
          vaza: Number(/Vaza\s*(\d+)/i.exec(hud)?.[1] ?? 0),
          naMesa: document.querySelectorAll(".trick .card").length,
        });
      }
      antes = agora;
    }).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ["role", "class"],
    });
  });
};

function decodificar(b: number[]): { tipo: string; payload: Record<string, unknown> } | null {
  const u = Buffer.from(b);
  const p = u[1];
  let len = 0;
  let ini = 0;
  if ((p & 0xe0) === 0xa0) { len = p & 0x1f; ini = 2; } else if (p === 0xd9) { len = u[2]; ini = 3; } else return null;
  return { tipo: u.subarray(ini, ini + len).toString("utf8"), payload: unpack(u.subarray(ini + len)) as Record<string, unknown> };
}

interface Medida { quem: string; mao: number; vaza: number; lidera: boolean; restante: number; nominal: number }

async function medir(p: Page, quem: string): Promise<Medida[]> {
  const bruto = await p.evaluate(() => {
    const w = window as unknown as { __quadros: { t: number; b: number[] }[]; __jogavel: Record<string, number>[] };
    return { quadros: w.__quadros, jogavel: w.__jogavel };
  });
  const dec = bruto.quadros.map((q) => ({ t: q.t, d: decodificar(q.b) })).filter((x) => x.d);
  const seat = (dec.find((x) => x.d!.tipo === "SERVER_WELCOME")?.d!.payload.you as { seat: number } | undefined)?.seat;
  const relogios = dec.filter((x) => x.d!.tipo === "TURN_CLOCK")
    .map((x) => ({ t: x.t, ...(x.d!.payload as { tipo: string; seat: number; restanteMs: number }) }));
  const out: Medida[] = [];
  for (const e of bruto.jogavel) {
    const r = relogios.filter((c) => c.tipo === "PLAY" && c.seat === seat && c.t <= e.t + 100).at(-1);
    if (!r) continue;
    const primeira = e.vaza === 1 && e.naMesa === 0;
    out.push({
      quem, mao: e.mao, vaza: e.vaza,
      // A vaza anterior ainda está na mesa: é o líder, clicável DURANTE a pausa de leitura.
      lidera: e.naMesa === 4,
      restante: r.restanteMs - (e.t - r.t),
      nominal: NOMINAL + (primeira ? 15_000 : 0),
    });
  }
  return out;
}

async function conduzir(p: Page, parar: () => boolean): Promise<void> {
  while (!parar()) {
    const pronto = p.getByRole("button", { name: /Estou pronto/ });
    if (await pronto.count()) { await pronto.first().click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(300); continue; }
    const trunfo = p.locator(".trumpbtn");
    if (await trunfo.count()) { await p.waitForTimeout(300); await trunfo.first().click({ timeout: 2000 }).catch(() => {}); continue; }
    const carta = p.locator(".hand .card[role=button]");
    if (await carta.count()) { await p.waitForTimeout(400); await carta.first().click({ timeout: 2000 }).catch(() => {}); await p.waitForTimeout(150); continue; }
    await p.waitForTimeout(100);
  }
}

test("no instante em que a carta fica clicável, resta o prazo nominal", async ({ browser }, ti) => {
  test.skip(ti.project.name !== "800x360", "roda uma vez, na geometria do aparelho");
  test.setTimeout(ORCAMENTO_MS + 3 * 60_000);

  const ctxA = await browser.newContext({ viewport: APARELHO });
  const ctxB = await browser.newContext({ viewport: APARELHO });
  await ctxA.addInitScript(INIT);
  await ctxB.addInitScript(INIT);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    const codigo = await criarSala(a, "Tito", "Sapo");
    await entrarNaSala(b, codigo, "Raiza", "Panda");
    // ESPERA O LOBBY CONFIRMAR CADA BOT antes do próximo clique. A primeira versão esperava 600ms
    // fixos: o segundo clique saía antes de o estado sincronizar, pedia o MESMO lugar, o servidor
    // recusava ("Esse lugar já está ocupado") e a partida nunca começava — o teste morria no
    // preparo sem medir nada. É o mesmo cuidado do helper `mesaEmPartida`.
    await expect(a.locator(".sl-bot.add")).toHaveCount(2, { timeout: 20_000 });
    await a.locator(".sl-bot.add").first().click();
    await expect(a.locator(".sl-bot.add")).toHaveCount(1, { timeout: 20_000 });
    await a.locator(".sl-bot.add").first().click();
    await expect(a.locator(".sl-lugar.robo")).toHaveCount(2, { timeout: 20_000 });
    await a.getByRole("button", { name: /Estou pronto/ }).click();
    await b.getByRole("button", { name: /Estou pronto/ }).click();
    await a.locator(".mesa").waitFor({ timeout: 30_000 });
    await b.locator(".mesa").waitFor({ timeout: 30_000 });

    // Joga até ter visto o caso que importa (um líder clicável durante a pausa) e um punhado dos
    // outros — sem depender de sorte de embaralhamento para "passar sem medir".
    const limite = Date.now() + ORCAMENTO_MS;
    let fim = false;
    const vigia = (async () => {
      while (!fim && Date.now() < limite) {
        await a.waitForTimeout(3000);
        const ms = [...(await medir(a, "Tito").catch(() => [])), ...(await medir(b, "Raiza").catch(() => []))];
        if (ms.filter((m) => m.lidera).length >= 2 && ms.filter((m) => !m.lidera).length >= 6) fim = true;
      }
      fim = true;
    })();
    await Promise.all([conduzir(a, () => fim), conduzir(b, () => fim), vigia]);

    const medidas = [...(await medir(a, "Tito")), ...(await medir(b, "Raiza"))];
    // Todas as medidas vão para o log, não só as reprovadas: é daqui que sai a dispersão real que
    // justifica a margem.
    console.log(`PRAZO_MEDIDAS ${JSON.stringify(medidas.map((m) => ({
      quem: m.quem, mao: m.mao, vaza: m.vaza, lidera: m.lidera, desvio: m.restante - m.nominal,
    })))}`);
    const lideres = medidas.filter((m) => m.lidera);
    expect(lideres.length, "nenhum líder clicável durante a pausa foi observado — o teste não mediu o caso").toBeGreaterThan(0);

    for (const m of medidas) {
      const desvio = m.restante - m.nominal;
      const rotulo = `[${m.quem} · mão ${m.mao} · vaza ${m.vaza} · ${m.lidera ? "LIDERA, durante a pausa" : "demais"}]`;
      // TETO — o jogador não pode agir vendo mais que o nominal.
      expect.soft(desvio, `${rotulo} clicável com ${m.restante}ms — ${desvio}ms ACIMA do nominal`)
        .toBeLessThanOrEqual(TETO_MS);
      // PISO — nem perdendo tempo por nada.
      expect.soft(desvio, `${rotulo} clicável com ${m.restante}ms — ${-desvio}ms ABAIXO do nominal`)
        .toBeGreaterThanOrEqual(-PISO_MS);
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
