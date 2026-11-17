/**
 * OS ITENS DA COROA NO CLIENTE (Entrega B).
 *
 * O cliente não decide nada: desenha o que o banco e o servidor disseram. O que se cobra aqui é
 * que ele desenhe CERTO (bloqueado/desbloqueado/equipado nas bordas de nível), que a moldura e a
 * coroa venham SÓ do assento sincronizado, que o baralho não mude tamanho nem alvo de carta, que a
 * celebração apareça uma vez por item e por conta, e que qualquer falha vire "sem vitrine" — nunca
 * um erro na Home.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import { createMatch, startNextHand, redactFor, type Seat } from "@king/engine";
import {
  CATALOGO, NADA_EQUIPADO, aplicarBaralho, baralhoGuardado, criarCosmeticos, estadoDoItem, liberadosNo,
  marcarCelebrados, paraCelebrar, type Equipados, type PortaDeCosmeticos,
} from "../auth/cosmeticos.js";
import { NovoItemDesbloqueado, ORIGEM_DO_XP, VitrineDeItens } from "./Cosmeticos.js";
import { BalaoSocial, coroaDaMesa, type MesaMultiplayer } from "./MesaOnline.js";
import { Mesa } from "./Mesa.js";
import { PartidaRemota } from "../game/partidaRemota.js";
import { COROA, ETIQUETAS_SOCIAIS, MENSAGENS, atalhosDe, fraseDe, porCategoria } from "./social.js";
import { sanitizar } from "../analytics/analytics.js";
import { RECURSOS_DO_CLIENTE, opcoesDeEntrada, type EstadoDaSalaLido } from "../net/clienteKing.js";

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

describe("o catálogo é FECHADO e é o mesmo do banco", () => {
  it("três itens, níveis 2/4/6, nesta ordem", () => {
    expect(CATALOGO.map((i) => [i.id, i.nivel])).toEqual([["moldura-real", 2], ["baralho-imperial", 4], ["reacao-coroa", 6]]);
  });

  it("os níveis daqui são os MESMOS da migração (o banco é quem recusa)", () => {
    const sql = ler("../../../../supabase/migrations/20261117120000_cosmeticos.sql");
    for (const i of CATALOGO) expect(sql).toContain(`when '${i.id}'`.padEnd(`when '${i.id}'`.length) );
    for (const i of CATALOGO) expect(sql).toMatch(new RegExp(`when '${i.id}'\\s+then ${i.nivel}\\b`));
  });

  it("estado de cada item nas BORDAS de nível", () => {
    const tabela: [number, string[]][] = [
      [1, ["bloqueado", "bloqueado", "bloqueado"]],
      [2, ["desbloqueado", "bloqueado", "bloqueado"]],
      [3, ["desbloqueado", "bloqueado", "bloqueado"]],
      [4, ["desbloqueado", "desbloqueado", "bloqueado"]],
      [5, ["desbloqueado", "desbloqueado", "bloqueado"]],
      [6, ["desbloqueado", "desbloqueado", "desbloqueado"]],
      [40, ["desbloqueado", "desbloqueado", "desbloqueado"]],
    ];
    for (const [nivel, esperado] of tabela) {
      expect(CATALOGO.map((i) => estadoDoItem(i, nivel, NADA_EQUIPADO)), `nível ${nivel}`).toEqual(esperado);
      expect(liberadosNo(nivel).length).toBe(esperado.filter((e) => e !== "bloqueado").length);
    }
    const tudo: Equipados = { "moldura-real": true, "baralho-imperial": true, "reacao-coroa": true };
    // equipado no banco mas abaixo do nível (impossível pelo banco): a vitrine mostra BLOQUEADO
    expect(CATALOGO.map((i) => estadoDoItem(i, 4, tudo))).toEqual(["equipado", "equipado", "bloqueado"]);
  });
});

describe("leitura e equipar: o banco decide, falha vira 'sem vitrine'", () => {
  function porta(over: Partial<PortaDeCosmeticos> = {}) {
    const chamadas: string[] = [];
    const p: PortaDeCosmeticos = {
      meus: async () => { chamadas.push("meus"); return { data: { moldura_real: true, baralho_imperial: false, reacao_coroa: false }, error: null }; },
      equipar: async (item, sim) => { chamadas.push(`equipar:${item}:${sim}`); return { data: [{ moldura_real: true, baralho_imperial: sim, reacao_coroa: false }], error: null }; },
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

  it("lê o que está equipado; sem linha ainda = nada equipado", async () => {
    expect(await criarCosmeticos(async () => porta().p).meus()).toEqual({ "moldura-real": true, "baralho-imperial": false, "reacao-coroa": false });
    const vazio = porta({ meus: async () => ({ data: null, error: null }) }).p;
    expect(await criarCosmeticos(async () => vazio).meus()).toEqual(NADA_EQUIPADO);
  });

  it("tabela ausente (migração não aplicada), erro, exceção ou linha estranha → null, nunca lança", async () => {
    const casos: Partial<PortaDeCosmeticos>[] = [
      { meus: async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }) },
      { meus: async () => { throw new Error("rede"); } },
      { meus: async () => ({ data: { moldura_real: "sim", baralho_imperial: false, reacao_coroa: false }, error: null }) },
      { meus: async () => ({ data: { moldura_real: true }, error: null }) },
    ];
    for (const c of casos) expect(await criarCosmeticos(async () => porta(c).p).meus()).toBeNull();
    expect(await criarCosmeticos(async () => null).meus()).toBeNull();
  });

  it("equipar: item fora do catálogo nem sai do aparelho; 42501 do banco = nível; o resto = falha", async () => {
    const { p, chamadas } = porta();
    const api = criarCosmeticos(async () => p);
    expect(await api.equipar("moldura-dourada" as never, true)).toEqual({ ok: false, motivo: "falha" });
    expect(chamadas).toEqual([]);
    expect(await api.equipar("baralho-imperial", true)).toEqual({ ok: true, equipados: { "moldura-real": true, "baralho-imperial": true, "reacao-coroa": false } });
    const negado = criarCosmeticos(async () => porta({ equipar: async () => ({ data: null, error: { code: "42501", message: "nível insuficiente" } }) }).p);
    expect(await negado.equipar("reacao-coroa", true)).toEqual({ ok: false, motivo: "nivel" });
    const caiu = criarCosmeticos(async () => porta({ equipar: async () => { throw new Error("rede"); } }).p);
    expect(await caiu.equipar("reacao-coroa", true)).toEqual({ ok: false, motivo: "falha" });
  });

  it("a porta real só LÊ cosmeticos_equipados e só CHAMA equipar_cosmetico — nada de nível ou XP vai do cliente", () => {
    const t = semComentarios(ler("../auth/cosmeticos.ts"));
    expect(t).toContain('c.from("cosmeticos_equipados")');
    expect(t).toContain('c.rpc("equipar_cosmetico", { p_item: item, p_equipado: equipado })');
    expect(t).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    expect(t).not.toMatch(/p_nivel|p_xp|xp_total/);
  });
});

describe("o BARALHO IMPERIAL é só deste aparelho e só pintura", () => {
  it("liga/desliga pela raiz do documento e guarda a escolha", () => {
    const raiz = { dataset: {} as Record<string, string> };
    (globalThis as { document?: unknown }).document = { documentElement: raiz };
    try {
      aplicarBaralho(true);
      expect(raiz.dataset.baralho).toBe("imperial");
      expect(baralhoGuardado()).toBe(true);
      aplicarBaralho(false);
      expect(raiz.dataset.baralho).toBeUndefined();
      expect(baralhoGuardado()).toBe(false);
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });

  it("o CSS do baralho não muda tamanho, posição nem alvo de carta — e não toca no K♥ nem no estado jogável", () => {
    const css = ler("./theme.css");
    const regras = css.split("\n").filter((l) => l.includes('data-baralho="imperial"') || l.includes(".card.imperial") || l.includes(".card.back.imperial"));
    expect(regras.length).toBeGreaterThan(0);
    const bloco = css.slice(css.indexOf("── BARALHO IMPERIAL"), css.indexOf("── REAÇÃO DA COROA"));
    expect(bloco).not.toMatch(/width|height|transform|margin|padding|position|--cw:|pointer-events|\.king|\.legal|\.illegal|display:none/);
  });
});

describe("a celebração: uma vez por item, por conta", () => {
  it("ao subir, só o que ainda não foi celebrado; marcado, não volta", () => {
    expect(paraCelebrar(1, "a").map((i) => i.id)).toEqual([]);
    expect(paraCelebrar(2, "a").map((i) => i.id)).toEqual(["moldura-real"]);
    marcarCelebrados("a", ["moldura-real"]);
    expect(paraCelebrar(2, "a")).toEqual([]);
    expect(paraCelebrar(5, "a").map((i) => i.id)).toEqual(["baralho-imperial"]);
    marcarCelebrados("a", ["baralho-imperial"]);
    expect(paraCelebrar(6, "a").map((i) => i.id)).toEqual(["reacao-coroa"]);
  });

  it("outra conta no mesmo aparelho não herda o que a primeira já viu", () => {
    marcarCelebrados("a", ["moldura-real", "baralho-imperial"]);
    expect(paraCelebrar(4, "b").map((i) => i.id)).toEqual(["moldura-real", "baralho-imperial"]);
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

  it("nível 1: os três bloqueados, cada um com o nível que libera, e nenhum botão de equipar", () => {
    const r = vitrine(1);
    for (const i of CATALOGO) {
      expect(item(r, i.id).classList.contains("bloqueado")).toBe(true);
      expect(item(r, i.id).querySelector(".it-estado")!.text).toBe(`🔒 Nível ${i.nivel}`);
      expect(item(r, i.id).querySelector(".it-botao")).toBeNull();
    }
  });

  it("nível 4 com o baralho equipado: moldura desbloqueada, baralho equipado (Desequipar), coroa bloqueada", () => {
    const r = vitrine(4, { ...NADA_EQUIPADO, "baralho-imperial": true });
    expect(item(r, "moldura-real").querySelector(".it-estado")!.text).toBe("Desbloqueado");
    expect(item(r, "moldura-real").querySelector(".it-botao")!.text).toBe("Equipar");
    expect(item(r, "baralho-imperial").querySelector(".it-estado")!.text).toBe("Equipado");
    expect(item(r, "baralho-imperial").querySelector(".it-botao")!.text).toBe("Desequipar");
    expect(item(r, "reacao-coroa").querySelector(".it-estado")!.text).toBe("🔒 Nível 6");
    expect(r.querySelector(".sub")!.text).toContain("2 de 3");
  });

  it("diz de onde vem o XP: online com outras pessoas; contra os bots não conta", () => {
    expect(vitrine(1).querySelector(".it-origem")!.text).toBe(ORIGEM_DO_XP);
    expect(ORIGEM_DO_XP).toMatch(/online/);
    expect(ORIGEM_DO_XP).toMatch(/bots não contam/);
    // nada de loja, preço, moeda ou sorteio
    const html = vitrine(6).toString();
    expect(html).not.toMatch(/R\$|preço|comprar|moeda|sorteio|loot|baú|gema/i);
  });

  it("a celebração diz NOVO ITEM DESBLOQUEADO! e quais", () => {
    const r = parse(renderToStaticMarkup(<NovoItemDesbloqueado itens={CATALOGO.slice(0, 2)} onVer={noop} onFechar={noop} />));
    expect(r.querySelector(".ni-titulo")!.text).toBe("NOVO ITEM DESBLOQUEADO!");
    expect(r.querySelectorAll(".ni-itens li").map((l) => l.childNodes[l.childNodes.length - 1].text)).toEqual(["Moldura Real", "Baralho Imperial"]);
  });
});

describe("MOLDURA e COROA vêm SÓ do assento sincronizado pelo servidor", () => {
  const SEATS: Seat[] = [0, 1, 2, 3];
  const NOMES = ["Você", "Bia", "Léo", "Nara"];
  function sala(cos: Partial<Record<number, { moldura?: boolean; coroa?: boolean }>>): EstadoDaSalaLido {
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

  it("a moldura aparece no assento certo, em QUALQUER aparelho da mesa (os 4 veem igual)", () => {
    const s = sala({ 1: { moldura: true }, 3: { moldura: true } });
    for (const eu of SEATS) {
      const r = mesa(eu, s);
      const comMoldura = r.querySelectorAll(".av.moldura-real").map((el) => [...el.classList.values()].find((c) => /^s\d$/.test(c)));
      expect(comMoldura.sort(), `visto do assento ${eu}`).toEqual(["s1", "s3"]);
    }
  });

  it("sem os campos (servidor antigo) ou falsos: nenhuma moldura, e a Mesa é a de sempre", () => {
    const r = mesa(0, sala({}));
    expect(r.querySelectorAll(".moldura-real")).toHaveLength(0);
    expect(r.querySelectorAll(".av")).toHaveLength(4);
  });

  it("a coroa só existe no aparelho cujo PRÓPRIO assento o servidor liberou; a chave é a mão desta sala", () => {
    const s = sala({ 2: { coroa: true } });
    expect(coroaDaMesa(mp(2, s), 3)).toEqual({ chave: "0315:3" });
    expect(coroaDaMesa(mp(0, s), 3)).toBeUndefined();
    expect(coroaDaMesa(mp(2, sala({})), 3)).toBeUndefined();
  });

  it("o balão da coroa é o MESMO balão, com acabamento; etiqueta desconhecida segue sem balão", () => {
    const b = parse(renderToStaticMarkup(<BalaoSocial mensagem={{ id: "coroa", nonce: 1 }} />));
    expect(b.querySelector(".balao.coroa")!.text).toBe(COROA.texto);
    const comum = parse(renderToStaticMarkup(<BalaoSocial mensagem={{ id: "boa", nonce: 2 }} />));
    expect(comum.querySelector(".balao")!.classList.contains("coroa")).toBe(false);
    expect(renderToStaticMarkup(<BalaoSocial mensagem={{ id: "coroa-falsa", nonce: 3 }} />)).toBe("");
  });
});

describe("a REAÇÃO DA COROA dentro do sistema social de sempre", () => {
  it("não entra nos atalhos nem no painel de todo mundo, mas o balão dela é desenhado por todos", () => {
    expect(MENSAGENS.map((m) => m.id)).not.toContain("coroa");
    for (const m of ["playing", "placar", "finished"] as const) expect(atalhosDe(m).map((f) => f.id)).not.toContain("coroa");
    expect(porCategoria().flatMap((g) => g.frases).map((f) => f.id)).not.toContain("coroa");
    expect(fraseDe("coroa")).toEqual(COROA);
  });

  it("CONTRATO: as etiquetas do cliente são EXATAMENTE as que o servidor aceita", () => {
    const servidor = ler("../../../server/src/rooms/social.ts");
    const lista = servidor.slice(servidor.indexOf("export const MENSAGENS_SOCIAIS = ["), servidor.indexOf("] as const;"));
    const doServidor = [...semComentarios(lista).matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect([...ETIQUETAS_SOCIAIS].sort()).toEqual([...doServidor].sort());
  });

  it("este cliente DECLARA que sabe mostrar a coroa ao entrar — com a mesma etiqueta do servidor —, com ou sem conta", () => {
    const servidor = ler("../../../server/src/rooms/social.ts");
    const doServidor = /export const REACAO_DA_COROA = "([a-z-]+)"/.exec(servidor)?.[1];
    expect(RECURSOS_DO_CLIENTE).toEqual([COROA.id]);
    expect(COROA.id).toBe(doServidor);
    const pedido = { nick: "Tito", avatar: "coruja" };
    expect(opcoesDeEntrada(pedido).recursos).toEqual(["coroa"]);
    expect(opcoesDeEntrada(pedido, "tok").recursos).toEqual(["coroa"]);
  });

  it("o analytics aceita a etiqueta da coroa (do conjunto fechado) e continua recusando texto livre", () => {
    expect(sanitizar("social_message_sent", { mensagem: "coroa" })).toEqual({ mensagem: "coroa" });
    expect(sanitizar("social_message_sent", { mensagem: "Viva o Rei!" })).toEqual({});
  });
});
