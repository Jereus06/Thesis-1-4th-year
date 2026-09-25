import { loadConfig } from "./config.ts";
import { createHttpHandler } from "./http.ts";
import { createNodeServer } from "./node-server.ts";
import { checkPostgres, createPostgresPool } from "./postgres-pool.ts";
import { PostgresStockCastRepository } from "./postgres-repository.ts";
import { StockCastService } from "./service.ts";

const config = loadConfig();
const pool = createPostgresPool(config);
const repository = new PostgresStockCastRepository(pool);
const handler = createHttpHandler(new StockCastService(repository), {
  checkDatabase: () => checkPostgres(pool),
});
const server = createNodeServer(handler, config.corsOrigin);

if (!(await checkPostgres(pool))) {
  await pool.end();
  throw new Error("PostgreSQL connection failed. Check DATABASE_URL and run npm run db:migrate.");
}

server.listen(config.port, config.host, () => {
  console.log(`StockCast PostgreSQL API listening on http://${config.host}:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log("Authentication is not implemented; do not expose this server publicly.");
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
