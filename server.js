// Hostinger / Passenger / cPanel entry point (ES Module compatible)
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distServer = path.join(__dirname, "dist", "server.cjs");

if (fs.existsSync(distServer)) {
  require(distServer);
} else {
  console.error("dist/server.cjs not found. Please run 'npm run build' first.");
}
