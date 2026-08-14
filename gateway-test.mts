import { gateway, generateText } from "ai";
import { configuredDefaultAgentModel } from "./lib/agent-model-defaults.ts";

// 1. Confirm the key works and show the configured Crux model.
const available = await gateway.getAvailableModels();
const model = configuredDefaultAgentModel();
const configured = available.models.find((item) => item.id === model);
console.log(`Configured model: ${model} (${configured ? "listed" : "not listed"})`);

// 2. Tiny generation to prove end-to-end inference through the Gateway.
const { text, usage } = await generateText({
  model,
  prompt: 'Reply with exactly these two words: gateway works',
});
console.log("\nGateway response:", text);
console.log("Usage:", JSON.stringify(usage));
