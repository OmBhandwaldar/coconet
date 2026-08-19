# CocoNet Portals — Role Demo Screens

Three role screens (Buyer / Supplier / Lender) that drive the live API to walk the full
MVP trade-finance flow. No login — a demo view of all three sides (in production these are
authenticated, permissioned portals).

## Run

Requires the backend stack + API running first (from the repo root):

```bash
npm run demo:reset     # bring the stack up from zero
npm run dev            # start the API + bridge (:3000)
```

Then start the portals (on **:3001**):

```bash
cd portals
npm install
npm run dev
```

Open **http://localhost:3001**, click **New Deal**, then open `/buyer`, `/supplier`, `/lender`
— ideally in three browser tabs. Actions in one tab show up in the others (shared ledger).

## Flow to demo
Buyer creates PO → Supplier acknowledges → Supplier requests pre-shipment finance → Lender
validates/quotes/approves → Supplier accepts (locks PO) → Lender disburses → Buyer records GRN →
Supplier raises invoice (3-way match) → Buyer approves → Supplier applies **invoice discounting** →
Lender validates/quotes → Supplier accepts → Lender disburses with net settlement → Buyer creates &
funds escrow → Buyer gives final approval → **escrow auto-releases to the Lender** (cross-chain).
Refund path available on the Buyer screen.

## Config
The API base defaults to `http://localhost:3000` (override with `NEXT_PUBLIC_API_BASE` in `.env.local`).
The deal identity is shared across tabs via `localStorage`; a fresh deal code each run avoids ID
collisions, so no ledger reset is needed between demos.
