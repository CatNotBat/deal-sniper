import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, "..");
const siteDir = join(repo, "site");
const distDir = join(repo, "dist");
const srcDir = join(repo, "src");

const appEntryPoints = {
  app: join(srcDir, "app/main.ts"),
  landing: join(srcDir, "app/landing.ts"),
};

function copySite(clean) {
  if (clean) {
    rmSync(distDir, { recursive: true, force: true });
    mkdirSync(distDir, { recursive: true });
  }
  cpSync(siteDir, distDir, { recursive: true });
}

async function buildBookmarklet() {
  const result = await build({
    entryPoints: [join(srcDir, "bookmarklet/main.ts")],
    bundle: true,
    format: "iife",
    minify: true,
    target: "es2020",
    write: false,
    legalComments: "none",
  });
  const code = result.outputFiles[0].text;
  if (!code.includes("__APP_URL__")) {
    throw new Error("bookmarklet bundle is missing the __APP_URL__ placeholder");
  }
  if (/innerHTML/.test(code)) {
    throw new Error("bookmarklet bundle contains innerHTML");
  }
  return code;
}

function sizeOf(name) {
  return statSync(join(distDir, name)).size;
}

async function buildAll() {
  copySite(true);

  const bookmarkletCode = await buildBookmarklet();
  writeFileSync(join(distDir, "bookmarklet.js"), bookmarkletCode);

  await build({
    entryPoints: appEntryPoints,
    bundle: true,
    format: "esm",
    minify: true,
    target: "es2020",
    outdir: distDir,
    legalComments: "none",
    define: { __BOOKMARKLET__: JSON.stringify(bookmarkletCode) },
  });

  console.log(`bookmarklet.js  ${sizeOf("bookmarklet.js")} bytes`);
  console.log(`app.js          ${sizeOf("app.js")} bytes`);
  console.log(`landing.js      ${sizeOf("landing.js")} bytes`);
}

if (process.argv.includes("--serve")) {
  await buildAll();
  const ctx = await context({
    entryPoints: appEntryPoints,
    bundle: true,
    format: "esm",
    minify: true,
    target: "es2020",
    outdir: distDir,
    legalComments: "none",
    define: { __BOOKMARKLET__: JSON.stringify(await buildBookmarklet()) },
  });
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: distDir, port: 8000 });
  console.log(`Serving dist/ at http://${host}:${port}`);
  watch(siteDir, { recursive: true }, () => {
    copySite(false);
  });
} else {
  await buildAll();
}
