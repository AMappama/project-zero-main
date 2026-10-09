import type { Pool } from "mysql2/promise";

export async function recordInvocation(
  pool: Pool | null | undefined,
  input: {
    callerId: number | null;
    purpose: string;
    model: string;
    latencyMs: number;
    promptTokens: number | null;
    completionTokens: number | null;
    contextHash: string;
    createdAt: string;
  },
) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO ai_invocations (caller_id, purpose, model, latency_ms, prompt_tokens, completion_tokens, context_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.callerId,
        input.purpose,
        input.model,
        input.latencyMs,
        input.promptTokens,
        input.completionTokens,
        input.contextHash,
        input.createdAt,
      ],
    );
  } catch {
    // 审计写失败不把密钥或提示词打进日志
  }
}
