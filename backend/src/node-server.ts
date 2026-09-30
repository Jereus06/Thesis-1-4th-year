import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type WebHandler = (request: Request) => Promise<Response>;

export function createNodeServer(
  handler: WebHandler,
  allowedOrigin = "http://localhost:5173",
): Server {
  return createServer(async (incoming, outgoing) => {
    try {
      if (incoming.method === "OPTIONS") {
        writeCors(outgoing, allowedOrigin);
        outgoing.writeHead(204).end();
        return;
      }
      const request = await toRequest(incoming);
      const response = await handler(request);
      writeCors(outgoing, allowedOrigin);
      response.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.writeHead(response.status);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      writeCors(outgoing, allowedOrigin);
      outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      outgoing.end(
        JSON.stringify({
          error: { code: "server_error", message: "The server could not process the request" },
        }),
      );
    }
  });
}

async function toRequest(incoming: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const host = incoming.headers.host ?? "localhost";
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${host}${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers,
    body,
  });
}

function writeCors(response: ServerResponse, origin: string) {
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-headers", "content-type,x-stockcast-user-id");
  response.setHeader("access-control-allow-methods", "GET,POST,PATCH,PUT,OPTIONS");
  response.setHeader("vary", "origin");
}
