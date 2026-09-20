import { createPool, type Pool, type PoolOptions, type RowDataPacket } from "mysql2/promise";
import { CopyEngine, freshCopyState, type CopyState } from "./engine";

type Environment = Record<string, string | undefined>;
export function mysqlOptions(env: Environment = process.env): PoolOptions {
  for (const name of ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"]) {
    if (!env[name]?.trim()) throw new Error(`Configuration MySQL incomplète : ${name}`);
  }
  const host = env.MYSQL_HOST!.trim();
  const port = Number(env.MYSQL_PORT || 3306);
  if (/[\s/:]/.test(host)) throw new Error("MYSQL_HOST doit contenir uniquement le nom d’hôte, sans port ni protocole");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MYSQL_PORT invalide");
  const ssl = env.MYSQL_SSL || "false";
  if (!["true", "false"].includes(ssl)) throw new Error("MYSQL_SSL doit être true ou false");
  return {
    host, port, database: env.MYSQL_DATABASE!.trim(), user: env.MYSQL_USER!.trim(),
    password: env.MYSQL_PASSWORD,
    ...(ssl === "true" ? { ssl: { rejectUnauthorized: true, ...(env.MYSQL_SSL_CA ? { ca: env.MYSQL_SSL_CA.replace(/\\n/g, "\n") } : {}) } } : {}),
    connectionLimit: 5, queueLimit: 100, waitForConnections: true,
    connectTimeout: 10000, enableKeepAlive: true, multipleStatements: false,
  };
}

function decodeState(value: unknown): CopyState {
  const state = typeof value === "string" ? JSON.parse(value) : value as CopyState | null;
  if (!state || state.version !== 1 || typeof state.enabled !== "boolean" || !Array.isArray(state.agents) || !Array.isArray(state.bindings) || !Array.isArray(state.logs) || !(state.baseline === null || Array.isArray(state.baseline))) {
    throw new Error("État MySQL copytrading invalide : restauration requise");
  }
  return state;
}

/** One locked InnoDB row protects the whole master/follower decision atomically. */
export class MysqlCopyStore {
  private ready?: Promise<void>;
  constructor(private readonly pool: Pool) {}

  private async initialize() {
    if (!this.ready) {
      this.ready = (async () => {
        await this.pool.query(`CREATE TABLE IF NOT EXISTS copytrading_state (
          id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
          state JSON NOT NULL,
          updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB`);
        // Never replace an existing journal, including its pending command IDs.
        await this.pool.execute("INSERT IGNORE INTO copytrading_state (id, state) VALUES (1, ?)", [JSON.stringify(freshCopyState())]);
        await this.locked(engine => {
          engine.state.enabled = false;
          for (const a of engine.state.agents) {
            a.enabled = false;
            a.lastSeen = 0;
            if (a.pending?.expiresAt) a.pending.expiresAt = Date.now() - 1;
          }
        });
      })().catch(error => { this.ready = undefined; throw error; });
    }
    await this.ready;
  }

  private async locked<T>(operation: (engine: CopyEngine) => T): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query("SET SESSION innodb_lock_wait_timeout = 10");
      await connection.beginTransaction();
      const [rows] = await connection.query<RowDataPacket[]>("SELECT state FROM copytrading_state WHERE id = 1 FOR UPDATE");
      if (rows.length !== 1) throw new Error("Journal MySQL absent : restauration requise");
      const engine = new CopyEngine(decodeState(rows[0].state));
      const result = operation(engine);
      await connection.execute("UPDATE copytrading_state SET state = ? WHERE id = 1", [JSON.stringify(engine.state)]);
      await connection.commit(); // Do not return any command before COMMIT completes.
      return result;
    } catch (error) {
      try { await connection.rollback(); } catch { connection.destroy(); }
      // A lost COMMIT response must not trigger an automatic re-execution.
      throw error;
    } finally {
      connection.release();
    }
  }

  async transaction<T>(operation: (engine: CopyEngine) => T): Promise<T> {
    await this.initialize();
    return this.locked(operation);
  }

  async snapshot() {
    await this.initialize();
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT state FROM copytrading_state WHERE id = 1");
    if (rows.length !== 1) throw new Error("Journal MySQL absent : restauration requise");
    return new CopyEngine(decodeState(rows[0].state)).snapshot();
  }
}

const runtime = globalThis as typeof globalThis & { __copyMysqlStore?: MysqlCopyStore };
export function mysqlStore() {
  // Render reloads environment configuration by restarting the process.
  return runtime.__copyMysqlStore ??= new MysqlCopyStore(createPool(mysqlOptions()));
}
