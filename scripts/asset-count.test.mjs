// node --test scripts/
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { addDeployIgnores, countUploadedAssets } from "./asset-count.mjs";

function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), "assets-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

test("deployed count leaves out .assetsignore entries and sky images, keeps JSON and pages", () => {
  const dir = tree({
    ".assetsignore": "data/survey/ledger.json\n",
    "index.html": "",
    "data/fields.json": "{}",
    "data/fields/f1.json": "{}",
    "data/fields/f1/e01.webp": "",
    "data/candidates/c1/stamp.png": "",
    "data/survey/ledger.json": "{}",
    "og.png": "",
  });
  try {
    // index.html, fields.json, f1.json, og.png (outside data/)
    assert.deepEqual(countUploadedAssets(dir), { uploaded: 4, ignored: 4 });
    // Local builds: images stay
    assert.equal(countUploadedAssets(dir, []).uploaded, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("addDeployIgnores makes wrangler's own .assetsignore match the deployed count", () => {
  const dir = tree({ ".assetsignore": "data/survey/ledger.json\n", "data/a.json": "{}", "data/x/e01.webp": "" });
  try {
    addDeployIgnores(dir);
    assert.match(readFileSync(join(dir, ".assetsignore"), "utf8"), /^data\/\*\*\/\*\.webp$/m);
    assert.equal(countUploadedAssets(dir, []).uploaded, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
