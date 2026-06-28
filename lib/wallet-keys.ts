import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type HexAddress = `0x${string}`;
export type HexPrivateKey = `0x${string}`;

const TESTNET_SCOPES = new Set(["arc-testnet", "testnet", "demo"]);

export function getSellerAddress(): HexAddress {
  return requiredAddress("seller testnet address", [
    "CRUX_SELLER_TESTNET_ADDRESS",
    "SELLER_ADDRESS",
  ]);
}

export function getHouseAddress(): HexAddress {
  return requiredAddress("house testnet address", [
    "CRUX_HOUSE_TESTNET_ADDRESS",
    "BUYER_ADDRESS",
  ]);
}

export function requireSellerPrivateKey(): HexPrivateKey {
  assertTestnetKeyScope();
  return requiredPrivateKey("seller testnet private key", [
    "CRUX_SELLER_TESTNET_PRIVATE_KEY",
    "SELLER_PRIVATE_KEY",
  ], [
    "CRUX_SELLER_TESTNET_ADDRESS",
    "SELLER_ADDRESS",
  ]);
}

export function requireHousePrivateKey(): HexPrivateKey {
  assertTestnetKeyScope();
  return requiredPrivateKey("house testnet private key", [
    "CRUX_HOUSE_TESTNET_PRIVATE_KEY",
    "BUYER_PRIVATE_KEY",
  ], [
    "CRUX_HOUSE_TESTNET_ADDRESS",
    "BUYER_ADDRESS",
  ]);
}

export function addressFromPrivateKey(privateKey: HexPrivateKey): HexAddress {
  return privateKeyToAccount(privateKey).address;
}

function assertTestnetKeyScope() {
  const scope = (process.env.CRUX_KEY_SCOPE ?? "arc-testnet").trim().toLowerCase();
  if (!TESTNET_SCOPES.has(scope)) {
    throw new Error(
      "Crux is wired for testnet wallet custody only. Set CRUX_KEY_SCOPE=arc-testnet for this app, " +
        "or add a dedicated production custody provider before using non-testnet private keys.",
    );
  }
}

function requiredPrivateKey(
  label: string,
  keyNames: [string, ...string[]],
  addressNames: [string, ...string[]],
): HexPrivateKey {
  const found = firstEnv(keyNames);
  if (!found) {
    throw new Error(
      `Missing ${label}. Set ${keyNames[0]}${keyNames.length > 1 ? ` (legacy alias: ${keyNames.slice(1).join(", ")})` : ""}.`,
    );
  }

  const privateKey = normalizePrivateKey(label, found.name, found.value);
  const derived = addressFromPrivateKey(privateKey);
  const expected = optionalAddress(label.replace("private key", "address"), addressNames);
  if (expected && getAddress(expected) !== getAddress(derived)) {
    throw new Error(
      `${label} does not match the configured address. Rotate/update ${found.name} and ` +
        `${addressNames[0]} together.`,
    );
  }

  return privateKey;
}

function requiredAddress(label: string, names: [string, ...string[]]): HexAddress {
  const address = optionalAddress(label, names);
  if (!address) {
    throw new Error(
      `Missing ${label}. Set ${names[0]}${names.length > 1 ? ` (legacy alias: ${names.slice(1).join(", ")})` : ""}.`,
    );
  }
  return address;
}

function optionalAddress(label: string, names: [string, ...string[]]): HexAddress | null {
  const found = firstEnv(names);
  if (!found) return null;

  const value = found.value.trim();
  if (!isAddress(value)) {
    throw new Error(`${found.name} is not a valid ${label}.`);
  }
  return getAddress(value) as HexAddress;
}

function normalizePrivateKey(label: string, name: string, value: string): HexPrivateKey {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(`${name} is not a valid ${label}.`);
  }
  return trimmed as HexPrivateKey;
}

function firstEnv(names: [string, ...string[]]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}
