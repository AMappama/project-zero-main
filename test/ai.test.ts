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
});
