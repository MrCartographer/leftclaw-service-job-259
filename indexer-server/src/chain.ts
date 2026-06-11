import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { config } from "./config.js";

export const submitterAccount = privateKeyToAccount(config.submitterPrivateKey);

export const publicClient = createPublicClient({
  chain: base,
  transport: http(config.rpcUrl),
});

export const walletClient = createWalletClient({
  account: submitterAccount,
  chain: base,
  transport: http(config.rpcUrl),
});
