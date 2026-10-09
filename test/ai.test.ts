import { describe, expect, it } from "vitest";
import { chatJson } from "../src/ai/provider";
import type { AiConfig } from "../src/ai/config";

const enabled: AiConfig = {
  enabled: true,
  timeoutMs: 1000,
  primary: { baseUrl: "https://primary.example/v1", apiKey: "primary-key", model: "primary-model" },
  fallback: { baseUrl: "https://fallback.example/v1", apiKey: "fallback-key", model: "fallback-model" },
};

describe("模型通道", () => {
  it("默认关闭时不发请求", async () => {
    let called = false;
    const result = await chatJson({
      purpose: "probe",
      system: "只输出 JSON",
      user: "{}",
      temperature: 0,
      parse: () => ({ ok: true }),
      fetchImpl: async () => {
        called = true;
        throw new Error("不该发出");
      },
      config: { ...enabled, enabled: false },
    });
    expect(result).toEqual({ ok: false, reason: "disabled" });
    expect(called).toBe(false);
  });

  it("主模型失败时改用备用模型，解析失败则退回", async () => {
    const seen: string[] = [];
    const result = await chatJson({
      purpose: "probe",
      system: "只输出 JSON",
      user: "{}",
      temperature: 0,
      config: enabled,
      parse: (value) => {
        const row = value as { ok?: boolean };
        return row.ok ? { ok: true } : null;
      },
      fetchImpl: async (url) => {
        seen.push(String(url));
        const model = String(url).includes("fallback") ? "备用" : "主";
        return new Response(JSON.stringify({ choices: [{ message: { content: model === "备用" ? "{\"ok\":true}" : "不是 json" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(seen.some((url) => url.includes("primary"))).toBe(true);
    expect(seen.some((url) => url.includes("fallback"))).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model).toBe("fallback-model");
  });

  it("两边都解析失败时不抛错", async () => {
    const result = await chatJson({
      purpose: "probe",
      system: "只输出 JSON",
      user: "{}",
      temperature: 0,
      config: enabled,
      parse: () => null,
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "{\"ok\":false}" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    expect(result).toEqual({ ok: false, reason: "parse" });
  });

  it("整条主备链路共享timeoutMs，不被重试次数放大", async () => {
    // 上游一直不返回。timeoutMs 是总预算，所以总耗时必须贴近它本身，
    // 而不是timeoutMs x 重试次数 x 两个端点。
    const budgetMs = 600;
    const started = Date.now();
    const result = await chatJson({
      purpose: "recommendation-copy",
      system: "只输出 JSON",
      user: "{}",
      temperature: 0.7,
      timeoutMs: budgetMs,
      config: enabled,
      parse: () => ({ ok: true }),
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    });
    const elapsed = Date.now() - started;
    expect(result).toEqual({ ok: false, reason: "timeout" });
    expect(elapsed).toBeLessThan(budgetMs * 2);
  });

  it("预算耗尽后不再发起第二次请求", async () => {
    let calls = 0;
    await chatJson({
      purpose: "staff-fit",
      system: "只输出 JSON",
      user: "{}",
      temperature: 0.2,
      timeoutMs: 400,
      config: enabled,
      parse: () => ({ items: [] }),
      fetchImpl: (_url, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        });
      },
    });
    // 第一次主模型就把预算用完，同端点不重试，备用端点也不再发请求。
    expect(calls).toBe(1);
  });
});
