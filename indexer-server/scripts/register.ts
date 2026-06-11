/**
 * One-time on-chain registration of (TOKEN, Transfer) for this indexer node.
 *
 * Defaults to CLAWD; set TOKEN_ADDRESS (and TOKEN_SYMBOL) to register another
 * token, e.g. TOKEN_ADDRESS=0x5F09… TOKEN_SYMBOL=DOTA.
 *
 * Run with the INDEXER's key (not the Railway submitter key — the indexer key
 * never needs to leave the machine you run this from):
 *
 *   REGISTRAR_PRIVATE_KEY=0x… npm run register
 *
 * Flow: approve USDC → depositBaseStake($1) if needed → register with NO boost.
 * Total cost: $1 USDC (recoverable via deregister + cooldowns) + dust gas.
 *
 * Boost defaults to 0 deliberately: _verifyLogInclusion is a stub (see
 * NEXT_STEPS.md), so an indexer cannot win a dispute by reveal — boost is
 * pure griefer profit until LogInclusionVerifier ships. Worst-case loss with
 * zero boost is 20% base-stake slashes ($0.20 per dispute).
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { SYMBOL, TOKEN, USDC } from "../src/config.js";
import { TRANSFER_TOPIC } from "../src/abi.js";
import { computeRegId } from "../src/registry.js";

const CONTRACT = (process.env.INDEXER_CONTRACT || "0x3be578A72d1c4ffDBB2AA2418a7fb749BCDBA313") as Hex;
const BASE_STAKE = 1_000_000n; // $1 — MIN_BASE_STAKE
const BOOST = BigInt(process.env.BOOST || "0"); // keep 0 until LogInclusionVerifier ships

const registrarAbi = parseAbi([
  "function depositBaseStake(uint256 amount)",
  "function register(address target, bytes32 eventSig, uint96 boost)",
  "function indexers(address) view returns (uint128 baseStake, uint64 registrationCount, uint64 deregisteredAt, uint64 lastSlashAt, uint8 slashCount)",
  "function registrations(bytes32) view returns (address targetContract, uint96 boostStake, bytes32 eventSigHash, uint64 registeredAt, uint64 deregisteredAt, address indexer)",
]);

const key = process.env.REGISTRAR_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("Set REGISTRAR_PRIVATE_KEY to the indexer wallet's private key");

const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") });
const walletClient = createWalletClient({ account, chain: base, transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org") });

async function waitFor(hash: Hex, label: string) {
  console.log(`  ${label}: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
}

async function main() {
  console.log(`Registrar (indexer): ${account.address}`);
  console.log(`Contract: ${CONTRACT}`);
  console.log(`Token: ${SYMBOL} ${TOKEN}`);

  const regId = computeRegId(account.address, TOKEN, TRANSFER_TOPIC);
  console.log(`Expected regId: ${regId}`);

  const existing = await publicClient.readContract({
    address: CONTRACT, abi: registrarAbi, functionName: "registrations", args: [regId],
  });
  if (existing[3] !== 0n && existing[4] === 0n) {
    console.log("Already registered and active — nothing to do.");
    return;
  }

  const [baseStake] = await publicClient.readContract({
    address: CONTRACT, abi: registrarAbi, functionName: "indexers", args: [account.address],
  });
  const needStake = baseStake < BASE_STAKE ? BASE_STAKE : 0n;
  const totalUsdc = needStake + BOOST;

  const balance = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
  });
  if (balance < totalUsdc) throw new Error(`Need ${formatUnits(totalUsdc, 6)} USDC, have ${formatUnits(balance, 6)}`);

  const allowance = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, CONTRACT],
  });
  if (allowance < totalUsdc) {
    const hash = await walletClient.writeContract({
      address: USDC, abi: erc20Abi, functionName: "approve", args: [CONTRACT, totalUsdc],
    });
    await waitFor(hash, "approve USDC");
  }

  if (needStake > 0n) {
    const hash = await walletClient.writeContract({
      address: CONTRACT, abi: registrarAbi, functionName: "depositBaseStake", args: [needStake],
    });
    await waitFor(hash, `depositBaseStake $${formatUnits(needStake, 6)}`);
  } else {
    console.log(`  base stake already ${formatUnits(baseStake, 6)} USDC`);
  }

  const hash = await walletClient.writeContract({
    address: CONTRACT, abi: registrarAbi, functionName: "register", args: [TOKEN, TRANSFER_TOPIC, BOOST],
  });
  await waitFor(hash, `register(${SYMBOL}, Transfer, boost=$${formatUnits(BOOST, 6)})`);

  const reg = await publicClient.readContract({
    address: CONTRACT, abi: registrarAbi, functionName: "registrations", args: [regId],
  });
  console.log(`\n✅ Registered. On-chain record:`);
  console.log(`  target:   ${reg[0]}`);
  console.log(`  boost:    ${formatUnits(reg[1], 6)} USDC`);
  console.log(`  eventSig: ${reg[2]}`);
  console.log(`  indexer:  ${reg[5]}`);
  console.log(`\nSet INDEXER_ADDRESS=${account.address} on the server.`);
}

main().catch(e => { console.error(e); process.exit(1); });
