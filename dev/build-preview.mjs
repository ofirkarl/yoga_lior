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
  minify: process.env.PREVIEW_MINIFY === "1",
  plugins: [mockApi],
  nodePaths: [process.env.NODE_MODULES ?? resolve(root, "node_modules")],
  define: { "process.env.NODE_ENV": process.env.PREVIEW_MINIFY === "1" ? "\"production\"" : "\"development\"" },
  logLevel: "warning",
});

const html = readFileSync(resolve(root, "index.html"), "utf8")
  .replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="./app.css" /><script type="module" src="./app.js"></script>')
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./')
  .replace('<body>', `<body>
    <nav class="demo-bar" aria-label="תצוגת הדגמה">
      <strong>תצוגת הדגמה, נתונים לדוגמה:</strong>
      <a href="#main">מתאמנת</a><a href="#admin">ליאור (ניהול)</a><a href="#login">כניסה</a>
      <a href="#pending">ממתינה לאישור</a><a href="#health">הצהרת בריאות</a><a href="#password">סיסמה זמנית</a>
    </nav>
    <style>
      .demo-bar{display:flex;flex-wrap:wrap;gap:.25rem .9rem;align-items:center;padding:.5rem 1rem;background:#1f2a24;color:#fff;font:14px/1.4 system-ui,sans-serif}
      .demo-bar a{color:#fff;text-decoration:underline;text-underline-offset:3px;min-height:32px;display:inline-flex;align-items:center}
      .demo-bar a[aria-current]{font-weight:700;text-decoration:none;background:#3f5a4a;padding:0 .5rem;border-radius:6px}
    </style>
    <script>
      for (const a of document.querySelectorAll('.demo-bar a')) if (a.getAttribute('href') === (location.hash || '#main')) a.setAttribute('aria-current', 'page');
      addEventListener('hashchange', () => location.reload());
    </script>`);
writeFileSync(resolve(out, "index.html"), html);
cpSync(resolve(root, "public"), out, { recursive: true });
console.log("preview built:", out);
