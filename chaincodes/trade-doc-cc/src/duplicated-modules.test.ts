import * as chai from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const { expect } = chai;

// ─── The two copies of the gate must not drift ───────────────────────────────
// maker-checker.ts is duplicated into trade-doc-cc and finance-cc rather than
// shared. That is deliberate: each chaincode is its own package with its own
// lifecycle sequence, and a shared library would couple two independently
// upgradeable deployments — changing the gate would force both to be redeployed
// together whether or not both needed it.
//
// The cost of that choice is drift, and drift in this particular file means two
// chaincodes disagreeing about who may approve what. So the copies are asserted
// identical here. A deliberate divergence belongs in a parameter, not a fork.

const CHAINCODES = path.resolve(__dirname, '..', '..');
const DUPLICATED = ['maker-checker.ts', 'approval-stub.ts'];

describe('duplicated modules stay identical', () => {
  for (const file of DUPLICATED) {
    it(`${file} matches between trade-doc-cc and finance-cc`, () => {
      const a = fs.readFileSync(path.join(CHAINCODES, 'trade-doc-cc', 'src', file), 'utf8');
      const b = fs.readFileSync(path.join(CHAINCODES, 'finance-cc', 'src', file), 'utf8');
      expect(b, `${file} has diverged — change both copies, or make the difference a parameter`)
        .to.equal(a);
    });
  }
});
