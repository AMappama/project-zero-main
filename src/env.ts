import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(process.cwd(), ".env");
try {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] != null && process.env[key] !== "") continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
} catch {
  // 没有 .env 时用代码里的默认值
}
