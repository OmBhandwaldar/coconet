import crypto from 'crypto';
import { DOCUMENTS_BUCKET, ensureDocumentsBucket, minioClient } from '../config/minio.js';

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
