import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHttpHandler } from "./http.ts";
import { LocalStockCastRepository } from "./local-repository.ts";
import { createNodeServer } from "./node-server.ts";
import { StockCastService } from "./service.ts";

const businessId = "00000000-0000-4000-8000-000000000001";

test("runnable server persists a sale and its inventory audit movement", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "stockcast-api-"));
  const filename = join(directory, "test.sqlite");
  const repository = new LocalStockCastRepository(filename);
  repository.bootstrapDemo(businessId);
  const server = createNodeServer(createHttpHandler(new StockCastService(repository)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/businesses/${businessId}`;

  const created = await request(`${base}/products`, "POST", {
    sku: "DEMO-001",
    name: "Demonstration Product",
    category: "Demo",
    unit: "piece",
    currentStock: "10",
    leadTimeDays: 2,
    safetyStock: "3",
    unitCost: "25.50",
  });
  assert.equal(created.response.status, 201);
  const productId = (created.body.data as { id: string }).id;

  const sold = await request(`${base}/sales`, "POST", {
    productId,
    saleDate: "2026-09-25",
    quantity: "3",
  });
  assert.equal(sold.response.status, 201);

  const products = await request(`${base}/products`);
  assert.equal((products.body.data as Array<{ currentStock: string }>)[0].currentStock, "7");

  const movements = await request(`${base}/inventory-movements`);
  const rows = movements.body.data as Array<{
    movementType: string;
    quantityDelta: string;
    balanceAfter: string;
  }>;
  assert.deepEqual(
    rows.map(({ movementType, quantityDelta, balanceAfter }) => ({
      movementType,
      quantityDelta,
      balanceAfter,
    })),
    [
      { movementType: "opening_balance", quantityDelta: "10", balanceAfter: "10" },
      { movementType: "sale", quantityDelta: "-3", balanceAfter: "7" },
    ],
  );
});

async function request(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: (await response.json()) as { data: unknown } };
}
