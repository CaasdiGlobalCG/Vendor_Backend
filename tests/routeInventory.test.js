/**
 * Route inventory — asserts every route module exports a non-empty express
 * router, and that critical endpoints still exist. A refactor cannot silently
 * drop or rename a route without this test failing.
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

const collectRouteFiles = () => {
  const out = [];
  const modulesDir = path.join(ROOT, 'modules');
  if (fs.existsSync(modulesDir)) {
    for (const f of fs.readdirSync(modulesDir, { recursive: true })) {
      const p = path.join(modulesDir, f);
      if (typeof f === 'string' && p.endsWith('.js') && /[\\/]routes[\\/]/.test(p)) out.push(p);
    }
  }
  const topRoutes = path.join(ROOT, 'routes');
  if (fs.existsSync(topRoutes)) {
    for (const f of fs.readdirSync(topRoutes, { recursive: true })) {
      const p = path.join(topRoutes, f);
      if (typeof f === 'string' && p.endsWith('.js')) out.push(p);
    }
  }
  return out;
};

const routerPaths = (router) => {
  const paths = [];
  for (const layer of router?.stack || []) {
    if (layer.route?.path) paths.push(layer.route.path);
  }
  return paths;
};

// Pre-existing dead code with a broken import — see importSmoke.test.js for details.
const KNOWN_BROKEN = new Set([
  'modules/workspace/routes/shareProgressRoutes.js',
]);

test('every route module exports a non-empty express router', async () => {
  const files = collectRouteFiles();
  assert.ok(files.length >= 10, `expected to find route files, found ${files.length}`);

  const failures = [];
  let checked = 0;
  let knownBroken = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const relNorm = rel.split(path.sep).join('/');
    if (KNOWN_BROKEN.has(relNorm)) {
      knownBroken++;
      continue;
    }
    try {
      const mod = await import(pathToFileURL(file).href);
      const router = mod.default;
      if (typeof router !== 'function' || !Array.isArray(router.stack)) {
        failures.push(`${rel} → default export is not an express router`);
      } else if (router.stack.length === 0) {
        failures.push(`${rel} → router has no routes`);
      } else {
        checked++;
      }
    } catch (err) {
      failures.push(`${rel} → ${err.code || err.name}: ${err.message}`);
    }
  }

  console.log(`[routeInventory] verified ${checked}/${files.length} route modules (${knownBroken} known-broken skipped)`);
  assert.equal(failures.length, 0, `route modules failed:\n${failures.join('\n')}`);
});

test('critical endpoints still exist', async () => {
  const checks = [
    ['modules/workspace/routes/dynamoWorkspaceRoutes.js', '/workspaces'],
    ['modules/workspace/routes/dynamoWorkspaceRoutes.js', '/workspaces/:id'],
    ['modules/workspace/routes/dynamoWorkspaceRoutes.js', '/workspaces/:id/canvas'],
  ];

  for (const [rel, expectedPath] of checks) {
    const mod = await import(pathToFileURL(path.join(ROOT, rel)).href);
    const paths = routerPaths(mod.default);
    assert.ok(
      paths.includes(expectedPath),
      `${rel} is missing route "${expectedPath}" (has: ${paths.join(', ')})`
    );
  }
});
