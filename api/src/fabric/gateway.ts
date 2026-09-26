import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Gateway, Identity, Signer, signers, type ChaincodeEventsOptions } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { env, PROJECT_ROOT } from '../config/env.js';
import { logger } from '../config/logger.js';
import { currentWalletLabel } from '../auth/identity-context.js';
import { ORG_PROFILES, identityExists } from '../auth/wallet.js';

// ─── Per-identity gateway connections ─────────────────────────────────────────
// A transaction must endorse under the MSP of the org whose user submitted it,
// otherwise every ledger entry is attributed to the platform operator and the
// audit trail cannot satisfy NFR-05.
//
// Connections are cached per wallet label because a gRPC channel plus a gateway
// handshake per request would be wasteful; the set of identities is small and
// bounded by the consortium's membership.
const gateways = new Map<string, { gateway: Gateway; client: grpc.Client }>();

let gateway: Gateway | null = null;
let grpcClient: grpc.Client | null = null;

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

function newGrpcConnection(): grpc.Client {
  const tlsRootCert = fs.readFileSync(resolvePath(env.FABRIC_TLS_CERT_PATH));
  const tlsCredentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(env.FABRIC_GATEWAY_PEER_ENDPOINT, tlsCredentials, {
    'grpc.ssl_target_name_override': env.FABRIC_GATEWAY_PEER_HOST_ALIAS,
  });
}

function newIdentity(): Identity {
  const credentials = fs.readFileSync(resolvePath(env.FABRIC_CERT_PATH));
  return { mspId: env.FABRIC_MSP_ID, credentials };
}

function newSigner(): Signer {
  const keyDirPath = resolvePath(env.FABRIC_KEY_DIR_PATH);
  const keyFiles = fs.readdirSync(keyDirPath);
  if (keyFiles.length === 0) throw new Error('No private key found in ' + keyDirPath);
  const privateKeyPem = fs.readFileSync(path.join(keyDirPath, keyFiles[0]));
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

const GATEWAY_OPTIONS = {
  evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
  endorseOptions: () => ({ deadline: Date.now() + 15000 }),
  submitOptions: () => ({ deadline: Date.now() + 5000 }),
  commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
};

/** Resolve a wallet label ('User1@buyer') to its signing material. */
function materialFor(label: string): { identity: Identity; signer: Signer } {
  const [user, orgKey] = label.split('@');
  const org = ORG_PROFILES.find((o) => o.key === orgKey);
  if (!org || !user) throw new Error(`Unknown wallet label '${label}'`);

  const base = path.join(
    resolvePath(env.FABRIC_CRYPTO_PATH), 'peerOrganizations', org.domain,
    'users', `${user}@${org.domain}`, 'msp',
  );
  const certDir = path.join(base, 'signcerts');
  const keyDir = path.join(base, 'keystore');
  const certFiles = fs.readdirSync(certDir);
  const keyFiles = fs.readdirSync(keyDir);
  if (!certFiles.length || !keyFiles.length) throw new Error(`No material for '${label}'`);

  return {
    identity: {
      mspId: org.mspId,
      credentials: fs.readFileSync(path.join(certDir, certFiles[0])),
    },
    signer: signers.newPrivateKeySigner(
      crypto.createPrivateKey(fs.readFileSync(path.join(keyDir, keyFiles[0]))),
    ),
  };
}

/**
 * Gateway for the current caller, opened on first use. Falls back to the
 * platform connection when there is no caller (background work) or when the
 * caller's material is missing.
 */
function gatewayForCaller(): Gateway {
  const label = currentWalletLabel();
  if (!label) {
    if (!gateway) throw new Error('Fabric Gateway not connected. Call connectGateway() first.');
    return gateway;
  }

  const cached = gateways.get(label);
  if (cached) return cached.gateway;

  const [user, orgKey] = label.split('@');
  const org = ORG_PROFILES.find((o) => o.key === orgKey);
  if (!org || !identityExists(org, user)) {
    // FAIL CLOSED. Falling back to the platform identity here would sign an
    // authenticated user's transaction under PlatformMSP — an identity that
    // passes every RBAC guard and, once Blocks 4 and 5 land, every
    // caller-party and checker!=maker check enforced in chaincode. A missing
    // or mistyped wallet entry must be an error, never a privilege upgrade.
    logger.error({ label }, 'No wallet material for caller — refusing to sign');
    throw new Error(`No Fabric identity provisioned for '${label}'`);
  }

  const { identity, signer } = materialFor(label);
  const client = newGrpcConnection();
  const gw = connect({ client, identity, signer, ...GATEWAY_OPTIONS });
  gateways.set(label, { gateway: gw, client });
  logger.info({ label, mspId: identity.mspId }, 'Opened Fabric Gateway for caller identity');
  return gw;
}

export async function connectGateway(): Promise<void> {
  grpcClient = newGrpcConnection();
  gateway = connect({
    client: grpcClient,
    identity: newIdentity(),
    signer: newSigner(),
    ...GATEWAY_OPTIONS,
  });
  logger.info(
    { peer: env.FABRIC_GATEWAY_PEER_ENDPOINT, channel: env.FABRIC_CHANNEL_NAME },
    'Fabric Gateway connected',
  );
}

export function getContract(chaincodeName: string): Contract {
  const network = gatewayForCaller().getNetwork(env.FABRIC_CHANNEL_NAME);
  return network.getContract(chaincodeName);
}

// Async-iterable stream of chaincode events. Without options it starts from the
// next block (bridge use); pass { startBlock: 0n } to replay full history then
// stay live (activity feed use).
export async function getChaincodeEvents(chaincodeName: string, options?: ChaincodeEventsOptions) {
  if (!gateway) throw new Error('Fabric Gateway not connected. Call connectGateway() first.');
  const network = gateway.getNetwork(env.FABRIC_CHANNEL_NAME);
  return network.getChaincodeEvents(chaincodeName, options);
}

export async function disconnectGateway(): Promise<void> {
  for (const [label, entry] of gateways) {
    entry.gateway.close();
    entry.client.close();
    logger.debug({ label }, 'Closed caller gateway');
  }
  gateways.clear();
  gateway?.close();
  grpcClient?.close();
  gateway = null;
  grpcClient = null;
  logger.info('Fabric Gateway disconnected');
}

/** Wallet labels with an open connection — used by tests and diagnostics. */
export function openIdentityLabels(): string[] {
  return [...gateways.keys()];
}
