// A PORTA DE ENTRADA, COM E SEM CREDENCIAL — o que a fase de identidade permanente NÃO pode quebrar.
//
// ══ POR QUE ESTE ARQUIVO EXISTE ══
//
// A verificação de credencial em si já é exercitada em `auth/identidade.test.ts`, contra tokens
// assinados de verdade. Este arquivo cuida de outra coisa, que aquele não vê: o que acontece com
// quem chega SEM credencial nenhuma — que é, hoje, todo mundo.
//
// A fase foi desenhada para ser ADITIVA: um servidor sem provedor configurado atende exatamente
// como sempre atendeu. A primeira versão do `onAuth` quebrou essa promessa de um jeito que nenhum
// teste de regra pegaria como tal — no Colyseus, um `onAuth` que devolve valor falsy REPROVA a
// entrada, e devolver `null` para "não sei quem é" recusou as quatro conexões de toda mesa. A
// suíte inteira ficou vermelha (129 testes) apontando para prazos, bots e vazas: 129 sintomas de
// uma porta trancada, e nenhum deles dizendo "a porta está trancada".
//
// Daí este arquivo. Ele não cobre nenhuma regra de KING; cobre a PORTA, para que uma regressão
// nela falhe com o nome dela e em segundos.
//
// ══ O QUE PRECISA CONTINUAR VERDADE ══
//
//   1. sem token, entra — e recebe identidade efêmera, como sempre;
//   2. sem provedor configurado, um token qualquer é IGNORADO, não é motivo de recusa;
//   3. dois convidados nunca compartilham `playerId`;
//   4. o cliente não declara quem é: `playerId` mandado nas opções de entrada não é acreditado.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import { PROTOCOL_VERSION } from "../protocol/index.js";

interface SdkRoom {
  roomId: string;
  state: { seats: { seat: number; playerId: string; nick: string }[] };
  leave(consented?: boolean): Promise<number>;
}

let colyseus: ColyseusTestServer;
beforeAll(async () => { colyseus = await boot(servidor); });
afterAll(async () => { await colyseus.shutdown(); });

const opcoes = (extra: Record<string, unknown> = {}) => ({
  protocolVersion: PROTOCOL_VERSION, nick: "Convidado", avatar: AVATARES[0], ...extra,
});

const entrar = async (extra?: Record<string, unknown>) =>
  (await colyseus.sdk.create(SALA_KING, opcoes(extra))) as unknown as SdkRoom;

/**
 * O `playerId` que o servidor atribuiu a esta conexão, lido do estado público da sala.
 *
 * A espera é pelo estado INTEIRO, e não só pelo assento: `create()` resolve assim que a sala
 * existe, e o primeiro patch do `Schema` chega depois — antes dele, `state.seats` é `undefined`.
 * A primeira versão daqui lia direto e explodia com `TypeError`, o que reprovava por motivo
 * nenhum: um teste que falha antes de medir não mede.
 */
const meuPlayerId = async (sala: SdkRoom): Promise<string> => {
  const pronto = () => (sala.state?.seats ?? []).some((a) => a.playerId !== "");
  for (let i = 0; i < 400 && !pronto(); i++) await new Promise((r) => setTimeout(r, 10));
  const ocupados = (sala.state?.seats ?? []).filter((a) => a.playerId !== "");
  expect(ocupados.length).toBeGreaterThan(0);
  return ocupados[0].playerId;
};

describe("entrar SEM credencial continua permitido", () => {
  it("sem token, a porta abre — e é aqui que a fase prova ser aditiva", async () => {
    const sala = await entrar();
    expect(await meuPlayerId(sala)).not.toBe("");
    await sala.leave(true);
  });

  it("sem provedor configurado, um token qualquer é IGNORADO — não vira recusa", async () => {
    // Sem `SUPABASE_URL` não há verificador, e não havendo verificador não há como conferir nada.
    // Recusar por precaução deixaria um cliente novo — que manda token — sem conseguir entrar num
    // servidor que ainda não foi configurado, exatamente durante a janela de implantação.
    const sala = await entrar({ accessToken: "isto-nao-e-um-jwt-valido" });
    expect(await meuPlayerId(sala)).not.toBe("");
    await sala.leave(true);
  });

  it("dois convidados NUNCA compartilham playerId", async () => {
    const a = await entrar();
    const b = await entrar();
    expect(await meuPlayerId(a)).not.toBe(await meuPlayerId(b));
    await a.leave(true);
    await b.leave(true);
  });
});

describe("o cliente APRESENTA credencial, nunca DECLARA identidade", () => {
  it("playerId mandado nas opções de entrada não é acreditado", async () => {
    const forjado = "00000000-0000-4000-8000-000000000000";
    const sala = await entrar({ playerId: forjado, sub: forjado, id: forjado });
    expect(await meuPlayerId(sala)).not.toBe(forjado);
    await sala.leave(true);
  });
});
