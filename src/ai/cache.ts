import { createHash } from "node:crypto";
import { currentRedis } from "../accounts";

const DAY_SECONDS = 24 * 60 * 60;

export function contextHash(parts: string[]) {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export async function cacheGet(hash: string): Promise<string | null> {
  const redis = currentRedis();
  if (!redis || redis.status !== "ready") return null;
  try {
    return await redis.get(cacheKey(hash));
  } catch {
    return null;
  }
}

export async function cacheSet(hash: string, value: string) {
  const redis = currentRedis();
  if (!redis || redis.status !== "ready") return;
  try {
    await redis.set(cacheKey(hash), value, "EX", DAY_SECONDS);
  } catch {
    // 缓存写失败不影响这次预览
  }
}

function cacheKey(hash: string) {
  return `ai:v1:${hash}`;
}
