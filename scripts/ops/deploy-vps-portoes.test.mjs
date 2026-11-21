// OS PORTÕES DE ARTEFATO DO DEPLOY × O SERVIDOR COMPILADO × OS CONTRATOS DE TEMPO.
//
// ══ O DEFEITO QUE ESTE TESTE EXISTE PARA NÃO DEIXAR VOLTAR ══
//
// A cinemática longa (PR #18) mudou `aberturaDaUltimaMao` de 3720 para 6000 ms. O código, os testes
// do servidor, o E2E e a CI ficaram verdes — e `scripts/deploy-vps.sh` continuava exigindo 3720 no
// artefato. Na VPS, o portão reprovaria o binário CERTO e acionaria o rollback. Nenhuma suíte via
// o script de deploy: ele só roda na VPS.
//
// Este teste roda no job rápido (`npm run test:ops`, depois de `build:server`) e prova, contra o
// `apps/server/dist` recém-compilado:
//   1. todo portão de `conferir_artefato` ACEITA o artefato compilado deste commit;
//   2. todo valor de tempo exigido pelo script é IGUAL a `TEMPOS_PADRAO` (fonte única);
//   3. os tempos da cinemática e do prazo estão TODOS sob portão (nenhum some sem querer);
//   4. cada portão de tempo REPROVA o valor antigo, o vizinho (±1), o décuplo e o décimo;
//   5. o verificador pós-deploy da última mão usa os mesmos números;
//   6. (Linux/CI) o bloco REAL do script, executado pelo bash com o grep do sistema, aprova este
//      artefato e reprova uma cópia com o valor antigo — a mesma semântica de ERE que a VPS usa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(RAIZ, "scripts/deploy-vps.sh");
const TEXTO = readFileSync(SCRIPT, "utf8");
const { TEMPOS_PADRAO } = await import(pathToFileURL(join(RAIZ, "apps/server/dist/match/tempos.js")).href);

/** Tempos que, se mudarem, mudam o que o jogador vive — e por isso precisam de portão exato. */
const TEMPOS_SOB_PORTAO = [
  "turno", "cortesiaDoBot", "aberturaDaUltimaMao", "leituraDaVazaKing", "pisoDoPlacarDoRei", "pisoDoPlacar",
];

/** As chamadas `conferir_artefato "<arquivo>" "<padrão>" "<descrição>"`, com continuação de linha. */
function portoes() {
  const unido = TEXTO.replace(/[ \t]*\\\r?\n\s*/g, " ");
  const re = /^conferir_artefato "([^"]+)" "((?:[^"\\]|\\.)*)" "([^"]+)"/gm;
  return [...unido.matchAll(re)].map(([, arquivo, padrao, que]) => ({ arquivo, padrao: padrao.replace(/\\"/g, '"'), que }));
}

/** ERE (grep -E) → RegExp do JS, linha a linha como o grep. Só as construções que o script usa. */
function ereParaJs(padrao) {
  assert.doesNotMatch(padrao, /\[\[:(?!space:\]\])/, `classe POSIX não suportada pelo teste: ${padrao}`);
  return new RegExp(padrao.replace(/\[\[:space:\]\]/g, "\\s"), "m");
}

/** `^[[:space:]]*<chave>: <número com _?>,$` → { chave, valor }. */
function portaoDeTempo(p) {
  const m = /^\^\[\[:space:\]\]\*([A-Za-z]+): ([0-9_?]+),\$$/.exec(p.padrao);
  if (!m) return null;
  return { chave: m[1], valor: Number(m[2].replace(/_\?/g, "")) };
}

const PORTOES = portoes();
const DE_TEMPO = PORTOES.filter((p) => p.arquivo.endsWith("/match/tempos.js")).map((p) => ({ ...p, tempo: portaoDeTempo(p) }));

test("o script tem portões de artefato, e o parser os encontra", () => {
  assert.ok(PORTOES.length >= 20, `só ${PORTOES.length} portões lidos — o formato do script mudou?`);
});

test("todo portão aceita o artefato compilado deste commit", () => {
  for (const p of PORTOES) {
    const conteudo = readFileSync(join(RAIZ, p.arquivo), "utf8");
    assert.match(conteudo, ereParaJs(p.padrao), `portão "${p.que}" reprovaria o artefato correto (${p.arquivo})`);
  }
});

test("todo portão de tempo é exato (ancorado) e igual a TEMPOS_PADRAO", () => {
  for (const p of DE_TEMPO) {
    assert.ok(p.tempo, `portão de tempo sem âncora/valor exato: ${p.padrao}`);
    assert.ok(p.tempo.chave in TEMPOS_PADRAO, `chave inexistente em TEMPOS_PADRAO: ${p.tempo.chave}`);
    assert.equal(p.tempo.valor, TEMPOS_PADRAO[p.tempo.chave],
      `deploy-vps.sh exige ${p.tempo.chave}=${p.tempo.valor}, o servidor compila ${TEMPOS_PADRAO[p.tempo.chave]}`);
  }
});

test("os tempos da cinemática e do prazo estão todos sob portão", () => {
  const cobertos = new Set(DE_TEMPO.map((p) => p.tempo?.chave));
  for (const chave of TEMPOS_SOB_PORTAO) assert.ok(cobertos.has(chave), `${chave} sem portão em deploy-vps.sh`);
  // Os valores aprovados para a cinemática longa, explícitos: mudar qualquer um exige mudar aqui.
  assert.equal(TEMPOS_PADRAO.aberturaDaUltimaMao, 6000);
  assert.equal(TEMPOS_PADRAO.leituraDaVazaKing, 6500);
  assert.equal(TEMPOS_PADRAO.pisoDoPlacarDoRei, 11500);
  assert.equal(TEMPOS_PADRAO.pisoDoPlacar, 8000);
});

test("cada portão de tempo reprova o valor antigo, o vizinho, o décuplo e o décimo", () => {
  const ANTIGOS = { aberturaDaUltimaMao: [3720], leituraDaVazaKing: [3400], pisoDoPlacarDoRei: [8000] };
  const comSeparador = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "_");
  for (const p of DE_TEMPO) {
    const { chave, valor } = p.tempo;
    const re = ereParaJs(p.padrao);
    for (const certo of [valor, comSeparador(valor)]) assert.match(`    ${chave}: ${certo},`, re);
    const errados = [...(ANTIGOS[chave] ?? []), valor + 1, valor - 1, valor * 10, Math.floor(valor / 10)];
    for (const n of errados) {
      for (const grafia of [String(n), comSeparador(n)]) {
        assert.doesNotMatch(`    ${chave}: ${grafia},`, re, `portão de ${chave} aceitou ${grafia}`);
      }
    }
    // Outra chave com o mesmo prefixo não satisfaz o portão (pisoDoPlacar × pisoDoPlacarDoRei).
    assert.doesNotMatch(`    ${chave}Extra: ${valor},`, re);
  }
});

test("portões da penalidade do Rei (PR #16): presentes e reprovam o binário sem a regra 2", () => {
  const de = (rotulo) => {
    const p = PORTOES.find((x) => x.que.startsWith(rotulo));
    assert.ok(p, `portão "${rotulo}" ausente em deploy-vps.sh`);
    return ereParaJs(p.padrao);
  };
  const regra = de("regra de XP atual");
  assert.match("export const REGRA_ATUAL = 2;", regra);
  for (const n of ["1", "3", "20", "2 "]) assert.doesNotMatch(`export const REGRA_ATUAL = ${n};`, regra);
  assert.doesNotMatch("// export const REGRA_ATUAL = 2;", regra);
  // O KingRoom da Fase II (sem o fato) e o com o fato comentado não passam.
  const integrado = de("captura do Rei entregue");
  assert.match("                capturouRei: capturadorDoRei(m),", integrado);
  assert.doesNotMatch("                pontos,\n            });", integrado);
  assert.doesNotMatch("                capturouRei: null,", integrado);
  const porta = de("porta v2 do credito");
  assert.doesNotMatch("select * from king_private.creditar_partida(", porta);
  const troca = de("troca de ocupante");
  assert.match("this.#contarJogada(dados.seat, dados.playerId === this.#elenco[dados.seat]?.playerId);", troca);
  assert.doesNotMatch("this.#contarJogada(dados.seat, true);", troca);
});

test("o verificador pós-deploy da última mão usa os mesmos números do servidor", () => {
  const v = readFileSync(join(RAIZ, "scripts/verificar-ultima-mao.mjs"), "utf8");
  const constante = (nome) => {
    const m = new RegExp(`^const ${nome} = ([0-9_]+);`, "m").exec(v);
    assert.ok(m, `${nome} não encontrado em verificar-ultima-mao.mjs`);
    return Number(m[1].replace(/_/g, ""));
  };
  assert.equal(constante("RESPIRO"), TEMPOS_PADRAO.aberturaDaUltimaMao);
  assert.equal(constante("TURNO"), TEMPOS_PADRAO.turno);
  assert.equal(constante("CORTESIA_DO_BOT"), TEMPOS_PADRAO.cortesiaDoBot);
  assert.equal(constante("PASSO_DA_APRESENTACAO"), TEMPOS_PADRAO.passoDaApresentacao);
});

// O bloco real, pelo bash e grep do sistema. No Windows o `bash` do PATH pode ser o do WSL (outra
// raiz de arquivos); a CI (ubuntu) é quem roda — e é ela o portão do PR.
test("bloco REAL do script: aprova este artefato e reprova o valor antigo", { skip: process.platform === "win32" }, () => {
  const ini = TEXTO.indexOf("conferir_artefato() {");
  const fim = TEXTO.indexOf('[ -z "$ART" ] || abortar');
  assert.ok(ini > 0 && fim > ini, "bloco de portões não localizado no script");
  const bloco = TEXTO.slice(ini, fim) + '\n[ -z "$ART" ] && echo PORTOES_OK || { echo "PORTOES_FALHA:$ART"; exit 1; }\n';

  const rodar = (cwd) => spawnSync("bash", ["-c", bloco], { cwd, encoding: "utf8" });
  const certo = rodar(RAIZ);
  assert.equal(certo.status, 0, certo.stdout + certo.stderr);
  assert.match(certo.stdout, /PORTOES_OK/);

  // Cópia só dos arquivos que os portões leem, com o valor ANTIGO da última mão.
  const tmp = mkdtempSync(join(tmpdir(), "king-portoes-"));
  try {
    for (const arquivo of new Set(PORTOES.map((p) => p.arquivo))) {
      mkdirSync(join(tmp, dirname(arquivo)), { recursive: true });
      copyFileSync(join(RAIZ, arquivo), join(tmp, arquivo));
    }
    const tempos = join(tmp, "apps/server/dist/match/tempos.js");
    const original = readFileSync(tempos, "utf8");
    for (const [de, para, rotulo] of [
      [/aberturaDaUltimaMao: 6_?000,/, "aberturaDaUltimaMao: 3_720,", "constante"],
      [/leituraDaVazaKing: 6_?500,/, "leituraDaVazaKing: 3_400,", "vaza-rei"],
      [/pisoDoPlacarDoRei: 11_?500,/, "pisoDoPlacarDoRei: 8_000,", "piso-rei"],
    ]) {
      assert.match(original, de);
      writeFileSync(tempos, original.replace(de, para));
      const r = rodar(tmp);
      assert.notEqual(r.status, 0, `bloco aprovou ${para}`);
      assert.match(r.stdout, new RegExp(`PORTOES_FALHA:.*\\b${rotulo}\\b`));
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
