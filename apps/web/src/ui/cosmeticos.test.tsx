/**
 * OS ITENS DA COROA NO CLIENTE (Entregas B e C).
 *
 * O cliente não decide nada: desenha o que o banco e o servidor disseram. O que se cobra aqui é
 * que ele desenhe CERTO (bloqueado/desbloqueado/equipado nas bordas de nível, na curva combinada),
 * que a moldura e as reações venham SÓ do assento sincronizado, que o baralho não mude tamanho nem
 * alvo de carta, que a celebração apareça uma vez por item e por conta, e que qualquer falha vire
 * "sem vitrine" — nunca um erro na Home.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import { createMatch, startNextHand, redactFor, type Seat } from "@king/engine";
import {
  BARALHOS, CATALOGO, CATEGORIAS, DESBLOQUEAVEIS, MOLDURAS, NADA_EQUIPADO, REACOES, TOALHAS, aplicarBaralho, baralhoGuardado,
  baralhoQueVale, criarCosmeticos, estadoDoItem, guardarMesa, itemDaToalha, liberadosNo, marcarCelebrados, mesaGuardada,
  paraCelebrar, proximoDesbloqueio, type Equipados, type ItemId, type PortaDeCosmeticos,
} from "../auth/cosmeticos.js";
import { MAX_NA_CELEBRACAO, NovoItemDesbloqueado, ORIGEM_DO_XP, VitrineDeItens } from "./Cosmeticos.js";
import { BalaoSocial, BotaoSocial, reacoesDaMesa, type MesaMultiplayer } from "./MesaOnline.js";
import { Mesa } from "./Mesa.js";
import { PartidaRemota } from "../game/partidaRemota.js";
import { KingGame } from "../game/kingGame.js";
import { PlacarFinal } from "./PlacarFinal.js";
import { COROA, ETIQUETAS_SOCIAIS, MENSAGENS, REACOES_SOCIAIS, atalhosDe, fraseDe, porCategoria } from "./social.js";
import { sanitizar } from "../analytics/analytics.js";
import { RECURSOS_DO_CLIENTE, lerEstadoDaSala, opcoesDeEntrada, type EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};
const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Um `localStorage` de mentira: o do Node não existe, e o teste precisa ver o que foi gravado. */
class Armazenamento {
  dados = new Map<string, string>();
  getItem(k: string) { return this.dados.get(k) ?? null; }
  setItem(k: string, v: string) { this.dados.set(k, String(v)); }
  removeItem(k: string) { this.dados.delete(k); }
}
let armazenamento: Armazenamento;
beforeEach(() => { armazenamento = new Armazenamento(); (globalThis as { localStorage?: unknown }).localStorage = armazenamento; });
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

/** Equipados com a toalha `t` e os itens dados ligados (as reações livres sempre ligadas). */
const com = (ids: ItemId[], t = "imperial"): Equipados => {
  const e = { ...NADA_EQUIPADO } as Equipados;
  for (const i of CATALOGO) if (i.toalha) e[i.id] = i.toalha === t;
  for (const id of ids) e[id] = true;
  return e;
};

/** A curva COMBINADA da Entrega C (+ os três de fora da curva, depois do 15, e a Esmeralda Real no 10). */
const CURVA: [ItemId, number][] = [
  ["moldura-real", 2], ["mesa-vinho", 3], ["baralho-imperial", 4], ["reacao-fogo", 5], ["reacao-coroa", 6],
  ["moldura-rubi", 7], ["mesa-azul", 8], ["baralho-safira", 9], ["mesa-esmeralda", 10], ["reacao-caveira", 10],
  ["moldura-onix", 11], ["mesa-preta", 12], ["baralho-ouro-negro", 13], ["reacao-aplauso", 14], ["moldura-diamante", 15],
  ["moldura-esmeralda", 16], ["baralho-rubi", 17], ["baralho-marfim", 18],
];

describe("o catálogo é FECHADO, por categoria, e é o mesmo do banco", () => {
  it("22 itens em quatro categorias; a curva combinada N2–N15 (+16/17/18); livres: duas mesas e duas reações", () => {
    expect(CATEGORIAS.map((c) => c.id)).toEqual(["moldura", "baralho", "mesa", "reacao"]);
    expect(CATALOGO).toHaveLength(22);
    expect(CATALOGO.filter((i) => i.categoria === "moldura").map((i) => i.nome))
      .toEqual(["Moldura Real", "Moldura Rubi Real", "Moldura Ônix Imperial", "Moldura Diamante do Rei", "Moldura Esmeralda Suprema"]);
    expect(CATALOGO.filter((i) => i.categoria === "baralho").map((i) => i.nome))
      .toEqual(["Baralho Imperial", "Baralho Safira Noturna", "Baralho Ouro Negro", "Baralho Imperial Rubi", "Baralho Marfim Real"]);
    expect(CATALOGO.filter((i) => i.categoria === "mesa").map((i) => i.nome))
      .toEqual(["Noite Imperial", "Verde Clássica", "Vinho Imperial", "Azul Royal", "Esmeralda Real", "Preta Premium"]);
    expect(CATALOGO.filter((i) => i.categoria === "reacao").map((i) => i.nome))
      .toEqual(["Risada", "Choro", "Fogo", "Coroa", "Caveira / Azar", "Aplauso"]);
    expect(CATALOGO.filter((i) => i.nivel <= 1).map((i) => i.id)).toEqual(["mesa-imperial", "mesa-verde", "reacao-risada", "reacao-choro"]);
    // a curva, EM ORDEM de nível (é a ordem da celebração e do "próximo")
    expect(DESBLOQUEAVEIS.map((i) => [i.id, i.nivel])).toEqual(CURVA);
    // de 2 a 15, exatamente um desbloqueio por nível — e o 10 com a Esmeralda Real, que já era dele
    for (let n = 2; n <= 15; n++) expect(CURVA.filter(([, x]) => x === n).length, `nível ${n}`).toBe(n === 10 ? 2 : 1);
    expect(CATEGORIAS.filter((c) => c.exclusiva).map((c) => c.id)).toEqual(["mesa"]);
    expect(CATALOGO.some((i) => i.categoria === "avatar")).toBe(false);
  });

  it("os níveis daqui são os MESMOS da migração do catálogo (o banco é quem recusa) — e as toalhas e reações, as MESMAS do servidor", () => {
    const sql = ler("../../../../supabase/migrations/20261119120000_cosmeticos_catalogo.sql");
    for (const i of CATALOGO.filter((x) => !x.toalha && x.nivel > 1)) expect(sql).toMatch(new RegExp(`when p_item = '${i.id}'\\s+then\\s+${i.nivel}\\b`));
    for (const i of CATALOGO.filter((x) => x.toalha)) expect(sql).toMatch(new RegExp(`when p_toalha = '${i.toalha}'\\s+then\\s+${i.nivel}\\b`));
    // e o catálogo das COLUNAS do banco é o mesmo daqui
    expect(sql).toContain(`check (moldura in (${MOLDURAS.map((m) => `'${m}'`).join(", ")}))`);
    expect(sql).toContain(`check (baralho in (${BARALHOS.map((m) => `'${m}'`).join(", ")}))`);
    expect(sql).toContain(`check (toalha in (${TOALHAS.map((m) => `'${m}'`).join(", ")}))`);
    expect(sql).toContain(`check (reacoes <@ array[${REACOES.slice(2).map((m) => `'${m}'`).join(", ")}]::text[])`);
    const servidor = ler("../../../server/src/rooms/identidade.ts");
    const temas = servidor.slice(servidor.indexOf("export const TEMAS_DA_MESA"), servidor.indexOf("] as const;", servidor.indexOf("export const TEMAS_DA_MESA")));
    expect([...temas.matchAll(/"([a-z]+)"/g)].map((m) => m[1])).toEqual([...TOALHAS]);
    const cos = ler("../../../server/src/progresso/cosmeticos.ts");
    expect(cos).toContain(`export const MOLDURAS = [${MOLDURAS.map((m) => `"${m}"`).join(", ")}] as const;`);
    expect(cos).toContain(`export const REACOES_DE_NIVEL = [${REACOES.slice(2).map((m) => `"${m}"`).join(", ")}] as const;`);
    const social = ler("../../../server/src/rooms/social.ts");
    expect(social).toContain(`export const REACOES = [${REACOES.map((m) => `"${m}"`).join(", ")}] as const;`);
    expect(social).toContain(`export const REACOES_LIVRES = ["risada", "choro"] as const;`);
  });

  it("estado de cada desbloqueio nas BORDAS de nível; as livres nunca bloqueiam", () => {
    for (const [id, nivel] of CURVA) {
      const i = CATALOGO.find((x) => x.id === id)!;
      expect(estadoDoItem(i, nivel - 1, NADA_EQUIPADO), `${id} no ${nivel - 1}`).toBe("bloqueado");
      expect(estadoDoItem(i, nivel, NADA_EQUIPADO), `${id} no ${nivel}`).toBe("desbloqueado");
    }
    for (const n of [1, 2, 10, 18, 40]) {
      expect(liberadosNo(n).length).toBe(CURVA.filter(([, x]) => x <= n).length);
      expect(estadoDoItem(itemDaToalha("verde"), n, NADA_EQUIPADO)).toBe("desbloqueado");
      expect(estadoDoItem(itemDaToalha("imperial"), n, NADA_EQUIPADO)).toBe("equipado"); // a padrão
      expect(estadoDoItem(CATALOGO.find((i) => i.id === "reacao-risada")!, n, NADA_EQUIPADO)).toBe("equipado"); // livre, sempre
    }
    // equipado no banco mas abaixo do nível (impossível pelo banco): a vitrine mostra BLOQUEADO
    expect(estadoDoItem(CATALOGO.find((i) => i.id === "moldura-diamante")!, 14, com(["moldura-diamante"]))).toBe("bloqueado");
    expect(proximoDesbloqueio(1)?.id).toBe("moldura-real");
    expect(proximoDesbloqueio(2)?.id).toBe("mesa-vinho");
    expect(proximoDesbloqueio(9)?.id).toBe("mesa-esmeralda");
    expect(proximoDesbloqueio(14)?.id).toBe("moldura-diamante");
    expect(proximoDesbloqueio(17)?.id).toBe("baralho-marfim");
    expect(proximoDesbloqueio(18)).toBeNull();
  });
});

describe("leitura e equipar: o banco decide, falha vira 'sem vitrine'", () => {
  function porta(over: Partial<PortaDeCosmeticos> = {}) {
    const chamadas: string[] = [];
    const p: PortaDeCosmeticos = {
      meus: async () => { chamadas.push("meus"); return { data: { moldura: "rubi", baralho: null, reacoes: ["fogo"], toalha: "verde" }, error: null }; },
      equipar: async (item, sim) => {
        chamadas.push(`equipar:${item}:${sim}`);
        return { data: [{ moldura: "onix", baralho: sim ? "safira" : null, reacoes: ["fogo", "aplauso"], toalha: "azul" }], error: null };
      },
      ...over,
    };
    return { p, chamadas };
  }

  it("SEM SESSÃO não pergunta nada (nem cria convidado)", async () => {
    const { p, chamadas } = porta();
    const api = criarCosmeticos(async () => p, () => false);
    expect(await api.meus()).toBeNull();
    expect(await api.equipar("moldura-real", true)).toEqual({ ok: false, motivo: "falha" });
    expect(chamadas).toEqual([]);
  });

  it("lê o que está equipado (uma moldura, um baralho ou nenhum, as reações, a toalha); sem linha ainda = nada equipado", async () => {
    expect(await criarCosmeticos(async () => porta().p).meus()).toEqual(com(["moldura-rubi", "reacao-fogo"], "verde"));
    const vazio = porta({ meus: async () => ({ data: null, error: null }) }).p;
    expect(await criarCosmeticos(async () => vazio).meus()).toEqual(NADA_EQUIPADO);
    expect(NADA_EQUIPADO["reacao-risada"] && NADA_EQUIPADO["reacao-choro"] && NADA_EQUIPADO["mesa-imperial"]).toBe(true);
  });

  it("tabela ausente (migração não aplicada), banco só com as partes 1–2, erro, exceção ou linha estranha → null, nunca lança", async () => {
    const linha = { moldura: null, baralho: null, reacoes: [], toalha: "imperial" };
    const casos: Partial<PortaDeCosmeticos>[] = [
      { meus: async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }) },
      { meus: async () => ({ data: null, error: { code: "42703", message: "column moldura does not exist" } }) },
      { meus: async () => { throw new Error("rede"); } },
      { meus: async () => ({ data: { ...linha, moldura: "dourada" }, error: null }) },
      { meus: async () => ({ data: { ...linha, baralho: "azul" }, error: null }) },
      { meus: async () => ({ data: { ...linha, reacoes: "fogo" }, error: null }) },
      { meus: async () => ({ data: { ...linha, reacoes: ["risada"] }, error: null }) },
      { meus: async () => ({ data: { ...linha, toalha: "roxa" }, error: null }) },
      { meus: async () => ({ data: { moldura_real: true, baralho_imperial: false, reacao_coroa: false, toalha: "verde" }, error: null }) },
    ];
    for (const c of casos) expect(await criarCosmeticos(async () => porta(c).p).meus()).toBeNull();
    expect(await criarCosmeticos(async () => null).meus()).toBeNull();
  });

  it("equipar: UMA porta para tudo (equipar_item); a resposta INTEIRA do banco vira o estado; fora do catálogo e reação livre nem saem do aparelho; 42501 = nível", async () => {
    const { p, chamadas } = porta();
    const api = criarCosmeticos(async () => p);
    expect(await api.equipar("moldura-dourada" as never, true)).toEqual({ ok: false, motivo: "falha" });
    expect(await api.equipar("reacao-risada", false)).toEqual({ ok: false, motivo: "falha" });
    expect(chamadas).toEqual([]);
    expect(await api.equipar("baralho-safira", true))
      .toEqual({ ok: true, equipados: com(["moldura-onix", "baralho-safira", "reacao-fogo", "reacao-aplauso"], "azul") });
    expect(await api.equipar("mesa-azul", true)).toMatchObject({ ok: true });
    expect(chamadas).toEqual(["equipar:baralho-safira:true", "equipar:mesa-azul:true"]);
    const negado = criarCosmeticos(async () => porta({ equipar: async () => ({ data: null, error: { code: "42501", message: "nível insuficiente" } }) }).p);
    expect(await negado.equipar("moldura-diamante", true)).toEqual({ ok: false, motivo: "nivel" });
    const caiu = criarCosmeticos(async () => porta({ equipar: async () => { throw new Error("rede"); } }).p);
    expect(await caiu.equipar("reacao-coroa", true)).toEqual({ ok: false, motivo: "falha" });
    const estranha = criarCosmeticos(async () => porta({ equipar: async () => ({ data: [{ moldura: null, baralho: null, reacoes: [], toalha: "roxa" }], error: null }) }).p);
    expect(await estranha.equipar("mesa-verde", true)).toEqual({ ok: false, motivo: "falha" });
  });

  it("a mesa CONTRA OS BOTS: só a toalha guardada e conhecida; o resto cai na Noite Imperial", () => {
    expect(mesaGuardada()).toBe("imperial");
    guardarMesa("preta");
    expect(mesaGuardada()).toBe("preta");
    armazenamento.setItem("king:mesa", "roxa<script>");
    expect(mesaGuardada()).toBe("imperial");
    guardarMesa("imperial");
    expect(armazenamento.getItem("king:mesa")).toBeNull();
  });

  it("a porta real só LÊ cosmeticos_equipados e só CHAMA equipar_item — nada de nível ou XP vai do cliente", () => {
    const t = semComentarios(ler("../auth/cosmeticos.ts"));
    expect(t).toContain('c.from("cosmeticos_equipados")');
    expect(t).toContain('.select("moldura, baralho, reacoes, toalha")');
    expect(t).toContain('c.rpc("equipar_item", { p_item: item, p_equipado: equipado })');
    expect(t.match(/c\.rpc\(/g)).toHaveLength(1);
    expect(t).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    expect(t).not.toMatch(/p_nivel|p_xp|xp_total/);
  });
});

describe("o BARALHO é só deste aparelho e só pintura", () => {
  it("troca pela raiz do documento e guarda a escolha; o 'imperial' guardado pela Entrega B continua valendo; lixo é ignorado", () => {
    const raiz = { dataset: {} as Record<string, string> };
    (globalThis as { document?: unknown }).document = { documentElement: raiz };
    try {
      armazenamento.setItem("king:baralho", "imperial");
      expect(baralhoGuardado()).toBe("imperial");
      aplicarBaralho("ouro-negro");
      expect(raiz.dataset.baralho).toBe("ouro-negro");
      expect(baralhoGuardado()).toBe("ouro-negro");
      aplicarBaralho(null);
      expect(raiz.dataset.baralho).toBeUndefined();
      expect(baralhoGuardado()).toBeNull();
      armazenamento.setItem("king:baralho", "true\"><script>");
      expect(baralhoGuardado()).toBeNull();
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  it("vale o baralho EQUIPADO só se o nível alcança", () => {
    expect(baralhoQueVale(com(["baralho-marfim"]), 18)).toBe("marfim");
    expect(baralhoQueVale(com(["baralho-marfim"]), 17)).toBeNull();
    expect(baralhoQueVale(NADA_EQUIPADO, 40)).toBeNull();
  });

  it("o CSS dos baralhos não muda tamanho, posição nem alvo de carta — e não toca no K♥ nem no estado jogável; cada baralho tem verso E face", () => {
    const css = ler("./theme.css");
    const bloco = css.slice(css.indexOf("── BARALHO IMPERIAL"), css.indexOf("── REAÇÃO DA COROA"));
    expect(bloco.length).toBeGreaterThan(500);
    expect(bloco).not.toMatch(/width|height|transform|margin|padding|position|--cw:|pointer-events|\.king|\.legal|\.illegal|display:none/);
    for (const b of BARALHOS) {
      expect(bloco, b).toContain(`:root[data-baralho="${b}"] .card.back`);
      expect(bloco, b).toContain(`:root[data-baralho="${b}"] .card:not(.back)`);
      expect(bloco, b).toContain(`.card.back.baralho-${b}`);
    }
  });
});

describe("a celebração: uma vez por item, por conta", () => {
  it("ao subir, só o que ainda não foi celebrado; marcado, não volta", () => {
    expect(paraCelebrar(1, "a").map((i) => i.id)).toEqual([]);
    expect(paraCelebrar(2, "a").map((i) => i.id)).toEqual(["moldura-real"]);
    marcarCelebrados("a", ["moldura-real"]);
    expect(paraCelebrar(2, "a")).toEqual([]);
    expect(paraCelebrar(4, "a").map((i) => i.id)).toEqual(["mesa-vinho", "baralho-imperial"]);
    marcarCelebrados("a", ["mesa-vinho", "baralho-imperial"]);
    expect(paraCelebrar(10, "a").map((i) => i.id))
      .toEqual(["reacao-fogo", "reacao-coroa", "moldura-rubi", "mesa-azul", "baralho-safira", "mesa-esmeralda", "reacao-caveira"]);
  });

  it("outra conta no mesmo aparelho não herda o que a primeira já viu", () => {
    marcarCelebrados("a", ["moldura-real", "mesa-vinho"]);
    expect(paraCelebrar(3, "b").map((i) => i.id)).toEqual(["moldura-real", "mesa-vinho"]);
  });

  it("armazenamento quebrado ou corrompido não derruba nada", () => {
    armazenamento.setItem("king:cosmeticos:celebrados", "{lixo");
    expect(paraCelebrar(2, "a").map((i) => i.id)).toEqual(["moldura-real"]);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => marcarCelebrados("a", ["moldura-real"])).not.toThrow();
  });
});

describe("a VITRINE diz bloqueado/desbloqueado/equipado, e não promete XP de partida solo", () => {
  const vitrine = (nivel: number, equipados: Equipados = NADA_EQUIPADO): HTMLElement => parse(renderToStaticMarkup(
    <VitrineDeItens nivel={nivel} equipados={equipados} ocupado={false} aviso={null} onEquipar={noop} onFechar={noop} />,
  ));
  const item = (r: HTMLElement, id: string) => r.querySelector(`[data-item="${id}"]`)!;

  it("nível 1: todos os desbloqueios trancados, cada um com o nível que libera; mesas e reações livres", () => {
    const r = vitrine(1);
    for (const i of DESBLOQUEAVEIS) {
      expect(item(r, i.id).classList.contains("bloqueado")).toBe(true);
      expect(item(r, i.id).querySelector(".it-estado")!.text).toBe(`🔒 Nível ${i.nivel}`);
      expect(item(r, i.id).querySelector(".it-botao")).toBeNull();
    }
    // a mesa é EXCLUSIVA: a em uso não tem botão; a outra livre tem "Usar"
    expect(item(r, "mesa-imperial").querySelector(".it-estado")!.text).toBe("Em uso");
    expect(item(r, "mesa-imperial").querySelector(".it-botao")).toBeNull();
    expect(item(r, "mesa-verde").querySelector(".it-estado")!.text).toBe("Livre");
    expect(item(r, "mesa-verde").querySelector(".it-botao")!.text).toBe("Usar");
    // as reações livres: "Livre", sem botão (são de todo mundo, sempre)
    for (const id of ["reacao-risada", "reacao-choro"]) {
      expect(item(r, id).querySelector(".it-estado")!.text).toBe("Livre");
      expect(item(r, id).querySelector(".it-botao")).toBeNull();
    }
    expect(r.querySelector(".it-proximo")!.text).toBe("Próximo: Moldura Real no nível 2");
    expect(r.querySelector(".sub")!.text).toContain(`0 de ${DESBLOQUEAVEIS.length}`);
  });

  it("organizada por CATEGORIA, na ordem do catálogo, com a amostra de verdade de cada item", () => {
    const r = vitrine(8);
    const secoes = r.querySelectorAll(".it-categoria");
    expect(secoes.map((s) => s.querySelector(".it-cat-titulo")!.text)).toEqual(["Molduras", "Baralhos", "Mesas", "Reações"]);
    expect(secoes.map((s) => s.querySelectorAll(".it-item").map((li) => li.getAttribute("data-item"))))
      .toEqual(CATEGORIAS.map((c) => CATALOGO.filter((i) => i.categoria === c.id).map((i) => i.id)));
    expect(item(r, "mesa-azul").querySelector(".it-estado")!.text).toBe("Desbloqueado");
    expect(item(r, "mesa-preta").querySelector(".it-estado")!.text).toBe("🔒 Nível 12");
    expect(r.querySelector(".sub")!.text).toContain(`7 de ${DESBLOQUEAVEIS.length}`);
    expect(r.querySelector(".it-proximo")!.text).toBe("Próximo: Baralho Safira Noturna no nível 9");
    expect(vitrine(18).querySelector(".it-proximo")!.text).toBe("Todos os itens da Coroa desbloqueados");
    // as amostras usam as MESMAS classes da partida
    expect(item(r, "mesa-azul").querySelector(".tema-amostra")!.getAttribute("data-tema")).toBe("azul");
    expect(item(r, "moldura-onix").querySelector(".sl-av.mold.moldura-onix")).not.toBeNull();
    expect(item(r, "baralho-ouro-negro").querySelector(".card.back.baralho-ouro-negro")).not.toBeNull();
    expect(item(r, "reacao-caveira").querySelector(".balao.reacao.r-caveira .rc-emoji")!.text).toBe("💀");
  });

  it("moldura e baralho: o equipado diz 'Desequipar'; os outros liberados, 'Equipar' (o banco troca); reação de nível liga/desliga", () => {
    const r = vitrine(13, com(["moldura-rubi", "baralho-ouro-negro", "reacao-fogo"]));
    expect(item(r, "moldura-rubi").querySelector(".it-estado")!.text).toBe("Equipado");
    expect(item(r, "moldura-rubi").querySelector(".it-botao")!.text).toBe("Desequipar");
    expect(item(r, "moldura-onix").querySelector(".it-botao")!.text).toBe("Equipar");
    expect(item(r, "moldura-diamante").querySelector(".it-estado")!.text).toBe("🔒 Nível 15");
    expect(item(r, "baralho-ouro-negro").querySelector(".it-botao")!.text).toBe("Desequipar");
    expect(item(r, "baralho-imperial").querySelector(".it-botao")!.text).toBe("Equipar");
    expect(item(r, "reacao-fogo").querySelector(".it-botao")!.text).toBe("Desequipar");
    expect(item(r, "reacao-caveira").querySelector(".it-botao")!.text).toBe("Equipar");
    expect(item(r, "reacao-aplauso").querySelector(".it-estado")!.text).toBe("🔒 Nível 14");
  });

  it("diz de onde vem o XP: online com outras pessoas; contra os bots não conta; nada de loja", () => {
    expect(vitrine(1).querySelector(".it-origem")!.text).toBe(ORIGEM_DO_XP);
    expect(ORIGEM_DO_XP).toMatch(/online/);
    expect(ORIGEM_DO_XP).toMatch(/bots não contam/);
    const html = vitrine(18).toString();
    expect(html).not.toMatch(/R\$|preço|comprar|moeda|sorteio|loot|baú/i);
  });

  it(`a celebração diz NOVO ITEM DESBLOQUEADO! e quais — no máximo ${MAX_NA_CELEBRACAO}, os mais novos, e "e mais N"`, () => {
    const dois = parse(renderToStaticMarkup(<NovoItemDesbloqueado itens={DESBLOQUEAVEIS.slice(0, 2)} onVer={noop} onFechar={noop} />));
    expect(dois.querySelector(".ni-titulo")!.text).toBe("NOVO ITEM DESBLOQUEADO!");
    expect(dois.querySelectorAll(".ni-itens li").map((l) => l.childNodes[l.childNodes.length - 1].text)).toEqual(["Moldura Real", "Vinho Imperial"]);
    expect(dois.querySelector(".ni-mais")).toBeNull();
    const todos = parse(renderToStaticMarkup(<NovoItemDesbloqueado itens={DESBLOQUEAVEIS} onVer={noop} onFechar={noop} />));
    expect(todos.querySelectorAll(".ni-itens li").map((l) => l.childNodes[l.childNodes.length - 1].text))
      .toEqual(["Moldura Diamante do Rei", "Moldura Esmeralda Suprema", "Baralho Imperial Rubi", "Baralho Marfim Real"]);
    expect(todos.querySelector(".ni-mais")!.text).toBe(`e mais ${DESBLOQUEAVEIS.length - MAX_NA_CELEBRACAO} itens`);
  });
});

describe("MOLDURA e REAÇÕES vêm SÓ do assento sincronizado pelo servidor", () => {
  const SEATS: Seat[] = [0, 1, 2, 3];
  const NOMES = ["Você", "Bia", "Léo", "Nara"];
  type Cos = { moldura?: boolean; coroa?: boolean; estiloMoldura?: string; reacoes?: string[] };
  function sala(cos: Partial<Record<number, Cos>>): EstadoDaSalaLido {
    return {
      protocolVersion: 3, roomCode: "0315", roomId: "0315", status: "playing",
      seats: SEATS.map((s) => ({
        seat: s, playerId: "p" + s, nick: NOMES[s], connected: true, ready: false, assisted: false, bot: false,
        host: s === 0, avatar: ["leao", "sapo", "coruja", "unicornio"][s], ...(cos[s] ?? {}),
      })),
    };
  }
  const mp = (eu: Seat, s: EstadoDaSalaLido): MesaMultiplayer => ({
    eu, sala: s, conexao: "conectado", relogio: null, prontos: [], recusa: null, emVoo: null, aguardando: false,
    pediProximaMao: false, mensagens: {}, onEnviarMensagem: noop, onCancelarProximaMao: noop,
  });
  function mesa(eu: Seat, s: EstadoDaSalaLido): HTMLElement {
    const m = createMatch(NOMES, 23);
    startNextHand(m);
    const g = new PartidaRemota({ matchId: "m1", stateVersion: 9, view: redactFor(m, eu), cause: "HAND_STARTED" }, eu, noop);
    return parse(renderToStaticMarkup(
      <Mesa game={g} reviewing={false} shake={0} castigo={null} onPlay={noop} onChooseTrump={noop}
        onAdvance={noop} onHome={noop} onRestart={noop} onOpenAudio={noop} mp={mp(eu, s)} />,
    ));
  }

  it("cada moldura aparece no assento certo, com o SEU estilo, em QUALQUER aparelho da mesa (os 4 veem igual)", () => {
    const s = sala({ 1: { estiloMoldura: "diamante" }, 3: { estiloMoldura: "rubi" } });
    for (const eu of SEATS) {
      const r = mesa(eu, s);
      const vistos = r.querySelectorAll(".av.mold").map((el) => {
        const c = [...el.classList.values()];
        return `${c.find((x) => /^s\d$/.test(x))}:${c.find((x) => x.startsWith("moldura-"))}`;
      });
      expect(vistos.sort(), `visto do assento ${eu}`).toEqual(["s1:moldura-diamante", "s3:moldura-rubi"]);
    }
  });

  it("servidor da Entrega B (só `moldura: true`): vira a Moldura Real; sem os campos: nenhuma moldura, a Mesa é a de sempre", () => {
    const lido = lerEstadoDaSala({ protocolVersion: 3, roomCode: "1", roomId: "1", status: "playing", seats: [{ seat: 0, moldura: true, coroa: true }] });
    expect(lido!.seats[0]).toMatchObject({ estiloMoldura: "real", reacoes: undefined, coroa: true });
    const novo = lerEstadoDaSala({ protocolVersion: 3, roomCode: "1", roomId: "1", status: "playing",
      seats: [{ seat: 0, moldura: true, estiloMoldura: "<b>", reacoes: "fogo,risada,lixo,aplauso" }] });
    expect(novo!.seats[0]).toMatchObject({ estiloMoldura: "", reacoes: ["fogo", "aplauso"] });
    const r = mesa(0, sala({}));
    expect(r.querySelectorAll(".mold")).toHaveLength(0);
    expect(r.querySelectorAll(".av")).toHaveLength(4);
  });

  it("o PLACAR FINAL mostra a moldura de cada um na linha dele (é onde a mesa inteira olha para quem venceu)", () => {
    const g = new KingGame(NOMES, 42);
    for (let guarda = 0; guarda < 40_000 && g.phase() !== "matchEnd"; guarda++) {
      if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]);
      else if (g.needsBotPlay()) g.stepBotPlay();
      else if (g.needsBotTrump()) g.stepBotTrump();
      else if (g.phase() === "trump") g.chooseTrumpHuman("hearts");
      else if (g.phase() === "handEnd") g.advanceHand();
      else break;
    }
    const s = sala({ 0: { estiloMoldura: "esmeralda" }, 2: { estiloMoldura: "onix" } });
    const r = parse(renderToStaticMarkup(<PlacarFinal game={g} onRestart={noop} onHome={noop} mp={mp(0, s)} />));
    const linhas = r.querySelectorAll(".fimlinha");
    expect(linhas).toHaveLength(4);
    const vistos = linhas.map((l) => {
      const av = l.querySelector(".av")!;
      const c = [...av.classList.values()];
      return `${c.find((x) => /^s\d$/.test(x))}:${c.find((x) => x.startsWith("moldura-")) ?? "-"}`;
    }).sort();
    expect(vistos).toEqual(["s0:moldura-esmeralda", "s1:-", "s2:moldura-onix", "s3:-"]);
  });

  it("as reações do MEU assento: as de nível que o servidor liberou + as livres; servidor da Entrega B = só a coroa; a chave é a mão desta sala", () => {
    const s = sala({ 2: { reacoes: ["fogo", "aplauso"] }, 1: { reacoes: [] }, 3: { coroa: true } });
    expect(reacoesDaMesa(mp(2, s), 3)).toEqual({ chave: "0315:3", liberadas: ["risada", "choro", "fogo", "aplauso"] });
    expect(reacoesDaMesa(mp(1, s), 3)).toEqual({ chave: "0315:3", liberadas: ["risada", "choro"] });
    expect(reacoesDaMesa(mp(3, s), 3)).toEqual({ chave: "0315:3", liberadas: ["coroa"] });
    expect(reacoesDaMesa(mp(0, s), 3)).toBeUndefined();
  });

  it("o painel mostra a fileira de reações liberadas, com o emoji grande e o nome no rótulo", () => {
    // o painel só abre com clique: aqui se confere o componente fechado e a amostra de cada reação
    const html = renderToStaticMarkup(<BotaoSocial status="playing" onEnviar={noop} reacoes={{ chave: "x:1", liberadas: ["risada", "coroa"] }} />);
    expect(html).toContain('aria-label="Mensagens rápidas"');
    expect(REACOES_SOCIAIS.map((r) => r.id)).toEqual([...REACOES]);
  });

  it("o balão da reação é o MESMO balão, com emoji grande e acabamento próprio; a coroa mantém a classe dela; desconhecida segue sem balão", () => {
    const b = parse(renderToStaticMarkup(<BalaoSocial mensagem={{ id: "coroa", nonce: 1 }} />));
    expect(b.querySelector(".balao.reacao.r-coroa.coroa")!.getAttribute("aria-label")).toBe(COROA.texto);
    for (const r of REACOES_SOCIAIS) {
      const x = parse(renderToStaticMarkup(<BalaoSocial mensagem={{ id: r.id, nonce: 2 }} />));
      expect(x.querySelector(`.balao.reacao.r-${r.id} .rc-emoji`)!.text).toBe(r.emoji);
      expect(x.querySelector(`.balao.reacao.r-${r.id} .rc-txt`)!.text).toBe(r.curto);
    }
    const comum = parse(renderToStaticMarkup(<BalaoSocial mensagem={{ id: "boa", nonce: 2 }} />));
    expect(comum.querySelector(".balao")!.classList.contains("reacao")).toBe(false);
    expect(renderToStaticMarkup(<BalaoSocial mensagem={{ id: "coroa-falsa", nonce: 3 }} />)).toBe("");
  });
});

describe("as REAÇÕES dentro do sistema social de sempre", () => {
  it("não entram nos atalhos nem nas categorias de frases, mas o balão delas é desenhado por todos", () => {
    for (const r of REACOES) {
      expect(MENSAGENS.map((m) => m.id)).not.toContain(r);
      for (const m of ["playing", "placar", "finished"] as const) expect(atalhosDe(m).map((f) => f.id)).not.toContain(r);
      expect(porCategoria().flatMap((g) => g.frases).map((f) => f.id)).not.toContain(r);
      expect(fraseDe(r)?.id).toBe(r);
    }
    expect(fraseDe("coroa")).toEqual(COROA);
    expect(COROA.texto).toBe("Viva o Rei! 👑");
  });

  it("CONTRATO: as etiquetas do cliente são EXATAMENTE as que o servidor aceita", () => {
    const servidor = ler("../../../server/src/rooms/social.ts");
    const lista = servidor.slice(servidor.indexOf("export const MENSAGENS_SOCIAIS = ["), servidor.indexOf("] as const;"));
    const doServidor = [...semComentarios(lista).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect([...ETIQUETAS_SOCIAIS].sort()).toEqual([...doServidor].sort());
  });

  it("este cliente DECLARA que sabe mostrar as seis reações ao entrar — com as mesmas etiquetas do servidor —, com ou sem conta", () => {
    expect(RECURSOS_DO_CLIENTE).toEqual([...REACOES]);
    const pedido = { nick: "Tito", avatar: "coruja" };
    expect(opcoesDeEntrada(pedido).recursos).toEqual([...REACOES]);
    expect(opcoesDeEntrada(pedido, "tok").recursos).toEqual([...REACOES]);
  });

  it("o analytics aceita as etiquetas das reações (do conjunto fechado) e continua recusando texto livre", () => {
    for (const r of REACOES) expect(sanitizar("social_message_sent", { mensagem: r })).toEqual({ mensagem: r });
    expect(sanitizar("social_message_sent", { mensagem: "Viva o Rei!" })).toEqual({});
  });
});
