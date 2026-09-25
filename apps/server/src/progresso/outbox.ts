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
import {
  closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { UUID, validarResultado, type ResultadoDaPartida } from "./tipos.js";

export interface PendenciasDoOutbox {
  validas: ResultadoDaPartida[];
  /** Nomes de arquivo — nunca conteúdo. */
  corrompidas: string[];
}

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
    let nomes: string[];
    try {
      nomes = readdirSync(this.diretorio);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { validas: [], corrompidas: [] };
      throw e;
    }
    const validas: ResultadoDaPartida[] = [];
    const corrompidas: string[] = [];
    for (const nome of nomes.sort()) {
      if (nome.startsWith(".") || !nome.endsWith(".json")) continue; // temporário de escrita interrompida
      try {
        const r = validarResultado(JSON.parse(readFileSync(join(this.diretorio, nome), "utf8")));
        if (`${r.partidaId}.json` !== nome) throw new Error("nome não bate com a partida");
        validas.push(r);
      } catch {
        corrompidas.push(nome);
      }
    }
    return { validas, corrompidas };
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
