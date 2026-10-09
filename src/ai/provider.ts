import type { Pool } from "mysql2/promise";
import { recordInvocation } from "./audit";
import { cacheGet, cacheSet, contextHash } from "./cache";
import { completionsUrl, readAiConfig, type AiConfig, type AiEndpoint } from "./config";

export type AiFailure = "disabled" | "timeout" | "parse" | "upstream";

export type ChatJsonInput<T> = {
  purpose: string;
  system: string;
  user: string;
  temperature: number;
  timeoutMs?: number;
  bypassCache?: boolean;
  callerId?: number | null;
  pool?: Pool | null;
  createdAt?: string;
  parse: (value: unknown) => T | null;
  fetchImpl?: typeof fetch;
  config?: AiConfig;
};

export type ChatJsonResult<T> =
  | { ok: true; data: T; model: string; fromCache: boolean }
  | { ok: false; reason: AiFailure };

type Usage = { promptTokens: number | null; completionTokens: number | null };

export async function chatJson<T>(input: ChatJsonInput<T>): Promise<ChatJsonResult<T>> {
  const config = input.config ?? readAiConfig();
  if (!config.enabled) return { ok: false, reason: "disabled" };
  const hash = contextHash([input.purpose, input.system, input.user, String(input.temperature)]);
  if (!input.bypassCache) {
    const cached = await cacheGet(hash);
    if (cached) {
      const parsed = parseText(cached, input.parse);
      if (parsed.ok) return { ok: true, data: parsed.data, model: "cache", fromCache: true };
    }
  }
  // timeoutMs 是整条主备链路的总预算，不是单次请求的超时。
  // 不设deadline 的话，重试次数乘以端点数会把等待放大成4 倍。
  const deadline = Date.now() + (input.timeoutMs ?? config.timeoutMs);
  const primary = await attempt(config.primary, input, deadline, hash);
  if (primary.ok) return primary.result;
  const fallback = await attempt(config.fallback, input, deadline, hash);
  if (fallback.ok) return fallback.result;
  const reason = primary.reason === "parse" || fallback.reason === "parse" ? "parse" : fallback.reason;
  return { ok: false, reason };
}

async function attempt<T>(
  endpoint: AiEndpoint,
  input: ChatJsonInput<T>,
  deadline: number,
  hash: string,
): Promise<{ ok: true; result: ChatJsonResult<T> } | { ok: false; reason: "timeout" | "parse" | "upstream" }> {
  const started = Date.now();
  const called = await callEndpoint(endpoint, input, deadline);
  await recordInvocation(input.pool, {
    callerId: input.callerId ?? null,
    purpose: input.purpose,
    model: called.ok ? called.model : endpoint.model || "unset",
    latencyMs: Date.now() - started,
    promptTokens: called.ok ? called.usage.promptTokens : null,
    completionTokens: called.ok ? called.usage.completionTokens : null,
    contextHash: hash,
    createdAt: input.createdAt ?? new Date().toISOString().slice(0, 10),
  });
  if (!called.ok) return { ok: false, reason: called.reason };
  const parsed = parseText(called.text, input.parse);
  if (!parsed.ok) return { ok: false, reason: "parse" };
  await cacheSet(hash, called.text);
  return { ok: true, result: { ok: true, data: parsed.data, model: called.model, fromCache: false } };
}

async function callEndpoint<T>(
  endpoint: AiEndpoint,
  input: ChatJsonInput<T>,
  deadline: number,
): Promise<{ ok: true; text: string; model: string; usage: Usage } | { ok: false; reason: "timeout" | "upstream"; model: string }> {
  if (!endpoint.apiKey || !endpoint.model) return { ok: false, reason: "upstream", model: endpoint.model || "unset" };
  let last: "timeout" | "upstream" = "upstream";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline - Date.now();
    // 预算用完就不再试第二次，也不再起新的计时器。
    if (remaining <= 0) return { ok: false, reason: "timeout", model: endpoint.model };
    const result = await once(endpoint, input, remaining);
    if (result.ok) return result;
    last = result.reason;
  }
  return { ok: false, reason: last, model: endpoint.model };
}

async function once<T>(
  endpoint: AiEndpoint,
  input: ChatJsonInput<T>,
  timeoutMs: number,
): Promise<{ ok: true; text: string; model: string; usage: Usage } | { ok: false; reason: "timeout" | "upstream" }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(completionsUrl(endpoint.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${endpoint.apiKey}`,
      },
      body: JSON.stringify({
        model: endpoint.model,
        temperature: input.temperature,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: "upstream" };
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) return { ok: false, reason: "upstream" };
    return {
      ok: true,
      text,
      model: endpoint.model,
      usage: {
        promptTokens: typeof body.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : null,
        completionTokens: typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : null,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "upstream" };
  } finally {
    clearTimeout(timer);
  }
}

function parseText<T>(text: string, parse: (value: unknown) => T | null): { ok: true; data: T } | { ok: false } {
  try {
    const value = JSON.parse(extractJson(text));
    const data = parse(value);
    if (data == null) return { ok: false };
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

function extractJson(text: string) {
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return text.slice(objectStart, objectEnd + 1);
  const listStart = text.indexOf("[");
  const listEnd = text.lastIndexOf("]");
  if (listStart >= 0 && listEnd > listStart) return text.slice(listStart, listEnd + 1);
  return text;
}
