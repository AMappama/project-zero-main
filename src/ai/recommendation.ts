import type { Pool } from "mysql2/promise";
import { displayName, getProfile } from "../profiles";
import { chatJson } from "./provider";
import { recommendationMessages, type ProfileFacts } from "./prompts/recommendation";
import { clip, LOCAL_FAILURE_NOTICE, suggestRecommendationCopy, type RecommendationCopy } from "./localCopy";

export type RecommendationDraft = {
  source: "model" | "local";
  notice: string | null;
  copy: RecommendationCopy;
};

const FIELDS = ["progress", "reason", "highlights", "hiddenPoints"] as const;

export async function suggestRecommendation(input: {
  pool: Pool | null;
  callerId: number | null;
  memberId: number;
  guestMemberId: number;
  facts: string[];
  temperature: number;
  bypassCache: boolean;
}): Promise<RecommendationDraft> {
  const memberName = input.pool ? await displayName(input.pool, input.memberId) : `会员 ${input.memberId}`;
  const guestName = input.pool ? await displayName(input.pool, input.guestMemberId) : `会员 ${input.guestMemberId}`;
  const local = suggestRecommendationCopy(memberName, guestName, input.memberId * 17 + input.guestMemberId);
  const member = input.pool ? await profileFacts(input.memberId, input.pool) : bareFacts(input.memberId);
  const guest = input.pool ? await profileFacts(input.guestMemberId, input.pool) : bareFacts(input.guestMemberId);
  const messages = recommendationMessages({ member, guest, facts: input.facts });
  const result = await chatJson<RecommendationCopy>({
    purpose: "recommendation-copy",
    system: messages.system,
    user: messages.user,
    temperature: input.temperature,
    bypassCache: input.bypassCache,
    callerId: input.callerId,
    pool: input.pool,
    parse: parseCopy,
  });
  if (!result.ok) {
    return {
      source: "local",
      notice: result.reason === "disabled" ? null : LOCAL_FAILURE_NOTICE,
      copy: local,
    };
  }
  return { source: "model", notice: null, copy: result.data };
}

async function profileFacts(memberId: number, pool: Pool): Promise<ProfileFacts> {
  const row = await getProfile(pool, memberId);
  return {
    label: row?.name?.trim() || `会员 ${memberId}`,
    name: row?.name ?? null,
    age: row?.age ?? null,
    city: row?.city ?? null,
    job: row?.job ?? null,
    schedule: row?.schedule ?? null,
    emotionalNeed: row?.emotionalNeed ?? null,
    strengths: row?.strengths ?? null,
    taboos: row?.taboos ?? null,
    disclosureBoundary: row?.disclosureBoundary ?? null,
  };
}

function bareFacts(memberId: number): ProfileFacts {
  return {
    label: `会员 ${memberId}`,
    name: null,
    age: null,
    city: null,
    job: null,
    schedule: null,
    emotionalNeed: null,
    strengths: null,
    taboos: null,
    disclosureBoundary: null,
  };
}

function parseCopy(value: unknown): RecommendationCopy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const copy = {} as RecommendationCopy;
  for (const field of FIELDS) {
    if (typeof record[field] !== "string") return null;
    copy[field] = clip(record[field], 60);
    if (!copy[field]) return null;
  }
  return copy;
}
