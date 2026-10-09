import "./env";
import { createServer } from "node:http";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createServer as createViteServer } from "vite";
import { resolve } from "node:path";
import { closeRedis, initRedis } from "./accounts";
import { closeFulfillmentDb } from "./db";
import { openFulfillment } from "./fulfillment";
import { handleRequest } from "./http";
import { seedWorkbench } from "./seed";
import { FulfillmentError } from "./types";

const port = Number(process.env.PORT ?? 47291);
const host = process.env.HOST ?? "0.0.0.0";

const redis = initRedis();
await redis.connect();

const { crm, pool } = await openFulfillment({ reset: true });
await seedWorkbench(crm);

const vite = await createViteServer({
  configFile: false,
  root: resolve(process.cwd(), "web"),
  appType: "spa",
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  server: { middlewareMode: true },
});

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api/")) {
    try {
      const body = await readJson(req);
      const result = await handleRequest(crm, { method: req.method ?? "GET", url, body, cookie: req.headers.cookie });
      sendJson(res, result.status, result.body, result.setCookie);
    } catch (error) {
      const message = error instanceof FulfillmentError ? error.message : "没有完成这次请求";
      sendJson(res, 400, { error: message });
    }
    return;
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end("没有这一页");
  });
});

server.listen(port, host, () => {
  console.log(`履约工作台 http://127.0.0.1:${port}`);
});

process.on("SIGINT", async () => {
  server.close();
  await closeFulfillmentDb(pool);
  await closeRedis();
  process.exit(0);
});

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown, setCookie?: string) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (setCookie) res.setHeader("set-cookie", setCookie);
  res.end(JSON.stringify(body));
}

async function readJson(req: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new FulfillmentError("请求缺少正文");
  }
}
