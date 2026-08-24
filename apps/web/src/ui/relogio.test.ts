/**
 * RELÓGIO DA DECISÃO — estado crítico e alerta.
 *
 * O que estes testes travam:
 *   • o crítico começa aos 10 segundos, não aos 5 do servidor;
 *   • o alerta sonoro toca UMA vez por decisão, na transição — nunca a cada segundo;
 *   • o alerta é só de quem tem a vez;
 *   • o prazo continua sendo do servidor: aqui só se representa.
 */
import { describe, it, expect } from "vitest";
import { LIMIAR_CRITICO_MS, deveAlertar, lerRelogio } from "./relogio.js";
import type { RelogioRecebido } from "../game/useKingOnline.js";

const AGORA = 1_000_000;
const relogio = (over: Partial<RelogioRecebido> = {}): RelogioRecebido => ({
  tipo: "PLAY", seat: 0, fase: "NORMAL", restanteMs: 25_000, recebidoEm: AGORA, ...over,
});

describe("lerRelogio", () => {
  it("desconta o tempo passado desde que a mensagem chegou", () => {
    const l = lerRelogio(relogio({ restanteMs: 25_000 }), 0, AGORA + 4_000)!;
    expect(l.restanteMs).toBe(21_000);
    expect(l.segundos).toBe(21);
  });

  it("estado NORMAL acima de 10 segundos", () => {
    for (const restante of [25_000, 15_000, 11_000, 10_001]) {
      const l = lerRelogio(relogio({ restanteMs: restante }), 0, AGORA)!;
      expect(l.estado, String(restante)).toBe("normal");
    }
  });

  it("a TRANSIÇÃO 11 → 10 é onde o crítico começa", () => {
    const onze = lerRelogio(relogio({ restanteMs: 25_000 }), 0, AGORA + 14_000)!;
    expect(onze.segundos).toBe(11);
    expect(onze.estado).toBe("normal");

    const dez = lerRelogio(relogio({ restanteMs: 25_000 }), 0, AGORA + 15_000)!;
    expect(dez.segundos).toBe(10);
    expect(dez.estado).toBe("critico");
  });

  it("estado CRÍTICO de 10 segundos para baixo", () => {
    for (const restante of [10_000, 9_000, 5_000, 1, 0]) {
      const l = lerRelogio(relogio({ restanteMs: restante }), 0, AGORA)!;
      expect(l.estado, String(restante)).toBe("critico");
    }
    expect(LIMIAR_CRITICO_MS).toBe(10_000);
  });

  it("some quando o prazo acaba — quem age por estouro é o servidor", () => {
    expect(lerRelogio(relogio({ restanteMs: 0 }), 0, AGORA)!.visivel).toBe(false);
    expect(lerRelogio(relogio({ restanteMs: 25_000 }), 0, AGORA + 30_000)!.visivel).toBe(false);
  });

  it("nunca mostra segundo negativo", () => {
    expect(lerRelogio(relogio({ restanteMs: 25_000 }), 0, AGORA + 90_000)!.segundos).toBe(0);
  });

  it("sabe de quem é a vez", () => {
    expect(lerRelogio(relogio({ seat: 0 }), 0, AGORA)!.meu).toBe(true);
    expect(lerRelogio(relogio({ seat: 2 }), 0, AGORA)!.meu).toBe(false);
  });

  it("o chip não existe para READY nem sem relógio — isso é assunto do Placar", () => {
    expect(lerRelogio(null, 0, AGORA)).toBeNull();
    expect(lerRelogio(relogio({ tipo: "READY", seat: null }), 0, AGORA)).toBeNull();
    expect(lerRelogio(relogio({ seat: null }), 0, AGORA)).toBeNull();
  });

  it("vale para TRUMP também, não só para PLAY", () => {
    const l = lerRelogio(relogio({ tipo: "TRUMP", restanteMs: 8_000 }), 0, AGORA)!;
    expect(l.estado).toBe("critico");
    expect(l.meu).toBe(true);
  });
});

describe("deveAlertar", () => {
  const noCritico = (restante: number, seat = 0) => lerRelogio(relogio({ restanteMs: restante, seat }), 0, AGORA);

  it("alerta ao entrar no crítico, na minha vez", () => {
    expect(deveAlertar(noCritico(10_000), 0)).toBe(true);
  });

  it("NÃO alerta acima de 10 segundos", () => {
    expect(deveAlertar(noCritico(11_000), 0)).toBe(false);
    expect(deveAlertar(noCritico(25_000), 0)).toBe(false);
  });

  it("NÃO alerta na vez dos outros", () => {
    expect(deveAlertar(noCritico(8_000, 2), 0)).toBe(false);
  });

  it("toca UMA VEZ SÓ — os segundos seguintes não repetem", () => {
    // MESMA mensagem do servidor, relógio andando: é assim que uma decisão corre de verdade.
    // (Modelar isso mudando `restanteMs` com `recebidoEm` fixo descreveria um PRAZO DIFERENTE,
    // não a mesma decisão — foi o erro da primeira versão deste teste.)
    const msg = relogio({ restanteMs: 25_000, recebidoEm: AGORA });
    const entrada = lerRelogio(msg, 0, AGORA + 15_000)!;   // 10s restantes
    expect(entrada.estado).toBe("critico");
    expect(deveAlertar(entrada, 0)).toBe(true);

    // a tela redesenha ~2x por segundo até o fim; nenhuma dessas pode tocar de novo
    for (const decorrido of [15_500, 16_000, 17_000, 20_000, 23_000, 24_500]) {
      const seguinte = lerRelogio(msg, 0, AGORA + decorrido);
      expect(seguinte!.prazoEm).toBe(entrada.prazoEm); // mesma decisão
      expect(deveAlertar(seguinte, entrada.prazoEm), `t+${decorrido}`).toBe(false);
    }
  });

  it("as várias mensagens do servidor para a MESMA decisão não fazem tocar de novo", () => {
    // o servidor manda TURN_CLOCK no início, no aviso e no crítico; o prazo calculado
    // varia alguns milissegundos entre elas por causa da rede
    const inicio = lerRelogio(relogio({ restanteMs: 10_000, recebidoEm: AGORA }), 0, AGORA)!;
    expect(deveAlertar(inicio, 0)).toBe(true);

    for (const jitter of [-800, -200, 0, 300, 900]) {
      const outra = lerRelogio(
        relogio({ restanteMs: 5_000, recebidoEm: AGORA + 5_000 + jitter }), 0, AGORA + 5_000,
      );
      expect(deveAlertar(outra, inicio.prazoEm), `jitter ${jitter}`).toBe(false);
    }
  });

  it("uma decisão NOVA volta a alertar", () => {
    const primeira = noCritico(10_000)!;
    const segunda = lerRelogio(
      relogio({ restanteMs: 10_000, recebidoEm: AGORA + 60_000 }), 0, AGORA + 60_000,
    )!;
    expect(deveAlertar(segunda, primeira.prazoEm)).toBe(true);
  });

  it("prazo esgotado não alerta", () => {
    expect(deveAlertar(lerRelogio(relogio({ restanteMs: 0 }), 0, AGORA), 0)).toBe(false);
  });
});
