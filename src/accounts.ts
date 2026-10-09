import { randomBytes } from "node:crypto";
import Redis from "ioredis";

export type Permission = "红娘" | "审核人";

export type Account = {
  id: number;
  name: string;
  personId: number;
  permissions: Permission[];
};

/** 两个种子账号。红娘可以单独有；审核人只加在已有红娘权限的账号上。 */
export const ACCOUNTS: Account[] = [
  { id: 1, name: "林晓", personId: 20, permissions: ["红娘"] },
  { id: 2, name: "苏衡", personId: 20, permissions: ["红娘", "审核人"] },
];

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_PREFIX = "session:";

let redis: Redis | null = null;

export function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

export function initRedis(url = redisUrl()): Redis {
  if (redis) return redis;
  redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  return redis;
}

export function currentRedis(): Redis | null {
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (!redis) return;
  const client = redis;
  redis = null;
  await client.quit();
}

function sessionKey(token: string) {
  return `${SESSION_PREFIX}${token}`;
}

export function hasPermission(account: Account, permission: Permission) {
  return account.permissions.includes(permission);
}

export async function signIn(accountId: number) {
  const account = ACCOUNTS.find((item) => item.id === accountId);
  if (!account) return null;
  const token = randomBytes(18).toString("hex");
  const client = initRedis();
  await client.set(sessionKey(token), String(account.id), "EX", SESSION_TTL_SECONDS);
  return { account, token };
}

export async function signOut(cookieHeader: string | undefined) {
  const token = readCookie(cookieHeader, "session");
  if (!token) return;
  const client = initRedis();
  await client.del(sessionKey(token));
}

export async function accountFromCookie(cookieHeader: string | undefined) {
  const token = readCookie(cookieHeader, "session");
  if (!token) return null;
  const client = initRedis();
  const idRaw = await client.get(sessionKey(token));
  if (idRaw == null) return null;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) return null;
  return ACCOUNTS.find((item) => item.id === id) ?? null;
}

export function sessionCookie(token: string) {
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie() {
  return "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function readCookie(header: string | undefined, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
