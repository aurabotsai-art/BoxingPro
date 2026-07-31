// First-load JS budget for the session page. The app must start fast on a
// phone over gym Wi-Fi; this fails the build when the "/" entry's
// first-load chunks exceed the gzip budget. Raise the number only with a
// deliberate commit that says why.
//
// Run from web/ AFTER `next build`: node tools/check_bundle_size.mjs
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUDGET_KB = 140;

const manifest = JSON.parse(readFileSync(".next/app-build-manifest.json", "utf8"));
const files = manifest.pages?.["/page"];
if (!files?.length) {
  console.error("bundle check: no '/page' entry in app-build-manifest.json");
  process.exit(1);
}

let total = 0;
for (const f of files.filter((f) => f.endsWith(".js"))) {
  total += gzipSync(readFileSync(join(".next", f))).length;
}
const kb = total / 1024;
const line = `bundle check: first-load JS for "/" = ${kb.toFixed(1)} KB gzip (budget ${BUDGET_KB} KB)`;
if (kb > BUDGET_KB) {
  console.error(`✗ ${line}`);
  process.exit(1);
}
console.log(`✓ ${line}`);
