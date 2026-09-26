# NEW-PLAN.md — Production Hardening Plan

**Created:** 26 September 2026 · **Execution branch:** `develop-more` (branched from `develop`)

This is the tracked execution document for taking the MVP to something a bank would pilot. It
supersedes nothing — [MVP-PLAN.md](MVP-PLAN.md) remains the record of how the MVP was built, and
[PRIVACY-DESIGN.md](PRIVACY-DESIGN.md) remains the authoritative data-visibility architecture that
Block 4 implements.

---

## Status

| Block | Scope | Branch | Status |
|---|---|---|---|
| 0 | Setup | `feat/harden-00-setup` | [x] Done |
| 1 | Event payload scrub | `feat/harden-01-events` | [x] Done |
| 2 | API quick wins + contract scanning | `feat/harden-02-quickwins` | [x] Done |
| 3 | Identity & access | `feat/harden-03-identity` | [~] Mostly done — Fabric CA outstanding |
| 4 | Privacy (Design 2) | `feat/harden-04-privacy` | [ ] Not started |
| 5 | Maker-checker | `feat/harden-05-maker-checker` | [ ] Not started |
| 6 | Bridge durability | `feat/harden-06-bridge` | [ ] Not started |
| 7 | Polygon contracts & settlement | `feat/harden-07-contracts` | [ ] Not started |
| 8 | Missing chaincodes | `feat/harden-08-chaincodes` | [ ] Not started |
| 9 | Platform & ops | `feat/harden-09-platform` | [ ] Not started |
| 10 | Portals | `feat/harden-10-portals` | [ ] Not started |
| 11 | Integrations | `feat/harden-11-integrations` | [ ] Not started |
| 12 | Additional finance products | `feat/harden-12-finance-products` | [ ] Not started |

---

## Context

The MVP proves the mechanism end to end: PO → GRN → invoice → 3-way match → pre-shipment finance →
invoice discounting with net settlement → escrow funded → cross-chain auto-release, plus a refund
path. The arithmetic is correct at every step and `npm run demo` asserts it.

What it is not is production-ready. Verified against the code:

- **No authentication at all** — no `auth` or `rbac` middleware; anyone reaching port 3000 can issue a PO or release an escrow.
- **Every ledger action is attributed to one hardcoded Platform Admin**, so the audit trail cannot satisfy NFR-05.
- **Financing terms sit on the shared channel**, violating NFR-06 — and 13 chaincode event payloads leaked amounts, quantities or free-text figures to every channel member, permanently (fixed in Block 1).
- **Maker-checker thresholds are stored but never enforced** (`"storage only — Ring 11 enforces"`).
- **The bridge has no checkpointing, retries or HA story** — a failed cross-chain write is silently lost.
- Three of six chaincodes and two of four contracts do not exist.

**Intended outcome:** authenticated, attributable, privacy-correct, with durable cross-chain
settlement and audited contracts.

---

## Ground rules

- **Never touch `main` or `develop`.** All work happens on `develop-more`.
- **One branch per block**, named `feat/harden-NN-<topic>`, branched from `develop-more` and merged
  back into `develop-more` when green.
- **Many small commits** — one logical change each, never a block-sized commit.
- **TDD** for every block containing business logic (chaincode rules, access control, bridge
  idempotency, finance products). Write the failing test first.
- **`code-review` at the end of each block**; **`security-review`** additionally before merging
  blocks 3, 4, 6 and 7.
- Every block must leave `npm run demo` green before merge.

---

## Block 0 — Setup

- [x] Create `develop-more` from `develop`
- [x] Merge `docs/privacy-architecture` (brings `PRIVACY-DESIGN.md` + CLAUDE.md/MVP-PLAN updates)
- [x] Write this file
- [x] Link from CLAUDE.md §22

---

## Block 1 — Event payload scrub

> **Highest priority in the entire plan — the only item with no retroactive fix.** Chaincode events
> reach every channel member and are immutable. A rate emitted into block 500 is leaked forever.

Thirteen event payloads carried commercial values. The first pass of this table listed only
the numeric fields; reading the code found three more that leak through **free text**, which a
key-name grep can never catch:

| Chaincode | Event | Leaking field |
|---|---|---|
| trade-doc-cc | `POCreated` | `gross_value` |
| trade-doc-cc | `POAmended` | `changes` (may contain price) |
| trade-doc-cc | `GRNCreated` | `received_qty` |
| trade-doc-cc | `GRNAccepted` | `accepted_qty` |
| trade-doc-cc | `InvoiceSubmitted` | `amount` |
| trade-doc-cc | `InvoiceRevised` | `amount`, `quantity` |
| finance-cc | `FinanceApproved` | `approved_amount` |
| finance-cc | `FinanceDisbursed` | `disbursed_amount`, `net_disbursed` |
| finance-cc | `FinanceRepaid` | `amount` |
| trade-doc-cc | `InvoiceMatchFailed` | `reasons` — *"Invoice amount 24750000 exceeds PO gross_value 25000000"*, i.e. **both documents' figures in free text** |
| trade-doc-cc | `InvoiceRejected` / `InvoiceDisputed` | caller-supplied free-text `reason` — can contain anything |
| finance-cc | `FinanceEligibilityPassed` / `Failed` | `reasons` free text |
| onboarding-cc | `MakerCheckerThresholdSet` | `threshold` — the amount an org waves through on one signature |
| onboarding-cc | `RiskTierAssigned` | `risk_tier` — the platform's credit judgement of a member |

**Verified safe:** the only consumers read ID fields — the bridge uses `payload.invoice_id`
([api/src/services/bridge.service.ts](api/src/services/bridge.service.ts)) and the activity feed uses
`entityFromFabricPayload`, which reads `invoice_id` / `po_id` / `grn_id` / `request_id` / `org_id`
([api/src/services/activity.service.ts](api/src/services/activity.service.ts)). **Nothing downstream breaks.**

**Target payload shape:** entity type, entity ID, deal ID, status, document hash, party org IDs, timestamp.

**Files:** `chaincodes/trade-doc-cc/src/trade-doc.chaincode.ts`, `chaincodes/finance-cc/src/finance.chaincode.ts`, `chaincodes/onboarding-cc/src/onboarding.chaincode.ts`

**Commits:** one per chaincode · `test: assert no commercial fields in event payloads` (a guard test
enumerating every event and asserting its payload key set) · `docs: record event payload contract`

**Verify:** chaincode unit tests green · `npm run demo:reset && npm run demo` green ·
`npx tsx scripts/dump-events.ts` replays **committed** events off the ledger and fails on any
commercial key. A key-name grep of the source is NOT sufficient — it passes while `reasons` free
text still carries the figures, which is exactly the leak it exists to catch.

**Outcome:** 7 commits. 13 payloads scrubbed; free text banned from events outright (a standing rule,
PRIVACY-DESIGN.md §3.2.1); whitelist guard tests per chaincode so an unlisted key fails the build;
verified against the chain — 16 distinct committed events, none carrying commercial data. A
pre-existing failing API test (stale `createGRN` assertion) was fixed in its own commit.

---

## Block 2 — API quick wins + contract scanning in CI

- `helmet` and rate limiting on the Express app (`api/src/app.ts` — neither present)
- **CORS lockdown** — currently `app.use(cors())` with no origin restriction, so any site can call the API
- Request size limits and graceful shutdown draining in-flight Fabric transactions (`api/src/server.ts`)
- Slither + Mythril in a GitHub Actions workflow against `contracts/src/`

**Commits:** one per concern (4–5 small).

**Verify:** existing API tests green · a cross-origin request is rejected · Slither clean or findings triaged.

---

## Block 3 — Identity & access

> Unblocks Blocks 4 and 5. Until this lands, the audit trail is fiction and the API is open to
> anyone who can route to it.

- **Fabric CA** containers in `docker-compose.yml`; per-user enrollment and a wallet, replacing the single Admin identity read from disk in `api/src/fabric/gateway.ts`
- **JWT auth middleware** — `JWT_SECRET` already exists in `.env` and nothing consumes it
- **RBAC middleware** reading roles from `onboarding-cc` (`assignRole` already stores them)
- **Per-org Gateway connections** so a buyer's transaction endorses under `BuyerMSP` — needs a connection cache keyed by identity
- **Fabric CA attributes (ABAC)** — `dept`, `role` — required by Block 4's user-level checks
- **Secrets management** — move `POLYGON_PRIVATE_KEY` (a public Hardhat test key in `.env.example`) to a KMS/Vault-backed signer

**TDD:** required — RBAC decisions, JWT rejection paths, identity→MSP mapping.

**Commits:** ~10 small — CA compose, enrollment service, wallet, JWT middleware, RBAC middleware, per-org gateway cache, ABAC attributes, secrets provider, route wiring, docs.

**Verify:** `security-review` · unauthenticated request rejected · supplier token cannot approve a buyer invoice · demo green with real per-user identities.

**Outcome (partial).** Landed: JWT login with scrypt-hashed secrets and
enumeration-resistant failure; RBAC mounted once in `routes/index.ts` so a new
router is protected by default; per-route authorisation across trade, finance,
escrow and onboarding; auditor blocked from every mutating verb globally; a
caller identity context (`AsyncLocalStorage`) tested across await boundaries and
concurrent callers; **per-MSP endorsement** — a demo run opens six distinct
signing identities across four MSPs, so a ledger entry is attributable to a
person and an org rather than to Platform Admin; and a secrets provider that
prefers `<NAME>_FILE`, warns on env-sourced secrets in production and refuses
publicly known development keys outright.

**Still outstanding — Fabric CA.** Identities come from the cryptogen material
already in the repo, not from CA enrollment. `api/src/auth/wallet.ts` is the seam
it plugs into: CA enrollment replaces where entries come from without changing
the middleware, RBAC or the gateway. Standing the CA up means regenerating
identity material and re-creating the channel, so it is deliberately a separate
change. Until it lands:

- users cannot be enrolled or revoked at runtime — the directory is static
- ABAC attributes (`dept=treasury`) have nowhere to be asserted, so the
  user-level half of PRIVACY-DESIGN.md §6 remains open
- the cryptogen keys on disk are the signing material, which is acceptable for a
  demonstrator and not for production

---

## Block 4 — Privacy (Design 2)

> Implements [PRIVACY-DESIGN.md](PRIVACY-DESIGN.md).

- **Collection support in deploy tooling** — `scripts/deploy-chaincode.sh` has no `--collections` flag
- **Transient-data helper** in `api/src/fabric/fabric.service.ts` — `invoke`/`query` are thin wrappers over `submitTransaction`/`evaluateTransaction` with positional args; add `invokeWithTransient`
- **Split write paths** in `trade-doc-cc` and `finance-cc`: index to public state (IDs, hashes, statuses, party org IDs, Rule-02 lien markers), payload to each party's `_implicit_org_<MSPID>`
- **128-bit CSPRNG salt** per private item, generated in the API layer, passed via transient (§3.3)
- **`blockToLive: 0`** on audit-relevant collections — irreversible after creation
- **Caller-party checks** on every private-data read path — collections are not access control (§4.1)
- **Per-org filtering** on the activity feed — it replays from block 0 and serves one global feed
- **Partition MongoDB per org**; same rule for PostgreSQL in Block 9
- **Test mocks** — chaincode stub needs `getPrivateData`, `putPrivateData`, `getTransient`
- **Endorsement policies** — settle the provisional `PlatformMSP AND one-of(deal parties)` here

**Not a concern:** `finance-cc`'s `crossQuery` into `trade-doc-cc` works unchanged — verified against
Fabric 2.5 docs; the called chaincode executes in its own namespace in the same transaction context.

**TDD:** required. Headline test is the leak scenario from PRIVACY-DESIGN.md §1.1 — two deals, two
lenders, assert the non-party lender's `getPrivateData` returns empty.

**Commits:** ~12 small.

**Verify:** `security-review` · two-deal leak test · demo green · `peer chaincode query` from a non-party peer returns nothing.

---

## Block 5 — Maker-checker

> Depends on Block 3 — without per-user identities there is no maker to distinguish from a checker.

- `PendingApproval` state in each chaincode
- **Checker ≠ maker assertion** against the submitting identity
- Threshold lookup before every transition above the configured amount (`getMakerCheckerThreshold` exists)
- Approval-queue endpoints and portal UI

**TDD:** required — two simulated MSP identities; assert self-approval is rejected.

**Commits:** ~8 small.

---

## Block 6 — Bridge durability

- **Durable checkpointing** — persist last processed block per chain
- **Idempotent handlers** keyed on transaction ID
- **Retry with backoff and a dead-letter queue** — a failed Polygon write is currently lost
- **HA** — extract from the API process to a singleton worker with leader election; keep on-chain idempotency as the safety net
- **Complete the Polygon→Fabric audit write** — land the interface here, wire it in Block 8
- **Bridge lag monitoring** and a reconciliation job comparing both chains

**TDD:** required — replay the same Fabric event twice, assert one release.

**Commits:** ~8 small.

---

## Block 7 — Polygon contracts & settlement

- `Pausable` emergency stop on the vault
- Multi-sig ownership via a Safe, replacing the single platform key
- Upgradeability decision — UUPS or a documented, tested migration path
- Coverage to **≥90%** (BRD requirement)
- Replace `MockUSDC` with the real settlement token; strip `mint`
- **External security audit** — calendar time outside our control — plus remediation
- Migration to a real Polygon CDK chain with validators and re-tested gas assumptions

**TDD:** required for Pausable, access control and the upgrade path.

**Commits:** ~8 small; audit remediation as its own commits.

---

## Block 8 — Missing chaincodes

> All built to [PRIVACY-DESIGN.md](PRIVACY-DESIGN.md) from the start — retrofitting is the expensive path.

- **`audit-cc`** — audit trails, evidence packs, observer access; every other chaincode then calls `logEvent`
- **`dispute-cc`** — dispute lifecycle, evidence, mediation, holdbacks, split settlement
- **`provenance-cc`** — items, batches, chain of custody, inspections, exceptions; unlocks Rule-04, Rule-05 and the Warehouse Receipt model
- **`lender-channel` and `auditor-channel`** — everything currently runs on `buyer-supplier-channel`
- **`ReleaseConditionEvaluator.sol`** — the six conditions, now that their sources exist (see Deferred re: sanctions)
- **Chaincode upgrade path** — sequence bump with data migration, tested

**TDD:** required throughout — enumerate illegal state transitions per entity and assert each throws.

**Commits:** ~25–30, one per function group.

---

## Block 9 — Platform & ops

> Largely parallelisable with Blocks 5–8.

CI/CD pipeline · production Dockerfile (the API runs under `tsx watch`) · Prometheus + Grafana
(Fabric exposes metrics on 8443 and 9444–9448 that nothing scrapes) · at-rest encryption and TLS for
Mongo, MinIO and peer private state DBs · MongoDB replica set with auth · MinIO policies, versioning,
object-lock · PostgreSQL reporting, partitioned per org · backup/restore with tested RTO/RPO ·
idempotency keys (BRD §28) · richer error taxonomy · OpenAPI spec from the zod schemas · event
emission sweep · **ESLint config** (the root `lint` script exists but no config file does, so it
errors out; CI skips it deliberately until this lands).

**Commits:** ~14 small, one per concern.

---

## Block 10 — Portals

Real authentication and sessions · server-side fetching so the browser never holds privileged state ·
**admin portal** · **auditor portal** · error and loading states · per-environment API base config ·
accessibility and responsive passes.

**Commits:** ~10 small.

---

## Block 11 — Integrations

Real banking integration for NEFT/RTGS with signed payloads and UTR reconciliation (replacing
`api/src/adapters/bank.adapter.ts`, which contacts no bank) · ERP, WMS, TMS, DMS, e-sign and
notification adapters · idempotent inbound webhooks with replay protection.

**Commits:** one per adapter.

> Banking integration is gated by the bank's own onboarding, which routinely runs to months and is
> not in our control. Treat its duration as unknown.

---

## Block 12 — Additional finance products

`finance-cc` currently hard-rejects anything but `PreShipment` and `InvoiceDiscounting`.

- **Dynamic discounting** — buyer-funded early payment on a sliding discount. No lender, no lien, no assignment; beneficiary stays the supplier. Cheapest of the three; reuses existing machinery.
- **PO finance** — distinct from pre-shipment: anchored on buyer credit, needs an Acknowledged PO plus a buyer credit check and a different Rule-03 advance-rate basis.
- **Warehouse receipt financing** — depends on `provenance-cc` from Block 8.

**TDD:** required — discount formula, eligibility rules, Rule-02 interaction.

**Commits:** ~3–4 per product.

---

## Deferred — NOT implemented in this plan

Decided 26 September 2026. All four are in BRD scope — the three finance products under §5, the
funding models under §26A — and are deferred deliberately, not overlooked. CLAUDE.md §2 requires that nothing in BRD scope be silently omitted — this table is that
record.

| Item | Why it is safe to defer |
|---|---|
| **Reserved and CreditBacked funding models** (`FundingManager.sol`) | BRD §26A. The contract exists only for these two models, so it drops from the plan entirely, along with the treasury and credit-line integrations they require. Prefunded escrow is unaffected. **CLAUDE.md §4, §11 and §20 rule 9 describe all three models as current scope and are annotated to point here.** |
| **Sanctions screening** | No code exists today. Block 8's `ReleaseConditionEvaluator` will therefore evaluate 5 live conditions with the sanctions input **stubbed to `true`**, explicitly marked as a stub in code and docs. **This is the one deferral carrying regulatory exposure** — it must not reach a real counterparty unresolved. |
| **Post-shipment finance** | Independent product; nothing else depends on it. |
| **Dealer / distributor financing** | The most isolated of all, and the only product where the *buyer* borrows — it would force a role-model change in `onboarding-cc` plus dealer-to-lender repayment tracking needed nowhere else. |

---

## Verification (every block)

1. Unit tests for the layer touched — mocha for chaincode/Solidity, vitest for API.
2. Block-specific integration test green; all previous blocks' tests still green.
3. `npm run demo:reset && npm run demo` end-to-end green.
4. Cross-check against source of truth, never the API response alone — `peer chaincode query` for Fabric, ethers `balanceOf`/`getEscrow` for Polygon.
5. `code-review` on the block diff; `security-review` additionally on Blocks 3, 4, 6, 7.
6. Tick the block's status row above and merge into `develop-more`.

---

## Rough effort (solo)

Blocks 1–8 — the path to something a bank would pilot — is **8–9 months** including audit turnaround.
Everything through Block 12 is **12–15 months**. Block 9 mostly disappears into the other blocks.
Block 11's banking integration is the least predictable line in the plan.
