// בונה תצוגה מקדימה עם נתוני הדגמה, בלי Supabase ובלי התקנת חבילות.
// שימוש: node dev/build-preview.mjs  →  dev/preview/index.html
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dev/preview");
mkdirSync(out, { recursive: true });

const mockApi = {
  name: "mock-api",
  setup(b) {
    b.onResolve({ filter: /\/lib\/api$/ }, () => ({ path: resolve(root, "dev/mock-api.ts") }));
  },
};

await build({
  entryPoints: [resolve(root, "src/main.tsx")],
  bundle: true,
  outdir: out,
  entryNames: "app",
  jsx: "automatic",
  format: "esm",
  target: "es2022",
  minify: false,
  plugins: [mockApi],
  nodePaths: [process.env.NODE_MODULES ?? resolve(root, "node_modules")],
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "warning",
});

const html = readFileSync(resolve(root, "index.html"), "utf8")
  .replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="./app.css" /><script type="module" src="./app.js"></script>')
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./');
writeFileSync(resolve(out, "index.html"), html);
cpSync(resolve(root, "public"), out, { recursive: true });
console.log("preview built:", out);
