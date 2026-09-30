import { ZodError } from "zod";
import {
  AuthenticationError,
  type AuthService,
  clearSessionCookie,
  readSessionCookie,
  sessionCookie,
} from "./auth.ts";
import { DomainError } from "./domain.ts";
import { StockCastService } from "./service.ts";
import { signInSchema, uuid } from "./schemas.ts";

type Action = (
  businessId: string,
  resourceId: string | null,
  body: unknown,
  actorId: string | null,
) => Promise<unknown>;

export function createHttpHandler(
  service: StockCastService,
  options: {
    databaseStatus?: "ready" | "not_checked";
    checkDatabase?: () => Promise<boolean>;
    auth?: AuthService;
    secureCookies?: boolean;
  } = {},
) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      if (options.checkDatabase) {
        const connected = await options.checkDatabase();
        return json(connected ? 200 : 503, {
          status: connected ? "ok" : "unavailable",
          database: connected ? "connected" : "unavailable",
        });
      }
      return json(200, { status: "ok", database: options.databaseStatus ?? "not_checked" });
    }

    if (url.pathname === "/api/v1/auth/sign-in" && request.method === "POST") {
      if (!options.auth)
        return problem(503, "authentication_unavailable", "Authentication is not configured");
      try {
        const body = signInSchema.parse(await readJson(request));
        const result = await options.auth.signIn(body.businessId, body.email, body.password);
        return json(
          200,
          { data: result.principal },
          { "set-cookie": sessionCookie(result.token, options.secureCookies ?? false) },
        );
      } catch (error) {
        if (error instanceof ZodError) return validationProblem(error);
        if (error instanceof AuthenticationError)
          return problem(401, "invalid_credentials", error.message);
        throw error;
      }
    }

    if (url.pathname === "/api/v1/auth/sign-out" && request.method === "POST") {
      if (!options.auth)
        return problem(503, "authentication_unavailable", "Authentication is not configured");
      await options.auth.signOut(readSessionCookie(request.headers.get("cookie")));
      return json(
        200,
        { data: { signedOut: true } },
        { "set-cookie": clearSessionCookie(options.secureCookies ?? false) },
      );
    }

    const principal = options.auth
      ? await options.auth.authenticate(readSessionCookie(request.headers.get("cookie")))
      : null;
    if (options.auth && !principal)
      return problem(401, "authentication_required", "Sign in is required");
    if (url.pathname === "/api/v1/auth/me" && request.method === "GET") {
      return json(200, { data: principal });
    }

    const match = url.pathname.match(
      /^\/api\/v1\/businesses\/([^/]+)\/(products|settings|sales|inventory-movements)(?:\/([^/]+))?$/,
    );
    if (!match) return problem(404, "not_found", "Route not found");

    const [, businessId, resource, resourceId = null] = match;
    let actorId: string | null = principal?.userId ?? null;
    try {
      uuid.parse(businessId);
      if (principal && principal.businessId !== businessId)
        return problem(403, "business_forbidden", "You do not belong to this business");
      const body = request.method === "GET" ? undefined : await readJson(request);
      if (principal && requiresOwner(request.method, resource, body) && principal.role !== "owner")
        return problem(403, "owner_required", "This action requires the owner role");
      const action = route(service, request.method, resource, Boolean(resourceId));
      if (!action) return problem(405, "method_not_allowed", "Method not allowed");
      const value = await action(businessId, resourceId, body, actorId);
      return json(request.method === "POST" ? 201 : 200, { data: value });
    } catch (error) {
      if (error instanceof ZodError) {
        return validationProblem(error);
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

function json(status: number, value: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function validationProblem(error: ZodError) {
  return json(400, {
    error: { code: "validation_error", message: "Request validation failed", issues: error.issues },
  });
}

function requiresOwner(method: string, resource: string, body: unknown) {
  if (resource === "products" && (method === "POST" || method === "PATCH")) return true;
  if (resource === "settings" && method === "PUT") return true;
  if (resource === "inventory-movements" && method === "POST") {
    const type = (body as { movementType?: string } | null)?.movementType;
    return type !== "receipt" && type !== "return";
  }
  return false;
}

function problem(status: number, code: string, message: string) {
  return json(status, { error: { code, message } });
}
