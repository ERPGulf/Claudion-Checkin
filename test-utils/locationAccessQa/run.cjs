#!/usr/bin/env node
// Host-only driver. No app session, native receipt, or server record is seeded.
const fs = require('node:fs');
const path = require('node:path');
const { evaluate } = require('./cdp.cjs');
const ids = {
  android: 'dc376389c8c4d44fd6a1750d710329fe6c4e88dd-1',
  ios: '1271e32336f8cbd7d1f8bb70b60a2b993e893292-1',
};
async function main() {
  const [platform, action, value] = process.argv.slice(2);
  if (!ids[platform]) throw new Error('Expected android or ios');
  if (action === 'snapshot') {
    if (!/^[a-zA-Z0-9_-]+$/.test(value || '')) throw new Error('Expected evidence label');
    const result = await evaluate(ids[platform], fs.readFileSync(path.join(__dirname, 'snapshot.body.cjs'), 'utf8'));
    const destination = path.resolve(__dirname, '../../docs/testing/location-access-emulator-2026-10-30', platform, `${value}.json`);
    fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ destination, session: result.session, queue: result.queue,
      recent: result.events.slice(-5).map(row => ({ eventId: row.eventId, sequence: row.sequence,
        kind: row.event.kind || row.transition, status: row.status, reason: row.reason, occurredAt: row.occurredAt })) }, null, 2));
    return;
  }
  const args = { action };
  if (action === 'navigate') args.route = value;
  if (action === 'locale') args.language = value;
  console.log(JSON.stringify(await evaluate(ids[platform], fs.readFileSync(path.join(__dirname, 'action.body.cjs'), 'utf8'), 45000, args), null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
