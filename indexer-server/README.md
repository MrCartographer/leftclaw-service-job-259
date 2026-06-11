# CLAWD Answers — IndexerRegistry node (job #259)

The off-chain half of the [IndexerRegistry](https://basescan.org/address/0x3be578A72d1c4ffDBB2AA2418a7fb749BCDBA313)
protocol, plus its marketing front door. One process serves both:

- **`GET /` — Clickable Questions.** A single-page site listing questions about
  $CLAWD ("How many transfers in the last 24h?", "How much has been burned?").
  Each answer costs **$0.10 USDC**, paid with one EIP-712 signature — no gas
  for the asker after a one-time USDC approval. No chat box, no API key.
- **`POST /query` — raw event API.** Agent-native: decoded CLAWD `Transfer`
  logs over any block range, $0.01 per query, same payment scheme.

A rolling in-memory index backfills 7 days of CLAWD `Transfer` events at boot
(~20s on a decent RPC) and polls for new blocks. It is a pure cache over the
canonical chain — reboots rebuild it identically, nothing to persist.

## Payment model (x402-style, settled by `settleQuery`)

1. Consumer approves USDC to the registry contract (once).
2. Consumer signs EIP-712 `SettlementData { indexer, regId, queryCount,
   totalFeeUSDC, consumerNonce }` — nonce is any random uint256 unused in
   `consumerNonceUsed`.
3. Server verifies the signature + allowance, serves the answer, and submits
   `settleQuery` on-chain. **Anyone may submit** — so the server signs with a
   throwaway gas-only wallet, never the indexer key.
4. The contract pulls the consumer's USDC: **98% → indexer, 1% → treasury,
   1% → CLAWD buyback-and-burn.**

## Run locally

```bash
npm install
cp .env.example .env   # fill in SUBMITTER_PRIVATE_KEY + INDEXER_ADDRESS
npm run dev            # http://localhost:8080
```

Exercise the full pay→ask flow (consumer needs USDC on Base):

```bash
CONSUMER_PRIVATE_KEY=0x… QUESTION=burned-total npm run query
```

## One-time on-chain registration

The questions page sells answers for the `(CLAWD, Transfer)` registration. It
must exist on-chain or settlements revert:

```bash
REGISTRAR_PRIVATE_KEY=0x…indexer-wallet-key… npm run register
```

Costs $1 base stake, zero boost (recoverable via deregister + 7d cooldown).
Boost stays 0 on purpose: the dispute proof verifier is a stub
(`NEXT_STEPS.md`), so boost is unprotectable until it ships. Then set
`INDEXER_ADDRESS` to that wallet — the 98% fee share pays there.

## Deploy to Railway

1. Push this repo to GitHub (or use the Railway CLI).
2. New Project → Deploy from repo → set **Root Directory** to `indexer-server`.
3. Railway auto-detects Node and runs `npm install` + `npm start`.
4. Variables: `SUBMITTER_PRIVATE_KEY` (fresh wallet with ~0.001 ETH on Base for
   settlement gas — gas-only, keep nothing else on it), `INDEXER_ADDRESS`,
   `BASE_RPC_URL` (Alchemy/Infura — the public RPC rate-limits the backfill),
   `SETTLE_ONCHAIN=1`. Leave `PORT` unset — Railway injects it.
5. Your `https://<app>.up.railway.app` URL is the product. Publish it.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Clickable Questions site |
| GET | `/health` | Liveness + watcher status |
| GET | `/api` | Service info + registrations (agent-facing) |
| GET | `/questions` | Question list + payment requirements |
| POST | `/ask` | Answer a question; `402` until paid |
| POST | `/query` | Raw decoded events over a block range; `402` until paid |

## ⚠️ Operational notes

- A live registration with a **dead** endpoint is disputable — keep this server
  up (it's stateless; Railway auto-restarts are safe) or `deregister` on-chain.
- `SettlementData` has **no expiry** — settle promptly after serving, and the
  frontend deliberately approves USDC in small increments ($0.10/$1/$5) to
  bound consumer exposure.
