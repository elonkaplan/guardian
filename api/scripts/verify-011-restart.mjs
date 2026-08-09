/**
 * Acceptance run for specs/011-demo-seed-fixtures/quickstart.md §8 — the acts
 * survive a restart.
 *
 *   docker compose restart api      # or restart however you run it
 *   node scripts/verify-011-restart.mjs
 *
 * ★ **This is the only silent failure in the feature.** The listings live in
 * Postgres and survive anything; the substitutions live in memory and do not.
 * If registration ever moves from `DemoModule.onModuleInit` to the seed service,
 * every act still passes §5–§7 on a freshly seeded database and Act 2 returns a
 * live five-item extraction on stage, with nothing logged as wrong.
 *
 * ⚠️ **Do not re-seed before running this.** Re-seeding is what hides the bug:
 * it would re-register the scripts as a side effect on the very path under test.
 *
 * Covers T048 ★.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { awaitTerminal, buyFixture, h, note, ok, psql, signIn, summary, topUp } from './verify-011-lib.mjs';

const seedDoc = JSON.parse(readFileSync(new URL('./.011-seed.json', import.meta.url), 'utf8'));
const fixture = (act) => seedDoc.fixtures.find((f) => f.act === act);

h('§8 ★ — the acts survive a restart (T048 · FR-026 · SC-009)');

// The listings must already be there from a PREVIOUS seed. If they are not,
// this run would be testing a fresh seed rather than a restart.
const seeded = psql(`SELECT count(*) FROM agents WHERE owner_account_id='${seedDoc.seller.accountId}'`);
ok(seeded === '3', 'the three listings are already in the database from an earlier seed', `count=${seeded}`);
note('NOT re-seeding — re-seeding would re-register the scripts and hide the failure this checks for');

// The three lines must appear on THIS boot, not on the boot that seeded.
const logs = execFileSync('docker', ['logs', 'api-api-1', '--since', '2m'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const registered = (logs.match(/registered demo script:/g) ?? []).length;
ok(registered === 3, 'three "registered demo script:" lines on this boot', `saw ${registered}`);
for (const act of ['Act 1', 'Act 2', 'Act 3']) {
  ok(logs.includes(`registered demo script: ${act}`), `${act} registered at bootstrap`);
}

const buyer = await signIn();
const top = await topUp(buyer.token, 400);
ok(top.status === 200, 'top-up → 200', `got ${top.status}`);

const bought = await buyFixture(buyer.token, fixture(2));
ok(bought.status === 201, 'bought Act 2 immediately after the restart, without re-seeding', `got ${bought.status}`);

if (bought.status === 201) {
  const { order } = await awaitTerminal(buyer.token, bought.body.id);
  const items = order?.run?.output?.lineItems ?? [];
  const names = items.map((x) => x.description);

  ok(order?.state === 'delivered', 'the order delivered', `got ${order?.state}`);
  ok(
    items.length === 3,
    '★ THREE line items after the restart, not five',
    `got ${items.length} (${names.join(', ')}) — five means the fixtures are registered at seed time, not at bootstrap`,
  );
  ok(
    JSON.stringify(names) === JSON.stringify(['Ergonomic keyboard', 'USB-C dock', 'Monitor stand']),
    'the same three as before the restart',
    `got ${names.join(', ')}`,
  );
  ok(Number(order?.run?.output?.total) === 300, 'total is still 300.00', `got ${order?.run?.output?.total}`);
}

process.exit(summary() === 0 ? 0 : 1);
