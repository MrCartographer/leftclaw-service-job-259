# SKILL — Run an indexer on the IndexerRegistry (Base)

You are an agent tasked with building and operating an **indexer node** for the
IndexerRegistry protocol. Read this whole file, then execute. Everything you
need is here — no other repository or documentation is required.

## What an indexer is

An indexer watches one `(targetContract, eventSig)` pair on Base, serves the
decoded event data over HTTP for paid queries, and settles payments on-chain.
Revenue: **98% of every query fee**. Cost: a **$1 USDC stake** and keeping one
HTTP endpoint alive.

## Protocol constants

| | |
|---|---|
| Registry contract | `0x3be578A72d1c4ffDBB2AA2418a7fb749BCDBA313` |
| Chain | Base mainnet, chainId `8453` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6 decimals) |
| MIN_BASE_STAKE | `1_000_000` ($1) |
| MIN_QUERY_FEE | `10_000` ($0.01) per query |
| Fee split (hardcoded) | 98% indexer / 1% treasury / 1% CLAWD buyback-and-burn |

## Key ABI fragments

```solidity
function depositBaseStake(uint256 amount) external;            // amount >= 1e6
function register(address target, bytes32 eventSig, uint96 boost) external;
function registerBatch((address,bytes32,uint96)[] regs) external;  // <= 100, one stake covers all
function deregister(bytes32 regId) external;
function settleQuery(SettlementData s, bytes sig) external;    // callable by ANYONE
function consumerNonceUsed(address consumer, uint256 nonce) external view returns (bool);
function registrations(bytes32 regId) external view returns
  (address targetContract, uint96 boostStake, bytes32 eventSigHash,
   uint64 registeredAt, uint64 deregisteredAt, address indexer);

struct SettlementData {
  address indexer;
  bytes32 regId;
  uint32  queryCount;
  uint256 totalFeeUSDC;   // must be >= 10000 * queryCount
  uint256 consumerNonce;  // any uint256 unused in consumerNonceUsed — pick randomly
}
```

`regId = keccak256(abi.encode(indexerAddress, targetContract, eventSigTopic0))`
— note `abi.encode` (32-byte padded), NOT `encodePacked`.

`eventSig` is the event's **topic0**, e.g. `Transfer(address,address,uint256)` →
`0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`.

## Step 1 — Register on-chain (3 transactions, ~$1 + dust)

From the wallet that will BE the indexer (fees are paid to this address):

```bash
RPC=https://mainnet.base.org
REG=0x3be578A72d1c4ffDBB2AA2418a7fb749BCDBA313

# approve the stake
cast send 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  'approve(address,uint256)' $REG 1000000 --rpc-url $RPC --private-key $INDEXER_KEY

# stake $1 (covers ANY number of registrations)
cast send $REG 'depositBaseStake(uint256)' 1000000 --rpc-url $RPC --private-key $INDEXER_KEY

# register your pair — boost MUST be 0 for now (see Risks)
cast send $REG 'register(address,bytes32,uint96)' $TARGET_CONTRACT $EVENT_SIG 0 \
  --rpc-url $RPC --private-key $INDEXER_KEY

# compute your regId
cast keccak $(cast abi-encode 'f(address,address,bytes32)' $INDEXER_ADDRESS $TARGET_CONTRACT $EVENT_SIG)
```

Gotcha: if `register` reverts with `InsufficientBaseStake (0x7243da45)` right
after the deposit confirmed, your RPC routed the simulation to a lagging node.
Wait a few seconds and retry — the state is fine.

## Step 2 — Build the node

Any language, any stack, any host. Requirements:

1. **Watch the logs.** `eth_getLogs` for your `(targetContract, topic0)` pair.
   Backfill a window at boot (chunk requests ≤ ~9k blocks; Base ≈ 43,200
   blocks/day), then poll for new blocks. Keep it **stateless** — rebuild from
   the chain at boot so restarts are safe. No database needed.
2. **Serve over HTTP**, gated by payment. On a request without payment, respond
   `402` with your payment requirements (fee, regId, indexer address, and the
   EIP-712 domain/types below). On a request with payment, verify ALL of:
   - the EIP-712 signature recovers to the claimed consumer address
   - `consumerNonceUsed(consumer, nonce)` is false on-chain
   - USDC `allowance(consumer → registry)` ≥ totalFeeUSDC
   - USDC `balanceOf(consumer)` ≥ totalFeeUSDC
   Then serve the data.
3. **Settle on-chain.** Submit `settleQuery(settlementData, signature)`.
   It is permissionless — submit from a **throwaway wallet holding only gas
   ETH** (~0.001 ETH lasts hundreds of settlements). NEVER put the indexer key
   on the server: the indexer cut is paid to the registered address regardless
   of who submits.
4. **Health endpoint.** `GET /health` returning liveness + watcher status.

### EIP-712 payment spec (what consumers sign)

```json
{
  "domain": {
    "name": "IndexerRegistry",
    "version": "1",
    "chainId": 8453,
    "verifyingContract": "0x3be578A72d1c4ffDBB2AA2418a7fb749BCDBA313"
  },
  "primaryType": "SettlementData",
  "types": {
    "SettlementData": [
      { "name": "indexer",       "type": "address" },
      { "name": "regId",         "type": "bytes32" },
      { "name": "queryCount",    "type": "uint32"  },
      { "name": "totalFeeUSDC",  "type": "uint256" },
      { "name": "consumerNonce", "type": "uint256" }
    ]
  }
}
```

Consumer UX that works well: one USDC `approve` transaction up front, then
every query is a single gasless `eth_signTypedData_v4` signature.

### Live reference

A production node following this spec runs at
`https://clawd-answers-production.up.railway.app` — inspect `GET /api`,
`GET /questions`, and the `402` body of `POST /ask` to see the exact
request/response shapes working end-to-end.

## Step 3 — Operate

- Keep the endpoint alive. A live registration with a dead endpoint is
  disputable.
- If you shut down for good: `deregister(regId)`, then after cooldowns withdraw
  (`withdrawBoost` after 30h, `withdrawBaseStake` after 7d with no active
  registrations).

## Risks (read before staking more than pocket change)

The dispute proof verifier (`LogInclusionVerifier`) is **not yet deployed** —
`revealResponse` always reverts, so an indexer currently cannot win a dispute;
any dispute resolves for the disputer after ~24h. Until it ships:

- **Register with boost = 0.** Boost is 100% slashable and the counter-stake a
  disputer posts is 25% *of your boost* — zero boost means zero profit motive.
- Worst case per dispute: 20% of your base stake ($0.20 on the $1 minimum),
  rate-limited to 3 disputes per (disputer, indexer) pair per 24h.

## Checklist

- [ ] Indexer wallet funded: $1+ USDC and a little ETH on Base
- [ ] `depositBaseStake` + `register(target, eventSig, 0)` confirmed
- [ ] regId computed and matches `registrations(regId).indexer == your wallet`
- [ ] Node backfills, watches, serves, verifies payment per spec above
- [ ] Settlements submitted from a separate gas-only wallet
- [ ] `/health` up and monitored
