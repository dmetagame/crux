import {
  decodeAbiParameters,
  decodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import type { GatewayX402Transfer } from "./gateway-transfer.ts";

export const ARC_TESTNET_USDC =
  "0x3600000000000000000000000000000000000000" as Address;
export const ARC_GATEWAY_WALLET =
  "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as Address;
export const ARC_GATEWAY_DOMAIN = 26;

export const GATEWAY_SUBMIT_BATCH_ABI = [
  {
    type: "function",
    name: "submitBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "calldataBytes", type: "bytes" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const GATEWAY_BATCH_CALLDATA_PARAMS = [
  {
    name: "deltas",
    type: "tuple[]",
    components: [
      { name: "depositor", type: "address" },
      { name: "value", type: "int256" },
    ],
  },
  { name: "batchId", type: "bytes32" },
  { name: "domain", type: "uint32" },
  { name: "tokenAddress", type: "address" },
  { name: "gatewayWalletAddress", type: "address" },
] as const;

export const GATEWAY_BATCH_PROCESSED_TOPIC = keccak256(
  stringToHex("BatchProcessed(bytes32,address,address)"),
);

type GatewayBatchLog = {
  address: string;
  topics: readonly string[];
  data: string;
};

export type ArcGatewayBatchEvidence = {
  batchId: Hex;
  signer: Address;
  tokenAddress: Address;
  domain: number;
  gatewayWalletAddress: Address;
  deltaCount: number;
  netDeltaAtomic: string;
  payerDeltaAtomic: string | null;
  payToDeltaAtomic: string | null;
  expectedAmountAtomic: string;
  containsExpectedDeltas: boolean;
  exactExpectedDeltas: boolean;
};

export function decodeArcGatewayBatchEvidence(input: {
  transactionInput: Hex;
  transactionTo: string | null | undefined;
  logs: readonly GatewayBatchLog[];
  transfer: Pick<
    GatewayX402Transfer,
    "fromAddress" | "toAddress" | "amount"
  >;
  gatewayWallet?: string;
  expectedDomain?: number;
}): ArcGatewayBatchEvidence {
  const gatewayWallet = normalizeAddress(
    input.gatewayWallet ?? ARC_GATEWAY_WALLET,
    "Gateway wallet",
  );
  const transactionTo = normalizeAddress(input.transactionTo, "transaction target");
  if (transactionTo !== gatewayWallet) {
    throw new Error("Arc transaction target is not the Circle Gateway wallet.");
  }

  const batchLogs = input.logs.filter((log) => {
    const address = normalizeAddress(log.address, "Gateway log address");
    return (
      address === gatewayWallet &&
      log.topics[0]?.toLowerCase() === GATEWAY_BATCH_PROCESSED_TOPIC.toLowerCase()
    );
  });
  if (batchLogs.length !== 1) {
    throw new Error(
      `Arc transaction must contain exactly one Gateway BatchProcessed event; found ${batchLogs.length}.`,
    );
  }

  const event = batchLogs[0];
  if (event.topics.length < 4) {
    throw new Error("Gateway BatchProcessed event is missing indexed fields.");
  }
  const batchId = requiredBytes32(event.topics[1], "batch id");
  const signer = topicAddress(event.topics[2], "batch signer");
  const eventToken = topicAddress(event.topics[3], "batch token");

  const decodedCall = decodeFunctionData({
    abi: GATEWAY_SUBMIT_BATCH_ABI,
    data: input.transactionInput,
  });
  const [calldataBytes] = decodedCall.args;
  const [deltas, calldataBatchId, domain, tokenAddress, calldataGateway] =
    decodeAbiParameters(GATEWAY_BATCH_CALLDATA_PARAMS, calldataBytes);
  const normalizedToken = normalizeAddress(tokenAddress, "batch token");
  const normalizedCalldataGateway = normalizeAddress(
    calldataGateway,
    "batch calldata Gateway wallet",
  );
  if (calldataBatchId.toLowerCase() !== batchId.toLowerCase()) {
    throw new Error("Gateway event batch id does not match submitBatch calldata.");
  }
  if (eventToken !== normalizedToken || normalizedToken !== ARC_TESTNET_USDC.toLowerCase()) {
    throw new Error("Gateway batch token does not match Arc Testnet USDC.");
  }
  if (normalizedCalldataGateway !== gatewayWallet) {
    throw new Error("Gateway batch calldata targets an unexpected wallet.");
  }
  if (input.expectedDomain !== undefined && domain !== input.expectedDomain) {
    throw new Error(`Gateway batch domain ${domain} does not match ${input.expectedDomain}.`);
  }

  const payer = normalizeAddress(input.transfer.fromAddress, "payer");
  const payTo = normalizeAddress(input.transfer.toAddress, "seller");
  const expectedAmount = BigInt(input.transfer.amount);
  const payerDelta = sumDelta(deltas, payer);
  const payToDelta = sumDelta(deltas, payTo);
  const netDelta = deltas.reduce((sum, delta) => sum + delta.value, BigInt(0));
  const containsExpectedDeltas =
    payerDelta !== null &&
    payToDelta !== null &&
    payerDelta <= -expectedAmount &&
    payToDelta >= expectedAmount;
  const exactExpectedDeltas =
    payerDelta === -expectedAmount && payToDelta === expectedAmount;

  return {
    batchId,
    signer,
    tokenAddress: normalizedToken as Address,
    domain,
    gatewayWalletAddress: normalizedCalldataGateway as Address,
    deltaCount: deltas.length,
    netDeltaAtomic: netDelta.toString(),
    payerDeltaAtomic: payerDelta?.toString() ?? null,
    payToDeltaAtomic: payToDelta?.toString() ?? null,
    expectedAmountAtomic: expectedAmount.toString(),
    containsExpectedDeltas,
    exactExpectedDeltas,
  };
}

function sumDelta(
  deltas: readonly { depositor: Address; value: bigint }[],
  address: string,
) {
  let total = BigInt(0);
  let found = false;
  for (const delta of deltas) {
    if (getAddress(delta.depositor).toLowerCase() !== address.toLowerCase()) continue;
    total += delta.value;
    found = true;
  }
  return found ? total : null;
}

function normalizeAddress(value: string | null | undefined, label: string) {
  if (!value || !isAddress(value)) throw new Error(`Arc ${label} is invalid.`);
  return getAddress(value).toLowerCase();
}

function topicAddress(value: string, label: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || !/^0{24}/.test(value.slice(2))) {
    throw new Error(`Gateway ${label} topic is invalid.`);
  }
  return normalizeAddress(`0x${value.slice(-40)}`, label) as Address;
}

function requiredBytes32(value: string, label: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`Gateway ${label} is invalid.`);
  }
  return value as Hex;
}
