# Crux Agent Integration Kit

Crux exposes two integration surfaces for other agents:

1. **x402-paid resources**: the calling agent pays Crux directly for a source.
2. **research runners**: Crux runs its own buying agent and pays sources during the run.

Production public house-wallet runner access is disabled. Use a visitor-funded wallet,
a scoped Crux agent key, or the operator web session.

Base URL:

```bash
export CRUX_BASE_URL=https://crux-khaki.vercel.app
```

## Discovery

```bash
curl "$CRUX_BASE_URL/.well-known/crux-agent.json"
curl "$CRUX_BASE_URL/openapi.json"
curl "$CRUX_BASE_URL/api/marketplace"
```

The discovery document advertises whether public house-wallet runners are enabled,
the OpenAPI URL, and the recommended surface for external agents.

## Option A: Buy x402 Resources Directly

This is the cleanest external-agent path. Your agent discovers a source, receives
HTTP 402 payment requirements, signs an x402 payment, and retries the request.

Example paid live-data endpoint:

```bash
curl -i "$CRUX_BASE_URL/api/real/wikipedia?subject=Coinbase"
```

Expected first response:

```http
HTTP/2 402
PAYMENT-REQUIRED: <base64 payment requirements>
```

After your x402 client pays, the same URL returns the purchased JSON. These
endpoints do not use a Crux API key.

Useful paid surfaces:

- `GET /api/real/{source}?subject=...`
- `GET /api/research/{id}?topic=...`
- `GET /api/premium/quote`
- `GET /api/premium/dataset`
- `POST /api/premium/compute`
- `GET /api/premium/agent-task`

## Option B: Visitor-Funded Research Run

Use this when a user or external agent should pay from its own Arc testnet wallet.
The same email recovers the same wallet.

Create or recover a wallet:

```bash
curl -sS -X POST "$CRUX_BASE_URL/api/wallet/create" \
  -H "Content-Type: application/json" \
  -d '{"email":"agent@example.com"}'
```

Response shape:

```json
{
  "walletId": "...",
  "address": "0x...",
  "walletToken": "..."
}
```

Fund `address` at `https://faucet.circle.com` on Arc testnet. Then check funding:

```bash
curl -sS "$CRUX_BASE_URL/api/wallet/status?walletId=$WALLET_ID" \
  -H "X-Crux-Wallet-Token: $WALLET_TOKEN"
```

Run research from that wallet:

```bash
curl -N "$CRUX_BASE_URL/api/agent/real?subject=Coinbase&budget=0.03&walletId=$WALLET_ID" \
  -H "X-Crux-Wallet-Token: $WALLET_TOKEN" \
  -H "Idempotency-Key: visitor-coinbase-001"
```

Response is NDJSON:

```json
{"type":"event","event":{"kind":"preview","sourceId":"wikipedia"}}
{"type":"event","event":{"kind":"purchase","sourceId":"wikipedia","price":"$0.0020"}}
{"type":"done","result":{...},"receiptUrl":"https://crux-khaki.vercel.app/runs/..."}
```

## Option C: Trusted-Agent House-Wallet Run

Trusted agents can use the embedded house wallet with a scoped Bearer key.
This is for partners, eval agents, and judge automation. It is not public by
default because these endpoints can spend the house wallet.

```bash
export CRUX_AGENT_KEY=crux_agent_...

curl -N "$CRUX_BASE_URL/api/agent/real?subject=Coinbase&budget=0.03" \
  -H "Authorization: Bearer $CRUX_AGENT_KEY" \
  -H "Idempotency-Key: trusted-coinbase-001"
```

Benchmark runner:

```bash
curl -N "$CRUX_BASE_URL/api/agent/run?topic=Northwind%20Logistics&budget=0.05" \
  -H "Authorization: Bearer $CRUX_AGENT_KEY" \
  -H "Idempotency-Key: trusted-benchmark-001"
```

Without a key, production returns:

```json
{"type":"error","message":"Public house-wallet runs are disabled."}
```

## Idempotency And Receipts

Send `Idempotency-Key` on runner requests. Retrying the same key for the same
caller replays the existing run instead of spending twice.

Completed runs return `receiptUrl`. Receipts include budget, purchases, rationales,
result, and settlement proof metadata.

Poll a receipt/run:

```bash
curl "$CRUX_BASE_URL/api/runs/$RECEIPT_ID"
```

## Auth Summary

- x402 resources: x402 payment, no Crux API key.
- visitor-funded runs: `walletId` query param plus `X-Crux-Wallet-Token`.
- trusted house-wallet runs: `Authorization: Bearer <Crux agent key>`.
- operator web runs: signed admin session from `/admin/login`.

## Rate And Spend Controls

The runner guard enforces model allowlists, per-caller hourly limits, daily budget
caps, and concurrency locks. Visitor-wallet runs fail closed if controls are
unavailable. House-wallet public access is disabled in production.
