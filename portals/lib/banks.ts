// Demo beneficiary bank accounts, prefilled per org so nothing is typed live.
// Fictional accounts on real bank IFSC prefixes — nothing here is a live account.
export const BANK_ACCOUNTS: Record<string, { beneficiary_name: string; account_number: string; ifsc: string; bank: string }> = {
  'tata-001': { beneficiary_name: 'Buyer Corp', account_number: '501000123456789', ifsc: 'HDFC0001234', bank: 'HDFC Bank' },
  'bharat-001': { beneficiary_name: 'Supplier Ltd', account_number: '912345678901234', ifsc: 'ICIC0004567', bank: 'ICICI Bank' },
  'hdfc-001': { beneficiary_name: 'Lender Bank', account_number: '004701555666777', ifsc: 'SBIN0007890', bank: 'State Bank of India' },
};

// RTGS is used for high-value transfers (₹2,00,000+); NEFT below that.
export const RTGS_THRESHOLD_INR = 200000;
export const modeFor = (amountInr: number) => (amountInr >= RTGS_THRESHOLD_INR ? 'RTGS' : 'NEFT');
