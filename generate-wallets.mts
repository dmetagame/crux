import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";

const envPath = path.resolve(".env.local");

const replaceOrAppend = (content: string, key: string, line: string) => {
  const regex = new RegExp(`^${key}=.*$`, "m");
  return regex.test(content)
    ? content.replace(regex, line)
    : content.trimEnd() + "\n" + line;
};

const removeKeys = (content: string, keys: string[]) => {
  let next = content;
  for (const key of keys) {
    next = next.replace(new RegExp(`^${key}=.*\\n?`, "m"), "");
  }
  return next;
};

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
const underline = (s: string) => `\x1b[4m${s}\x1b[24m`;

const generateWallet = (label: string) => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  console.log(`\n${bold(label)}`);
  console.log(`  ${dim("Address:")}     ${cyan(account.address)}`);
  console.log(`  ${dim("Private key:")} written to ${cyan(".env.local")} only`);
  return { address: account.address, privateKey };
};

// --- Seller (platform operator) ---
const seller = generateWallet("Seller testnet wallet (platform operator)");

// --- Buyer (funder wallet — agents spawn ephemeral wallets from this) ---
const house = generateWallet("House testnet wallet (agent funder)");

// --- Write to .env.local ---
const lines: Record<string, string> = {
  CRUX_KEY_SCOPE: "arc-testnet",
  CRUX_SELLER_TESTNET_ADDRESS: seller.address,
  CRUX_SELLER_TESTNET_PRIVATE_KEY: seller.privateKey,
  CRUX_HOUSE_TESTNET_ADDRESS: house.address,
  CRUX_HOUSE_TESTNET_PRIVATE_KEY: house.privateKey,
};

const legacyKeys = [
  "SELLER_ADDRESS",
  "SELLER_PRIVATE_KEY",
  "BUYER_ADDRESS",
  "BUYER_PRIVATE_KEY",
];

let content = fs.existsSync(envPath)
  ? fs.readFileSync(envPath, "utf-8")
  : "";
content = removeKeys(content, legacyKeys);

for (const [key, value] of Object.entries(lines)) {
  const line = `${key}=${value}`;
  content = content
    ? replaceOrAppend(content, key, line)
    : line;
}

fs.writeFileSync(envPath, content.trimEnd() + "\n");
console.log(`\n${green("Written to")} ${envPath}`);

console.log(`
${bold("Next steps:")}
  ${dim("1.")} Fund the house testnet wallet with USDC so agents can make payments.
     Visit Circle's faucet and request USDC for the Arc Testnet:

     ${underline("https://faucet.circle.com/")}

     Paste this address: ${cyan(house.address)}

  ${dim("2.")} Start the dev server:        ${cyan("npm run dev")}
  ${dim("3.")} Run payment agents:          ${cyan("npm run agent")}
     Run as many in parallel as you like — each spawns its own ephemeral wallet.
`);
