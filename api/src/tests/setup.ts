// Global test setup — runs before every test file.
// Loads env from .env.test if present, otherwise uses .env.example defaults.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.LOG_LEVEL = 'silent';

// Minimal env values so env.ts schema passes in tests without a live Fabric/Polygon.
process.env.MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/coconetdb-test';
process.env.MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY ?? 'coconetadmin';
process.env.MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY ?? 'coconetsecret123';
process.env.FABRIC_CRYPTO_PATH = process.env.FABRIC_CRYPTO_PATH ?? './fabric-network/crypto-config';
process.env.FABRIC_CERT_PATH = process.env.FABRIC_CERT_PATH ?? '/tmp/stub.pem';
process.env.FABRIC_KEY_DIR_PATH = process.env.FABRIC_KEY_DIR_PATH ?? '/tmp';
process.env.FABRIC_TLS_CERT_PATH = process.env.FABRIC_TLS_CERT_PATH ?? '/tmp/stub.pem';
process.env.POLYGON_PRIVATE_KEY =
  process.env.POLYGON_PRIVATE_KEY ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-at-least-16-chars';
