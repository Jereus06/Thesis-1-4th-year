import { ZodError } from "zod";
import { DomainError } from "./domain.ts";
import { StockCastService } from "./service.ts";
import { uuid } from "./schemas.ts";

type Action = (
  businessId: string,
  resourceId: string | null,
  body: unknown,
  actorId: string | null,
) => Promise<unknown>;

export function createHttpHandler(service: StockCastService) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      return json(200, { status: "ok", database: "not_checked" });
    }

    const match = url.pathname.match(
      /^\/api\/v1\/businesses\/([^/]+)\/(products|settings|sales|inventory-movements)(?:\/([^/]+))?$/,
    );
    if (!match) return problem(404, "not_found", "Route not found");

    const [, businessId, resource, resourceId = null] = match;
    const actorHeader = request.headers.get("x-stockcast-user-id");
    let actorId: string | null = null;
    try {
      uuid.parse(businessId);
      if (actorHeader) actorId = uuid.parse(actorHeader);
      const body = request.method === "GET" ? undefined : await readJson(request);
      const action = route(service, request.method, resource, Boolean(resourceId));
      if (!action) return problem(405, "method_not_allowed", "Method not allowed");
      const value = await action(businessId, resourceId, body, actorId);
      return json(request.method === "POST" ? 201 : 200, { data: value });
    } catch (error) {
      if (error instanceof ZodError) {
        return json(400, {
          error: {
            code: "validation_error",
            message: "Request validation failed",
            issues: error.issues,
          },
        });
      }
      if (error instanceof DomainError) {
        const status = { not_found: 404, conflict: 409, insufficient_stock: 409, forbidden: 403 }[
          error.code
        ];
        return problem(status, error.code, error.message);
      }
      if (error instanceof SyntaxError)
        return problem(400, "invalid_json", "Request body must be valid JSON");
      return problem(500, "internal_error", "An unexpected error occurred");
    }
  };
}

function route(
  service: StockCastService,
  method: string,
  resource: string,
  hasId: boolean,
): Action | null {
  if (resource === "products" && method === "GET" && !hasId) return (b) => service.listProducts(b);
  if (resource === "products" && method === "POST" && !hasId)
    return (b, _id, body, actor) => service.createProduct(b, body, actor);
  if (resource === "products" && method === "PATCH" && hasId)
    return (b, id, body) => service.updateProduct(b, id!, body);
  if (resource === "settings" && method === "GET" && !hasId) return (b) => service.getSettings(b);
  if (resource === "settings" && method === "PUT" && !hasId)
    return (b, _id, body) => service.putSettings(b, body);
  if (resource === "sales" && method === "GET" && !hasId) return (b) => service.listSales(b);
  if (resource === "sales" && method === "POST" && !hasId)
    return (b, _id, body, actor) => service.recordSale(b, body, actor);
  if (resource === "inventory-movements" && method === "GET" && !hasId)
    return (b) => service.listMovements(b);
  if (resource === "inventory-movements" && method === "POST" && !hasId)
    return (b, _id, body, actor) => service.recordMovement(b, body, actor);
  return null;
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json"))
    throw new DomainError("conflict", "Content-Type must be application/json");
  return request.json();
}

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function problem(status: number, code: string, message: string) {
  return json(status, { error: { code, message } });
}
