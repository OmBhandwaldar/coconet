# DEMO.md — Presenter Walkthrough

How to run and narrate the CocoNet MVP demo: the **Tata Motors → Bharat Stampings → HDFC Bank**
deal, end-to-end across Hyperledger Fabric and Polygon.

## Run it

```bash
npm run demo:reset     # from zero (≈2–3 min: stack + channel + chaincodes + contracts)
npm run dev            # Terminal 1 — API + bridge
npm run demo           # Terminal 2 — the flow (≈10s), prints a settlement summary
```

`npm run demo` asserts every step and exits non-zero on any failure, so a green run is a real
pass. Re-runnable without reset (unique run-id each time).

## The story it tells

| Demo step | What happens | Chain |
|---|---|---|
| Onboarding | Tata (buyer), Bharat (supplier), HDFC (lender) registered + approved | Fabric `onboarding-cc` |
| 1–2 | Tata issues a PO (₹2,50,00,000 / $271,739); Bharat acknowledges | Fabric `trade-doc-cc` |
| 3–3A | Bharat takes ₹1,20,00,000 / $130,435 pre-shipment finance from HDFC → **PO locked** (lien Perfected, Rule-02) | Fabric `finance-cc` (cross-reads `trade-doc-cc`) |
| 7–9 | GRN accepted; Bharat raises invoice (₹2,47,50,000 / $269,022); **3-way match** passes; Tata approves | Fabric `trade-doc-cc` |
| 10–10A | HDFC discounts the invoice; **net settlement** auto-repays the pre-shipment loan → Bharat nets ₹1,20,77,466 / $131,277; invoice assigned to HDFC | Fabric `finance-cc` (service computes net) |
| 11 | Tata creates an escrow to HDFC and **funds $269,022 USDC** into the vault | Polygon `EscrowFactory`/`EscrowVault` |
| 12–13 | Tata approves the escrow's invoice on Fabric → **the bridge flips the Polygon condition → escrow auto-releases $269,022 to HDFC** | **Fabric → bridge → Polygon** |
| Sad path | A second escrow is funded, then **refunded to the buyer before release** ($50,000 returned) — Rule-0C | Polygon `EscrowVault.refund` |

## The moment to highlight

The cross-chain release. When the invoice is approved **on Fabric**, the bridge picks up the
`InvoiceApproved` event, flips the condition **on Polygon**, and — funded + approved both true —
the `EscrowVault` releases real USDC to HDFC. Correlation key across both chains: `escrowPaymentId`.

**Show the money actually moved** (don't trust the API alone):
```bash
# HDFC's USDC balance on Polygon, before and after the demo
node -e "const{ethers}=require('ethers');(async()=>{const p=new ethers.JsonRpcProvider('http://localhost:8545');\
const t=new ethers.Contract(process.env.USDC_ADDRESS||'0x5FbDB2315678afecb367f032d93F642f64180aa3',\
['function balanceOf(address)view returns(uint256)'],p);\
console.log('HDFC USDC:',Number(await t.balanceOf('0x90F79bf6EB2c4f870365E785982E1f101E93b906')/1000000n));})()"

# the same invoice/finance state on Fabric
docker exec coconet-cli peer chaincode query -C buyer-supplier-channel -n finance-cc \
  -c '{"function":"getFinanceRequest","Args":["<FR-id-from-demo-output>"]}'
```

## Settlement math (1 USD = ₹92)

- Pre-shipment advance: ₹1,20,00,000 / $130,435
- Invoice (9,900 units): ₹2,47,50,000 / $269,022
- Discounting gross (2%): ₹2,42,55,000 / $263,641
- Loan + interest settled: ₹1,21,77,534 / $132,365
- **Net to Bharat:** ₹1,20,77,466 / $131,277
- **Escrow released to HDFC:** $269,022 (₹2,47,50,000)
- HDFC profit: discount ₹4,95,000 + interest ₹1,77,534 = ₹6,72,534 / $7,310

## What is narrated vs. executed

The full BRD example has 14 steps; the MVP **executes** the path above. These are part of the
story but **not executed** (deferred to the rings noted in MVP-PLAN.md):

- Steps 4–6 — production/provenance, warehouse receipt, dispatch/delivery → **Ring 2**.
- Step 7A — rejected-goods handling → simplified (GRN accepts the full quantity).
- Refund (Rule-0C cancel-before-release) **is demoed** (sad path above); the full dispute
  lifecycle that would *trigger* a hold/refund (raise → respond → resolve) → **Ring 3**.
- Escrow release checks 2 of 6 conditions (funded + invoice-approved); the other 4 (delivery,
  sanctions, senior approval, no-dispute) → **Rings 7 / 10 / 11 / 3**.
- Full audit evidence pack (step 14) → **Ring 1** (`audit-cc`; today the bridge logs a stub).

Be upfront about this in the demo — it shows the architecture end-to-end with an honest scope,
not a faked full flow.
