import * as grpc from '@grpc/grpc-js';
import { connect, Contract, Gateway, Identity, Signer, signers } from '@hyperledger/fabric-gateway';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { env, PROJECT_ROOT } from '../config/env.js';
import { logger } from '../config/logger.js';

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

export async function connectGateway(): Promise<void> {
  grpcClient = newGrpcConnection();
  gateway = connect({
    client: grpcClient,
    identity: newIdentity(),
    signer: newSigner(),
    evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15000 }),
    submitOptions: () => ({ deadline: Date.now() + 5000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 60000 }),
  });
  logger.info(
    { peer: env.FABRIC_GATEWAY_PEER_ENDPOINT, channel: env.FABRIC_CHANNEL_NAME },
    'Fabric Gateway connected',
  );
}

export function getContract(chaincodeName: string): Contract {
  if (!gateway) throw new Error('Fabric Gateway not connected. Call connectGateway() first.');
  const network = gateway.getNetwork(env.FABRIC_CHANNEL_NAME);
  return network.getContract(chaincodeName);
}

// Async-iterable stream of chaincode events (used by the bridge). Starts from the
// next block, so only events emitted after subscription are delivered.
export async function getChaincodeEvents(chaincodeName: string) {
  if (!gateway) throw new Error('Fabric Gateway not connected. Call connectGateway() first.');
  const network = gateway.getNetwork(env.FABRIC_CHANNEL_NAME);
  return network.getChaincodeEvents(chaincodeName);
}

export async function disconnectGateway(): Promise<void> {
  gateway?.close();
  grpcClient?.close();
  gateway = null;
  grpcClient = null;
  logger.info('Fabric Gateway disconnected');
}
