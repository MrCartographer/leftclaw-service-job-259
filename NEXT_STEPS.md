# NEXT_STEPS.md — IndexerRegistry

## Out of Scope (Documented)

### 1. LogInclusionVerifier — EIP-4788 + Patricia Trie Proof Verification

**Status:** STUB in `IndexerRegistry._verifyLogInclusion()` — always reverts.

**Impact:** `revealResponse()` always fails. Disputes therefore always resolve via `resolveExpiredDispute()` (disputer wins after 24h + 5min). The staking, registration, and settlement flows work fully.

**Spec for implementation:**

```
LogInclusionVerifier.sol — library
Input: ProofData struct { uint64 slot; bytes32[] sszBodyPath; bytes executionHeader; bytes[] trieNodes; bytes receipt; uint256 logIndex; address expectedAddress; bytes32 expectedTopic0; }

Step 1: Read beacon root
  address constant EIP4788 = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;
  (bool ok, bytes memory data) = EIP4788.staticcall(abi.encode(slot * 12)); // slot → timestamp
  require(ok && data.length == 32);
  bytes32 beaconRoot = abi.decode(data, (bytes32));

Step 2: Verify SSZ execution payload header against beacon root
  - Hash the beacon block body fields using SSZ (sha256-based Merkle tree)
  - Verify path from executionPayloadHeader to beaconRoot
  - Libraries: ethereum/consensus-specs SSZ helpers (port to Solidity)
  - Reference: EIP-4788 spec at https://eips.ethereum.org/EIPS/eip-4788

Step 3: Extract receiptsRoot from execution payload header
  - Parse RLP-encoded executionHeader
  - Field at index 8 is receiptsRoot (bytes32)

Step 4: Patricia trie traversal
  - RLP-decode each node in trieNodes
  - Traverse from receiptsRoot to the receipt
  - Key: RLP(transaction_index)
  - Reference: Ethereum yellow paper §D (Modified Merkle Patricia Trie)
  - Reference implementation: ethereum/py-evm

Step 5: Parse receipt logs
  - RLP-decode receipt: [status, gasUsed, logsBloom, logs]
  - logs[logIndex]: [address, [topic0, topic1...], data]
  - Verify address == dispute.registration.targetContract
  - Verify topic0 == dispute.registration.eventSigHash
```

**Estimated complexity:** 400-600 lines Solidity. Recommend using Solidity libraries:
- `hamdiallam/Solidity-RLP` for RLP decoding
- `succinctlabs/telepathy-contracts` (reference for SSZ)
- OR: hire a specialized ZK/cryptography contractor

**EIP-4788 timing note:** DISPUTE_WINDOW (24h) + DISPUTE_RESPONSE_SECS (6h) = max 30h lifecycle. EIP-4788 ring buffer stores ~27h of slots on Base. Verify this holds for Base's current slot timing before enabling revealResponse.

---

### 2. Indexer Node Software

Off-chain service that:
- Indexes Base events matching registered (contract, eventSig) pairs
- Serves responses over HTTP with x402/USDC micropayment gate
- Validates and accumulates consumer payments
- Submits periodic `settleQuery()` on-chain

Reference: https://ethskills.com/x402/SKILL.md

---

### 3. Dispute Keeper Bot

Off-chain service that monitors disputes and calls `resolveExpiredDispute()` after the deadline passes.

---

### 4. Domain / ENS

Point an ENS subdomain to the IPFS CID for a human-readable URL.

---

## Known Limitations (Current Build)

- `revealResponse()` reverts until LogInclusionVerifier is implemented
- TWAP floor in `executeBuyback()` is passthrough when pool.observe() fails (new pools)
- Frontend uses event history scanning (no subgraph) — may be slow for high-volume registrations
