import "dotenv/config";
import { getAddress, type Hex } from "viem";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  // Signs + submits settleQuery txs. Only needs ETH for gas — settleQuery is
  // permissionless, so this does NOT have to be the registered indexer wallet.
  submitterPrivateKey: required("SUBMITTER_PRIVATE_KEY") as Hex,
  // The wallet that registered (CLAWD, Transfer) on-chain. The 98% indexer cut
  // is paid here regardless of who submits the settlement.
  indexerAddress: getAddress(required("INDEXER_ADDRESS")),
  contract: getAddress(process.env.INDEXER_CONTRACT || "0x3be578A72d1c4ffDBB2AA2418a7fb749BCDBA313"),
  // Per-question fee for the Clickable Questions page. 100000 = $0.10 USDC.
  questionFee: BigInt(process.env.QUESTION_FEE || "100000"),
  // Per-query fee for the raw /query endpoint. 10000 = $0.01 (on-chain minimum).
  queryFee: BigInt(process.env.QUERY_FEE || "10000"),
  settleOnchain: process.env.SETTLE_ONCHAIN === "1",
  // How far back the CLAWD Transfer watcher backfills at boot.
  // 302400 blocks ≈ 7 days at Base's 2s block time.
  backfillBlocks: BigInt(process.env.BACKFILL_BLOCKS || "302400"),
  port: Number(process.env.PORT || 8080),
  chainId: 8453,
} as const;

// Base mainnet addresses (fixed).
export const USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
export const CLAWD = getAddress("0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07");
export const DEAD = getAddress("0x000000000000000000000000000000000000dEaD");

// Block-time arithmetic for time windows (Base: 2s blocks).
export const BLOCKS_PER_DAY = 43_200n;
