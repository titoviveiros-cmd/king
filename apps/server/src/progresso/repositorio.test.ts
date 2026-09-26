// O POOL DO PROGRESSO — TLS verificado com a CA explícita, e nada que o afrouxe.
import { describe, expect, it } from "vitest";
import pg from "pg";
import { repositorioPg } from "./repositorio.js";

const CA = "-----BEGIN CERTIFICATE-----\nMIIDxDCCAqygAwIBAgIU\n-----END CERTIFICATE-----\n";
const URL = "postgresql://king_server.projeto:senha-de-teste@aws-0-sa-east-1.pooler.supabase.com:5432/postgres";

/** O pool que `repositorioPg` criou, sem abrir conexão nenhuma. */
function poolDe(): { options: { ssl?: unknown; max?: number } } & pg.Pool {
  let criado: pg.Pool | null = null;
  const Original = pg.Pool;
  // captura o pool construído, sem mudar o que ele recebe
  (pg as unknown as { Pool: unknown }).Pool = class extends Original {
    constructor(o: pg.PoolConfig) { super(o); criado = this; }
  };
  try {
    void repositorioPg({ connectionString: URL, ca: CA });
  } finally {
    (pg as unknown as { Pool: unknown }).Pool = Original;
  }
  return criado as unknown as { options: { ssl?: unknown; max?: number } } & pg.Pool;
}

describe("TLS do pool de progresso", () => {
  it("verifica cadeia E nome do host com a CA explícita", async () => {
    const pool = poolDe();
    expect(pool.options.ssl).toEqual({ ca: CA, rejectUnauthorized: true });
    await pool.end();
  });

  it("não há checkServerIdentity próprio nem caminho sem TLS", async () => {
    const pool = poolDe();
    const ssl = pool.options.ssl as Record<string, unknown>;
    expect(Object.keys(ssl).sort()).toEqual(["ca", "rejectUnauthorized"]);
    expect(ssl.rejectUnauthorized).toBe(true);
    expect(pool.options.max).toBe(2);
    await pool.end();
  });
});
