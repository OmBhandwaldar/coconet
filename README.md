# CocoNet — Permissioned Blockchain Trade-Finance Platform (MVP)

A consortium-grade dual-chain platform unifying supply-chain trade documents, invoice
financing, and buyer-funded programmable-money escrow on a single shared event flow.

- **Hyperledger Fabric** — identity, trade documents, finance (workflow + provenance).
- **Polygon (Supernet / local Hardhat)** — programmable-money escrow that settles in USDC.
- **Bridge** —relays Fabric events to Polygon, correlated by `escrowPaymentId`.

The MVP reproduces the **Tata Motors / Bharat Stampings / HDFC Bank** worked example
end-to-end. See [EXAMPLE-FLOW.md](EXAMPLE-FLOW.md) (the frozen reference), [PLAN.md](PLAN.md)
(full BRD spec), [MVP-PLAN.md](MVP-PLAN.md) (build sequence + decisions log), and
[DEMO.md](DEMO.md) (presenter walkthrough).

> **Currency note:** escrow currently settles in **USD (USDC/USDT, mocked locally)** at a fixed
> **1 USD = ₹92** — a deliberate MVP simplification (production uses an INR-pegged token). Finance
> records stay in INR. INR figures carry their USD equivalent as `₹INR / $USD`.

---

## Architecture

```
Next.js portals (out of scope, solo)        Postman / demo.ts  ← exercises the API
                     │
              Express API (api/)  ──────────────┬───────────────┐
                     │                          │               │
         fabric-gateway                   ethers.js          bridge.service
                     │                          │          (Fabric ↔ Polygon)
        ┌────────────┴───────────┐         ┌────┴─────────────┐
        │  Hyperledger Fabric     │         │  Polygon (Hardhat)│
        │  onboarding-cc          │         │  EscrowFactory    │
        │  trade-doc-cc           │         │  EscrowVault      │
        │  finance-cc             │         │  MockUSDC         │
        │  buyer-supplier-channel │         └──────────────────┘
        └─────────────────────────┘
  off-chain: MongoDB · MinIO (document storage, SHA-256 on-chain)
```

## Prerequisites

- **Docker Desktop** (running)
- **Node.js ≥ 20** (developed on Node 24)
- macOS/Linux shell (scripts are bash; `.ps1` equivalents kept for Windows)

## First-time setup

```bash
npm install                      # all workspaces
./scripts/generate-artifacts.sh  # ONE TIME: Fabric crypto + genesis block (needs Docker)
cp .env.example .env             # if you don't already have .env
```

## Run the end-to-end demo

```bash
npm run demo:reset               # from zero: stack up → channel → 3 chaincodes → 3 contracts
npm run dev                      # Terminal 1 — API + bridge (leave running)
npm run demo                     # Terminal 2 — drives the full flow, prints settlement summary
```

`npm run demo` runs onboarding → PO → GRN → invoice → 3-way match → pre-shipment finance →
invoice discounting (net settlement) → escrow create + fund → invoice approval → **the bridge
auto-releases the escrow on Polygon**, asserting each step and printing a ₹/$ settlement summary.
It uses a unique run-id each time, so it is safe to re-run without resetting.

## Tests

```bash
npm test --workspace=@coconet/api                 # API (vitest, chain mocked) — 54 tests
npm test --workspace=@coconet/onboarding-cc       # chaincode unit (mocha)
npm test --workspace=@coconet/trade-doc-cc        # chaincode unit (mocha)
npm test --workspace=@coconet/finance-cc          # chaincode unit (mocha)
npm test --workspace=@coconet/contracts           # Solidity (Hardhat) — 18 tests
npx newman run postman/coconet.postman_collection.json   # full API collection (live stack)
```

Correctness is always cross-checked against the source of truth — `peer chaincode query` for
Fabric, ethers `balanceOf`/`getEscrow` for Polygon — never the API response alone.

## Teardown

```bash
./scripts/network-down.sh                 # stop + drop ledger volumes
./scripts/network-down.sh --keep-volumes  # stop, preserve ledger
```

## MVP scope & what's deferred

Implemented: onboarding, trade documents (PO/GRN/invoice/3-way match), pre-shipment + invoice
discounting finance with Rule-01/Rule-02 and net settlement, and Prefunded invoice-linked escrow
with a 2-condition release (funded + invoice-approved) via the bridge.

Deferred to post-MVP rings (see MVP-PLAN.md): provenance (Ring 2), disputes (Ring 3), all 3 PDCs
(Ring 4), extra channels (Ring 5), funding models + the full 6-condition `ReleaseConditionEvaluator`
(Rings 6–7), the remaining 5 finance products (Ring 9), sanctions checkpoints (Ring 10), the
maker-checker engine + Fabric CA per-user identities (Ring 11), and `audit-cc` (Ring 1).

**Optional (not included):** block explorers — Hyperledger Explorer (Fabric) is the lighter option
if visual chain browsing is wanted for a presentation; Blockscout (EVM) is heavier and finicky on
Hardhat, so it is not recommended for the MVP.
