import type { Pool } from "mysql2/promise";
import type { Fulfillment } from "../fulfillment";
import type { ShopRoleName } from "../types";
import { chatJson } from "./provider";
import { staffFitMessages } from "./prompts/staffFit";
import { clip } from "./localCopy";

export type StaffFitNote = {
  personId: number;
  fitScore: number;
  whyMatch: string;
  risk: string;
  firstTalk: string;
};

export type StaffFitResult =
  | { available: false }
  | { available: true; failed: true; notice: "匹配说明未生成" }
  | { available: true; failed: false; notes: StaffFitNote[]; order: number[] };

export async function suggestStaffFit(input: {
  crm: Fulfillment;
  pool: Pool | null;
  callerId: number | null;
  tenantId: number;
  roles: ShopRoleName[];
}): Promise<StaffFitResult> {
  if (process.env.AI_ENABLED !== "1") return { available: false };
  const people = await input.crm.listAssignableServicePeople({ tenantId: input.tenantId, roles: input.roles });
  const allowed = new Map(people.map((person) => [person.personId, person]));
  const brief = people.map((person) => ({
    personId: person.personId,
    name: person.name,
    roleLabel: person.roleLabel,
    score: person.score,
    closeRate: person.closeRate,
    servedCount: person.servedCount,
    statusLabel: person.statusLabel,
    reason: person.reason,
  }));
  const messages = staffFitMessages(brief);
  const result = await chatJson<{ items: StaffFitNote[] }>({
    purpose: "staff-fit",
    system: messages.system,
    user: messages.user,
    temperature: 0.2,
    timeoutMs: 4500,
    callerId: input.callerId,
    pool: input.pool,
    parse: (value) => parseNotes(value, allowed),
  });
  if (!result.ok) return { available: true, failed: true, notice: "匹配说明未生成" };
  const notes = [...result.data.items].sort((left, right) => right.fitScore - left.fitScore || left.personId - right.personId);
  const ranked = notes.map((note) => note.personId);
  const rest = people.map((person) => person.personId).filter((personId) => !ranked.includes(personId));
  return { available: true, failed: false, notes, order: [...ranked, ...rest] };
}

function parseNotes(value: unknown, allowed: Map<number, unknown>): { items: StaffFitNote[] } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const notes: StaffFitNote[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const personId = row.personId;
    const fitScore = row.fitScore;
    if (typeof personId !== "number" || !allowed.has(personId) || seen.has(personId)) continue;
    if (typeof fitScore !== "number" || !Number.isFinite(fitScore)) return null;
    if (typeof row.whyMatch !== "string" || typeof row.risk !== "string" || typeof row.firstTalk !== "string") return null;
    seen.add(personId);
    notes.push({
      personId,
      fitScore: Math.max(0, Math.min(100, Math.round(fitScore))),
      whyMatch: clip(row.whyMatch, 80),
      risk: clip(row.risk, 80),
      firstTalk: clip(row.firstTalk, 80),
    });
  }
  if (notes.length === 0) return null;
  return { items: notes };
}
