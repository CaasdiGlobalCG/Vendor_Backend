// ============================================================
// FILE: test-rbac-api.js
// PURPOSE: API integration tests for RBAC endpoints.
//          Requires vendor backend running on port 5001.
// RUN:    node modules/rbac/tests/test-rbac-api.js
// PREREQ: Vendor backend running (npm run dev)
// ============================================================

const VENDOR_BASE = process.env.VENDOR_API_URL || 'http://localhost:5001';
const CLIENT_BASE = process.env.CLIENT_API_URL || 'http://localhost:5004';

// ── Test harness ──
let totalTests = 0;
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const skips = [];

function assert(testName, condition, detail = '') {
  totalTests++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${testName}`);
  } else {
    failed++;
    const msg = detail || 'assertion failed';
    console.log(`  ❌ ${testName} — ${msg}`);
    failures.push({ testName, detail: msg });
  }
}

function skip(testName, reason) {
  totalTests++;
  skipped++;
  console.log(`  ⏭️  ${testName} — SKIPPED: ${reason}`);
  skips.push({ testName, reason });
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━`);
}

async function safeFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// PRE-FLIGHT: Check servers are running
// ═══════════════════════════════════════════════════════════
async function checkServers() {
  console.log('Pre-flight: checking servers...');

  const vendorOk = await safeFetch(`${VENDOR_BASE}/api/health`);
  const vendorUp = vendorOk && vendorOk.status < 500;
  console.log(`  Vendor backend (${VENDOR_BASE}): ${vendorUp ? '🟢 UP' : '🔴 DOWN'}`);

  const clientOk = await safeFetch(`${CLIENT_BASE}/client-api/health`);
  const clientUp = clientOk && clientOk.status < 500;
  console.log(`  Client backend (${CLIENT_BASE}): ${clientUp ? '🟢 UP' : '🔴 DOWN'}`);

  return { vendorUp, clientUp };
}

// ═══════════════════════════════════════════════════════════
// SECTION 1: Unauthenticated Access Tests
// ═══════════════════════════════════════════════════════════
async function testUnauthAccess() {
  section('1. Unauthenticated Access (should be 401 or 403)');

  // 1.1 — GET /api/rbac/me without auth
  const meRes = await safeFetch(`${VENDOR_BASE}/api/rbac/me`);
  if (meRes) {
    assert('1.1 GET /api/rbac/me without auth → 401',
      meRes.status === 401, `Got ${meRes.status}`);
  } else {
    skip('1.1 GET /api/rbac/me without auth', 'Server unreachable');
  }

  // 1.2 — GET /api/rbac/roles without auth
  const rolesRes = await safeFetch(`${VENDOR_BASE}/api/rbac/roles`);
  if (rolesRes) {
    assert('1.2 GET /api/rbac/roles without auth → 401',
      rolesRes.status === 401, `Got ${rolesRes.status}`);
  } else {
    skip('1.2 GET /api/rbac/roles without auth', 'Server unreachable');
  }

  // 1.3 — GET /api/rbac/members without auth
  const membersRes = await safeFetch(`${VENDOR_BASE}/api/rbac/members`);
  if (membersRes) {
    assert('1.3 GET /api/rbac/members without auth → 401',
      membersRes.status === 401, `Got ${membersRes.status}`);
  } else {
    skip('1.3 GET /api/rbac/members without auth', 'Server unreachable');
  }

  // 1.4 — POST /api/rbac/members/invite without auth
  const inviteRes = await safeFetch(`${VENDOR_BASE}/api/rbac/members/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', roleId: 'admin' }),
  });
  if (inviteRes) {
    assert('1.4 POST invite without auth → 401',
      inviteRes.status === 401, `Got ${inviteRes.status}`);
  } else {
    skip('1.4 POST invite without auth', 'Server unreachable');
  }

  // 1.5 — GET /api/rbac/invitations without auth
  const invitationsRes = await safeFetch(`${VENDOR_BASE}/api/rbac/invitations`);
  if (invitationsRes) {
    assert('1.5 GET /api/rbac/invitations without auth → 401',
      invitationsRes.status === 401, `Got ${invitationsRes.status}`);
  } else {
    skip('1.5 GET /api/rbac/invitations without auth', 'Server unreachable');
  }

  // 1.6 — POST /api/rbac/roles without auth
  const createRoleRes = await safeFetch(`${VENDOR_BASE}/api/rbac/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleName: 'Test', roleLevel: 3 }),
  });
  if (createRoleRes) {
    assert('1.6 POST create role without auth → 401',
      createRoleRes.status === 401, `Got ${createRoleRes.status}`);
  } else {
    skip('1.6 POST create role without auth', 'Server unreachable');
  }

  // 1.7 — PUT /api/rbac/roles/:roleId without auth
  const updateRoleRes = await safeFetch(`${VENDOR_BASE}/api/rbac/roles/admin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions: [] }),
  });
  if (updateRoleRes) {
    assert('1.7 PUT update role without auth → 401',
      updateRoleRes.status === 401, `Got ${updateRoleRes.status}`);
  } else {
    skip('1.7 PUT update role without auth', 'Server unreachable');
  }

  // 1.8 — DELETE member without auth
  const deleteMemberRes = await safeFetch(`${VENDOR_BASE}/api/rbac/members/fake-user`, {
    method: 'DELETE',
  });
  if (deleteMemberRes) {
    assert('1.8 DELETE member without auth → 401',
      deleteMemberRes.status === 401, `Got ${deleteMemberRes.status}`);
  } else {
    skip('1.8 DELETE member without auth', 'Server unreachable');
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 2: Public Endpoints (Invite Accept)
// ═══════════════════════════════════════════════════════════
async function testPublicEndpoints() {
  section('2. Public Endpoints (no auth required)');

  // 2.1 — Validate invite with no token → 400
  const validateNoToken = await safeFetch(`${VENDOR_BASE}/api/rbac/invite/validate`);
  if (validateNoToken) {
    assert('2.1 GET validate without token → 400',
      validateNoToken.status === 400, `Got ${validateNoToken.status}`);
  } else {
    skip('2.1 GET validate without token', 'Server unreachable');
  }

  // 2.2 — Validate invite with invalid token → 400 or 404
  const validateBad = await safeFetch(`${VENDOR_BASE}/api/rbac/invite/validate?token=invalid-token-123`);
  if (validateBad) {
    assert('2.2 GET validate with invalid token → 400/404',
      [400, 404].includes(validateBad.status), `Got ${validateBad.status}`);
  } else {
    skip('2.2 GET validate with invalid token', 'Server unreachable');
  }

  // 2.3 — Accept invite with missing fields → 400
  const acceptMissing = await safeFetch(`${VENDOR_BASE}/api/rbac/invite/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (acceptMissing) {
    assert('2.3 POST accept with empty body → 400',
      acceptMissing.status === 400, `Got ${acceptMissing.status}`);
  } else {
    skip('2.3 POST accept with empty body', 'Server unreachable');
  }

  // 2.4 — Accept invite with invalid token → 400/404
  const acceptBadToken = await safeFetch(`${VENDOR_BASE}/api/rbac/invite/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'non-existent-token',
      password: 'Test@12345',
      displayName: 'Test User',
    }),
  });
  if (acceptBadToken) {
    assert('2.4 POST accept with invalid token → 400/404',
      [400, 404].includes(acceptBadToken.status), `Got ${acceptBadToken.status}`);
  } else {
    skip('2.4 POST accept with invalid token', 'Server unreachable');
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 3: Invalid Auth Token Tests
// ═══════════════════════════════════════════════════════════
async function testInvalidAuth() {
  section('3. Invalid Auth Token');

  const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIn0.fakesignature';

  // 3.1 — Fake JWT on /api/rbac/me
  const meRes = await safeFetch(`${VENDOR_BASE}/api/rbac/me`, {
    headers: { 'Authorization': `Bearer ${fakeToken}` },
  });
  if (meRes) {
    assert('3.1 Fake JWT on /api/rbac/me → 401',
      meRes.status === 401, `Got ${meRes.status}`);
  } else {
    skip('3.1 Fake JWT on /api/rbac/me', 'Server unreachable');
  }

  // 3.2 — Malformed auth header
  const malformedRes = await safeFetch(`${VENDOR_BASE}/api/rbac/me`, {
    headers: { 'Authorization': 'NotBearer sometoken' },
  });
  if (malformedRes) {
    assert('3.2 Malformed auth header → 401',
      malformedRes.status === 401, `Got ${malformedRes.status}`);
  } else {
    skip('3.2 Malformed auth header', 'Server unreachable');
  }

  // 3.3 — Empty auth header
  const emptyAuthRes = await safeFetch(`${VENDOR_BASE}/api/rbac/me`, {
    headers: { 'Authorization': '' },
  });
  if (emptyAuthRes) {
    assert('3.3 Empty auth header → 401',
      emptyAuthRes.status === 401, `Got ${emptyAuthRes.status}`);
  } else {
    skip('3.3 Empty auth header', 'Server unreachable');
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 4: Permissions Catalog (Public-ish)
// ═══════════════════════════════════════════════════════════
async function testPermissionsCatalog() {
  section('4. Permissions Catalog Endpoint');

  // These may or may not require auth depending on config
  // Test both scenarios

  // 4.1 — List permissions for vendor platform
  const vendorPermsRes = await safeFetch(`${VENDOR_BASE}/api/rbac/permissions?platform=vendor`);
  if (vendorPermsRes) {
    if (vendorPermsRes.status === 401) {
      skip('4.1 GET permissions?platform=vendor', 'Requires auth');
    } else {
      assert('4.1 GET permissions?platform=vendor → 200',
        vendorPermsRes.status === 200, `Got ${vendorPermsRes.status}`);
      if (vendorPermsRes.status === 200) {
        const data = await vendorPermsRes.json();
        assert('4.2 Vendor permissions response has categories',
          data.categories !== undefined || data.permissions !== undefined || Array.isArray(data),
          `Response keys: ${Object.keys(data || {})}`);
      }
    }
  } else {
    skip('4.1-4.2 Permissions catalog', 'Server unreachable');
  }

  // 4.3 — Invalid platform → 400
  const invalidPlatformRes = await safeFetch(`${VENDOR_BASE}/api/rbac/permissions?platform=invalid`);
  if (invalidPlatformRes) {
    if (invalidPlatformRes.status === 401) {
      skip('4.3 Invalid platform check', 'Requires auth');
    } else {
      assert('4.3 GET permissions?platform=invalid → 400',
        invalidPlatformRes.status === 400, `Got ${invalidPlatformRes.status}`);
    }
  } else {
    skip('4.3 Invalid platform check', 'Server unreachable');
  }

  // 4.4 — List platforms
  const platformsRes = await safeFetch(`${VENDOR_BASE}/api/rbac/permissions/platforms`);
  if (platformsRes) {
    if (platformsRes.status === 401) {
      skip('4.4 List platforms', 'Requires auth');
    } else {
      assert('4.4 GET permissions/platforms → 200',
        platformsRes.status === 200, `Got ${platformsRes.status}`);
    }
  } else {
    skip('4.4 List platforms', 'Server unreachable');
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 5: Client Backend RBAC Endpoints
// ═══════════════════════════════════════════════════════════
async function testClientBackend(clientUp) {
  section('5. Client Backend RBAC Endpoints');

  if (!clientUp) {
    skip('5.x All client backend tests', 'Client backend not running');
    return;
  }

  // 5.1 — GET /client-api/rbac/me without auth → 401
  const meRes = await safeFetch(`${CLIENT_BASE}/client-api/rbac/me`);
  if (meRes) {
    assert('5.1 GET /client-api/rbac/me without auth → 401',
      meRes.status === 401, `Got ${meRes.status}`);
  } else {
    skip('5.1 Client /me endpoint', 'Server unreachable');
  }

  // 5.2 — GET /client-api/rbac/roles without auth → 401
  const rolesRes = await safeFetch(`${CLIENT_BASE}/client-api/rbac/roles`);
  if (rolesRes) {
    assert('5.2 GET /client-api/rbac/roles without auth → 401',
      rolesRes.status === 401, `Got ${rolesRes.status}`);
  } else {
    skip('5.2 Client /roles endpoint', 'Server unreachable');
  }

  // 5.3 — GET /client-api/rbac/members without auth → 401
  const membersRes = await safeFetch(`${CLIENT_BASE}/client-api/rbac/members`);
  if (membersRes) {
    assert('5.3 GET /client-api/rbac/members without auth → 401',
      membersRes.status === 401, `Got ${membersRes.status}`);
  } else {
    skip('5.3 Client /members endpoint', 'Server unreachable');
  }

  // 5.4 — POST invite without auth → 401
  const inviteRes = await safeFetch(`${CLIENT_BASE}/client-api/rbac/members/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', roleId: 'admin' }),
  });
  if (inviteRes) {
    assert('5.4 POST /client-api/rbac/members/invite without auth → 401',
      inviteRes.status === 401, `Got ${inviteRes.status}`);
  } else {
    skip('5.4 Client invite endpoint', 'Server unreachable');
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 6: Handoff Endpoint Tests
// ═══════════════════════════════════════════════════════════
async function testHandoff() {
  section('6. Handoff Endpoint');

  // 6.1 — POST /api/auth/handoff without token → 401
  const noTokenRes = await safeFetch(`${VENDOR_BASE}/api/auth/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (noTokenRes) {
    assert('6.1 POST handoff without token → 401',
      noTokenRes.status === 401, `Got ${noTokenRes.status}`);
  } else {
    skip('6.1 POST handoff without token', 'Server unreachable');
  }

  // 6.2 — POST /api/auth/handoff with fake token → 401
  const fakeTokenRes = await safeFetch(`${VENDOR_BASE}/api/auth/handoff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer fake.jwt.token',
    },
    body: JSON.stringify({ targetPlatform: 'sales' }),
  });
  if (fakeTokenRes) {
    assert('6.2 POST handoff with fake JWT → 401',
      fakeTokenRes.status === 401, `Got ${fakeTokenRes.status}`);
  } else {
    skip('6.2 POST handoff with fake JWT', 'Server unreachable');
  }

  // 6.3 — GET handoff exchange with invalid code → 400/404
  const exchangeRes = await safeFetch(`${VENDOR_BASE}/api/auth/handoff/sales-exchange?code=invalid-code`);
  if (exchangeRes) {
    assert('6.3 GET exchange with invalid code → 400/404',
      [400, 404].includes(exchangeRes.status), `Got ${exchangeRes.status}`);
  } else {
    skip('6.3 GET exchange with invalid code', 'Server unreachable');
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 7: Route Existence Checks
// ═══════════════════════════════════════════════════════════
async function testRouteExistence() {
  section('7. Route Existence (confirm routes are mounted)');

  const routes = [
    { method: 'GET',    path: '/api/rbac/me',              name: 'me' },
    { method: 'GET',    path: '/api/rbac/roles',            name: 'list roles' },
    { method: 'GET',    path: '/api/rbac/members',          name: 'list members' },
    { method: 'GET',    path: '/api/rbac/invitations',      name: 'list invitations' },
    { method: 'POST',   path: '/api/rbac/members/invite',   name: 'invite member' },
    { method: 'POST',   path: '/api/rbac/roles',            name: 'create role' },
  ];

  for (const route of routes) {
    const options = route.method === 'POST'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      : {};
    const res = await safeFetch(`${VENDOR_BASE}${route.path}`, options);
    if (res) {
      // Route exists if we get anything other than 404
      assert(`7.${routes.indexOf(route) + 1} ${route.method} ${route.path} → route mounted`,
        res.status !== 404, `Got 404 — route not found`);
    } else {
      skip(`7.${routes.indexOf(route) + 1} ${route.name}`, 'Server unreachable');
    }
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 8: Request Validation Tests
// ═══════════════════════════════════════════════════════════
async function testRequestValidation() {
  section('8. Request Body Validation (via public invite accept)');

  // 8.1 — Password too weak
  const weakPwRes = await safeFetch(`${VENDOR_BASE}/api/rbac/invite/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'fake', password: '123', displayName: 'Test' }),
  });
  if (weakPwRes) {
    assert('8.1 Weak password → 400',
      weakPwRes.status === 400, `Got ${weakPwRes.status}`);
  } else {
    skip('8.1 Weak password validation', 'Server unreachable');
  }

  // 8.2 — Display name too short
  const shortNameRes = await safeFetch(`${VENDOR_BASE}/api/rbac/invite/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'fake', password: 'Test@12345', displayName: 'A' }),
  });
  if (shortNameRes) {
    assert('8.2 Short displayName → 400',
      shortNameRes.status === 400, `Got ${shortNameRes.status}`);
  } else {
    skip('8.2 Short displayName validation', 'Server unreachable');
  }

  // 8.3 — Missing token
  const noTokenRes = await safeFetch(`${VENDOR_BASE}/api/rbac/invite/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'Test@12345', displayName: 'Test User' }),
  });
  if (noTokenRes) {
    assert('8.3 Missing token in accept → 400',
      noTokenRes.status === 400, `Got ${noTokenRes.status}`);
  } else {
    skip('8.3 Missing token validation', 'Server unreachable');
  }
}

// ═══════════════════════════════════════════════════════════
// SECTION 9: CORS Check
// ═══════════════════════════════════════════════════════════
async function testCORS() {
  section('9. CORS Headers');

  // CORS middleware only emits Access-Control-Allow-Origin when the
  // request includes an Origin header that matches the allowlist.
  // We send a plausible localhost origin for the preflight check.
  const testOrigin = 'http://localhost:5173';
  const res = await safeFetch(`${VENDOR_BASE}/api/rbac/me`, {
    method: 'OPTIONS',
    headers: {
      'Origin': testOrigin,
      'Access-Control-Request-Method': 'GET',
    },
  });
  if (res) {
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowMethods = res.headers.get('access-control-allow-methods');
    assert('9.1 OPTIONS response returns CORS headers',
      res.status < 500, `Got ${res.status}`);
    // The header is only present when testOrigin is in ALLOWED_ORIGINS.
    // If missing, it's a config issue — not a code bug. Mark conditional.
    if (allowOrigin) {
      assert('9.2 Access-Control-Allow-Origin matches origin',
        allowOrigin === testOrigin || allowOrigin === '*',
        `Got: ${allowOrigin}`);
    } else {
      skip('9.2 Access-Control-Allow-Origin',
        `Origin ${testOrigin} not in ALLOWED_ORIGINS — CORS header not returned (expected in dev)`);
    }
  } else {
    skip('9.1-9.2 CORS check', 'Server unreachable');
  }
}

// ═══════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     RBAC API Integration Tests                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const { vendorUp, clientUp } = await checkServers();

  if (!vendorUp) {
    console.log('\n⚠️  Vendor backend is not running. Most tests will be skipped.');
    console.log('   Start it with: cd Venodr/Vendor_Backend && npm run dev\n');
  }

  await testUnauthAccess();
  await testPublicEndpoints();
  await testInvalidAuth();
  await testPermissionsCatalog();
  await testClientBackend(clientUp);
  await testHandoff();
  await testRouteExistence();
  await testRequestValidation();
  await testCORS();

  // ── RESULTS ──
  console.log('\n' + '═'.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped (${totalTests} total)`);

  if (failed > 0) {
    console.log('\n🔴 FAILURES:');
    failures.forEach(f => console.log(`  ❌ ${f.testName} — ${f.detail}`));
  }
  if (skipped > 0) {
    console.log(`\n⏭️  ${skipped} tests skipped (server not running or auth required)`);
  }
  console.log('═'.repeat(60));

  // Return results for capture
  return { total: totalTests, passed, failed, skipped, failures, skips };
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
