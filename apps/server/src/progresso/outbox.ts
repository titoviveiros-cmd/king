// O OUTBOX — a pendência de crédito que sobrevive a reinício.
//
// ══ POR QUE EXISTE ══
//
// A partida termina em memória. Entre esse instante e o COMMIT no banco há rede, pooler e Postgres
// — e o processo pode morrer no meio. Sem outbox, a partida simplesmente não seria creditada. Com
// ele, a pendência é gravada em disco ANTES de qualquer tentativa, e só sai de lá depois que o
// banco confirmou.
//
// ══ POR QUE SÍNCRONO ══
//
// A gravação acontece no instante em que o motor declara a partida encerrada, e termina antes de a
// sala seguir. Um arquivo de algumas centenas de bytes custa menos que o risco de o processo cair
// entre "decidi gravar" e "gravei".
//
// ══ ESCRITA ATÔMICA ══
//
// Arquivo temporário exclusivo → fsync → rename para o nome final → fsync do diretório (onde o
// sistema permite). Quem lê o diretório nunca vê um JSON pela metade com o nome final.
//
// ══ O QUE NÃO FAZ ══
//
// Não guarda senha, token nem XP — só o resultado da partida. E não apaga arquivo corrompido: ele
// é REPORTADO e fica lá para alguém olhar. Apagar em silêncio seria perder crédito sem rastro.
//
// ══ O MARCADOR (E-2) ══
//
// O expurgo das lápides só tira a lápide de quem nenhuma pendência cita — e "nenhuma pendência" só vale
// para o diretório CERTO. `gravar()` recria o diretório que sumir, então um caminho trocado, um volume
// que não montou ou uma reinstalação pareceriam um outbox vazio depois da 1ª partida. Por isso o
// diretório tem um MARCADOR (`.king-outbox`, um id aleatório), criado pelo inventário do expurgo e
// nunca por `gravar()`. O banco registra o primeiro que vê e recusa expurgar com outro.
import {
  closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { UUID, validarResultado, type ResultadoDaPartida } from "./tipos.js";

/** Começa com ponto: `pendentes()` ignora, como ignora os temporários. */
export const MARCADOR_DO_OUTBOX = ".king-outbox";

export interface PendenciasDoOutbox {
  validas: ResultadoDaPartida[];
  /** Nomes de arquivo — nunca conteúdo. */
  corrompidas: string[];
}

/** O que o expurgo das lápides precisa saber do outbox. Nunca conteúdo de pendência. */
export interface InventarioDoOutbox {
  /** O id do arquivo `.king-outbox` — o banco só expurga com o marcador que registrou. */
  marcador: string;
  /** Todo jogador citado por uma pendência VÁLIDA, em minúsculas e sem repetição. */
  jogadores: string[];
  pendencias: number;
  /** `.json` que não validam (nomes). Com qualquer um, o expurgo não acontece. */
  duvidosos: string[];
}

const codigo = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code;

export class OutboxDeProgresso {
  constructor(readonly diretorio: string) {}

  /** Grava a pendência, de forma atômica e durável. Lança se não conseguir. */
  gravar(r: ResultadoDaPartida): void {
    validarResultado(r);
    mkdirSync(this.diretorio, { recursive: true, mode: 0o700 });
    const final = join(this.diretorio, `${r.partidaId}.json`);
    const temporario = join(this.diretorio, `.${r.partidaId}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    const fd = openSync(temporario, "wx", 0o600);
    try {
      writeSync(fd, JSON.stringify(r));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporario, final);
    this.#sincronizarDiretorio();
  }

  /** Remove a pendência de uma partida já confirmada. Ausente = já removida, e está tudo bem. */
  remover(partidaId: string): void {
    if (!UUID.test(partidaId)) return;
    try {
      unlinkSync(join(this.diretorio, `${partidaId}.json`));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }

  /** O que está pendente. Arquivo ilegível vai para `corrompidas` e CONTINUA no disco. */
  pendentes(): PendenciasDoOutbox {
    return this.#ler({ ausenteEhVazio: true });
  }

  /**
   * O INVENTÁRIO DO EXPURGO DAS LÁPIDES — mais estrito que `pendentes()`. Lá, diretório ausente é
   * "nada pendente" (é o caso de quem nunca gravou); aqui, ausente ou ilegível LANÇA: com o outbox não
   * lido de verdade, nada prova que não há pendência. E sem marcador no diretório, ele nasce aqui.
   */
  inventario(): InventarioDoOutbox {
    if (!statSync(this.diretorio).isDirectory()) throw Object.assign(new Error("o outbox não é um diretório"), { code: "ENOTDIR" });
    const marcador = this.#marcador();
    const { validas, corrompidas } = this.#ler({ ausenteEhVazio: false });
    const jogadores = new Set(validas.flatMap((r) => r.humanos.map((h) => h.playerId.toLowerCase())));
    return { marcador, jogadores: [...jogadores].sort(), pendencias: validas.length, duvidosos: corrompidas };
  }

  #ler({ ausenteEhVazio }: { ausenteEhVazio: boolean }): PendenciasDoOutbox {
    let nomes: string[];
    try {
      nomes = readdirSync(this.diretorio);
    } catch (e) {
      if (ausenteEhVazio && codigo(e) === "ENOENT") return { validas: [], corrompidas: [] };
      throw e;
    }
    const validas: ResultadoDaPartida[] = [];
    const corrompidas: string[] = [];
    for (const nome of nomes.sort()) {
      if (nome.startsWith(".") || !nome.endsWith(".json")) continue; // temporário de escrita interrompida, marcador
      let bruto: string;
      try {
        bruto = readFileSync(join(this.diretorio, nome), "utf8");
      } catch (e) {
        if (codigo(e) === "ENOENT") continue; // removida entre listar e ler: foi confirmada nesse meio-tempo
        corrompidas.push(nome);
        continue;
      }
      try {
        const r = validarResultado(JSON.parse(bruto));
        if (`${r.partidaId}.json` !== nome) throw new Error("nome não bate com a partida");
        validas.push(r);
      } catch {
        corrompidas.push(nome);
      }
    }
    return { validas, corrompidas };
  }

  /** Lê o marcador; ausente, cria — temporário exclusivo, fsync e `link` (que nunca sobrescreve). */
  #marcador(): string {
    const final = join(this.diretorio, MARCADOR_DO_OUTBOX);
    const lido = this.#lerMarcador(final);
    if (lido) return lido;
    const temporario = join(this.diretorio, `${MARCADOR_DO_OUTBOX}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    const fd = openSync(temporario, "wx", 0o600);
    try {
      writeSync(fd, `${randomUUID()}
`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temporario, final);
    } catch (e) {
      if (codigo(e) !== "EEXIST") throw e; // outro processo criou no meio: vale o dele
    } finally {
      unlinkSync(temporario);
    }
    this.#sincronizarDiretorio();
    const criado = this.#lerMarcador(final);
    if (!criado) throw Object.assign(new Error("marcador do outbox não pôde ser criado"), { code: "KING_MARCADOR" });
    return criado;
  }

  /** `null` só se o arquivo não existe. Existe e não é um id: lança — marcador estragado é dúvida. */
  #lerMarcador(caminho: string): string | null {
    let bruto: string;
    try {
      bruto = readFileSync(caminho, "utf8");
    } catch (e) {
      if (codigo(e) === "ENOENT") return null;
      throw e;
    }
    const id = bruto.trim().toLowerCase();
    if (!UUID.test(id)) throw Object.assign(new Error("marcador do outbox ilegível"), { code: "KING_MARCADOR" });
    return id;
  }

  /** fsync do diretório garante o rename no disco. O Windows não deixa abrir diretório assim. */
  #sincronizarDiretorio(): void {
    let fd: number | null = null;
    try {
      fd = openSync(this.diretorio, "r");
      fsyncSync(fd);
    } catch {
      /* sistema sem fsync de diretório: o rename ainda é atômico, só não tem a barreira extra */
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }
}
