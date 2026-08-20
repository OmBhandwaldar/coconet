// Business RATES + FX (legitimately configured constants) and fallback defaults
// used ONLY for the no-document "quick create" path. All downstream amounts
// (pre-shipment, discounting, escrow) DERIVE from the actual PO/invoice values.
export const AMT = {
  // rates / config
  interestRate: 0.12,
  tenorDays: 45,
  advanceRate: 0.48,   // pre-shipment advance = advanceRate × PO value
  discRate: 0.02,      // discounting discount %
  fx: 92,              // 1 USD = ₹92 (escrow settles in USD)

  // fallback defaults for quick-create when no document is parsed
  poGross: 25000000,   // ₹2,50,00,000
  poQty: 10000,
  poPrice: 2500,
  grnQty: 10000,
  invAmount: 24750000, // ₹2,47,50,000 (9,900 units)
  invQty: 9900,
};

// Derivations — the single source of truth for downstream amounts.
export const preShipAmount = (poGross: number) => Math.round(poGross * AMT.advanceRate);
export const discGross = (invoiceAmount: number) => Math.round(invoiceAmount * (1 - AMT.discRate));
export const escrowUsd = (invoiceAmount: number) => Math.round(invoiceAmount / AMT.fx);
