import type { Pool, RowDataPacket } from "mysql2/promise";
import { DEMO_MEMBER_NAMES } from "./demoNames";
import { FulfillmentError } from "./types";

export type MemberProfileRow = {
  memberId: number;
  name: string | null;
  age: number | null;
  city: string | null;
  job: string | null;
  schedule: string | null;
  emotionalNeed: string | null;
  strengths: string | null;
  taboos: string | null;
  disclosureBoundary: string | null;
  source: "manual" | "sync";
  updatedAt: string;
};

type ProfileSql = RowDataPacket & {
  member_id: number;
  name: string | null;
  age: number | null;
  city: string | null;
  job: string | null;
  schedule: string | null;
  emotional_need: string | null;
  strengths: string | null;
  taboos: string | null;
  disclosure_boundary: string | null;
  source: "manual" | "sync";
  updated_at: string;
};

const SELECT_PROFILE = `SELECT member_id, name, age, city, job, schedule, emotional_need, strengths, taboos, disclosure_boundary, source, updated_at FROM member_profiles`;

function mapProfile(row: ProfileSql): MemberProfileRow {
  return {
    memberId: row.member_id,
    name: row.name,
    age: row.age,
    city: row.city,
    job: row.job,
    schedule: row.schedule,
    emotionalNeed: row.emotional_need,
    strengths: row.strengths,
    taboos: row.taboos,
    disclosureBoundary: row.disclosure_boundary,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

export function emptyProfile(memberId: number): MemberProfileRow {
  return {
    memberId,
    name: null,
    age: null,
    city: null,
    job: null,
    schedule: null,
    emotionalNeed: null,
    strengths: null,
    taboos: null,
    disclosureBoundary: null,
    source: "manual",
    updatedAt: "",
  };
}

export async function listProfiles(pool: Pool): Promise<MemberProfileRow[]> {
  const [rows] = await pool.query<ProfileSql[]>(`${SELECT_PROFILE} ORDER BY member_id`);
  return rows.map(mapProfile);
}

export async function getProfile(pool: Pool, memberId: number): Promise<MemberProfileRow | null> {
  const [rows] = await pool.query<ProfileSql[]>(`${SELECT_PROFILE} WHERE member_id = ?`, [memberId]);
  return rows[0] ? mapProfile(rows[0]) : null;
}

export async function displayName(pool: Pool, memberId: number): Promise<string> {
  const profile = await getProfile(pool, memberId);
  const name = profile?.name?.trim();
  return name ? name : `会员 ${memberId}`;
}

function textOrNull(value: unknown, label: string, max: number) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new FulfillmentError(`${label}要写成文字`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new FulfillmentError(`${label}不超过 ${max} 字`);
  return text;
}

export async function saveManualProfile(
  pool: Pool,
  input: { memberId: number; today: string; body: Record<string, unknown> },
): Promise<MemberProfileRow> {
  const [members] = await pool.query<RowDataPacket[]>(`SELECT id FROM members WHERE id = ?`, [input.memberId]);
  if (!members[0]) throw new FulfillmentError("会员不存在");
  const name = textOrNull(input.body.name, "姓名", 64);
  const city = textOrNull(input.body.city, "城市", 64);
  const job = textOrNull(input.body.job, "职业", 64);
  const schedule = textOrNull(input.body.schedule, "作息", 128);
  const emotionalNeed = textOrNull(input.body.emotionalNeed, "情感需求", 255);
  const strengths = textOrNull(input.body.strengths, "优点", 255);
  const taboos = textOrNull(input.body.taboos, "禁忌", 255);
  const disclosureBoundary = textOrNull(input.body.disclosureBoundary, "可对嘉宾说的边界", 255);
  let age: number | null = null;
  if (input.body.age != null && input.body.age !== "") {
    const parsed = typeof input.body.age === "number" ? input.body.age : Number(input.body.age);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) throw new FulfillmentError("年龄要写成整数");
    age = parsed;
  }
  await pool.query(
    `INSERT INTO member_profiles (
      member_id, name, age, city, job, schedule, emotional_need, strengths, taboos, disclosure_boundary, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      age = VALUES(age),
      city = VALUES(city),
      job = VALUES(job),
      schedule = VALUES(schedule),
      emotional_need = VALUES(emotional_need),
      strengths = VALUES(strengths),
      taboos = VALUES(taboos),
      disclosure_boundary = VALUES(disclosure_boundary),
      source = 'manual',
      updated_at = VALUES(updated_at)`,
    [input.memberId, name, age, city, job, schedule, emotionalNeed, strengths, taboos, disclosureBoundary, input.today],
  );
  const saved = await getProfile(pool, input.memberId);
  if (!saved) throw new FulfillmentError("画像没有写上");
  return saved;
}

/** 成交域同步的位置。本轮不接外部库，也不写会员表。 */
export function syncMemberProfileFromDeal(_memberId: number): { synced: false; reason: string } {
  return { synced: false, reason: "成交域同步还没接上" };
}

export async function seedDemoProfiles(pool: Pool, today = "2026-09-30") {
  for (const [rawId, name] of Object.entries(DEMO_MEMBER_NAMES)) {
    const memberId = Number(rawId);
    const [members] = await pool.query<RowDataPacket[]>(`SELECT id FROM members WHERE id = ?`, [memberId]);
    if (!members[0]) continue;
    await pool.query(
      `INSERT INTO member_profiles (member_id, name, source, updated_at)
       VALUES (?, ?, 'manual', ?)
       ON DUPLICATE KEY UPDATE member_id = member_id`,
      [memberId, name, today],
    );
  }
}
