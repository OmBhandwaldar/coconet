# PRIVACY-DESIGN.md — Data Visibility Architecture (DECIDED)

**Status:** Decided — 25 September 2026. Supersedes the PDC table in CLAUDE.md §5 as originally written.
**Scope:** How trade, financing and escrow data is partitioned across Fabric channels, private data
collections and chaincode access control, so that non-participating members cannot see a deal's
commercial detail — BRD **NFR-06** (privacy) and **BR-06** (selective data visibility), under
**BR-10** (multi-anchor, multi-supplier, multi-lender).

This document is authoritative for any work touching data placement. Treat it the way the dual-chain
split is treated: **decided, not open for re-proposal.**

---

## 1. Why the original design does not hold

CLAUDE.md §5 and [MVP-PLAN.md](MVP-PLAN.md) Ring 4 specify three collections scoped by **role**:

| PDC | Members as originally specified |
|---|---|
| `financingTermsPDC` | Lender + Supplier |
| `escrowAmountsPDC` | Buyer treasury |
| `sanctionsResultPDC` | Platform |

A Fabric collection's membership policy names **organizations**, not deals. With a single buyer,
supplier and lender on the network this is indistinguishable from per-deal privacy. The moment a
second lender or second buyer joins — which BR-10 explicitly requires — role-scoped collections
leak between direct competitors.

### 1.1 Worked leak analysis

Network: buyers **Tata Motors**, **Mahindra**; supplier **Bharat Stampings** (party to both deals);
lenders **HDFC**, **ICICI**; plus Platform and Auditor.

- **Deal A** — Tata buys from Bharat. PO ₹2.50 cr, invoice ₹2.47 cr, discounted by HDFC at **2.0%**.
- **Deal B** — Mahindra buys from Bharat. PO ₹1.85 cr, invoice ₹1.80 cr, discounted by ICICI at **3.5%**.

Under role-scoped collections:

| Org | Deal A | Deal B |
|---|---|---|
| Tata | correct | **LEAK** — reads Mahindra's PO and invoice from channel state |
| Mahindra | **LEAK** — reads Tata's PO, invoice and escrow amount | correct |
| Bharat | correct (party to both) | correct |
| HDFC | correct | **LEAK** — reads ICICI's 3.5% from `financingTermsPDC` |
| ICICI | **LEAK** — reads HDFC's 2.0% from `financingTermsPDC` | correct |
| Auditor | sees nothing (nothing replicated to its channel) | sees nothing |

Four leaks, three of them between competitors. ICICI learns HDFC's pricing for a shared client;
Tata learns what Mahindra pays for the same parts from the same supplier.

### 1.2 Why this cannot be patched in chaincode

Once private data is disseminated to a collection member, it is written to that organization's
private state database on its own peers. Those operators can query CouchDB directly and bypass
chaincode entirely. **A read check in chaincode is a convenience, not a boundary.** Confidentiality
between two orgs requires that the bytes never reach the second org's peers.

---

## 2. The decision — Design 2

> **The channel is the membership boundary. The collection is the deal boundary.
> Nothing commercially sensitive is ever written to channel public state.**

Three layers, each doing one job:

| Layer | Enforces | Boundary strength |
|---|---|---|
| **Channel** | who may transact on the network at all | cryptographic — non-members never receive blocks |
| **Private data collection** | which orgs hold a given deal's payload | cryptographic — non-members never receive the bytes |
| **Chaincode + ABAC** | which *users* within a member org may read/act | soft — stops users, not that org's own peer admins |

### 2.1 What goes where

**Channel public state — an index only.** Enough to enforce rules and correlate across chains,
and nothing a competitor can monetise:

- deal ID, document IDs (`po_id`, `grn_id`, `invoice_id`, `request_id`, `escrowPaymentId`)
- document SHA-256 hashes
- status / state-machine position (`Issued`, `Approved`, `Assigned`, `Funded`, `Released`)
- the **org IDs** of the parties to the deal
- lien markers for Rule-02 (`LOCK:<asset>` — a boolean plus the deal it belongs to)

**Private collections — everything else.** Amounts, unit prices, line items, quantities, discount
rates, interest, tenor, advance rates, fee schedules, escrow amounts, beneficiary account details,
sanctions results, inspection findings, dispute evidence.

**Rule-02 still works on public state**, because duplicate-financing prevention only needs "is this
asset already liened, and under which deal" — never the rate.

### 2.2 Implicit collections, per deal

Every org automatically has an implicit collection `_implicit_org_<MSPID>` for every chaincode —
no `collections_config.json` entry and **no chaincode redeploy when a new org joins**. This is the
decisive advantage over named pairwise collections, which would need a redeploy per new member and
grow combinatorially.

For each deal, the chaincode computes the party set and writes the payload into the implicit
collection of **each party org only**:

- Deal A → `_implicit_org_TataMSP`, `_implicit_org_BharatMSP`, `_implicit_org_HDFCMSP`, `_implicit_org_PlatformMSP`
- Deal B → `_implicit_org_MahindraMSP`, `_implicit_org_BharatMSP`, `_implicit_org_ICICIMSP`, `_implicit_org_PlatformMSP`

ICICI's peers never receive Deal A's bytes. Not through gossip, not on request, not ever.

Payloads are passed in as **transient data**, never as ordinary chaincode arguments, so the value
does not appear in the transaction proposal that endorsers and the orderer see.

Resulting visibility:

| Org | Deal A | Deal B |
|---|---|---|
| Tata | full payload | ID + status only |
| Mahindra | ID + status only | full payload |
| Bharat | full payload | full payload (party to both) |
| HDFC | full payload | sees asset is liened; not by whom, not at what rate |
| ICICI | sees asset is liened | full payload |
| Platform | full payload | full payload |
| Auditor | full read via replicated audit records | full read |

### 2.3 Collections are per chaincode namespace

`_implicit_org_HDFCMSP` under `trade-doc-cc` is a **different store** from the same-named collection
under `finance-cc`. A chaincode can only resolve collections defined in its own namespace; calling
`GetPrivateData` against another chaincode's collection fails with *"collection not defined for
chaincode namespace."* See §4 for how cross-chaincode reads are done correctly.

### 2.4 Fate of the three original PDCs

| PDC | Decision |
|---|---|
| `sanctionsResultPDC` | **Keep as specified.** Platform-only is genuinely one org, so role-scope and deal-scope coincide. |
| `escrowAmountsPDC` | **Keep, buyer-scoped, plus ABAC.** The org boundary is correct (it is the buyer's own money); the "treasury only" part is a *user-level* restriction and needs Fabric CA attributes (§6), not a collection. |
| `financingTermsPDC` | **Replaced** by per-deal implicit collections. This is the one that leaks under BR-10. |


### 2.5 Alternatives considered and rejected

| Option | Why rejected |
|---|---|
| **Named pairwise collections** (one per buyer-supplier-lender combination) | Requires a `collections_config.json` entry and a **chaincode redeploy for every new member**, and grows combinatorially with the org set. Directly conflicts with BR-10's multi-party programmes. |
| **Encrypt payloads inside a shared role-scoped collection** | Simpler to deploy, but moves the whole problem into key management (distribution, rotation, revocation on member exit) and destroys queryability — CouchDB rich queries cannot read ciphertext. Compromise of one key retroactively exposes every deal in the collection. |
| **Keep role-scoped collections and filter reads in chaincode** | Not a boundary. The bytes are already in the member org's private state DB; its operators read CouchDB directly and bypass chaincode (§1.2). |
| **One channel per buyer-supplier relationship** | Genuine isolation, but channel count explodes, cross-deal queries become impossible, and each new relationship needs channel creation and chaincode deployment. Also fragments the shared event chain that is the platform's premise. |

---

## 3. Decided parameters

### 3.1 `blockToLive: 0` — never purge

Set on every collection carrying audit-relevant data. The default purges private data after N
blocks, which would destroy the evidence trail NFR-05 requires.

**This is irreversible.** `blockToLive` cannot be modified on an existing collection — Fabric
requires a consistent value regardless of a peer's block height. It must be correct at creation.

### 3.2 Chaincode events must carry no commercial payload

**The highest-priority action item, and the one with no retroactive fix.**

Chaincode events are delivered to **every channel member** regardless of collection membership, and
they are immutable once in a block. An amount or rate emitted into block 500 is leaked permanently —
no later redesign recovers it.

Event payloads are therefore restricted to: entity type, entity ID, deal ID, new status, document
hash, party org IDs, timestamp. **Never** amounts, rates, quantities, prices or account details.

This surface is live today: [api/src/services/activity-feed.service.ts](api/src/services/activity-feed.service.ts)
replays chaincode events from block 0 and serves them globally. Two follow-on requirements:

1. Audit and strip every `setEvent` payload in all three chaincodes.
2. Filter the activity feed per requesting org, rather than serving one global feed.

### 3.3 Every private payload carries a random salt

**Fabric writes a hash of every private data item to the channel ledger of every peer on the
channel.** Collections hide the value, not its existence — and a hash of a predictable value is not
a secret.

Fabric documents the attack directly: *"If the private data is relatively simple and predictable
(e.g. transaction dollar amount), channel members who are not authorized to the private data
collection could try to guess the content of the private data via brute force hashing of the domain
space, in hopes of finding a match with the private data hash on the chain."*

Our data is precisely this case. A discount rate lives in a domain of a few hundred plausible values
(0.5% to 6.0% in basis points). An invoice amount is usually round. ICICI, holding Deal A's public
hash, could brute-force HDFC's 2.0% in milliseconds — defeating Design 2 for the exact field it was
built to protect.

**Decision: every private data value includes a random salt**, concatenated with the private data
key and carried in the value, per Fabric's own mitigation: *"Private data that is predictable should
therefore include a random 'salt' that is concatenated with the private data key and included in the
private data value, so that a matching hash cannot realistically be found via brute force."*

Rules:
- The salt is generated **client-side** (API layer) and passed through the **transient field** —
  never derived in chaincode from deterministic inputs such as the tx ID, which endorsers must
  agree on and attackers can see.
- At least 128 bits from a CSPRNG.
- One fresh salt **per private data item**, not per deal — reusing a salt across a deal's items
  lets one cracked value unlock the rest.
- The salt is stored inside the private value, so parties reading the collection get it for free;
  non-members get neither salt nor value.
- This applies to **every** collection carrying guessable data: per-deal payloads,
  `escrowAmountsPDC`, and `sanctionsResultPDC` (a boolean pass/fail is maximally guessable).

### 3.4 No application-level encryption — of channel state or collection payloads

Decided explicitly, because it is the obvious next question after §3.3 and the answer is not "more
crypto".

| Where | Encrypt? | Why |
|---|---|---|
| **Channel public state** | **No** | It holds only IDs, hashes, statuses and lien markers. Encrypting breaks what they exist for: Rule-02 must read the lien marker, and the bridge must read `escrowPaymentId` in the clear to correlate across chains. Document hashes are already one-way. |
| **Private collection payloads** | **No** | Every org in a deal's collection is entitled to the data — that is why it was disseminated to them. Either they hold the key (encryption protects nothing from them) or they do not (the data is useless to them). Against non-parties, collection membership already prevents delivery. Cost without benefit: key distribution, rotation, revocation on member exit, and loss of CouchDB rich queries over private data. |
| **Private state DB, MongoDB, MinIO at rest** | **Yes — at the infrastructure layer** | NFR-01. Disk/volume encryption and the stores' own at-rest encryption. Not a chaincode concern. |
| **In transit** | **Yes** | TLS is already enabled network-wide; keep it for Mongo and MinIO too. |

**The hash exposure is closed by the salt (§3.3), not by encryption.** Reaching for encryption to
solve it would be treating the symptom with the wrong tool.

**One open exception.** `escrowAmountsPDC` scoped to "buyer treasury only" is a *user-level* boundary
inside a single org, and the ABAC check in §6 is soft — it does not stop that org's own peer
administrators. If that boundary ever needs to be hard, encrypting the value under a key held only
by the treasury role is the correct mechanism, precisely because the data rests on peers whose
operators should not read it. This is the inverse of the collection case and the only place
application-level encryption earns its cost. Left open; not required today.

### 3.5 Off-chain stores must be partitioned per org

MongoDB and the planned PostgreSQL reporting database must be partitioned by organization. Isolating
data on-chain and then pooling it in the query layer reproduces every leak in §1.1 outside the
ledger, where it is easier to exfiltrate.

### 3.6 Endorsement policy — provisional, deliberately deferred

Fabric requires that **the private data distribution policy be broader than the endorsement policy**,
because a peer must hold the private data in order to endorse a transaction that touches it. With
deal-scoped collections, endorsers must be deal parties — so a static chaincode-level policy such as
"majority of orgs" becomes unsatisfiable once the network has more orgs than any single deal has
parties.

**Provisional decision:** Platform is a party to every deal and therefore always holds the data, so
use **`PlatformMSP AND one-of(deal parties)`**. Always satisfiable however many orgs join. The cost
is trust concentration in Platform, which the architecture already assumes.

**Deferred deliberately, and safely.** Endorsement policy lives in the chaincode definition and
changes with a sequence bump — no data migration. State-based endorsement (`setStateValidationParameter`,
available in the shim already in use) can pin a per-deal policy to individual keys later. Settle this
at the deployment where collections first go live, when the real org set is known.

Collection-level `endorsementPolicy` can override the chaincode-level policy and restrict endorsers
to collection members; that is the mechanism to reach for if the provisional policy proves too coarse.

---

## 4. Cross-chaincode reads — verified behaviour

`finance-cc` reads POs and invoices from `trade-doc-cc` via `invokeChaincode`
([finance.chaincode.ts:285](chaincodes/finance-cc/src/finance.chaincode.ts#L285)) to enforce Rule-01
against on-chain state rather than API-supplied data.

**This pattern survives Design 2 unchanged, and was verified against Fabric 2.5 documentation.**
`InvokeChaincode` executes the called chaincode in the *same transaction context* on the same
channel, adding its read/write set to the calling transaction. The called chaincode runs in **its
own namespace**, so `trade-doc-cc.getInvoice()` resolving its own `GetPrivateData` works, and the
value returns to `finance-cc` in the response.

The narrower restriction in §2.3 still applies: `finance-cc` must go *through* `trade-doc-cc`, and
may not address `trade-doc-cc`'s collections directly.

### 4.1 Consequence — collections are not access control

Fabric is explicit that *"private data collections do not by themselves limit access control within
chaincode."* Any chaincode on the channel, and any client reaching a peer that holds the data, can
invoke `trade-doc-cc.getInvoice` and receive private data.

**Therefore every read path returning private data must verify the caller against the deal's party
list before returning.** Without this, `crossQuery` is an open door. This is a mandatory chaincode
change, not an optional hardening.

---

## 5. Channels

Three channels remain as per CLAUDE.md §5, but their job is narrowed to **membership**, not
confidentiality — deal-level separation is the collections' job (§2.2):

| Channel | Members | Holds |
|---|---|---|
| `buyer-supplier-channel` | all buyers, all suppliers, Platform | trade document index + per-deal collections |
| `lender-channel` | all lenders, all suppliers, Platform | finance request index + per-deal collections |
| `auditor-channel` | Auditor, Platform (read-only) | replicated audit records from `audit-cc` |

The auditor sees everything it is entitled to via records replicated to its channel, and still
cannot read a financing rate — it was never a member of the collection that held it.

---

## 6. User-level access (ABAC)

Collections bind to organizations, so `escrowAmountsPDC` scoped to the buyer means *every user at
Tata*, not Tata's treasury team. Closing that gap requires **Fabric CA attributes** (for example
`dept=treasury`, `role=checker`) asserted in each user's X.509 certificate and checked in chaincode
via the client identity library.

This is a **soft boundary** — it stops ordinary users, not that org's own peer administrators. That
is acceptable here, because the data in question belongs to the org doing the enforcing. It is *not*
acceptable as a substitute for collection membership between different orgs (§1.2).

Depends on Fabric CA per-user identities, currently unbuilt: the API connects as a single hardcoded
Platform Admin ([api/src/fabric/gateway.ts](api/src/fabric/gateway.ts)).

---

## 7. Impact on existing code

| Component | Change required |
|---|---|
| `trade-doc-cc` | Split writes: index to public state, payload to party implicit collections via transient data. Add caller-party checks on every getter. Strip event payloads. |
| `finance-cc` | Same split. Financing terms move off the main channel — this closes the known gap logged in MVP-PLAN Block 4. `crossQuery` unchanged (§4). |
| `onboarding-cc` | Minimal. Org records are legitimately network-wide; sanctions results already platform-only. |
| `provenance-cc`, `dispute-cc`, `audit-cc` | **Not yet written — build to this design from the start.** Retrofitting is the expensive path. |
| `api/src/services/*` | Pass payloads as transient data; **generate a 128-bit CSPRNG salt per private item** (§3.3); read as the requesting org rather than as Platform. |
| `activity-feed.service.ts` | Per-org filtering; stop serving one global feed. |
| `scripts/deploy-chaincode.sh` | No `--collections` flag today. Needs collection config and per-collection endorsement policy support. |
| Chaincode unit tests | Mock stub needs `getPrivateData`, `putPrivateData`, `getTransient`. |
| API integration tests | Chains are mocked; expected to survive unchanged. |
| MongoDB / PostgreSQL | Partition per org (§3.3). |

---

## 8. Sequencing

Ordered by cost-of-delay, not by size:

1. **Strip commercial data from chaincode event payloads** (§3.2). No retroactive fix exists; do this before any real data is committed.
2. **Record this design** — done, this file.
3. **Refactor `trade-doc-cc` and `finance-cc` write paths** to transient data + party implicit collections, with `blockToLive: 0` and a per-item random salt (§3.3).
4. **Add caller-party checks** to every private-data read path (§4.1).
5. **Per-org activity feed filtering.**
6. **Deploy tooling** — collection config support in the deploy script.
7. **Endorsement policy** — settle at first collections deployment (§3.6).
8. **ABAC** — with Fabric CA per-user identities.

Doing 3 and 4 **before** `provenance-cc`, `dispute-cc` and `audit-cc` are written is materially
cheaper than after; all three would otherwise need rewriting.

---

## 9. Decided vs open

**Decided — do not re-propose:**
- Channel = membership boundary; collection = deal boundary; channel state holds index data only.
- Per-deal implicit collections over named pairwise collections (no redeploy on new members).
- Payloads via transient data, never as chaincode arguments.
- `blockToLive: 0` on audit-relevant collections.
- Every private payload carries a client-generated 128-bit random salt (hashes are public; predictable values are brute-forceable).
- No commercial data in chaincode event payloads, ever.
- `financingTermsPDC` replaced; `sanctionsResultPDC` unchanged; `escrowAmountsPDC` retained plus ABAC.
- Off-chain stores partitioned per org.
- **No application-level encryption** of channel state or collection payloads; at-rest encryption handled at the infrastructure layer (§3.4).
- Caller-party checks mandatory on every private-data read path.

**Open:**
- Final endorsement policy shape (provisional in §3.4).
- Exact ABAC attribute taxonomy, pending Fabric CA work.
- Whether auditor records are replicated by the bridge, by `audit-cc`, or by a dedicated service.
- Whether `escrowAmountsPDC` needs value-level encryption to make "treasury only" a hard boundary (§3.4).

---

## 10. References

- [Private data collection definition — Fabric 2.5](https://hyperledger-fabric.readthedocs.io/en/release-2.5/private-data-arch.html) — `blockToLive`, distribution vs endorsement policy, collection-level `endorsementPolicy`
- [Private data concepts — Fabric 2.5](https://hyperledger-fabric.readthedocs.io/en/release-2.5/private-data/private-data.html) — collections are not access control; `GetPrivateDataHash`
- [Go shim `InvokeChaincode` / `GetPrivateData`](https://pkg.go.dev/github.com/hyperledger/fabric-chaincode-go/shim) — same-transaction-context semantics
- [fabric-shim `ChaincodeStub` API](https://hyperledger.github.io/fabric-chaincode-node/main/api/fabric-shim.ChaincodeStub.html) — `setStateValidationParameter` for state-based endorsement
- BRD/SRS v1.1 §7 (BR-06, BR-10), §19 (NFR-05, NFR-06)
- [CLAUDE.md](CLAUDE.md) §5 — channel and PDC overview, now pointing here
- [MVP-PLAN.md](MVP-PLAN.md) Ring 4 — original PDC plan, superseded by this document
