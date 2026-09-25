import assert from "node:assert/strict";
import test from "node:test";
import type { DataOrigin } from "./domain.ts";
import { createHttpHandler } from "./http.ts";
import type { StockCastRepository } from "./repository.ts";
import { StockCastService } from "./service.ts";

const businessId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

function repository(origin: DataOrigin | null = "demo") {
  const calls: unknown[] = [];
  const repo: StockCastRepository = {
    async getBusinessOrigin() {
      return origin;
    },
    async listProducts() {
      return [];
    },
    async createProduct(id, dataOrigin, input, actorId) {
      calls.push({ id, dataOrigin, input, actorId });
      return { id: productId, businessId: id, ...input, isActive: true };
    },
    async updateProduct() {
      return null;
    },
    async getSettings() {
      return null;
    },
    async putSettings(value) {
      return value;
    },
    async listSales() {
      return [];
    },
    async recordManualSale(input) {
      calls.push(input);
      return {
        id: "33333333-3333-4333-8333-333333333333",
        source: "manual",
        recordedBy: input.actorId,
        dataOrigin: input.origin,
        ...input,
      };
    },
    async listMovements() {
      return [];
    },
    async recordMovement(input) {
      calls.push(input);
      return {
        id: "44444444-4444-4444-8444-444444444444",
        balanceAfter: "12",
        saleId: null,
        recordedBy: input.actorId,
        dataOrigin: input.origin,
        ...input,
      };
    },
  };
  return { repo, calls };
}

test("health response does not pretend the database was checked", async () => {
  const { repo } = repository();
  const response = await createHttpHandler(new StockCastService(repo))(
    new Request("http://test/api/v1/health"),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", database: "not_checked" });
});

test("health checks a connected database", async () => {
  const { repo } = repository();
  const response = await createHttpHandler(new StockCastService(repo), {
    checkDatabase: async () => true,
  })(new Request("http://test/api/v1/health"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", database: "connected" });
});

test("health reports an unavailable database", async () => {
  const { repo } = repository();
  const response = await createHttpHandler(new StockCastService(repo), {
    checkDatabase: async () => false,
  })(new Request("http://test/api/v1/health"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable", database: "unavailable" });
});

test("creates a product with decimal strings and explicit demo origin", async () => {
  const { repo, calls } = repository();
  const response = await createHttpHandler(new StockCastService(repo))(
    new Request(`http://test/api/v1/businesses/${businessId}/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku: "DEMO-1",
        name: "Demo item",
        category: "Demo",
        unit: "piece",
        currentStock: "10.5",
        leadTimeDays: 2,
        safetyStock: "2",
        unitCost: "4.25",
      }),
    }),
  );
  assert.equal(response.status, 201);
  assert.equal((calls[0] as { dataOrigin: string }).dataOrigin, "demo");
});

test("rejects invalid sale quantities before repository mutation", async () => {
  const { repo, calls } = repository();
  const response = await createHttpHandler(new StockCastService(repo))(
    new Request(`http://test/api/v1/businesses/${businessId}/sales`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId, saleDate: "2026-09-24", quantity: 0 }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});

test("rejects negative receipt movements", async () => {
  const { repo, calls } = repository();
  const response = await createHttpHandler(new StockCastService(repo))(
    new Request(`http://test/api/v1/businesses/${businessId}/inventory-movements`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        productId,
        movementDate: "2026-09-24",
        movementType: "receipt",
        quantityDelta: "-2",
      }),
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(calls.length, 0);
});