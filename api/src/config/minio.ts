import { Client } from 'minio';
import { env } from './env.js';

export const minioClient = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

export const DOCUMENTS_BUCKET = env.MINIO_BUCKET_DOCUMENTS;

let bucketReady = false;

// Lazily ensure the documents bucket exists (idempotent, runs once per process).
export async function ensureDocumentsBucket(): Promise<void> {
  if (bucketReady) return;
  const exists = await minioClient.bucketExists(DOCUMENTS_BUCKET).catch(() => false);
  if (!exists) await minioClient.makeBucket(DOCUMENTS_BUCKET);
  bucketReady = true;
}
