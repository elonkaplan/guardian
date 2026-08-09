/**
 * Shared plumbing for the 011-demo-seed-fixtures acceptance run.
 *
 * Auth, top-up and psql access are lifted verbatim from `verify-008.mjs` rather
 * than reinvented — the same way 007's seller/settlement scripts share theirs.
 *
 * ⚠️ Everything built on this SPENDS REAL RESOURCES: `registerAgent` and
 * `openDeal` transactions on Monad from the operator/buyer keys, and Anthropic
 * calls for every run that is NOT a seeded fixture. The fixtures themselves are
 * free — that is the point of them — but §9's stranger-input checks are live by
 * design and each one is a genuine model call.
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { execFileSync } from 'node:child_process';

export const API = 'http://localhost:3000';

/**
 * Straight into Postgres via the container, not `docker compose exec`.
 *
 * Compose derives its project name from the directory, and this repo has been
 * bitten once by two working copies colliding on the same project name. Naming
 * the container removes the ambiguity and cannot recreate anything.
 */
export const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', 'api-postgres-1', 'psql', '-U', 'postgres', '-d', 'guardian', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();

let pass = 0;
let fail = 0;
const failures = [];

export const ok = (c, label, extra = '') => {
  if (c) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ❌ ${label}${extra && ' — ' + extra}`);
  }
  return c;
};

export const note = (s) => console.log(`  ℹ️  ${s}`);
export const h = (s) => console.log(`\n${s}`);

export const summary = () => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nfailed:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  return fail;
};

export const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  let text = null;
  try {
    text = await r.text();
    j = JSON.parse(text);
  } catch {}
  return { status: r.status, body: j, text };
};

export const signIn = async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const nonce = await api('/auth/nonce', { method: 'POST', body: { address: acct.address } });
  const signature = await acct.signMessage({ message: nonce.body.message });
  const verify = await api('/auth/verify', {
    method: 'POST',
    body: { address: acct.address, signature },
  });
  return { acct, token: verify.body.token };
};

export const topUp = async (token, amountMinor) =>
  api('/topup', { method: 'POST', body: { amountMinor }, token });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll an order until it leaves `purchased`/`running`.
 *
 * Timeout is generous: a live model call is the slow part, and a fixture that
 * has to fall through to one is exactly the case we most want to observe rather
 * than time out on.
 */
export const awaitTerminal = async (token, orderId, timeoutMs = 180_000) => {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    const got = await api(`/orders/${orderId}`, { token });
    last = got.body;
    const state = last?.state;
    if (state && state !== 'purchased' && state !== 'running') {
      return { order: last, elapsedMs: Date.now() - start };
    }
    await sleep(1000);
  }
  return { order: last, elapsedMs: Date.now() - start, timedOut: true };
};

/**
 * Poll for a verdict. Guardian audits on its own poller, so the verdict lands
 * some seconds after the complaint rather than in its response.
 */
export const awaitVerdict = async (token, orderId, timeoutMs = 180_000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const got = await api(`/orders/${orderId}/verdict`, { token });
    if (got.status === 200 && got.body?.tier) {
      return { verdict: got.body, elapsedMs: Date.now() - start };
    }
    await sleep(2000);
  }
  return { verdict: null, elapsedMs: Date.now() - start, timedOut: true };
};

export const seed = () => api('/demo/seed', { method: 'POST' });
export const reset = () => api('/demo/reset', { method: 'POST' });

/** Buy one fixture verbatim from the seed response — never a retyped copy. */
export const buyFixture = async (token, fixture) =>
  api('/orders', {
    method: 'POST',
    token,
    body: {
      agentId: fixture.agentId,
      input: fixture.input,
      acceptanceCriteria: fixture.acceptanceCriteria,
    },
  });
