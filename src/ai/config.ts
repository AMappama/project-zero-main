export type AiEndpoint = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AiConfig = {
  enabled: boolean;
  timeoutMs: number;
  primary: AiEndpoint;
  fallback: AiEndpoint;
};

export function readAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  return {
    enabled: env.AI_ENABLED === "1",
    timeoutMs: positiveInt(env.AI_TIMEOUT_MS, 8000),
    primary: {
      baseUrl: env.AI_BASE_URL || "https://api.deepseek.com/v1",
      apiKey: env.AI_API_KEY || "",
      model: env.AI_MODEL || "deepseek-chat",
    },
    fallback: {
      baseUrl: env.AI_FALLBACK_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
      apiKey: env.AI_FALLBACK_API_KEY || "",
      model: env.AI_FALLBACK_MODEL || "glm-4-flash",
    },
  };
}

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function completionsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}
