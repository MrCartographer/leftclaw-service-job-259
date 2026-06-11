/**
 * Example consumer: exercises the full pay→ask flow against a running server.
 *
 *   CONSUMER_PRIVATE_KEY=0x… SERVER=http://localhost:8080 npm run query
 *
 * The consumer wallet needs USDC on Base and must approve USDC to the
 * IndexerRegistry contract (the script does this if needed). Asking costs
 * $0.10 per question when the server settles on-chain.
 */
import "dotenv/config";
import { createPublicClient, createWalletClient, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const SERVER = process.env.SERVER || "http://localhost:8080";
const QUESTION = process.env.QUESTION || "transfers-24h";

const key = process.env.CONSUMER_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("Set CONSUMER_PRIVATE_KEY");

const account = privateKeyToAccount(key);
const rpc = http(process.env.BASE_RPC_URL || "https://mainnet.base.org");
const publicClient = createPublicClient({ chain: base, transport: rpc });
const walletClient = createWalletClient({ account, chain: base, transport: rpc });

function randomNonce(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return BigInt("0x" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join(""));
}

async function main() {
  console.log(`Consumer: ${account.address}`);

  const q = await fetch(`${SERVER}/questions`).then(r => r.json());
  const fee = BigInt(q.fee);
  const { payTo, asset, indexer, regId, eip712 } = q.payment;
  console.log(`Asking "${QUESTION}" for ${q.feeDisplay} (regId ${regId})`);

  const allowance = await publicClient.readContract({
    address: asset, abi: erc20Abi, functionName: "allowance", args: [account.address, payTo],
  });
  if (allowance < fee) {
    console.log("Approving USDC…");
    const hash = await walletClient.writeContract({
      address: asset, abi: erc20Abi, functionName: "approve", args: [payTo, fee * 10n],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  const consumerNonce = randomNonce();
  const signature = await walletClient.signTypedData({
    domain: eip712.domain,
    types: eip712.types,
    primaryType: "SettlementData",
    message: { indexer, regId, queryCount: 1, totalFeeUSDC: fee, consumerNonce },
  });

  const res = await fetch(`${SERVER}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      questionId: QUESTION,
      payment: {
        consumer: account.address,
        queryCount: 1,
        totalFeeUSDC: fee.toString(),
        consumerNonce: consumerNonce.toString(),
        signature,
      },
    }),
  });
  const data = await res.json();
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(data, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
