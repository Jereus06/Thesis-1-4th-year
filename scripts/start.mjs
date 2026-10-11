import { fileURLToPath } from "node:url";
import { startStockCast } from "./startup.mjs";

process.exitCode = startStockCast({
  projectDir: fileURLToPath(new URL("..", import.meta.url)),
  setupOnly: process.argv.includes("--setup-only"),
});
