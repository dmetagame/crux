# Crux Demo Runbook

Use this for the hackathon video, live judging, or async reviewer walkthrough.

Live app: https://crux-khaki.vercel.app

## Golden Receipts

Use these if a live run is slow or if a reviewer wants durable proof:

- Fresh x402 facilitator proof: https://crux-khaki.vercel.app/runs/f0834987-c823-4b62-917c-9b7b3ed964cc
- Coinbase public-company run: https://crux-khaki.vercel.app/runs/6707c268-9a4e-4f9c-b197-e9e8f3ca410c
- OpenAI private-company run: https://crux-khaki.vercel.app/runs/e015e4c9-d14b-4e66-90e5-f3cb53e5924c
- Northwind scored benchmark: https://crux-khaki.vercel.app/runs/9859fecb-488b-478d-a5bc-fec3899d9229
- Agent-vs-baselines comparison: https://crux-khaki.vercel.app/runs/512afc48-1a8f-410d-89a4-64e63303b0f5

## 3-Minute Demo

### 1. Open Operator Mode

Go to:

```text
https://crux-khaki.vercel.app/agent?mode=operator
```

Sign in as admin. Operator mode uses the embedded house wallet and is the cleanest
path for a judge-facing live demo.

Show the top counters:

- autonomous payments
- Gateway-settled USDC
- average transaction size
- distinct payers
- latest Gateway settlements

### 2. Run A Public Company

In "Research a real subject", run:

```text
Coinbase
```

Narration:

```text
Crux previews sources, decides which data is worth buying, and spends real
test-USDC only when the source is useful for this subject.
```

Point out:

- live preview events
- purchase events
- Gateway settlement references
- cited final brief
- public receipt URL

Open the receipt and show the purchase ledger.

### 3. Run A Private Company Contrast

Run:

```text
OpenAI
```

Narration:

```text
The same agent should not blindly buy SEC filings for a private company. The
spending decision changes because the subject changes.
```

Point out the skipped SEC spend if the run does not need it.

### 4. Show Benchmark Proof

Switch to "Benchmark (scored vs baselines)".

Run:

```text
Compare vs naive baselines
```

Narration:

```text
This is the proof that the agent is not just transacting. It beats fixed buying
heuristics against a hidden answer key because it previews, skips traps, and
stops when enough evidence is bought.
```

Point out:

- reasoning agent score
- buy-cheapest baseline
- buy-by-quality baseline
- false rumor avoided by the reasoning agent
- comparison receipt

### 5. Show External-Agent Surface

Open:

```text
https://crux-khaki.vercel.app/.well-known/crux-agent.json
https://crux-khaki.vercel.app/openapi.json
```

Narration:

```text
Other agents can discover Crux, buy individual x402 resources directly, pay from
their own visitor wallet, or use a scoped trusted-agent key.
```

### 6. Show Visitor Wallet Path

Switch back to visitor mode and click "Generate testnet wallet".

Narration:

```text
Visitors and external users are not forced onto the house wallet. Crux creates a
fresh hosted Arc testnet wallet and returns a short-lived capability token. Once
the wallet is funded, runs are attributed to it as a distinct payer.
```

Do not wait for faucet funding during the main demo unless you already have a
funded visitor wallet ready.

## Fallback Plan

If a live model call is slow, open a previous receipt from `/runs/<id>` and walk
through the saved ledger, rationale, and settlement metadata.

If a public API source is temporarily weak for an obscure subject, use the curated
chips:

- Public: `Nvidia`, `Coinbase`, `Palantir`
- Private: `OpenAI`, `Anthropic`, `Stripe`

## One-Liner

```text
Crux is an autonomous paying research agent where the product is not the report;
it is the spending judgment: what the agent chooses to buy, skip, and stop at
under a USDC budget, with every purchase settling through Circle Gateway on Arc.
```
