import { gateway, generateText } from "ai";

// 1. Confirm the key works + discover exact Claude slugs (gateway uses dots, e.g. claude-opus-4.8).
const available = await gateway.getAvailableModels();
const claude = available.models.filter((m) => m.id.toLowerCase().includes("claude"));
console.log("Claude models available via gateway:");
for (const m of claude) console.log("  ", m.id);

// 2. Tiny generation on Haiku to prove end-to-end inference through the gateway.
const { text, usage } = await generateText({
  model: "anthropic/claude-haiku-4.5",
  prompt: 'Reply with exactly these two words: gateway works',
});
console.log("\nHaiku response:", text);
console.log("Usage:", JSON.stringify(usage));
