// O SERVIDOR É A AUTORIDADE DO TEMPO — provado pelo formato do protocolo, não por confiança.
//
// A pergunta veio de uma partida real entre dois aparelhos: "o tempo de vocês está igual?". A
// resposta não depende de sincronizar relógio nenhum, e sim de duas propriedades que estes testes
// travam:
//
//   1. NENHUMA mensagem do cliente carrega tempo. Não há campo de carimbo, de duração nem de
//      offset em lugar nenhum do envelope cliente → servidor. Um aparelho com a hora errada, ou
//      um cliente adulterado de propósito, não tem por onde influenciar o prazo: o vocabulário
//      não oferece a palavra.
//   2. O que o servidor manda é DURAÇÃO, não carimbo. `restanteMs` é "falta tanto", e o cliente
//      só precisa medir quanto passou desde que a mensagem chegou. Se um dia isto virar um
//      instante absoluto, todo aparelho com a hora fora do lugar passa a contar errado, e o teste
//      abaixo cai antes de alguém descobrir isso num aparelho de verdade.
//
// Quem derruba a jogada por estouro é sempre o servidor, pelo mesmo caminho de uma ação humana.
// A contrapartida no cliente está em `apps/web/src/ui/relogio.test.ts`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ClienteParaServidor, RelogioDaDecisao } from "../protocol/index.js";

const PROTOCOLO = readFileSync(fileURLToPath(new URL("../protocol/index.ts", import.meta.url)), "utf8");

/** O corpo de uma interface declarada no protocolo, sem comentários. */
function corpoDaInterface(nome: string): string {
  // Aceita `extends`: `JogarCarta` e `EscolherTrunfo` herdam de `IntencaoBase`, e é justamente a
  // base herdada que precisa ser varrida junto (ela vai na lista de cargas).
  const i = PROTOCOLO.search(new RegExp(`export interface ${nome}(\\s+extends\\s+\\w+)?\\s*\\{`));
  if (i < 0) throw new Error(`interface ${nome} não encontrada`);
  const fim = PROTOCOLO.indexOf("\n}", i);
  return PROTOCOLO.slice(i, fim)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
}

/** Nomes de campo de um corpo de interface. */
const campos = (corpo: string) => [...corpo.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);

describe("o cliente não tem vocabulário para falar de tempo", () => {
  // Compila-se junto: se uma mensagem nova entrar no mapa, ela entra nesta lista.
  const MENSAGENS: (keyof ClienteParaServidor)[] = [
    "CLIENT_SET_READY", "CLIENT_PLAY_CARD", "CLIENT_SELECT_TRUMP",
    "CLIENT_READY_NEXT_HAND", "CLIENT_ADD_BOT", "CLIENT_REMOVE_BOT", "CLIENT_SOCIAL_MESSAGE",
    "CLIENT_SET_TABLE_THEME", "CLIENT_SET_AVATAR",
  ];

  it("o mapa cliente → servidor não ganhou mensagens sem que este teste soubesse", () => {
    const corpo = corpoDaInterface("ClienteParaServidor");
    expect(campos(corpo).sort()).toEqual([...MENSAGENS].sort());
  });

  it("nenhum payload de cliente tem campo de tempo", () => {
    // Os payloads das mensagens acima, pelos nomes que o mapa referencia.
    // `ProntoParaProximaMao` é alias de `IntencaoBase`, que entra na lista por si.
    const cargas = ["DefinirPronto", "IntencaoBase", "JogarCarta", "EscolherTrunfo",
      "GerirBot", "EnviarMensagemSocial", "OpcoesDeEntrada"];
    const proibido = /(^|[a-z])(time|timestamp|now|clock|deadline|elapsed|offset|epoch|ms|prazo|instante|agora)($|[A-Z])/;

    for (const nome of cargas) {
      for (const campo of campos(corpoDaInterface(nome))) {
        expect(campo, `${nome}.${campo} parece carregar tempo do cliente`).not.toMatch(proibido);
      }
    }
  });
});

describe("o servidor manda duração, não carimbo de hora", () => {
  it("o relógio da decisão é `restanteMs`, e nada de absoluto o acompanha", () => {
    const corpo = corpoDaInterface("RelogioDaDecisao");
    const nomes = campos(corpo);
    expect(nomes, "o campo de duração sumiu do relógio").toContain("restanteMs");
    for (const proibido of ["deadlineEm", "expiraEm", "serverTime", "serverNow", "agora", "epoch"]) {
      expect(nomes, `${proibido} tornaria o cliente dependente da hora do servidor`)
        .not.toContain(proibido);
    }
  });

  it("o tipo é uma duração de verdade: número de milissegundos", () => {
    // Asserção de TIPO, exercida em runtime para não virar comentário: se `restanteMs` virar
    // string de data ou objeto, isto não compila.
    const r: RelogioDaDecisao = { tipo: "PLAY", seat: 0, restanteMs: 25_000, fase: "NORMAL" };
    expect(typeof r.restanteMs).toBe("number");
    expect(r.restanteMs).toBeGreaterThan(0);
  });
});
