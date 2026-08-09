/**
 * Acceptance run for specs/007-orders-purchase-saga/quickstart.md — the purchase
 * saga, end to end, against the live escrow and a real Postgres.
 *
 *   node scripts/verify-007.mjs
 *
 * ⚠️ This SPENDS REAL TESTNET FUNDS. It tops up, buys an agent, and leaves the
 * money in escrow — every run is a real `openDeal` and the gas is charged at the
 * LIMIT (Monad charges the limit, not the usage).
 *
 * It lives in `scripts/` for the reason `verify-005.mjs` does: there are no
 * automated tests in this component by design (`docs/CONTEXT.md`), so the manual
 * verification is a script you run and read. It is the executable form of
 * quickstart.md §3, §5, §7 and §11.
 *
 * NOT covered here, and deliberately:
 *   - §4, the forced chain failure. It needs the API restarted against a dead
 *     RPC host, which is a process-level change this script cannot make from
 *     inside. Run it by hand; it is the headline criterion.
 *   - §4's unknown-outcome branch (U1-U5). Needs RECEIPT_TIMEOUT_MS=1 and a
 *     restart, same reason.
 *   - §6, §9, §10 — accept, complain and Act 3 all need a `delivered` order, and
 *     execution (API-08) does not exist. Reaching them means hand-editing the
 *     order row AND calling markDelivered on-chain, which is a rehearsal step
 *     rather than a script.
 *
 * Requires the API on :3000 and the Postgres container up.
 */
import { createPublicClient, http } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('../.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const API = 'http://localhost:3000';
const pub = createPublicClient({ transport: http(env.MONAD_RPC_URL) });

const escrowAbi = [
  {
    type: 'function',
    name: 'totalEscrowed',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
];
const totalEscrowed = () =>
  pub.readContract({
    address: env.ESCROW_CONTRACT_ADDRESS,
    abi: escrowAbi,
    functionName: 'totalEscrowed',
  });

let pass = 0,
  fail = 0;
const ok = (c, label, extra = '') =>
  c
    ? (pass++, console.log(`  ✅ ${label}${extra && ' — ' + extra}`))
    : (fail++, console.log(`  ❌ ${label}${extra && ' — ' + extra}`));
const h = (s) => console.log(`\n${s}`);

const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try {
    j = await r.json();
  } catch {}
  return { status: r.status, body: j };
};

const signIn = async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const nonce = await api('/auth/nonce', { method: 'POST', body: { address: acct.address } });
  const signature = await acct.signMessage({ message: nonce.body.message });
  const verify = await api('/auth/verify', {
    method: 'POST',
    body: { address: acct.address, signature },
  });
  return { acct, token: verify.body.token };
};

// ---------- two wallets: a buyer, and a stranger who is party to nothing ----------
const buyer = await signIn();
const stranger = await signIn();
console.log(`buyer    ${buyer.acct.address}\nstranger ${stranger.acct.address}`);

// ---------- the agent to buy ----------
const agents = await api('/agents');
const agent = agents.body?.[0];
if (!agent) {
  console.log('\nNo agents listed. Seed the catalogue first (006 quickstart §1).');
  process.exit(1);
}
console.log(`agent    ${agent.name} (${agent.id}) at ${agent.priceMinor}¢`);

const detail = await api(`/agents/${agent.id}`);
const inputSchema = detail.body?.inputSchema ?? {};
// Build a minimal document satisfying the seller's declared schema.
const sampleInput = Object.fromEntries(
  (inputSchema.required ?? Object.keys(inputSchema.properties ?? {})).map((k) => [
    k,
    inputSchema.properties?.[k]?.type === 'number' ? 1 : 'verification run',
  ]),
);

// ---------- §11 auth ----------
h('§11 — every order endpoint refuses an unauthenticated caller (E1)');
for (const [m, p] of [
  ['GET', '/orders'],
  ['POST', '/orders'],
  ['GET', '/sales'],
  ['GET', '/orders/00000000-0000-0000-0000-000000000000'],
  ['GET', '/orders/00000000-0000-0000-0000-000000000000/case-file'],
  ['POST', '/orders/00000000-0000-0000-0000-000000000000/accept'],
  ['POST', '/orders/00000000-0000-0000-0000-000000000000/complain'],
]) {
  const r = await api(p, { method: m, body: m === 'POST' ? { reason: 'x' } : undefined });
  ok(r.status === 401, `${m} ${p} → 401`, `got ${r.status}`);
}

// ---------- §11 empty lists ----------
h('§11 — a fresh account gets empty lists, never a 404 (E9, E10)');
const mine0 = await api('/orders', { token: buyer.token });
ok(mine0.status === 200 && Array.isArray(mine0.body) && mine0.body.length === 0, 'GET /orders → 200 []', `got ${mine0.status} ${JSON.stringify(mine0.body)}`);
const sales0 = await api('/sales', { token: buyer.token });
ok(sales0.status === 200 && Array.isArray(sales0.body) && sales0.body.length === 0, 'GET /sales → 200 []', `got ${sales0.status}`);

// ---------- §11 refusals that cost nothing ----------
h('§11 — bad purchases are refused before any money moves (E2, E4, E5, E7, E8)');
const badAgent = await api('/orders', {
  method: 'POST',
  token: buyer.token,
  body: { agentId: '00000000-0000-0000-0000-000000000000', input: {}, acceptanceCriteria: 'x' },
});
ok(badAgent.status === 404, 'unknown agent → 404', `got ${badAgent.status}`);

const blankCriteria = await api('/orders', {
  method: 'POST',
  token: buyer.token,
  body: { agentId: agent.id, input: sampleInput, acceptanceCriteria: '   ' },
});
ok(blankCriteria.status === 400, 'whitespace-only acceptanceCriteria → 400', `got ${blankCriteria.status}`);

const badInput = await api('/orders', {
  method: 'POST',
  token: buyer.token,
  body: { agentId: agent.id, input: { nope: 42 }, acceptanceCriteria: 'anything' },
});
ok(badInput.status === 400, 'input violating inputSchema → 400', `got ${badInput.status}`);
ok(
  Boolean(badInput.body?.fieldErrors?.input),
  'refusal names the input field',
  JSON.stringify(badInput.body?.fieldErrors ?? badInput.body).slice(0, 160),
);

const malformed = await api('/orders/not-a-uuid', { token: buyer.token });
ok(malformed.status === 400, 'malformed uuid on GET /orders/:id → 400', `got ${malformed.status}`);

// ⚠️ The buyer has no money yet, so this is the 402 branch.
const broke = await api('/orders', {
  method: 'POST',
  token: buyer.token,
  body: { agentId: agent.id, input: sampleInput, acceptanceCriteria: 'anything' },
});
ok(broke.status === 402, 'balance below price → 402 (not 400, not 500)', `got ${broke.status}`);
const afterBroke = await api('/me', { token: buyer.token });
ok(
  afterBroke.body.availableBalanceMinor === 0 && afterBroke.body.inEscrowMinor === 0,
  'a refused purchase moved no money and created no order',
  `${afterBroke.body.availableBalanceMinor}/${afterBroke.body.inEscrowMinor}`,
);
ok((await api('/orders', { token: buyer.token })).body.length === 0, 'no order row was created');

// ---------- §3 the purchase ----------
h('§3 — a purchase completes and the escrow holds the money');
const top = await api('/topup', { method: 'POST', body: { amountMinor: agent.priceMinor * 2 }, token: buyer.token });
ok(top.status === 200, `top-up ${agent.priceMinor * 2}¢ → 200`, `got ${top.status} ${JSON.stringify(top.body).slice(0, 200)}`);

const me0 = await api('/me', { token: buyer.token });
const esc0 = await totalEscrowed();
const t0 = Date.now();
const order = await api('/orders', {
  method: 'POST',
  token: buyer.token,
  body: { agentId: agent.id, input: sampleInput, acceptanceCriteria: 'Every line item, and a correct total.' },
});
const elapsed = Date.now() - t0;

ok(order.status === 201, 'POST /orders → 201', `got ${order.status} ${JSON.stringify(order.body).slice(0, 240)}`);
ok(typeof order.body?.id === 'string', 'P2 response is { id }', JSON.stringify(order.body));
ok(Object.keys(order.body ?? {}).length === 1, 'P2 nothing else in the body');
ok(elapsed > 500, 'P3 the call waited for a receipt (seconds, not milliseconds)', `${elapsed}ms`);

const ORDER = order.body?.id;
const me1 = await api('/me', { token: buyer.token });
ok(
  me0.body.availableBalanceMinor - me1.body.availableBalanceMinor === agent.priceMinor,
  'P5 availableBalanceMinor fell by EXACTLY the price',
  `${me0.body.availableBalanceMinor} → ${me1.body.availableBalanceMinor}`,
);
ok(
  me1.body.inEscrowMinor - me0.body.inEscrowMinor === agent.priceMinor,
  'P6 inEscrowMinor rose by EXACTLY the same amount',
  `${me0.body.inEscrowMinor} → ${me1.body.inEscrowMinor}`,
);

const ledger = (await api('/me/ledger', { token: buyer.token })).body;
const debit = ledger.find((e) => e.kind === 'purchase');
ok(Boolean(debit), 'P7 a purchase-kind entry exists');
ok(debit?.amountMinor === -agent.priceMinor, 'P7 it is negative and equals the price', String(debit?.amountMinor));
ok(debit?.orderId === ORDER, 'P7 it is linked to the order', String(debit?.orderId));

const got = await api(`/orders/${ORDER}`, { token: buyer.token });
ok(got.status === 200, 'GET /orders/:id → 200', `got ${got.status}`);
ok(got.body?.state === 'purchased', 'P4 state is purchased', String(got.body?.state));
ok(got.body?.run === null, 'P8 run is null — execution has not started');
ok(got.body?.priceMinor === agent.priceMinor, 'P10 price is a snapshot', String(got.body?.priceMinor));
ok(got.body?.reviewWindowSeconds === Number(env.REVIEW_WINDOW_SECONDS), 'P11 review window is the config snapshot', `${got.body?.reviewWindowSeconds} vs ${env.REVIEW_WINDOW_SECONDS}`);
ok(typeof got.body?.agentName === 'string', 'agentName resolved through the pinned version', got.body?.agentName);
ok(!('agentId' in (got.body ?? {})), 'no agentId on the order response (contract §3)');
ok(!('systemPrompt' in (got.body ?? {})), 'no systemPrompt anywhere in the order response');

const esc1 = await totalEscrowed();
ok(esc1 - esc0 === BigInt(agent.priceMinor) * 10_000n, 'P13 totalEscrowed rose by the price in base units', `${esc1 - esc0}`);

// ---------- §8 the case file ----------
h('§8 — the case file answers for an order that has not run (C3, C4, C5)');
const cf = await api(`/orders/${ORDER}/case-file`, { token: buyer.token });
ok(cf.status === 200, 'GET case-file → 200 even in purchased', `got ${cf.status}`);
ok(Array.isArray(cf.body?.steps) && cf.body.steps.length === 0, 'C4 steps is [] and not an error');
ok('output' in (cf.body ?? {}) && cf.body.output === null, 'C5 output is present AND null (the absence is the evidence)');
ok(Array.isArray(cf.body?.capabilities) && Array.isArray(cf.body?.exclusions), 'C3 capabilities and exclusions present');
ok(cf.body?.acceptanceCriteria === 'Every line item, and a correct total.', 'C3 acceptance criteria verbatim');
ok(!('systemPrompt' in (cf.body ?? {})), 'C1 no systemPrompt in the buyer copy');
ok(!('rawSteps' in (cf.body ?? {})), 'C1 no rawSteps in the buyer copy');

// ---------- §7 who may see it ----------
h('§7 — visibility: the buyer yes, a stranger 404 and indistinguishable (S3, S4)');
const byStranger = await api(`/orders/${ORDER}`, { token: stranger.token });
ok(byStranger.status === 404, 'stranger → GET /orders/:id → 404, never 403', `got ${byStranger.status}`);
const cfStranger = await api(`/orders/${ORDER}/case-file`, { token: stranger.token });
ok(cfStranger.status === 404, 'stranger → case-file → 404', `got ${cfStranger.status}`);
const ghost = await api('/orders/00000000-0000-0000-0000-000000000000', { token: buyer.token });
ok(ghost.status === 404, 'non-existent order → 404');
ok(
  JSON.stringify(ghost.body) === JSON.stringify(byStranger.body),
  'S4 the two 404 bodies are byte-identical (no existence oracle)',
  `${JSON.stringify(ghost.body)} vs ${JSON.stringify(byStranger.body)}`,
);

// ---------- §7 the lists ----------
h('§7/§11 — each side sees its own trades (S5, S6, S7)');
const mine1 = await api('/orders', { token: buyer.token });
ok(mine1.body.length === 1 && mine1.body[0].id === ORDER, 'buyer GET /orders contains the order');
ok(typeof mine1.body[0].agentName === 'string', 'summary carries agentName');
const salesBuyer = await api('/sales', { token: buyer.token });
ok(salesBuyer.body.length === 0, 'S7 the buyer sees it in /orders, not /sales');
const salesStranger = await api('/sales', { token: stranger.token });
ok(salesStranger.body.length === 0, 'S6 a stranger sees nothing in /sales');

// ---------- §6/§9 settlement refusals ----------
h('§6/§9 — settling refuses in the wrong state, and to the wrong caller (A6, A7, D6)');
const acceptEarly = await api(`/orders/${ORDER}/accept`, { method: 'POST', token: buyer.token });
ok(acceptEarly.status === 409, 'accept on a purchased order → 409', `got ${acceptEarly.status} ${JSON.stringify(acceptEarly.body).slice(0, 160)}`);
const acceptStranger = await api(`/orders/${ORDER}/accept`, { method: 'POST', token: stranger.token });
ok(acceptStranger.status === 404, 'accept by a non-buyer → 404, not 403', `got ${acceptStranger.status}`);
const complainEarly = await api(`/orders/${ORDER}/complain`, { method: 'POST', token: buyer.token, body: { reason: 'too slow' } });
ok(complainEarly.status === 409, 'complain on a purchased order → 409', `got ${complainEarly.status}`);
const complainBlank = await api(`/orders/${ORDER}/complain`, { method: 'POST', token: buyer.token, body: { reason: '  ' } });
ok(complainBlank.status === 400, 'D7 blank reason → 400', `got ${complainBlank.status}`);
const complainStranger = await api(`/orders/${ORDER}/complain`, { method: 'POST', token: stranger.token, body: { reason: 'x' } });
ok(complainStranger.status === 404, 'D6 complain by a non-buyer → 404', `got ${complainStranger.status}`);

// ---------- §5 the double-spend race ----------
h('§5 — two simultaneous purchases cannot spend one balance (R1-R4)');
const meRace = await api('/me', { token: buyer.token });
ok(meRace.body.availableBalanceMinor === agent.priceMinor, 'buyer has exactly one price left', String(meRace.body.availableBalanceMinor));
const [r1, r2] = await Promise.all([
  api('/orders', { method: 'POST', token: buyer.token, body: { agentId: agent.id, input: sampleInput, acceptanceCriteria: 'race a' } }),
  api('/orders', { method: 'POST', token: buyer.token, body: { agentId: agent.id, input: sampleInput, acceptanceCriteria: 'race b' } }),
]);
const codes = [r1.status, r2.status].sort();
ok(codes[0] === 201 && codes[1] === 402, 'R1 exactly one 201 and one 402', codes.join(','));
const meAfter = await api('/me', { token: buyer.token });
ok(meAfter.body.availableBalanceMinor >= 0, 'R3/R4 balance never went negative', String(meAfter.body.availableBalanceMinor));
ok(meAfter.body.availableBalanceMinor === 0, 'R4 balance is exactly 0', String(meAfter.body.availableBalanceMinor));
const orderCount = (await api('/orders', { token: buyer.token })).body.length;
ok(orderCount === 2, 'R2 exactly one new order was created', `${orderCount} total`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
