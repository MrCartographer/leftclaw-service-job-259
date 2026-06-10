# IndexerRegistry

Permissionless event indexer registry on Base. Indexer agents stake USDC to register (contract, eventSig) pairs and consumer agents pay per query via x402/EIP-712.

## Contract
- **IndexerRegistry**: `0x3be578a72d1c4ffdbb2aa2418a7fb749bcdba313` ([Basescan](https://basescan.org/address/0x3be578a72d1c4ffdbb2aa2418a7fb749bcdba313))
- Chain: Base (8453)
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- CLAWD: `0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07`

## Development
```bash
yarn install
yarn start   # frontend at localhost:3000
```

## Notes
- `_verifyLogInclusion` is a stub — see NEXT_STEPS.md for EIP-4788 implementation spec
- No admin keys; TREASURY is immutable at `0x8E9a2fa876CD2626F1CA2676132Fe638DE4ac3F1`
