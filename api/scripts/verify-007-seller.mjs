/**
 * quickstart.md §7 and §8 — the seller's half of the two order reads, and the
 * disclosure boundary between the two copies of the case file.
 *
 *   node scripts/verify-007-seller.mjs
 *
 * ⚠️ SPENDS REAL TESTNET FUNDS: registers an agent and opens one deal.
 *
 * **This is the check the source brief calls out by name**: *"a seller can open
 * `GET /orders/:id` and `GET /orders/:id/case-file` for a sale they did not buy
 * — verify as the seller account, not just the buyer."* Authorising those two
 * routes on `buyer_account_id` alone is the natural thing to write, it passes
 * every test a buyer would run, and it silently deletes half the product.
 *
 * `verify-007.mjs` cannot cover it: it signs in as fresh wallets and buys a
 * seeded agent whose owner's key nobody holds. This script lists its own agent
 * first, so it holds both sides of the trade.
 */
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const API = 'http://localhost:3000';
const SENTINEL = 'SENTINEL-PROMPT-DO-NOT-LEAK-007';

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
  let j = null,
    text = '';
  try {
    text = await r.text();
    j = JSON.parse(text);
  } catch {}
  return { status: r.status, body: j, raw: text };
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

const seller = await signIn();
const buyer = await signIn();
const stranger = await signIn();
console.log(`seller   ${seller.acct.address}\nbuyer    ${buyer.acct.address}\nstranger ${stranger.acct.address}`);

// ---------- the seller lists an agent whose prompt is a sentinel ----------
h('setup — the seller lists an agent (real registerAgent)');
const created = await api('/agents', {
  method: 'POST',
  token: seller.token,
  body: {
    name: 'VerifyBot 007',
    description: 'Exists so the seller side of the order reads can be verified.',
    capabilities: ['Echoes the text it is given.'],
    exclusions: ['Does not handle images.'],
    priceMinor: 100,
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    outputSchema: {
      type: 'object',
      properties: { echoed: { type: 'string' } },
      required: ['echoed'],
    },
    systemPrompt: `${SENTINEL}. You echo the text you are given.`,
    model: 'claude-haiku-4-5',
    timeoutSeconds: 60,
  },
});
ok(created.status === 201, 'POST /agents → 201', `got ${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
ok(typeof created.body?.onchainAgentId === 'number', 'agent is registered on-chain', String(created.body?.onchainAgentId));
const AGENT = created.body?.id;

// ---------- the buyer buys it ----------
h('setup — the buyer purchases it (real openDeal)');
const top = await api('/topup', { method: 'POST', body: { amountMinor: 200 }, token: buyer.token });
ok(top.status === 200, 'buyer topped up', `got ${top.status}`);

const order = await api('/orders', {
  method: 'POST',
  token: buyer.token,
  body: { agentId: AGENT, input: { text: 'hello' }, acceptanceCriteria: 'Echo it back exactly.' },
});
ok(order.status === 201, 'POST /orders → 201', `got ${order.status} ${JSON.stringify(order.body).slice(0, 200)}`);
const ORDER = order.body?.id;

// ---------- §7 the seller can open a sale they did not buy ----------
h('§7 — the SELLER opens an order they did not buy (S1, S2, S5)');
const asSeller = await api(`/orders/${ORDER}`, { token: seller.token });
ok(asSeller.status === 200, 'S1 seller → GET /orders/:id → 200', `got ${asSeller.status}`);
ok(asSeller.body?.agentName === 'VerifyBot 007', 'S1 it is the right order', String(asSeller.body?.agentName));

const cfSeller = await api(`/orders/${ORDER}/case-file`, { token: seller.token });
ok(cfSeller.status === 200, 'S2 seller → GET /orders/:id/case-file → 200', `got ${cfSeller.status}`);

const sales = await api('/sales', { token: seller.token });
ok(sales.status === 200 && sales.body.length === 1, 'S5 the sale appears in GET /sales', `${sales.body?.length} rows`);
ok(sales.body?.[0]?.id === ORDER, 'S5 keyed by the ORDER id, not a sale id');
ok(!('buyerAddress' in (sales.body?.[0] ?? {})), 'the seller does not learn who bought it');

const sellerOrders = await api('/orders', { token: seller.token });
ok(sellerOrders.body.length === 0, 'S7 the sale is NOT in the seller GET /orders');
const buyerSales = await api('/sales', { token: buyer.token });
ok(buyerSales.body.length === 0, 'S6 the buyer sees nothing in GET /sales');

h('§7 — a stranger is refused, indistinguishably (S3, S4)');
const s1 = await api(`/orders/${ORDER}`, { token: stranger.token });
const s2 = await api(`/orders/${ORDER}/case-file`, { token: stranger.token });
const ghost = await api('/orders/00000000-0000-0000-0000-000000000000', { token: buyer.token });
ok(s1.status === 404, 'S3 stranger → order → 404, never 403', `got ${s1.status}`);
ok(s2.status === 404, 'S3 stranger → case-file → 404', `got ${s2.status}`);
ok(JSON.stringify(s1.body) === JSON.stringify(ghost.body), 'S4 refusal is byte-identical to a non-existent order');

h('§7 — the writes stay buyer-only even for the seller (A7, D6)');
const accSeller = await api(`/orders/${ORDER}/accept`, { method: 'POST', token: seller.token });
ok(accSeller.status === 404, 'A7 seller → accept → 404', `got ${accSeller.status}`);
const compSeller = await api(`/orders/${ORDER}/complain`, {
  method: 'POST',
  token: seller.token,
  body: { reason: 'I would like to reply' },
});
ok(compSeller.status === 404, 'D6 seller → complain → 404 (no right of reply)', `got ${compSeller.status}`);

// ---------- §8 the disclosure boundary ----------
h('§8 — the sentinel sweep (C1, C2)');
const buyerSurfaces = [
  ['GET /orders', await api('/orders', { token: buyer.token })],
  ['GET /orders/:id', await api(`/orders/${ORDER}`, { token: buyer.token })],
  ['GET /orders/:id/case-file', await api(`/orders/${ORDER}/case-file`, { token: buyer.token })],
  ['GET /agents', await api('/agents')],
  ['GET /agents/:id', await api(`/agents/${AGENT}`)],
];
for (const [label, r] of buyerSurfaces) {
  ok(!r.raw.includes(SENTINEL), `C1 ${label} contains no fragment of the prompt`);
}
ok(!(await api('/sales', { token: seller.token })).raw.includes(SENTINEL), 'C1 GET /sales carries no prompt either');

ok(cfSeller.raw.includes(SENTINEL), 'C2 the SELLER case file DOES contain the prompt — it is theirs');
ok(typeof cfSeller.body?.systemPrompt === 'string', 'C2 seller copy carries systemPrompt');
ok(Array.isArray(cfSeller.body?.rawSteps), 'C2 seller copy carries rawSteps');

const cfBuyer = await api(`/orders/${ORDER}/case-file`, { token: buyer.token });
ok(!('systemPrompt' in (cfBuyer.body ?? {})), 'C1 buyer copy has NO systemPrompt key at all');
ok(!('rawSteps' in (cfBuyer.body ?? {})), 'C1 buyer copy has NO rawSteps key at all');
ok(cfBuyer.body?.capabilities?.[0] === 'Echoes the text it is given.', 'C3 pinned capabilities verbatim');
ok(cfBuyer.body?.exclusions?.[0] === 'Does not handle images.', 'C3 pinned exclusions verbatim');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
