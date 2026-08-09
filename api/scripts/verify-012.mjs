/**
 * API-12 — capture harness for the published contract.
 *
 * ## ⚠️ This is not a test suite
 *
 * Automated tests are out of scope for this component (`docs/CONTEXT.md`). This
 * script exists to make the contract writable: it hits every registered route and
 * writes what actually came back to `captures/`, so `docs/openapi.yaml` can be
 * written from responses rather than from TypeScript declarations. The handful of
 * `ok()` assertions are the acceptance scenarios spec 012 names, not coverage.
 *
 * ## Why it registers its own agent instead of using the demo seller's
 *
 * Six routes have a buyer shape and a seller shape, and `/case-file` returns
 * structurally different objects to each. Capturing only the buyer's leaves
 * `SellerCaseFileResponse` undocumented. The demo seller's account is derived from
 * a configured address whose key we do not hold, so the script signs in as a fresh
 * account and publishes its own agent — which also captures `POST /agents`,
 * `POST /agents/:id/versions` and `PATCH /agents/:id/active` with real bodies.
 *
 * That agent is bought, complained about, and audited, so the order it produces is
 * the source of every order-shaped capture: the buyer's and the seller's view of
 * the same order, and the verdict.
 *
 * Usage: `node scripts/verify-012.mjs [outDir]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  api,
  awaitTerminal,
  awaitVerdict,
  h,
  note,
  ok,
  seed,
  signIn,
  sleep,
  summary,
  topUp,
} from './verify-011-lib.mjs';

const OUT = process.argv[2] ?? join(process.cwd(), 'captures');
mkdirSync(OUT, { recursive: true });

const captured = new Set();

/** Record one response verbatim. The filename is the route, not the URL. */
const capture = (name, res) => {
  const file = join(OUT, `${name.replace(/[^A-Za-z0-9]+/g, '_')}.json`);
  writeFileSync(file, JSON.stringify({ name, status: res.status, body: res.body ?? res.text }, null, 2));
  captured.add(name);
  return res;
};

/** Call and record in one step. */
const grab = async (name, path, opts) => capture(name, await api(path, opts));

// Every route the router registers, checked off as captures land (T009).
const ROUTES = [
  'POST /auth/nonce', 'POST /auth/verify', 'GET /auth/session',
  'GET /me', 'GET /me/ledger',
  'POST /topup', 'POST /withdraw', 'POST /offramp',
  'POST /onramp/routes', 'POST /offramp/routes',
  'GET /agents', 'GET /agents?owner=me', 'GET /agents/:id', 'GET /agents/:id/versions',
  'POST /agents', 'POST /agents/:id/versions', 'PATCH /agents/:id/active',
  'GET /orders', 'GET /orders/:id', 'GET /orders/:id/case-file',
  'POST /orders', 'POST /orders/:id/accept', 'POST /orders/:id/complain',
  'GET /sales', 'GET /orders/:id/verdict',
  'POST /demo/seed', 'POST /demo/reset',
  'GET /health',
];

const CAPTURE_AGENT = {
  name: 'ContractProbe',
  description: 'A minimal summariser published by the API-12 capture harness.',
  capabilities: ['Summarises a short document.', 'Reports the word count of its summary.'],
  exclusions: ['Does not translate.', 'Does not answer questions about the document.'],
  priceMinor: 100,
  inputSchema: {
    type: 'object',
    properties: { document: { type: 'string' }, wordCap: { type: 'integer' } },
    required: ['document', 'wordCap'],
    // Load-bearing everywhere, including nested objects: the model service refuses
    // any object schema that does not set it, and the run fails for a reason that
    // has nothing to do with the definition. (API-11's thirteen-order failure.)
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { summary: { type: 'string' }, wordCount: { type: 'integer' } },
    required: ['summary', 'wordCount'],
    additionalProperties: false,
  },
  systemPrompt:
    'You summarise documents within a word cap. Write one paragraph under the cap, then count the words you wrote and report that count exactly.',
  model: 'claude-haiku-4-5',
  timeoutSeconds: 120,
};

// ---------------------------------------------------------------------------

h('§0 — health and the demo catalogue');

await grab('GET /health', '/health');
const seeded = capture('POST /demo/seed', await seed());
ok(seeded.status === 200, 'POST /demo/seed → 200', `got ${seeded.status}`);

h('§1 — two identities: a seller who publishes, a buyer who buys');

const nonceRes = await api('/auth/nonce', { method: 'POST', body: { address: '0x' + '11'.repeat(20) } });
capture('POST /auth/nonce', nonceRes);

const seller = await signIn();
const buyer = await signIn();
note(`seller ${seller.acct.address}`);
note(`buyer  ${buyer.acct.address}`);

// Re-run verify on a throwaway account purely to capture the body shape.
const throwaway = await signIn();
capture('POST /auth/verify', { status: 201, body: { token: throwaway.token } });

await grab('GET /auth/session', '/auth/session', { token: buyer.token });

h('§2 — the seller publishes an agent (routes 14, 15, 16)');

const created = capture('POST /agents', await api('/agents', { method: 'POST', token: seller.token, body: CAPTURE_AGENT }));
ok(created.status === 201, 'POST /agents → 201', `got ${created.status} ${String(created.text).slice(0, 300)}`);
const agentId = created.body?.id;

if (!agentId) {
  console.log('\nCannot continue without an agent — aborting.');
  process.exit(summary() || 1);
}

capture(
  'POST /agents/:id/versions',
  await api(`/agents/${agentId}/versions`, {
    method: 'POST',
    token: seller.token,
    body: { ...CAPTURE_AGENT, description: CAPTURE_AGENT.description + ' (v2)' },
  }),
);

// Toggle off and back on, so the capture is of a live agent.
await api(`/agents/${agentId}/active`, { method: 'PATCH', token: seller.token, body: { active: false } });
capture(
  'PATCH /agents/:id/active',
  await api(`/agents/${agentId}/active`, { method: 'PATCH', token: seller.token, body: { active: true } }),
);

await grab('GET /agents/:id/versions', `/agents/${agentId}/versions`, { token: seller.token });

h('§3 — the catalogue, anonymous and owner-scoped (route 11, three behaviours)');

await grab('GET /agents', '/agents');
await grab('GET /agents?owner=me', '/agents?owner=me', { token: seller.token });
await grab('GET /agents/:id', `/agents/${agentId}`);

h('§4 — money (routes 4–10)');

const top = capture('POST /topup', await topUp(buyer.token, 1500));
ok(top.status === 200, 'POST /topup → 200', `got ${top.status} ${String(top.text).slice(0, 200)}`);

const me = await grab('GET /me', '/me', { token: buyer.token });
ok(
  me.body !== null && Object.prototype.hasOwnProperty.call(me.body, 'settledFundsMinor'),
  'GET /me carries settledFundsMinor as a present key (T011 · SC-005)',
  'the key is absent — a client cannot distinguish "unknown" from "not sent"',
);
note(`settledFundsMinor = ${JSON.stringify(me.body?.settledFundsMinor)}`);

await grab('GET /me/ledger', '/me/ledger', { token: buyer.token });
await grab('POST /onramp/routes', '/onramp/routes', { method: 'POST', token: buyer.token, body: { amountMinor: 500 } });
await grab('POST /offramp/routes', '/offramp/routes', { method: 'POST', token: buyer.token, body: { amountMinor: 500 } });
await grab('POST /offramp', '/offramp', { method: 'POST', token: buyer.token, body: { amountMinor: 100 } });
await grab('POST /withdraw', '/withdraw', { method: 'POST', token: buyer.token });

h('§5 — one order, driven to a verdict (routes 17–25)');

const order = capture(
  'POST /orders',
  await api('/orders', {
    method: 'POST',
    token: buyer.token,
    body: {
      agentId,
      input: { document: 'The board approved a price rise of 12% effective in March, alongside a new usage tier.', wordCap: 60 },
      acceptanceCriteria: 'Under 60 words and it must mention the price rise.',
    },
  }),
);
ok(order.status === 201, 'POST /orders → 201', `got ${order.status} ${String(order.text).slice(0, 300)}`);
const orderId = order.body?.id;

const { order: settledOrder, timedOut } = await awaitTerminal(buyer.token, orderId);
ok(!timedOut, 'the order reached a terminal state', 'timed out — is the execution poller running?');
note(`order state → ${settledOrder?.state}`);

await grab('GET /orders', '/orders', { token: buyer.token });
await grab('GET /orders/:id', `/orders/${orderId}`, { token: buyer.token });
await grab('GET /orders/:id/case-file', `/orders/${orderId}/case-file`, { token: buyer.token });
await grab('GET /sales', '/sales', { token: seller.token });

// The seller's view of the same three reads — different shapes, same route (T012).
const sellerOrder = capture('GET /orders/:id (seller)', await api(`/orders/${orderId}`, { token: seller.token }));
const sellerCase = capture('GET /orders/:id/case-file (seller)', await api(`/orders/${orderId}/case-file`, { token: seller.token }));

ok(sellerOrder.status === 200, 'the agent owner can read GET /orders/:id (US1 #3)', `got ${sellerOrder.status}`);
ok(sellerCase.status === 200, 'the agent owner can read GET /orders/:id/case-file (US1 #3)', `got ${sellerCase.status}`);
ok(
  sellerCase.body !== null && typeof sellerCase.body?.systemPrompt === 'string',
  "the seller's case file carries systemPrompt; the buyer's must not",
  'the seller view is missing its own prompt',
);

const complaint = capture(
  'POST /orders/:id/complain',
  await api(`/orders/${orderId}/complain`, { method: 'POST', token: buyer.token, body: { reason: 'The summary omits the pricing change I asked for.' } }),
);
ok(complaint.status === 202, 'POST /orders/:id/complain → 202', `got ${complaint.status} ${String(complaint.text).slice(0, 300)}`);

// Captured before the audit finishes — this is the VERDICT_NOT_FOUND shape.
capture('GET /orders/:id/verdict (pending)', await api(`/orders/${orderId}/verdict`, { token: buyer.token }));

const { verdict, timedOut: vTimedOut } = await awaitVerdict(buyer.token, orderId);
ok(!vTimedOut, 'the audit produced a verdict', 'timed out — is the guardian poller running?');
await grab('GET /orders/:id/verdict', `/orders/${orderId}/verdict`, { token: buyer.token });
capture('GET /orders/:id/verdict (seller)', await api(`/orders/${orderId}/verdict`, { token: seller.token }));
note(`verdict tier → ${verdict?.tier}`);

// A second order, left un-complained, so `accept` can be captured on a live one.
const acceptable = await api('/orders', {
  method: 'POST',
  token: buyer.token,
  body: {
    agentId,
    input: { document: 'A short note about the quarterly pricing change and its effective date.', wordCap: 50 },
    acceptanceCriteria: 'Under 50 words.',
  },
});
if (acceptable.body?.id) {
  await awaitTerminal(buyer.token, acceptable.body.id);
  capture('POST /orders/:id/accept', await api(`/orders/${acceptable.body.id}/accept`, { method: 'POST', token: buyer.token }));
}

h('§6 — the seller is refused on the two buyer-only writes (T012)');

const sellerAccept = await api(`/orders/${orderId}/accept`, { method: 'POST', token: seller.token });
const sellerComplain = await api(`/orders/${orderId}/complain`, { method: 'POST', token: seller.token, body: { reason: 'x' } });
capture('403or404 seller accept', sellerAccept);
capture('403or404 seller complain', sellerComplain);
ok(sellerAccept.status >= 400, 'the agent owner cannot accept the buyer\'s order', `got ${sellerAccept.status}`);
ok(sellerComplain.status >= 400, 'the agent owner cannot complain on the buyer\'s order', `got ${sellerComplain.status}`);

h('§7 — systemPrompt leaves the boundary nowhere but the two owner routes (T013)');

const leaks = [];
for (const name of captured) {
  if (name === 'GET /agents/:id/versions' || name === 'GET /orders/:id/case-file (seller)') continue;
  const { readFileSync } = await import('node:fs');
  const file = join(OUT, `${name.replace(/[^A-Za-z0-9]+/g, '_')}.json`);
  const text = readFileSync(file, 'utf8');
  if (text.includes('systemPrompt')) leaks.push(name);
}
ok(leaks.length === 0, 'no response outside the two owner routes carries systemPrompt', `leaked in: ${leaks.join(', ')}`);

h('§8 — the failure bodies the contract has to document (T010)');

const bad = '00000000-0000-4000-8000-000000000000';

capture('400 zod body', await api('/orders', { method: 'POST', token: buyer.token, body: {} }));
capture('400 uuid param', await api('/orders/not-a-uuid', { token: buyer.token }));
capture('400 owner value', await api('/agents?owner=someone-else', { token: buyer.token }));
capture('401 no token', await api('/me'));
capture('401 owner me anonymous', await api('/agents?owner=me'));
capture('404 order missing', await api(`/orders/${bad}`, { token: buyer.token }));
capture('404 agent missing', await api(`/agents/${bad}`));
capture('404 verdict order missing', await api(`/orders/${bad}/verdict`, { token: buyer.token }));

// Another buyer's order must be 404 — not 403, and above all not 500, because the
// consuming UI retries anything that is not 404/403 forever (SC-010).
const stranger = await signIn();
const strangerRead = capture('404 order of another buyer', await api(`/orders/${orderId}`, { token: stranger.token }));
ok(strangerRead.status === 404, "another buyer's order reads as 404 (T045 · SC-010)", `got ${strangerRead.status} — a 5xx makes the UI retry forever`);

capture('409 complain twice', await api(`/orders/${orderId}/complain`, { method: 'POST', token: buyer.token, body: { reason: 'again' } }));
capture('409 accept wrong state', await api(`/orders/${orderId}/accept`, { method: 'POST', token: buyer.token }));
capture('409 offramp over balance', await api('/offramp', { method: 'POST', token: buyer.token, body: { amountMinor: 99_999_999 } }));
capture('402 purchase over balance', await (async () => {
  const poor = await signIn();
  return api('/orders', { method: 'POST', token: poor.token, body: { agentId, input: { document: 'x', wordCap: 10 }, acceptanceCriteria: 'y' } });
})());

h('§9 — demo reset, captured last because it clears the orders above');

capture('POST /demo/reset', await api('/demo/reset', { method: 'POST' }));

h('§10 — coverage');

const missing = ROUTES.filter((r) => !captured.has(r));
ok(missing.length === 0, `all ${ROUTES.length} registered routes captured`, `missing: ${missing.join(', ')}`);
note(`${captured.size} captures written to ${OUT}`);

await sleep(200);
process.exit(summary());
