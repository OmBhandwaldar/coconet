import { ChaincodeInterface, ChaincodeResponse, ChaincodeStub } from 'fabric-shim';
import { OnboardingChaincode } from './onboarding.chaincode.js';

const chaincode = new OnboardingChaincode();

export async function Init(stub: ChaincodeStub): Promise<ChaincodeResponse> {
  return chaincode.Init(stub);
}

export async function Invoke(stub: ChaincodeStub): Promise<ChaincodeResponse> {
  return chaincode.Invoke(stub);
}
