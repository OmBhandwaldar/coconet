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
| HDFC | full payload | sees the asset is liened, by which deal and party orgs (public index, §2.1); not the rate, amount or terms |
| ICICI | sees the asset is liened, by which deal and party orgs; not the rate, amount or terms | full payload |
| Platform | full payload | full payload |
| Auditor | full read of the audit record — every action, actor, hash and timestamp — but NOT collection payloads it was never a member of (§5) | same |

### 2.2.1 Where the payload actually lives — platform-custodied canonical

**Decided 27 September 2026, during implementation.** §2.2 above describes the payload going to
"each party's implicit collection". Fabric makes that costlier than it appears:

> *"the private data dissemination policy and endorsement policy for implicit organization-specific
> collections is the respective organization itself."*

Two consequences the original design did not account for:

1. **Writing to an org's implicit collection requires that org to endorse.** Writing Deal A to
   Tata's, Bharat's, HDFC's and Platform's collections means all four endorse every transaction —
   every party's peers must be online for any write to succeed.
2. **Reads inside chaincode are org-specific.** A peer can only read its own org's implicit
   collection, so a `GetPrivateData` in the 3-way match or Rule-01 eligibility returns different
   results on different endorsers, and endorsement stops matching.

**Decision: the canonical payload lives in `_implicit_org_PlatformMSP` only.**

- Platform is a party to every deal, so the canonical copy always exists and chaincode logic is
  deterministic with a single endorsing org.
- **Non-parties still never receive the bytes** — the competitor leak in §1.1 is closed, which is
  what this design exists to do. ICICI's peers hold nothing of Deal A.
- Parties read their deal through chaincode, which enforces the party check in §4.1 against the
  caller's MSP.

**What this costs.** Parties do not hold their own copy of their deal's payload; Platform is a
required custodian. That is a real concentration of trust — though Platform already holds the only
API identity and is party to every deal, so it is a concentration the architecture already had
rather than a new one. If parties must hold their own bytes for resilience or independent audit,
the upgrade path is a follow-up transaction per party endorsed by that party, replicating from the
canonical copy; the canonical read path does not change.

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

**On implicit collections this is not a setting — it is guaranteed.** Fabric: *"blockToLive is not
available, meaning that private data is never automatically purged."* Since Design 2 stores payloads
in implicit collections (§2.2), the evidence trail NFR-05 requires cannot be purged out from under
us, and there is nothing to configure.

It remains a live decision for any **named** collection added later: `0` means never purge, a
non-zero value purges after that many blocks, and it cannot be changed once the collection exists.

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

#### 3.2.1 The implemented contract

Enforced by a whitelist guard test per chaincode (`src/event-payload.test.ts`). A key nobody listed
fails the build — deliberately, so a field added later by someone who has not read this document
cannot leak silently.

| Chaincode | Allowed event payload keys |
|---|---|
| `trade-doc-cc` | `po_id`, `grn_id`, `invoice_id`, `buyer_id`, `supplier_id`, `assigned_to`, `status`, `doc_hash`, `changed_fields`, `failed_checks` |
| `finance-cc` | `request_id`, `asset_id`, `asset_type`, `product_type`, `lender_id`, `status`, `failed_checks` |
| `onboarding-cc` | `org_id`, `org_type`, `msp_id`, `status`, `role`, `tx_type` |

Removed in the Block 1 scrub (NEW-PLAN.md):

| Event | Was carrying |
|---|---|
| `POCreated` | `gross_value` |
| `POAmended` | `changes` — the amended values themselves; now `changed_fields`, the names only |
| `GRNCreated` | `received_qty` |
| `GRNAccepted` | `accepted_qty` |
| `InvoiceSubmitted` | `amount` |
| `InvoiceRevised` | `amount`, `quantity` |
| `InvoiceMatchFailed` | `reasons` — free text of the form *"Invoice amount 24750000 exceeds PO gross_value 25000000"*, i.e. both documents' figures; now `failed_checks` |
| `InvoiceRejected` / `InvoiceDisputed` | caller-supplied free-text `reason` |
| `FinanceApproved` | `approved_amount` |
| `FinanceDisbursed` | `disbursed_amount`, `net_disbursed` |
| `FinanceRepaid` | `amount` |
| `FinanceEligibilityPassed` / `Failed` | `reasons` free text; now `failed_checks` |
| `MakerCheckerThresholdSet` | `threshold` — the amount above which an org needs a second signature |
| `RiskTierAssigned` | `risk_tier` — the platform's credit judgement of a member |

**Two standing rules that follow from this:**

1. **No free text in an event, ever.** Reason and justification strings are caller-supplied or
   built from document figures; both stay in state. Events carry check *names*, not explanations.
2. **Consumers may depend on identifiers only.** The bridge reads `invoice_id` and the activity feed
   derives the deal code from the entity id — both hold under this contract. Anything needing a
   figure must read state as an entitled party, never listen for it.

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

**Settled 27 September 2026, empirically.** The provisional `PlatformMSP AND one-of(deal parties)`
does not survive contact with Fabric. Three things forced the answer:

1. The gateway **will not disclose transient data to peers outside its own organisation** — a
   buyer's submission failed with *"no endorsers found in the gateway's organization; retry
   specifying endorsing organization(s) to protect transient data"*. Transient submissions must name
   their endorsing org explicitly.
2. Only the **owning org can endorse a write to its implicit collection**, and the canonical payload
   lives in Platform's (§2.2.1). So Platform, and only Platform, can endorse these writes.
3. With the default majority-of-orgs policy, a Platform-only endorsement then failed to commit with
   `ENDORSEMENT_POLICY_FAILURE`.

**The policy is therefore `OR('PlatformMSP.member')`** for every chaincode that writes private data —
currently `trade-doc-cc`, and `finance-cc` because it cross-invokes it (a transaction must satisfy
both chaincodes' policies, so they have to agree).

**This is a real centralisation, and it should be stated plainly.** Trade documents and financing
records are endorsed by one organisation. The *signature* on the transaction is still the acting
user's, so attribution under NFR-05 holds — Rajesh's PO is signed by Rajesh — but the endorsement
that makes it valid comes from Platform alone. A consortium member cannot independently verify a
write by endorsing it.

That is the price of platform-custodied private data (§2.2.1), and it is the same trade-off in a
different guise: whoever holds the only copy is the only one who can attest to it. If the consortium
needs independent endorsement, the route is party-held copies — each party endorsing writes to its
own collection — which is the upgrade path §2.2.1 records.

**Deferred deliberately, and safely.** Endorsement policy lives in the chaincode definition and
changes with a sequence bump — no data migration. State-based endorsement (`setStateValidationParameter`,
available in the shim already in use) can pin a per-deal policy to individual keys later. Settle this
at the deployment where collections first go live, when the real org set is known.

**How it is actually expressed.** `PlatformMSP AND one-of(deal parties)` cannot be written as a
static chaincode-level policy — the party set differs per deal, which is the same unsatisfiability
described above. It must be realised either as a collection-level `endorsementPolicy` (which
overrides the chaincode-level policy and restricts endorsers to collection members) or as
state-based endorsement pinned per key. Treat the phrase as the *intent*; the mechanism is one of
those two, chosen at first collections deployment.

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

**Both paths assume one channel, and that assumption has an expiry date.** `CHANNEL` is hardcoded in
`finance-cc` and today every chaincode lives on `buyer-supplier-channel`. Adding `lender-channel`
breaks this: `InvokeChaincode` across channels returns only the Response and **any `PutState` from
the called chaincode is discarded**. `crossInvoke`
([finance.chaincode.ts:296](chaincodes/finance-cc/src/finance.chaincode.ts#L296)) is the
state-changing path — it carries the atomic Rule-02 lien lock, writing `LOCK:<asset>` and
cross-invoking `lockPO`/`assignInvoice` in one transaction so the lien and the asset status commit
together. **That atomicity cannot survive a channel split.** Before `finance-cc` moves to
`lender-channel`, decide one of: keep both chaincodes co-channel, move the lien to an event-driven
saga with compensation, or keep the asset-status write in `trade-doc-cc`'s own transaction. Open
question, owned by the channel-separation work.

### 4.1 Consequence — collections are not access control

Fabric is explicit that *"private data collections do not by themselves limit access control within
chaincode."* For implicit collections it is stronger still — *"memberOnlyRead and memberOnlyWrite are
not available"* — so there is no declarative access control to fall back on at all. Any chaincode on the channel, and any client reaching a peer that holds the data, can
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
| `onboarding-cc` | Small but not zero. Org records are legitimately network-wide, but the risk tier and maker-checker threshold are not (scrubbed from events in Block 1; the stored values still need read-path scoping). `sanctionsResultPDC` has **no implementation at all** — no sanctions code exists anywhere in the repo — so §2.4's row for it describes intent, not state. |
| `provenance-cc`, `dispute-cc`, `audit-cc` | **Not yet written — build to this design from the start.** Retrofitting is the expensive path. |
| `api/src/services/*` | Pass payloads as transient data; **generate a 128-bit CSPRNG salt per private item** (§3.3); read as the requesting org rather than as Platform. |
| `activity-feed.service.ts` | Per-org filtering; stop serving one global feed. |
| `scripts/deploy-chaincode.sh` | No `--collections` flag today. Needs collection config and per-collection endorsement policy support. |
| Chaincode unit tests | Mock stub needs `getPrivateData`, `putPrivateData`, `getTransient`. |
| API integration tests | Chains are mocked; expected to survive unchanged. |
| MongoDB / PostgreSQL | Partition per org (§3.5). |

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
- Final endorsement policy shape (provisional in §3.6).
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

---

## 11. Known limitations (accepted)

Things that are true of the system as built, decided deliberately rather than overlooked. Each is
accepted for a pilot and carries its upgrade path.

### 11.1 A single organisation endorses trade and finance writes

**Accepted 1 October 2026.** Endorsement is `OR('PlatformMSP.member')` (§3.6). No consortium member
can independently endorse a trade document or financing record.

Attribution is unaffected — the transaction still carries the acting user's signature, so Rajesh's
purchase order is signed by Rajesh and NFR-05 holds. What is lost is *independent attestation*: the
endorsement that makes the write valid comes from Platform alone, so a member cannot verify a write
by endorsing it.

This follows directly from platform-custodied payloads (§2.2.1) — whoever holds the only copy is
the only one who can attest to it — and from Fabric's rule that only the owning org endorses writes
to its implicit collection.

**Why accepted:** Platform is already the operator of record, is party to every deal, and holds the
only API identity. The concentration is one the architecture had before this change; endorsement
makes it visible rather than creating it.

**Upgrade path:** party-held copies (§2.2.1) — each party endorsing writes to its own collection.
This restores independent endorsement and gives each member its own bytes, at the cost of every
write needing all deal parties online to endorse. Nothing built so far has to be discarded to get
there; the canonical read path does not change.

**Raise this proactively** with any counterparty whose risk function asks who can attest to a
record. It is a reasonable answer for a pilot and a poor one to be caught out by.

---

## 12. Decision log

Every decision taken on this architecture, newest last. Entries here are **decided** — see §9 for
what remains open.

| # | Date | Decision | Where | Why |
|---|---|---|---|---|
| 1 | 25 Sep 2026 | **Channel = membership boundary, collection = deal boundary.** Channel public state holds index data only. | §2 | Role-scoped PDCs leak between competitors once a second lender or buyer joins (BR-10); a collection policy names orgs, not deals. |
| 2 | 25 Sep 2026 | **Per-deal implicit collections**, not named pairwise collections. | §2.2, §2.5 | Named collections need a chaincode redeploy for every new member and grow combinatorially. |
| 3 | 25 Sep 2026 | **Payloads travel as transient data**, never as chaincode arguments. | §2.2 | Arguments appear in the proposal every endorser and the orderer sees. |
| 4 | 25 Sep 2026 | **No commercial data in chaincode event payloads, ever.** No free text either. | §3.2 | Events reach every channel member and are immutable — there is no retroactive fix. |
| 5 | 25 Sep 2026 | **Every private payload carries a 128-bit CSPRNG salt**, one per item, generated client-side. | §3.3 | Fabric publishes the hash of every private value; a discount rate or round amount is otherwise brute-forceable. |
| 6 | 25 Sep 2026 | **No application-level encryption** of channel state or collection payloads. At-rest encryption is infrastructure. | §3.4 | Members are entitled to the data; encrypting index data breaks Rule-02 and cross-chain correlation. |
| 7 | 25 Sep 2026 | **Off-chain stores partitioned per org.** | §3.5 | Pooling off-chain recreates every on-chain leak somewhere easier to exfiltrate. |
| 8 | 25 Sep 2026 | **Caller-party checks mandatory on every private read path.** | §4.1 | Collections control who holds data, not who may ask for it; implicit collections have no `memberOnlyRead`. |
| 9 | 26 Sep 2026 | **Deferred from scope:** Reserved/CreditBacked funding (and `FundingManager.sol`), sanctions screening, post-shipment finance, dealer financing. | [NEW-PLAN.md](NEW-PLAN.md) | Deliberate scope reduction. Sanctions is flagged as the deferral carrying regulatory exposure. |
| 10 | 26 Sep 2026 | **Identity model built on cryptogen material; Fabric CA deferred.** `wallet.ts` is the seam. | [NEW-PLAN.md](NEW-PLAN.md) Block 3 | CA enrollment replaces where identities come from without changing middleware, RBAC or the gateway. |
| 11 | 27 Sep 2026 | **Platform-custodied canonical payload** — the payload lives in `_implicit_org_PlatformMSP` alone, not in every party's collection. | §2.2.1 | Writing to an org's implicit collection requires that org to endorse, and chaincode reads of org-specific collections are non-deterministic across endorsers. |
| 12 | 27 Sep 2026 | **`blockToLive` is not configured** — it is unavailable on implicit collections, which never purge. Corrects decision 5's original wording. | §3.1 | Fabric: *"blockToLive is not available, meaning that private data is never automatically purged."* The NFR-05 trail is guaranteed, not configured. |
| 13 | 27 Sep 2026 | **Endorsement policy is `OR('PlatformMSP.member')`** for every chaincode writing private data, and for `finance-cc` because it cross-invokes `trade-doc-cc`. | §3.6 | Found empirically in three steps: the gateway will not disclose transient data outside its own org; only the owning org endorses writes to its implicit collection; a Platform-only endorsement then failed to commit under majority-of-orgs. |
| 14 | 1 Oct 2026 | **Accept single-org endorsement as a known limitation** rather than rebuild for party-held copies. | §11.1 | Platform is already the operator of record and party to every deal. Upgrade path recorded; nothing built is discarded by taking it later. |

| 15 | 1 Oct 2026 | **Salt generated client-side for deal payloads, from the transaction id inside chaincode.** | §3.3 | Chaincode must be deterministic — every endorser has to compute the same value, so `crypto.randomBytes` is unusable there. The tx id is the only entropy available. |
| 16 | 1 Oct 2026 | **Assignment adds the assignee to the asset's party set.** | §2.1 | Discounting transfers the receivable; without this the lender owned an invoice it could not read, which surfaced as the net-settlement maths producing `NaN`. |
| 17 | 1 Oct 2026 | **Indexes are rebuilt field by field, never spread from the merged view.** | §2.1 | Spreading publishes the payload the collection exists to hide, and a field added later leaks silently. Two real leaks were shipped this way before the rule was adopted. |
| 18 | 1 Oct 2026 | **The activity feed is scoped to the viewer's own deals.** | §3.2 | Payloads no longer carry figures, but a global feed still reveals who trades with whom and how often. |
| 19 | 1 Oct 2026 | **Organisation risk tier and maker-checker thresholds are private**, visible to the platform and the organisation itself. | §2.1 | Removing them from events and redacting them in the API left them in channel state, which every member's peer reads directly. |

| 20 | 1 Oct 2026 | **The approval record is split like every other entity**: who must sign is public, the amount under approval and the threshold it breached are private. | §2.1 | An approval record with a public amount would announce the value of every large deal — the leak §1.1 exists to close, reintroduced through the audit trail. Verified live: a non-party lender reads the signers, not the ₹2.5cr. |
| 21 | 1 Oct 2026 | **Checker ≠ maker is asserted on X.509 identity**, `ctx.clientIdentity.getID()`, not on MSP. | §2.1 | Two users of the same organisation are the point; comparing MSPs would compare a value equal by construction. This is what Block 3's per-caller gateway was built for. |
| 22 | 1 Oct 2026 | **A parked transition returns a pending result; it does not throw.** The API answers 202. | §2.1 | Fabric has no way to write state and abort — a thrown error would roll back the approval record along with the transition, so the gate must return and the caller must distinguish the two shapes. |
| 23 | 1 Oct 2026 | **The checker commits the maker's figure, replayed from the approval record.** | §2.1 | Otherwise maker-checker counts signatures without constraining what was signed: a checker could approve one amount and commit another. The checker sends no transient data at all. |
| 24 | 1 Oct 2026 | **An unset threshold is zero — everything needs two signatures — and a failed threshold lookup aborts the transition.** | §2.1 | Fails closed. A forgotten configuration becomes loud rather than permissive, and an unreachable onboarding-cc cannot downgrade a transition to one signature. |
| 25 | 1 Oct 2026 | **Entitlement to an organisation's thresholds is the authority to act on its behalf.** | §2.1 | `getOrganization` returns thresholds only to the org itself or the platform (decision 19), so their absence is the access decision. A supplier can no longer approve the invoice it raised. |

**Keep this current.** Any decision that changes data placement, endorsement, or what a non-party can
see gets a row here on the same commit that implements it.
