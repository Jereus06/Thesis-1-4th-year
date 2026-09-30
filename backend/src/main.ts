import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHttpHandler } from "./http.ts";
import { LocalStockCastRepository } from "./local-repository.ts";
import { createNodeServer } from "./node-server.ts";
import { StockCastService } from "./service.ts";

export const DEMO_BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

const here = dirname(fileURLToPath(import.meta.url));
const dataFile = resolve(
  process.env.STOCKCAST_DATA_FILE ?? resolve(here, "../data/stockcast-demo.sqlite"),
);
const port = parsePort(process.env.PORT);
const host = process.env.HOST ?? "127.0.0.1";
const allowedOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

mkdirSync(dirname(dataFile), { recursive: true });
const repository = new LocalStockCastRepository(dataFile);
repository.bootstrapDemo(DEMO_BUSINESS_ID);
const server = createNodeServer(
  createHttpHandler(new StockCastService(repository), { databaseStatus: "ready" }),
  allowedOrigin,
);

server.listen(port, host, () => {
  console.log(`StockCast demo API listening on http://${host}:${port}`);
  console.log(`Demo business: ${DEMO_BUSINESS_ID}`);
  console.log(`Local data file: ${dataFile}`);
  console.log("Demo mode only: authentication and production PostgreSQL wiring are not enabled.");
});

function shutdown() {
  server.close(() => {
    repository.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function parsePort(value: string | undefined) {
  const port = Number(value ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  return port;
}
