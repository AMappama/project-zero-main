import "../env";
import { chatJson } from "./provider";
import { readAiConfig } from "./config";

const config = readAiConfig();
if (!config.enabled) {
  console.log("AI 未开启");
  process.exit(0);
}

const started = Date.now();
const result = await chatJson({
  purpose: "probe",
  system: "只输出 JSON 对象。",
  user: "输出 {\"ok\":true}",
  temperature: 0,
  parse: (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null),
});
const elapsed = Date.now() - started;
if (!result.ok) {
  console.log(`没有调通 ${result.reason} ${elapsed}ms`);
  process.exit(1);
}
console.log(`${result.model} ${elapsed}ms`);
