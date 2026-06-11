import { verifyTypedData, type Address, type Hex } from "viem";
import { config, USDC } from "./config.js";
import { erc20Abi, registryAbi } from "./abi.js";
import { publicClient, walletClient } from "./chain.js";

// EIP-712 domain + types — must match IndexerRegistry's DOMAIN_SEPARATOR and
// SETTLEMENT_TYPEHASH exactly.
export const domain = {
  name: "IndexerRegistry",
  version: "1",
  chainId: config.chainId,
  verifyingContract: config.contract,
} as const;

export const types = {
  SettlementData: [
    { name: "indexer", type: "address" },
    { name: "regId", type: "bytes32" },
    { name: "queryCount", type: "uint32" },
    { name: "totalFeeUSDC", type: "uint256" },
    { name: "consumerNonce", type: "uint256" },
  ],
} as const;

export type PaymentAuth = {
  consumer: Address;
  queryCount: number;
  totalFeeUSDC: bigint;
  consumerNonce: bigint;
  signature: Hex;
};

/**
 * Verify a consumer's SettlementData signature. Nonces are consumer-chosen and
 * just need to be unused on-chain (consumerNonceUsed mapping) — random 256-bit
 * values never collide in practice.
 */
export async function verifyPayment(
  regId: Hex,
  auth: PaymentAuth,
  minFee: bigint,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (auth.totalFeeUSDC < minFee * BigInt(auth.queryCount)) {
    return { ok: false, reason: `fee ${auth.totalFeeUSDC} below required ${minFee * BigInt(auth.queryCount)}` };
  }

  let valid = false;
  try {
    valid = await verifyTypedData({
      address: auth.consumer,
      domain,
      types,
      primaryType: "SettlementData",
      message: {
        indexer: config.indexerAddress,
        regId,
        queryCount: auth.queryCount,
        totalFeeUSDC: auth.totalFeeUSDC,
        consumerNonce: auth.consumerNonce,
      },
      signature: auth.signature,
    });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "signature does not recover to consumer" };

  const [nonceUsed, allowance, balance] = await Promise.all([
    publicClient.readContract({
      address: config.contract,
      abi: registryAbi,
      functionName: "consumerNonceUsed",
      args: [auth.consumer, auth.consumerNonce],
    }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "allowance",
      args: [auth.consumer, config.contract],
    }),
    publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [auth.consumer],
    }),
  ]);

  if (nonceUsed) return { ok: false, reason: "nonce already used on-chain" };
  if (allowance < auth.totalFeeUSDC) {
    return { ok: false, reason: `USDC allowance ${allowance} < fee ${auth.totalFeeUSDC}; approve USDC to ${config.contract}` };
  }
  if (balance < auth.totalFeeUSDC) {
    return { ok: false, reason: `USDC balance ${balance} < fee ${auth.totalFeeUSDC}` };
  }
  return { ok: true };
}

/**
 * Settle on-chain. settleQuery is permissionless — the submitter wallet pays
 * gas, the contract pulls the consumer's USDC and pays 98% to the registered
 * indexer, 1% treasury, 1% CLAWD buyback reserve.
 */
export async function settle(regId: Hex, auth: PaymentAuth): Promise<Hex> {
  return walletClient.writeContract({
    address: config.contract,
    abi: registryAbi,
    functionName: "settleQuery",
    args: [
      {
        indexer: config.indexerAddress,
        regId,
        queryCount: auth.queryCount,
        totalFeeUSDC: auth.totalFeeUSDC,
        consumerNonce: auth.consumerNonce,
      },
      auth.signature,
    ],
  });
}
