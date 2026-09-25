import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createHttpHandler } from "./http.ts";
import { runMigrations } from "./migrate.ts";
import { createNodeServer } from "./node-server.ts";
import { PostgresStockCastRepository } from "./postgres-repository.ts";
import { StockCastService } from "./service.ts";

const databaseUrl = process.env.POSTGRES_TEST_URL;

test(
  "PostgreSQL server persists product, sale, stock balance, and audit movement across restart",
  {
    skip: databaseUrl ? false : "Set POSTGRES_TEST_URL to run the live PostgreSQL integration test",
  },
  async () => {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl });
    await runMigrations(pool);
    const businessId = randomUUID();
    await pool.query(
      "INSERT INTO businesses (id,name,data_origin) VALUES ($1,'Integration Test','demo')",
      [businessId],
    );

    let server = createNodeServer(
      createHttpHandler(new StockCastService(new PostgresStockCastRepository(pool))),
    );
    await listen(server);
    try {
      let base = address(server, businessId);
      const created = await request(`${base}/products`, "POST", {
        sku: "PG-TEST",
        name: "PostgreSQL Test Product",
        category: "Test",
        unit: "piece",
        currentStock: "10",
        leadTimeDays: 2,
        safetyStock: "3",
        unitCost: "25.50",
      });
      const productId = (created.data as { id: string }).id;
      await request(`${base}/sales`, "POST", { productId, saleDate: "2026-09-25", quantity: "3" });

      await close(server);
      server = createNodeServer(
        createHttpHandler(new StockCastService(new PostgresStockCastRepository(pool))),
      );
      await listen(server);
      base = address(server, businessId);
      const products = await request(`${base}/products`);
      assert.equal((products.data as Array<{ currentStock: string }>)[0].currentStock, "7.000");
      const movements = await request(`${base}/inventory-movements`);
      assert.equal((movements.data as unknown[]).length, 2);
    } finally {
      if (server.listening) await close(server);
      await pool.query("DELETE FROM businesses WHERE id=$1", [businessId]);
      await pool.end();
    }
  },
);

async function listen(server: ReturnType<typeof createNodeServer>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function close(server: ReturnType<typeof createNodeServer>) {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function address(server: ReturnType<typeof createNodeServer>, businessId: string) {
  const value = server.address();
  assert.ok(value && typeof value !== "string");
  return `http://127.0.0.1:${value.port}/api/v1/businesses/${businessId}`;
}

async function request(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    assert.fail(`${method} ${url} returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as { data: unknown };
}
