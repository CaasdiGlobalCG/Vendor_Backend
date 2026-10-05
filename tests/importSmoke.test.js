/**
 * Import smoke test — the guard for "something is broken and we don't know it".
 *
 * Loads EVERY backend module (routes, controllers, services, models, middleware,
 * utils, auth, config) and fails if any file cannot be imported. This catches the
 * class of breakage where a new dependency was never installed (e.g. the
 * `pdf-parse` incident) or an import path was renamed.
 *
 * Files with import-time side effects (cron/scheduler bootstrappers, websocket
 * servers) are skipped — importing them would start timers inside the test run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = ['modules', 'routes', 'middleware', 'utils', 'services', 'models', 'controllers', 'auth', 'config'];

// Files that start timers / servers / background jobs at import time.
const SIDE_EFFECT_SKIP = /(scheduler|cron|websocket|wsServer|notificationBridge)/i;

/**
 * KNOWN-BROKEN imports (pre-existing, NOT mounted anywhere — dead code with
 * broken import paths). Verified by grep: nothing imports these files, so the
 * running backend is unaffected. Remove an entry here once the file is fixed
 * or deleted.
 *
 *  - shareProgressController/-Routes → imports ../../../../Employee_Main/... (off-by-one
 *    path: escapes the repo and points at new-vendordash/Employee_Main which does not exist)
 *  - controllers/mfaController.js   → imports models/DynamoVendor.js (missing)
 *  - auth/googleAuth.js             → imports models/GoogleUser (missing)
 */
const KNOWN_BROKEN = new Set([
  'modules/workspace/controllers/shareProgressController.js',
  'modules/workspace/routes/shareProgressRoutes.js',
  'controllers/mfaController.js',
  'auth/googleAuth.js',
]);

const collectFiles = (dir) => {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.js'))
    .map((f) => path.join(abs, f))
    .filter((f) => !f.includes('node_modules'))
    // Skip test files that live inside module trees — importing them would run
    // their tests as a side effect instead of checking production code.
    .filter((f) => !/[\\/](tests?|__tests__)[\\/]/.test(f));
};

test('every backend module imports without errors', async () => {
  const files = SCAN_DIRS.flatMap(collectFiles);
  assert.ok(files.length > 50, `expected to find backend files, found ${files.length}`);

  const failures = [];
  let imported = 0;
  let skipped = 0;
  let knownBroken = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const relNorm = rel.split(path.sep).join('/');
    if (SIDE_EFFECT_SKIP.test(rel)) {
      skipped++;
      continue;
    }
    if (KNOWN_BROKEN.has(relNorm)) {
      knownBroken++;
      continue;
    }
    try {
      await import(pathToFileURL(file).href);
      imported++;
    } catch (err) {
      failures.push(`${rel} → ${err.code || err.name}: ${err.message}`);
    }
  }

  console.log(`[importSmoke] imported ${imported} files · skipped ${skipped} side-effect files · ${knownBroken} known-broken (dead code) · ${failures.length} failures`);
  assert.equal(failures.length, 0, `files failed to import:\n${failures.join('\n')}`);
});
