import crypto from 'crypto';
import { createRequire } from 'module';
import { DOCUMENTS_BUCKET, ensureDocumentsBucket, minioClient } from '../config/minio.js';

// Import the implementation directly to avoid pdf-parse's debug block (which runs
// on bare `import 'pdf-parse'` in ESM and reads a test file).
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (b: Buffer) => Promise<{ text: string }>;

export interface UploadResult {
  doc_hash: string;
  bucket: string;
  object: string;
  size: number;
  content_type: string;
}

// FR-DOC-02: store the raw document in MinIO, keep only its SHA-256 fingerprint
// on-chain. The hash doubles as the object key so identical bytes dedupe naturally.
export async function uploadDocument(
  buffer: Buffer,
  contentType = 'application/octet-stream',
): Promise<UploadResult> {
  await ensureDocumentsBucket();
  const doc_hash = crypto.createHash('sha256').update(buffer).digest('hex');
  await minioClient.putObject(DOCUMENTS_BUCKET, doc_hash, buffer, buffer.length, {
    'Content-Type': contentType,
  });
  return { doc_hash, bucket: DOCUMENTS_BUCKET, object: doc_hash, size: buffer.length, content_type: contentType };
}

export interface VerifyResult {
  doc_hash: string;
  exists: boolean;
  size?: number;
}

// Confirm a document with the given fingerprint is present in storage.
export async function verifyDocument(hash: string): Promise<VerifyResult> {
  await ensureDocumentsBucket();
  try {
    const stat = await minioClient.statObject(DOCUMENTS_BUCKET, hash);
    return { doc_hash: hash, exists: true, size: stat.size };
  } catch {
    return { doc_hash: hash, exists: false };
  }
}

export interface StoredDocument {
  stream: NodeJS.ReadableStream;
  contentType: string;
  size: number;
}

export interface ParsedFields {
  amount?: number;
  quantity?: number;
  item?: string;
  invoice_number?: string;
  po_number?: string;
  due_date?: string;
}

export interface ParseResult {
  doc_hash: string;      // the file is also stored (attached) and hashed
  fields: ParsedFields;
  found: string[];       // which fields were actually extracted from the document
  text_snippet: string;  // first chars of the extracted text (transparency)
}

// Extract text from an uploaded document (PDF text layer or plain text) and pull
// out trade fields heuristically. Self-contained — nothing leaves the platform.
// OCR for scanned images is a future addition; today images yield no text.
export async function parseDocument(buffer: Buffer, contentType: string): Promise<ParseResult> {
  const up = await uploadDocument(buffer, contentType); // store + hash the real file too

  let text = '';
  const isPdf = contentType === 'application/pdf' || buffer.subarray(0, 4).toString() === '%PDF';
  if (isPdf) {
    try { text = (await pdfParse(buffer)).text ?? ''; } catch { text = ''; }
  } else if (contentType.startsWith('text/')) {
    text = buffer.toString('utf8');
  }

  const norm = text.replace(/\s+/g, ' ');
  const fields: ParsedFields = {};
  const found: string[] = [];
  const num = (s: string) => parseInt(s.replace(/[,\s]/g, ''), 10);

  const amt = norm.match(/(?:grand\s*total|total\s*amount|amount\s*payable|total)\D{0,12}(?:₹|rs\.?|inr)?\s*([\d,]{4,})/i);
  if (amt) { const n = num(amt[1]); if (n > 0) { fields.amount = n; found.push('amount'); } }

  const qty = norm.match(/([\d,]{1,7})\s*(?:units|nos|pcs|pieces|qty)\b/i) || norm.match(/quantity\D{0,6}([\d,]{1,7})/i);
  if (qty) { const n = num(qty[1]); if (n > 0) { fields.quantity = n; found.push('quantity'); } }

  const itm = norm.match(/(?:item|description|product|goods|particulars)\s*(?:name)?\s*[:\-]\s*([A-Za-z][A-Za-z0-9 &/\-]{1,39})/i);
  if (itm) {
    const v = itm[1].trim().replace(/\s+(?:qty|quantity|hsn|amount|total|price|units|nos|pcs).*$/i, '').trim();
    if (v) { fields.item = v; found.push('item'); }
  }

  const inv = norm.match(/invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Za-z0-9/\-]+)/i);
  if (inv) { fields.invoice_number = inv[1]; found.push('invoice_number'); }

  const po = norm.match(/(?:p\.?\s*o\.?|purchase\s*order)\s*(?:no\.?|number|#)?\s*[:\-]?\s*([A-Za-z0-9/\-]+)/i);
  if (po) { fields.po_number = po[1]; found.push('po_number'); }

  const due = norm.match(/(?:due\s*date|due)\D{0,6}(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i);
  if (due) { fields.due_date = due[1]; found.push('due_date'); }

  return { doc_hash: up.doc_hash, fields, found, text_snippet: text.slice(0, 400) };
}

// Retrieve the raw document bytes for a fingerprint (null if not present).
export async function getDocument(hash: string): Promise<StoredDocument | null> {
  await ensureDocumentsBucket();
  try {
    const stat = await minioClient.statObject(DOCUMENTS_BUCKET, hash);
    const stream = await minioClient.getObject(DOCUMENTS_BUCKET, hash);
    return {
      stream,
      contentType: stat.metaData?.['content-type'] ?? 'application/octet-stream',
      size: stat.size,
    };
  } catch {
    return null;
  }
}
