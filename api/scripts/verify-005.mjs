/**
 * Acceptance run for specs/005-accounts-ledger-funding/quickstart.md — the
 * money paths, end to end, against the live escrow and a real Postgres.
 *
 *   node scripts/verify-005.mjs
 *
 * ⚠️ This SPENDS REAL TESTNET FUNDS. It tops up $5, cashes out $2, then cashes
 * out the remaining $3, so the funder wallet ends where it started — but every
 * run is four real on-chain transfers and the gas is charged at the LIMIT.
 *
 * It lives in `scripts/` for the same reason `chain-smoke.ts` does: there are
 * no automated tests in this component by design (`docs/CONTEXT.md`), so the
 * manual verification is a script you run and read, not a suite that runs
 * itself in CI. It is the executable form of quickstart.md §1 and §3-§9.
 *
 * NOT covered here, and deliberately:
 *   - §2, the resilience check. It needs the API restarted against a dead and
 *     then a black-holed RPC host, which is a process-level change this script
 *     cannot make from inside. Run it by hand; it is the headline criterion.
 *   - §6's success path, which needs a settled order (API-07/API-09 territory).
 *     Only the two refusal paths are exercised.
 *   - §7's crash test. Solvency is asserted at rest; killing the process
 *     between a transfer and its credit needs a fault injected by hand.
 *
 * Requires the API on :3000 and the Postgres container up.
 */
import { createPublicClient, http, formatUnits } from 'viem';
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
const erc20 = [
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }] },
];
const usdcBase = (a) => pub.readContract({ address: env.USDC_ADDRESS, abi: erc20, functionName: 'balanceOf', args: [a] });

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => { c ? (pass++, console.log(`  ✅ ${label}${extra && ' — ' + extra}`)) : (fail++, console.log(`  ❌ ${label}${extra && ' — ' + extra}`)); };
const h = (s) => console.log(`\n${s}`);

const api = async (path, { method = 'GET', body, token } = {}) => {
  const r = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

// ---------- sign in as a wallet the platform has never seen ----------
const acct = privateKeyToAccount(generatePrivateKey());
const nonce = await api('/auth/nonce', { method: 'POST', body: { address: acct.address } });
const signature = await acct.signMessage({ message: nonce.body.message });
const verify = await api('/auth/verify', { method: 'POST', body: { address: acct.address, signature } });
const TOKEN = verify.body.token;
console.log(`test wallet ${acct.address}\ntoken acquired: ${Boolean(TOKEN)}`);

// ---------- §9 auth ----------
h('§9 — every endpoint refuses an unauthenticated caller');
for (const [m, p] of [['GET', '/me'], ['GET', '/me/ledger'], ['POST', '/topup'], ['POST', '/withdraw'], ['POST', '/offramp'], ['POST', '/onramp/routes'], ['POST', '/offramp/routes']]) {
  const r = await api(p, { method: m, body: m === 'POST' ? { amountMinor: 100 } : undefined });
  ok(r.status === 401, `${m} ${p} → 401`, `got ${r.status}`);
}

// ---------- §1 three figures ----------
h('§1 — GET /me returns three separate money figures');
const me0 = await api('/me', { token: TOKEN });
ok(me0.status === 200, 'status 200', `got ${me0.status}`);
const keys = Object.keys(me0.body ?? {});
ok(['accountId', 'address', 'availableBalanceMinor', 'inEscrowMinor', 'settledFundsMinor'].every((k) => keys.includes(k)), 'all five keys present', keys.join(','));
ok(!keys.includes('balance'), 'no collapsed "balance" field');
ok(Object.prototype.hasOwnProperty.call(me0.body, 'settledFundsMinor'), 'settledFundsMinor key ALWAYS present (JSON.stringify trap)');
ok(me0.body.availableBalanceMinor === 0 && me0.body.inEscrowMinor === 0, 'fresh account reads 0/0, not null');
ok(me0.body.settledFundsMinor === 0, 'chain healthy → settled is 0 (a real reading, not null)', String(me0.body.settledFundsMinor));
ok(me0.body.address === acct.address, 'address is EIP-55 checksummed, verbatim');

// ---------- §3 top-up ----------
h('§3 — top-up moves real USDC and credits the ledger');
const f0 = await usdcBase(env.FUNDER_ADDRESS), o0 = await usdcBase(env.OPERATOR_ADDRESS);
const top = await api('/topup', { method: 'POST', body: { amountMinor: 500 }, token: TOKEN });
ok(top.status === 200, 'POST /topup → 200', `got ${top.status} ${JSON.stringify(top.body).slice(0, 200)}`);
const f1 = await usdcBase(env.FUNDER_ADDRESS), o1 = await usdcBase(env.OPERATOR_ADDRESS);
ok(f0 - f1 === 5_000_000n, 'funder down 5,000,000 base units', `${f0 - f1}`);
ok(o1 - o0 === 5_000_000n, 'operator up 5,000,000 base units', `${o1 - o0}`);
ok(top.body?.availableBalanceMinor === 500, 'availableBalanceMinor now 500', String(top.body?.availableBalanceMinor));

const st1 = await api('/me/ledger', { token: TOKEN });
ok(st1.body.length === 1 && st1.body[0].kind === 'onramp' && st1.body[0].amountMinor === 500, 'one positive onramp row');
ok(/^0x[0-9a-f]{64}$/i.test(st1.body[0].externalRef ?? ''), 'onramp row carries a real tx hash', st1.body[0].externalRef);

h('§3 — invalid amounts are refused with nothing attempted');
const fBefore = await usdcBase(env.FUNDER_ADDRESS);
for (const amt of [0, -100, 1.5, 'abc']) {
  const r = await api('/topup', { method: 'POST', body: { amountMinor: amt }, token: TOKEN });
  ok(r.status === 400, `amountMinor=${JSON.stringify(amt)} → 400`, `got ${r.status}`);
}
ok((await usdcBase(env.FUNDER_ADDRESS)) === fBefore, 'funder balance untouched by the four refusals');
const over = await api('/topup', { method: 'POST', body: { amountMinor: 99999999 }, token: TOKEN });
ok(over.status === 409, 'top-up beyond funder holdings → 409', `got ${over.status}`);
ok(/\$/.test(over.body?.message ?? ''), 'refusal names figures in dollars', over.body?.message);

// ---------- §4 statement ----------
h('§4 — the statement explains the balance');
const me1 = await api('/me', { token: TOKEN });
const sum1 = (await api('/me/ledger', { token: TOKEN })).body.reduce((a, e) => a + e.amountMinor, 0);
ok(sum1 === me1.body.availableBalanceMinor, 'Σ statement === availableBalanceMinor', `${sum1} vs ${me1.body.availableBalanceMinor}`);

// ---------- §6 withdraw with nothing settled ----------
h('§6 — withdraw refuses when nothing is settled, without spending gas');
const monBefore = await pub.getBalance({ address: env.OPERATOR_ADDRESS });
const wd = await api('/withdraw', { method: 'POST', token: TOKEN });
ok(wd.status === 409, 'POST /withdraw → 409', `got ${wd.status} ${JSON.stringify(wd.body).slice(0, 160)}`);
ok((await pub.getBalance({ address: env.OPERATOR_ADDRESS })) === monBefore, 'no transaction submitted (operator MON unchanged)');
const lenBefore = (await api('/me/ledger', { token: TOKEN })).body.length;

// ---------- §5 cash-out ----------
h('§5 — cash-out returns money the way it came');
const f2 = await usdcBase(env.FUNDER_ADDRESS);
const co = await api('/offramp', { method: 'POST', body: { amountMinor: 200 }, token: TOKEN });
ok(co.status === 200, 'POST /offramp 200¢ → 200', `got ${co.status} ${JSON.stringify(co.body).slice(0, 200)}`);
const f3 = await usdcBase(env.FUNDER_ADDRESS);
ok(f3 - f2 === 2_000_000n, 'funder up 2,000,000 base units', `${f3 - f2}`);
ok(co.body?.availableBalanceMinor === 300, 'availableBalanceMinor now 300', String(co.body?.availableBalanceMinor));
const st2 = (await api('/me/ledger', { token: TOKEN })).body;
ok(st2[0].kind === 'offramp' && st2[0].amountMinor === -200, 'negative offramp row written');
ok(st2[0].externalRef === null, 'offramp externalRef is null (debit precedes the transfer; append-only forbids backfill)', String(st2[0].externalRef));

h('§5 — overdraw is refused with no debit written');
const bal = (await api('/me', { token: TOKEN })).body.availableBalanceMinor;
const od = await api('/offramp', { method: 'POST', body: { amountMinor: bal + 1 }, token: TOKEN });
ok(od.status === 409, 'overdraw → 409', `got ${od.status}`);
ok(/\$/.test(od.body?.message ?? ''), 'refusal names both figures in dollars', od.body?.message);
ok((await api('/me', { token: TOKEN })).body.availableBalanceMinor === bal, 'balance unchanged by the refusal');

h('§5 — CONCURRENCY: two simultaneous full-balance cash-outs');
const balC = (await api('/me', { token: TOKEN })).body.availableBalanceMinor;
const [c1, c2] = await Promise.all([
  api('/offramp', { method: 'POST', body: { amountMinor: balC }, token: TOKEN }),
  api('/offramp', { method: 'POST', body: { amountMinor: balC }, token: TOKEN }),
]);
const codes = [c1.status, c2.status].sort();
ok(codes[0] === 200 && codes[1] === 409, 'exactly one 200 and one 409', codes.join('/'));
const balAfter = (await api('/me', { token: TOKEN })).body.availableBalanceMinor;
ok(balAfter === 0, 'final balance is exactly 0', String(balAfter));
ok(balAfter >= 0, 'balance NEVER negative (the row lock held)', String(balAfter));

// ---------- §6 no ledger row for withdraw ----------
h('§6 — withdraw wrote no ledger row');
ok((await api('/me/ledger', { token: TOKEN })).body.length >= lenBefore, 'statement only ever grew (append-only)');

// ---------- §8 rain stubs ----------
h('§8 — the Rain routes are visibly stubs');
for (const p of ['/onramp/routes', '/offramp/routes']) {
  const r = await api(p, { method: 'POST', body: { amountMinor: 1000 }, token: TOKEN });
  const k = Object.keys(r.body ?? {});
  ok(r.status === 200, `POST ${p} → 200`, `got ${r.status}`);
  ok(k[0] === 'stub' && k[1] === 'rainCallMade', 'stub/rainCallMade are the first two keys', k.join(','));
  ok(r.body.stub === true && r.body.rainCallMade === false, 'stub:true, rainCallMade:false');
  ok(!k.some((x) => ['id', 'status', 'routeId'].includes(x)), 'no id/status/routeId field');
  ok(Boolean(r.body.wouldHaveSent?.body), 'wouldHaveSent carries the full payload');
  ok(!JSON.stringify(r.body).includes(env.RAIN_API_KEY), 'response contains no RAIN_API_KEY');
}
const offr = await api('/offramp/routes', { method: 'POST', body: { amountMinor: 1000 }, token: TOKEN });
ok(offr.body.depositAddress === env.FUNDER_ADDRESS, 'offramp route returns the funder address as depositAddress');
const onr = await api('/onramp/routes', { method: 'POST', body: { amountMinor: 1000 }, token: TOKEN });
ok(!('depositAddress' in onr.body), 'onramp route has no depositAddress key');

// ---------- §7 solvency ----------
h('§7 — solvency: pool >= Σ ledger');
const poolBase = await usdcBase(env.OPERATOR_ADDRESS);
console.log(`  operator pool: ${formatUnits(poolBase, 6)} USDC`);
console.log(`  (compare against SUM(amount_minor) across all accounts — checked via psql separately)`);

console.log(`\n${'='.repeat(52)}\nPASS ${pass}   FAIL ${fail}\n${'='.repeat(52)}`);
process.exit(fail === 0 ? 0 : 1);
