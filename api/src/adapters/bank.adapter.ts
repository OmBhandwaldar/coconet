// Mocked banking adapter (CLAUDE.md §12 — "mocked where no external system exists").
// Simulates an Indian NEFT/RTGS rail: no bank is contacted, references are generated
// locally. This is the seam where a real bank/payment-gateway integration plugs in.

export type TransferMode = 'NEFT' | 'RTGS';

// IFSC: 4-letter bank code + '0' (reserved) + 6-char branch code. e.g. HDFC0001234
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function isValidIfsc(ifsc: string): boolean {
  return IFSC_RE.test(ifsc);
}

export function bankCodeFromIfsc(ifsc: string): string {
  return ifsc.slice(0, 4).toUpperCase();
}

// RTGS is used for high-value transfers (₹2,00,000 and above); NEFT below that.
export const RTGS_THRESHOLD_INR = 200000;

export function transferMode(amountInr: number): TransferMode {
  return amountInr >= RTGS_THRESHOLD_INR ? 'RTGS' : 'NEFT';
}

// A plausible-looking UTR: bank code + mode letter + YYMMDD + 6-digit sequence.
// Real UTR formats vary by rail/bank — this is representative, not spec-exact.
let seq = Math.floor(Math.random() * 900000) + 100000;

export function generateUtr(ifsc: string, mode: TransferMode): string {
  const d = new Date();
  const yymmdd =
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');
  return `${bankCodeFromIfsc(ifsc)}${mode[0]}${yymmdd}${seq++}`;
}
