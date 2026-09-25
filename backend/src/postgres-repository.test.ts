import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./domain.ts";
import { PostgresStockCastRepository, type Queryable } from "./postgres-repository.ts";

const businessId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

function scriptedClient(stock: string) {
  const statements: string[] = [];
  const client: Queryable & { release(): void } = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith("SELECT current_stock"))
        return { rows: [{ current_stock: stock }], rowCount: 1 };
      if (sql.startsWith("INSERT INTO sales")) {
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              business_id: businessId,
              product_id: productId,
              sale_date: "2026-09-24",
              quantity: "3",
              data_origin: "demo",
              recorded_by: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      statements.push("RELEASE");
    },
  };
  return { client, statements };
}

test("manual sale writes sale, balance, and audit movement in one transaction", async () => {
  const { client, statements } = scriptedClient("10");
  const repository = new PostgresStockCastRepository({
    query: client.query,
    async connect() {
      return client;
    },
  });
  await repository.recordManualSale({
    businessId,
    productId,
    saleDate: "2026-09-24",
    quantity: "3",
    origin: "demo",
    actorId: null,
  });
  assert.equal(statements[0], "BEGIN");
  assert.ok(statements.some((sql) => sql.startsWith("UPDATE products SET current_stock")));
  assert.ok(statements.some((sql) => sql.startsWith("INSERT INTO inventory_movements")));
  assert.ok(statements.includes("COMMIT"));
  assert.ok(!statements.includes("ROLLBACK"));
});

test("manual sale rolls back when stock is insufficient", async () => {
  const { client, statements } = scriptedClient("2");
  const repository = new PostgresStockCastRepository({
    query: client.query,
    async connect() {
      return client;
    },
  });
  await assert.rejects(
    repository.recordManualSale({
      businessId,
      productId,
      saleDate: "2026-09-24",
      quantity: "3",
      origin: "demo",
      actorId: null,
    }),
    (error) => error instanceof DomainError && error.code === "insufficient_stock",
  );
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(!statements.some((sql) => sql.startsWith("INSERT INTO sales")));
});
