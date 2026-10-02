#!/usr/bin/env node
/**
 * Rewrite the app version in every file that scripts/check-version.mjs reads.
 *
 * release.yml uses this on workflow_dispatch runs. A manual run names the
 * release whatever version it was dispatched with (e.g. 1.0.2-beta.1 for the
 * beta dress rehearsal), but Tauri builds the version baked into the source
 * tree. Without this step the artifacts land in the draft release named for
 * the repo's current version while `prepare` promised the dispatched one, and
 * every smoke-test step then hunts for PaperNinja_<dispatched version>_* files
 * that were never built. Tag runs never need it: check-version.mjs already
 * fails the run when the source version and the tag disagree.
 *
 * The extraction patterns below are the same ones check-version.mjs uses --
 * keep the two files in sync.
 *
 * Cargo.lock is deliberately not touched: the build refreshes it from
 * Cargo.toml on its own.
 *
 * Usage:
 *   node scripts/set-version.mjs 1.0.2
 *   node scripts/set-version.mjs 1.0.2-beta.1
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Same shape release.yml's prepare job accepts: 1.2.3 or 1.2.3-beta.1.
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

const newVersion = process.argv[2];
if (!newVersion || !VERSION_RE.test(newVersion)) {
  console.error(
    `Usage: node scripts/set-version.mjs <version>\n` +
      `  <version> must be like 1.2.3 or 1.2.3-beta.1 (no v prefix), got: ${newVersion ?? '(none)'}`,
  );
  process.exit(1);
}

function readText(relPath) {
  return readFileSync(resolve(root, relPath), 'utf8');
}

// Swap the captured version for newVersion and leave every other byte --
// including line endings -- untouched. The files here can be CRLF on a
// Windows checkout; a wholesale rewrite would churn every line.
function swapVersion(text, regex, label) {
  const m = text.match(regex);
  if (!m) throw new Error(`Could not locate the version string in ${label}`);
  if (m[1] === newVersion) return { text, changed: false, from: m[1] };
  const at = m.index + m[0].indexOf(m[1]);
  return {
    text: text.slice(0, at) + newVersion + text.slice(at + m[1].length),
    changed: true,
    from: m[1],
  };
}

const updated = [];

// JSON sources: parse, set, write back with the same 2-space indent.
for (const relPath of ['package.json', 'src-tauri/tauri.conf.json']) {
  const json = JSON.parse(readText(relPath));
  if (typeof json.version !== 'string') {
    throw new Error(`${relPath} has no top-level "version"`);
  }
  if (json.version !== newVersion) {
    json.version = newVersion;
    writeFileSync(resolve(root, relPath), JSON.stringify(json, null, 2) + '\n');
  }
  updated.push([relPath, json.version]);
}

// Text sources: surgical swap, using check-version.mjs's exact patterns.
const textTargets = [
  ['src-tauri/Cargo.toml', /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m],
  ['src/components/SplashScreen.tsx', /APP_VERSION\s*=\s*['"]([^'"]+)['"]/],
  ['src/components/Dashboard.tsx', /useState\s*\(\s*['"]([0-9][^'"]+)['"]\s*\)/],
  ['src/components/AboutDialog.tsx', /APP_VERSION_FALLBACK\s*=\s*['"]([^'"]+)['"]/],
];

for (const [relPath, regex] of textTargets) {
  const result = swapVersion(readText(relPath), regex, relPath);
  if (result.changed) writeFileSync(resolve(root, relPath), result.text);
  updated.push([relPath, newVersion]);
}

// Verify by re-reading every source the way check-version.mjs does. A missed
// file would otherwise surface an hour into the smoke-test job instead of
// right here, where the fix is one line away.
const mismatches = [];
for (const [relPath, expected] of updated) {
  let actual;
  const text = readText(relPath);
  if (relPath.endsWith('.json')) {
    actual = JSON.parse(text).version;
  } else if (relPath.endsWith('Cargo.toml')) {
    actual = text.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
  } else if (relPath.endsWith('SplashScreen.tsx')) {
    actual = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
  } else if (relPath.endsWith('Dashboard.tsx')) {
    actual = text.match(/useState\s*\(\s*['"]([0-9][^'"]+)['"]\s*\)/)?.[1];
  } else {
    actual = text.match(/APP_VERSION_FALLBACK\s*=\s*['"]([^'"]+)['"]/)?.[1];
  }
  if (actual !== expected) mismatches.push(`  ${relPath}: "${actual}" (expected "${expected}")`);
}

if (mismatches.length > 0) {
  console.error('set-version failed to update every source:');
  for (const m of mismatches) console.error(m);
  process.exit(1);
}

for (const [relPath] of updated) console.log(`${relPath}: now ${newVersion}`);
console.log(`All six sources report ${newVersion} ✓`);
