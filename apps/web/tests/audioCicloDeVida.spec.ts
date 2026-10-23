/**
 * O ÁUDIO DEPOIS DE IR AO WHATSAPP E VOLTAR — num navegador de verdade, com o AudioContext real.
 *
 * O defeito apareceu em aparelho: com o som tocando, sair do KING e voltar deixava o jogo mudo (V1,
 * 22/10/2026), e a V1 emudecia na 2ª volta (V2, 23/10/2026). Aqui o "sair" é simulado
 * (visibilityState + visibilitychange) e o navegador suspendendo o contexto também — o que prova a
 * LÓGICA: a música para escondida, o contexto volta, o agendador recomeça uma vez só, nenhum ouvinte
 * se acumula e os efeitos voltam, volta após volta. O Chromium NÃO reproduz o zumbi do WebKit: a
 * prova do contexto "running" de relógio parado é instrumentada (o relógio é congelado à mão).
 * NADA disto substitui o teste físico no iPhone.
 *
 * Um viewport só: o que se mede é o ciclo de vida do áudio, não layout.
 */
import { expect, test, type Page } from "@playwright/test";
import { SEL, iniciarPartidaLocal } from "./helpers/mesa.js";

type Sonda = { ctxs: AudioContext[]; musica: Set<number>; osc: number[]; gestos: Map<EventListenerOrEventListenerObject, Set<string>>; gestosMax: number };

async function prepararAudio(page: Page, prefs: { music: boolean; sfx: boolean }) {
  await page.addInitScript((p) => {
    localStorage.setItem("king.audio", JSON.stringify({ ...p, haptics: false, musicVol: 0.4, sfxVol: 0.4 }));
    localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    const s = {
      ctxs: [] as AudioContext[], musica: new Set<number>(), osc: [] as number[],
      gestos: new Map<EventListenerOrEventListenerObject, Set<string>>(), gestosMax: 0,
    };
    (window as unknown as { __som: typeof s }).__som = s;
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(...a: ConstructorParameters<typeof AudioContext>) { super(...a); s.ctxs.push(this); s.osc.push(0); }
      createOscillator() { s.osc[s.ctxs.indexOf(this)]++; return super.createOscillator(); }
    } as typeof AudioContext;
    // O agendador da música é o intervalo de um compasso (2000 ms; 1500 na comemoração).
    const si = window.setInterval.bind(window);
    const ci = window.clearInterval.bind(window);
    window.setInterval = ((fn: TimerHandler, ms?: number, ...r: unknown[]) => {
      const id = si(fn, ms, ...r);
      if (ms === 2000 || ms === 1500) s.musica.add(id);
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => { if (id !== undefined) s.musica.delete(id); ci(id); }) as typeof window.clearInterval;
    // O gesto de reserva do motor: touchend/click/keydown em captura e passivo, na janela.
    const GESTOS = ["touchend", "click", "keydown"];
    const add = window.addEventListener.bind(window);
    const rem = window.removeEventListener.bind(window);
    window.addEventListener = ((t: string, f: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => {
      if (GESTOS.includes(t) && typeof o === "object" && o.capture && o.passive) {
        (s.gestos.get(f) ?? s.gestos.set(f, new Set()).get(f)!).add(t);
        s.gestosMax = Math.max(s.gestosMax, [...s.gestos.values()].reduce((n, v) => n + v.size, 0));
      }
      add(t, f, o);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((t: string, f: EventListenerOrEventListenerObject, o?: boolean | EventListenerOptions) => {
      if (GESTOS.includes(t) && (o === true || (typeof o === "object" && o.capture))) {
        s.gestos.get(f)?.delete(t);
        if (s.gestos.get(f)?.size === 0) s.gestos.delete(f);
      }
      rem(t, f, o);
    }) as typeof window.removeEventListener;
  }, prefs);
}

const sonda = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __som: Sonda }).__som;
  const atual = s.ctxs[s.ctxs.length - 1];
  return {
    contextos: s.ctxs.length,
    estado: atual?.state ?? null,
    velhosAbertos: s.ctxs.slice(0, -1).filter((c) => c.state !== "closed").length,
    musica: s.musica.size,
    osc: [...s.osc],
    gestos: [...s.gestos.values()].reduce((n, v) => n + v.size, 0),
    gestosMax: s.gestosMax,
  };
});
const ficar = (page: Page, estado: "hidden" | "visible") => page.evaluate((e) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => e });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => e === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}, estado);
const navegadorSuspende = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __som: Sonda }).__som;
  return s.ctxs[s.ctxs.length - 1].suspend();
});
/** Um efeito de verdade: o botão de som (toque) e o "Voltar ao jogo" (toque de novo). */
async function efeitoNoContextoAtual(page: Page) {
  const antes = await sonda(page);
  const i = antes.contextos - 1;
  await page.locator(SEL.topbtn).getByRole("button", { name: "Som e vibração" }).click();
  await page.locator(".ovcard .btn.gold").click();
  await expect.poll(async () => (await sonda(page)).osc[i], { message: "o efeito não criou som no contexto atual" }).toBeGreaterThan(antes.osc[i]);
}
function semErrosNoConsole(page: Page) {
  const erros: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  page.on("pageerror", (e) => erros.push(String(e)));
  return erros;
}

test.beforeEach(({}, ti) => { test.skip(ti.project.name !== "852x393", "ciclo de vida do áudio: um viewport basta"); });
test.describe.configure({ timeout: 120_000 });

test("Música e Efeitos ligados: 10 idas e voltas — um contexto, um agendador, nenhum ouvinte sobrando, efeitos a cada volta", async ({ page }) => {
  const erros = semErrosNoConsole(page);
  await prepararAudio(page, { music: true, sfx: true });
  await page.goto("/");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.mesa)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sonda(page)).toMatchObject({ contextos: 1, estado: "running", musica: 1 });

  for (let volta = 1; volta <= 10; volta++) {
    await ficar(page, "hidden");
    await expect.poll(async () => (await sonda(page)).musica, { message: `volta ${volta}: a música seguiu escondida` }).toBe(0);
    if (volta % 2) await navegadorSuspende(page);
    await ficar(page, "visible");
    await expect.poll(() => sonda(page), { message: `volta ${volta}`, timeout: 10_000 })
      .toMatchObject({ contextos: 1, estado: "running", musica: 1, gestos: 0 });
    await efeitoNoContextoAtual(page);
  }
  // idas e voltas sem esperar: nunca dois agendadores, nada sobrando
  for (let i = 0; i < 5; i++) { await ficar(page, "hidden"); await ficar(page, "visible"); }
  await expect.poll(() => sonda(page), { timeout: 10_000 }).toMatchObject({ contextos: 1, musica: 1, gestos: 0 });
  const fim = await sonda(page);
  expect(fim.gestosMax, "o gesto de reserva acumulou ouvintes").toBeLessThanOrEqual(3);
  expect(fim.contextos, "o Chromium saudável não pode ganhar contexto novo").toBe(1);
  expect(erros, "erros no console").toEqual([]);
});

test("Música desligada: as voltas retomam o contexto e NÃO ligam a música", async ({ page }) => {
  const erros = semErrosNoConsole(page);
  await prepararAudio(page, { music: false, sfx: true });
  await page.goto("/");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.mesa)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sonda(page)).toMatchObject({ contextos: 1, musica: 0 });
  for (let volta = 1; volta <= 3; volta++) {
    await ficar(page, "hidden");
    await navegadorSuspende(page);
    await ficar(page, "visible");
    await expect.poll(() => sonda(page), { message: `volta ${volta}`, timeout: 10_000 })
      .toMatchObject({ contextos: 1, estado: "running", musica: 0, gestos: 0 });
  }
  await efeitoNoContextoAtual(page);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("king.audio") ?? "{}").music), "a preferência mudou").toBe(false);
  expect(erros, "erros no console").toEqual([]);
});

test("INSTRUMENTADO: contexto que volta 'running' com o relógio parado → o 1º toque cria um contexto NOVO, e o velho fecha", async ({ page }) => {
  const erros = semErrosNoConsole(page);
  await prepararAudio(page, { music: true, sfx: true });
  await page.goto("/");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.mesa)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sonda(page)).toMatchObject({ contextos: 1, estado: "running", musica: 1 });

  await ficar(page, "hidden");
  // o zumbi do WebKit, feito à mão: o estado segue "running", o relógio para
  await page.evaluate(() => {
    const c = (window as unknown as { __som: Sonda }).__som.ctxs[0];
    const parado = c.currentTime;
    Object.defineProperty(c, "currentTime", { configurable: true, get: () => parado });
  });
  await ficar(page, "visible");
  await page.waitForTimeout(2_500); // assenta (300 ms) e mede o relógio (até 1,5 s): zumbi
  expect(await sonda(page), "a volta criou contexto sem gesto, ou tocou música num relógio parado")
    .toMatchObject({ contextos: 1, musica: 0, gestos: 3 });

  await page.locator(".trick").click(); // um toque qualquer na mesa (a vaza só mostra cartas): só o motor de áudio ouve
  await expect.poll(() => sonda(page), { timeout: 10_000 })
    .toMatchObject({ contextos: 2, estado: "running", velhosAbertos: 0, musica: 1, gestos: 0 });
  const depois = await sonda(page);
  expect(depois.osc[1], "a música não foi para o contexto novo").toBeGreaterThan(0);
  const noVelho = depois.osc[0];
  await efeitoNoContextoAtual(page);
  expect((await sonda(page)).osc[0], "efeito no contexto velho").toBe(noVelho);

  // e a próxima volta já opera no contexto novo, sem trocar de novo
  await ficar(page, "hidden");
  await navegadorSuspende(page);
  await ficar(page, "visible");
  await expect.poll(() => sonda(page), { timeout: 10_000 }).toMatchObject({ contextos: 2, estado: "running", musica: 1, gestos: 0 });
  expect(erros, "erros no console").toEqual([]);
});
