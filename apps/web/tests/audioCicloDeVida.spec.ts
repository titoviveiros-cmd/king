/**
 * O ÁUDIO DEPOIS DE IR AO WHATSAPP E VOLTAR — num navegador de verdade, com o AudioContext real.
 *
 * O defeito (22/10/2026) apareceu em aparelho: com o som tocando, sair do KING e voltar deixava o
 * jogo mudo. Aqui o "sair" é simulado (visibilityState + visibilitychange) e o navegador suspendendo
 * o contexto também — o que prova a LÓGICA: a música para escondida, o contexto volta, o agendador
 * recomeça uma vez só, e os efeitos voltam a criar som. NÃO substitui o teste físico no iPhone.
 *
 * Um viewport só: o que se mede é o ciclo de vida do áudio, não layout.
 */
import { expect, test, type Page } from "@playwright/test";
import { SEL, iniciarPartidaLocal } from "./helpers/mesa.js";

type Sonda = { ctxs: AudioContext[]; musica: Set<number>; osciladores: number };

async function prepararAudio(page: Page, prefs: { music: boolean; sfx: boolean }) {
  await page.addInitScript((p) => {
    localStorage.setItem("king.audio", JSON.stringify({ ...p, haptics: false, musicVol: 0.4, sfxVol: 0.4 }));
    localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    const s = { ctxs: [] as AudioContext[], musica: new Set<number>(), osciladores: 0 };
    (window as unknown as { __som: typeof s }).__som = s;
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(...a: ConstructorParameters<typeof AudioContext>) { super(...a); s.ctxs.push(this); }
      createOscillator() { s.osciladores++; return super.createOscillator(); }
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
  }, prefs);
}

const sonda = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as { __som: Sonda }).__som;
  return { contextos: s.ctxs.length, estado: s.ctxs[0]?.state ?? null, musica: s.musica.size, osciladores: s.osciladores };
});
const ficar = (page: Page, estado: "hidden" | "visible") => page.evaluate((e) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => e });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => e === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}, estado);
const navegadorSuspende = (page: Page) => page.evaluate(() => (window as unknown as { __som: Sonda }).__som.ctxs[0].suspend());

test.beforeEach(({}, ti) => { test.skip(ti.project.name !== "852x393", "ciclo de vida do áudio: um viewport basta"); });

test("Música e Efeitos ligados: escondido para, de volta retoma — um agendador só, e os efeitos voltam", async ({ page }) => {
  await prepararAudio(page, { music: true, sfx: true });
  await page.goto("/");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.mesa)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sonda(page)).toMatchObject({ contextos: 1, estado: "running", musica: 1 });

  for (let volta = 1; volta <= 4; volta++) {
    await ficar(page, "hidden");
    await expect.poll(async () => (await sonda(page)).musica, { message: `volta ${volta}: a música seguiu escondida` }).toBe(0);
    await navegadorSuspende(page);
    await ficar(page, "visible");
    await expect.poll(() => sonda(page), { message: `volta ${volta}` }).toMatchObject({ contextos: 1, estado: "running", musica: 1 });
  }
  // idas e voltas sem esperar: nunca dois agendadores
  for (let i = 0; i < 5; i++) { await ficar(page, "hidden"); await ficar(page, "visible"); }
  await expect.poll(async () => (await sonda(page)).musica).toBe(1);

  // os EFEITOS também voltam: um toque que faz som cria oscilador no contexto recuperado
  const antes = (await sonda(page)).osciladores;
  await page.locator(SEL.topbtn).first().click();
  await expect.poll(async () => (await sonda(page)).osciladores).toBeGreaterThan(antes);
  expect((await sonda(page)).contextos, "a volta não pode criar outro AudioContext").toBe(1);
});

test("Música desligada: a volta retoma o contexto e NÃO liga a música", async ({ page }) => {
  await prepararAudio(page, { music: false, sfx: true });
  await page.goto("/");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.mesa)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => sonda(page)).toMatchObject({ contextos: 1, musica: 0 });
  await ficar(page, "hidden");
  await navegadorSuspende(page);
  await ficar(page, "visible");
  await expect.poll(() => sonda(page)).toMatchObject({ contextos: 1, estado: "running", musica: 0 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("king.audio") ?? "{}").music), "a preferência mudou").toBe(false);
});
