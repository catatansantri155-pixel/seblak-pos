/**
 * Deklarasi tipe minimal untuk modul bawaan Node "node:sqlite".
 * Proyek ini sengaja tidak menambah @types/node sebagai dependensi hanya
 * untuk test; shim D1 di tests/helpers/d1.ts memakai permukaan kecil ini.
 */
declare module "node:module" {
  export function createRequire(url: string | URL): (id: string) => unknown;
}

declare module "node:sqlite" {
  export interface StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
  }
  export class DatabaseSync {
    constructor(path: string);
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
}
