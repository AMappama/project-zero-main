import type { Pool, RowDataPacket } from "mysql2/promise";

export type Achievements = {
  meetings: number;
  applications: number;
  notes: number;
};

export async function countAchievements(pool: Pool, tenantId: number): Promise<Achievements> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
      (SELECT COUNT(*) FROM meetings WHERE tenant_id = ? AND result IS NOT NULL AND result <> '') AS meetings,
      (SELECT COUNT(*) FROM applications WHERE tenant_id = ? AND status = '通过') AS applications,
      (SELECT COUNT(*) FROM notes WHERE tenant_id = ?) AS notes`,
    [tenantId, tenantId, tenantId],
  );
  const row = rows[0];
  return {
    meetings: Number(row?.meetings ?? 0),
    applications: Number(row?.applications ?? 0),
    notes: Number(row?.notes ?? 0),
  };
}
