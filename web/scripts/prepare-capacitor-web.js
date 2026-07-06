import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(projectRoot, "dist");
const rootAssetPattern = /\.(png|jpg|jpeg|webp|svg|ico|webmanifest)$/i;

function copyFileIfExists(fileName) {
  const source = join(projectRoot, fileName);
  if (!existsSync(source)) {
    throw new Error(`Missing required web asset: ${fileName}`);
  }
  copyFileSync(source, join(distDir, fileName));
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

copyFileIfExists("index.html");
copyFileIfExists("app.js");

for (const entry of readdirSync(projectRoot)) {
  const source = join(projectRoot, entry);
  if (statSync(source).isFile() && rootAssetPattern.test(entry)) {
    copyFileSync(source, join(distDir, entry));
  }
}

console.log(`Prepared Capacitor web assets in ${distDir}`);