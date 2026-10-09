import { createMysqlPool, closeFulfillmentDb } from "../src/db";
import { createTestFulfillment, type Fulfillment } from "../src/fulfillment";
import type { Pool } from "mysql2/promise";

export async function fresh(): Promise<{ pool: Pool; crm: Fulfillment }> {
  const pool = createMysqlPool();
  const crm = await createTestFulfillment(pool);
  return { pool, crm };
}

export async function closeTestDb(pool: Pool) {
  await closeFulfillmentDb(pool);
}

export async function tableNames(pool: Pool) {
  const [rows] = await pool.query<{ TABLE_NAME: string }[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  );
  return rows.map((row) => row.TABLE_NAME).sort();
}

export async function indexNames(pool: Pool) {
  const [rows] = await pool.query<{ INDEX_NAME: string }[]>(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME != 'PRIMARY'`,
  );
  return rows.map((row) => row.INDEX_NAME).sort();
}

export async function columnNames(pool: Pool, table: string) {
  const [rows] = await pool.query<{ COLUMN_NAME: string }[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [table],
  );
  return rows.map((row) => row.COLUMN_NAME);
}

export async function expectQueryFail(pool: Pool, sql: string, params: unknown[] = []) {
  await expect(pool.query(sql, params)).rejects.toThrow();
}
