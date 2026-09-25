import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";

const envFile = resolve(process.cwd(), process.env.ENV_FILE ?? ".env");
if (existsSync(envFile)) loadEnvFile(envFile);

const environmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must use postgres:// or postgresql://",
    ),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  CORS_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type BackendConfig = {
  databaseUrl: string;
  port: number;
  nodeEnv: "development" | "test" | "production";
  host: string;
  corsOrigin: string;
  databaseSsl: boolean;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): BackendConfig {
  const value = environmentSchema.parse(environment);
  return {
    databaseUrl: value.DATABASE_URL,
    port: value.PORT,
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    corsOrigin: value.CORS_ORIGIN,
    databaseSsl: value.DATABASE_SSL,
  };
}
