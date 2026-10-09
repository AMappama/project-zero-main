import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2/promise";
import * as schema from "./schema";
import { DROP_SCHEMA_SQL, SCHEMA_SQL } from "./schema.sql";

export function mysqlConfig() {
  return {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "fulfillment",
    password: process.env.MYSQL_PASSWORD ?? "fulfillment",
    database: process.env.MYSQL_DATABASE ?? "fulfillment",
    multipleStatements: true,
    waitForConnections: true,
    connectionLimit: 10,
  };
}

let sharedPool: Pool | null = null;

export function createMysqlPool(): Pool {
  return createPool(mysqlConfig());
}

/** mysql2 按分号切多语句，触发器正文里的分号会被拆开。按语句逐条执行。 */
function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let depth = 0;
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!current && (trimmed === "" || trimmed.startsWith("--"))) continue;
    current += `${line}\n`;
    if (/^BEGIN\b/i.test(trimmed)) depth += 1;
    if (/^END\s*;?$/i.test(trimmed)) depth = Math.max(0, depth - 1);
    if (depth === 0 && trimmed.endsWith(";")) {
      statements.push(current.trim());
      current = "";
    }
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

export async function resetSchema(pool: Pool): Promise<void> {
  for (const statement of [...splitSql(DROP_SCHEMA_SQL), ...splitSql(SCHEMA_SQL)]) {
    await pool.query(statement);
  }
}

export function drizzleFromPool(pool: Pool) {
  return drizzle(pool, { schema, mode: "default" });
}

export type AppDb = ReturnType<typeof drizzleFromPool>;

export async function openFulfillmentDb(options?: { reset?: boolean; pool?: Pool }): Promise<{ db: AppDb; pool: Pool }> {
  const pool = options?.pool ?? createMysqlPool();
  if (options?.reset !== false) {
    await resetSchema(pool);
  }
  return { db: drizzleFromPool(pool), pool };
}

export async function closeFulfillmentDb(pool: Pool): Promise<void> {
  await pool.end();
  if (sharedPool === pool) sharedPool = null;
}

export function getSharedPool(): Pool | null {
  return sharedPool;
}

export function setSharedPool(pool: Pool | null): void {
  sharedPool = pool;
}
