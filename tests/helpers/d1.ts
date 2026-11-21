/**
 * Shim D1 in-memory untuk test Vitest, di atas node:sqlite (bawaan Node 24,
 * tanpa dependensi tambahan). Mengimplementasikan permukaan D1 yang dipakai
 * worker: prepare/bind/run/first/all/batch + exec.
 *
 * createTestDb() membuat database kosong, menjalankan SEMUA migrasi
 * (migrations/*.sql berurutan) lalu seed demo (seeds/0001_demo.sql), persis
 * seperti urutan pemakaian nyata.
 */
import type { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// node:sqlite dimuat lewat createRequire: resolver Vite pada Vitest belum
// mengenali builtin "node:sqlite" dan gagal memuatnya sebagai URL.
const { DatabaseSync: DatabaseSyncCtor } = createRequire(import.meta.url)(
  "node:sqlite",
) as { DatabaseSync: typeof DatabaseSync };

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

class ShimPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): ShimPreparedStatement {
    return new ShimPreparedStatement(this.sqlite, this.sql, values);
  }

  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number } }> {
    const info = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }

  async first<T>(colName?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.params);
    if (!row) return null;
    if (colName) return (row[colName] as T) ?? null;
    return row as T;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean; meta: Record<string, never> }> {
    const rows = this.sqlite.prepare(this.sql).all(...this.params);
    return { results: rows as T[], success: true, meta: {} };
  }
}

class ShimD1 {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string): ShimPreparedStatement {
    return new ShimPreparedStatement(this.sqlite, sql);
  }

  async batch(stmts: ShimPreparedStatement[]): Promise<unknown[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: unknown[] = [];
      for (const s of stmts) results.push(await s.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (e) {
      this.sqlite.exec("ROLLBACK");
      throw e;
    }
  }

  async exec(sql: string): Promise<{ success: boolean; meta: Record<string, never> }> {
    this.sqlite.exec(sql);
    return { success: true, meta: {} };
  }
}

export interface TestDb {
  db: D1Database;
  sqlite: DatabaseSync;
  stockBalance(productId: string): number;
  scalar<T>(sql: string, ...params: unknown[]): T | undefined;
}

export function createTestDb(withSeed = true): TestDb {
  const sqlite = new DatabaseSyncCtor(":memory:");
  const migDir = join(root, "migrations");
  const files = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    sqlite.exec(readFileSync(join(migDir, f), "utf8"));
  }
  if (withSeed) {
    sqlite.exec(readFileSync(join(root, "seeds", "0001_demo.sql"), "utf8"));
  }
  const db = new ShimD1(sqlite) as unknown as D1Database;
  return {
    db,
    sqlite,
    stockBalance(productId: string): number {
      const row = sqlite
        .prepare("SELECT COALESCE(SUM(qty_delta), 0) AS bal FROM stock_movements WHERE product_id = ?")
        .get(productId);
      return Number(row?.bal ?? 0);
    },
    scalar<T>(sql: string, ...params: unknown[]): T | undefined {
      const row = sqlite.prepare(sql).get(...params);
      if (!row) return undefined;
      const values = Object.values(row);
      return values[0] as T;
    },
  };
}
