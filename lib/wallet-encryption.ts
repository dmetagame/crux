import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { HexPrivateKey } from "@/lib/wallet-keys";

const PREFIX = "cruxwallet:v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const AAD = Buffer.from("crux:user_wallets:private_key:v1", "utf8");

export function hasWalletEncryptionKey() {
  return Boolean(process.env.CRUX_WALLET_ENCRYPTION_KEY?.trim());
}

export function shouldRequireEncryptedWallets() {
  const configured = process.env.CRUX_WALLET_REQUIRE_ENCRYPTED_WALLETS?.trim();
  if (configured) return /^true$/i.test(configured);
  return process.env.NODE_ENV === "production";
}

export function encryptWalletPrivateKey(privateKey: HexPrivateKey) {
  validatePrivateKey(privateKey);

  const key = walletEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(AAD);

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privateKey, "utf8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptWalletPrivateKey(encrypted: string): HexPrivateKey {
  const [prefix, version, ivRaw, authTagRaw, ciphertextRaw] = encrypted.split(":");
  if (`${prefix}:${version}` !== PREFIX || !ivRaw || !authTagRaw || !ciphertextRaw) {
    throw new Error("Unsupported encrypted wallet key format.");
  }

  const iv = Buffer.from(ivRaw, "base64url");
  const authTag = Buffer.from(authTagRaw, "base64url");
  const ciphertext = Buffer.from(ciphertextRaw, "base64url");
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error("Invalid encrypted wallet key payload.");
  }

  const decipher = createDecipheriv(ALGORITHM, walletEncryptionKey(), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAAD(AAD);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  validatePrivateKey(plaintext);
  return plaintext as HexPrivateKey;
}

export function isEncryptedWalletPrivateKey(value: string | null | undefined) {
  return value?.startsWith(`${PREFIX}:`) ?? false;
}

export function walletEncryptionVersion() {
  return 1;
}

function walletEncryptionKey() {
  const raw = process.env.CRUX_WALLET_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error("Missing CRUX_WALLET_ENCRYPTION_KEY.");
  }

  const candidates = [];
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    candidates.push(Buffer.from(raw, "hex"));
  }
  candidates.push(Buffer.from(raw, "base64url"));
  candidates.push(Buffer.from(raw, "base64"));

  const key = candidates.find((candidate) => candidate.length === KEY_BYTES);
  if (!key) {
    throw new Error("CRUX_WALLET_ENCRYPTION_KEY must decode to 32 bytes.");
  }
  return key;
}

function validatePrivateKey(value: string): asserts value is HexPrivateKey {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("Wallet private key is not a valid 0x-prefixed 32-byte key.");
  }
}
