// One-off verification (Block 1): replay committed chaincode events off the ledger
// and assert no payload carries commercial data. Source of truth is the chain, not
// the unit tests. Run with the stack up: npx tsx scripts/dump-events.ts
import { connectGateway, getChaincodeEvents, disconnectGateway } from '../api/src/fabric/gateway.js';

const FORBIDDEN = /amount|value|qty|quantity|price|rate|fee|tenor|threshold|risk_tier|reason|changes/i;
const seen = new Map<string, Set<string>>();
const offenders: string[] = [];

function report(): never {
  console.log('\n=== Committed on-chain event payload keys ===');
  for (const [name, keys] of [...seen.entries()].sort()) {
    console.log(`  ${name.padEnd(28)} ${[...keys].join(', ')}`);
  }
  console.log(`\nDistinct events observed: ${seen.size}`);
  console.log(offenders.length
    ? `\nLEAKS FOUND:\n  ${offenders.join('\n  ')}`
    : '\nPASS — no commercial data in any committed event payload.');
  process.exit(offenders.length ? 1 : 0);
}

async function drain(cc: string) {
  const events = await getChaincodeEvents(cc, { startBlock: BigInt(0) });
  for await (const ev of events) {
    const payload = JSON.parse(Buffer.from(ev.payload).toString());
    if (!seen.has(ev.eventName)) seen.set(ev.eventName, new Set());
    for (const [k, v] of Object.entries(payload)) {
      seen.get(ev.eventName)!.add(k);
      if (FORBIDDEN.test(k)) offenders.push(`${ev.eventName}.${k} = ${JSON.stringify(v)}`);
    }
  }
}

async function main() {
  await connectGateway();
  // The event stream stays open for live events, so replay is bounded by a timer.
  setTimeout(() => { void disconnectGateway().finally(report); }, 10000);
  await Promise.all(['trade-doc-cc', 'finance-cc', 'onboarding-cc'].map(drain));
}
main();
