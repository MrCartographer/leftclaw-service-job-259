"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";

const CONTRACT = "0x3be578A72d1c4ffDBB2AA2418a7fb749BCDBA313";
const REFERENCE_REPO = "https://github.com/MrCartographer/leftclaw-service-job-259";

const AGENT_PROMPT = `You are building an indexer node for the IndexerRegistry protocol on Base mainnet.

Contract: ${CONTRACT} (chainId 8453)
USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals)
Reference implementation: ${REFERENCE_REPO} (indexer-server/)

Protocol rules:
1. regId = keccak256(abi.encode(indexerAddress, targetContract, eventSigTopic0))
2. Register: USDC.approve(contract, amount) -> depositBaseStake(>= 1e6) -> register(target, eventSig, boost).
   Use boost = 0 until the protocol's dispute proof verifier ships.
3. Consumers pay by signing EIP-712 typed data:
   domain = { name: "IndexerRegistry", version: "1", chainId: 8453, verifyingContract: <contract> }
   SettlementData = { indexer: address, regId: bytes32, queryCount: uint32, totalFeeUSDC: uint256, consumerNonce: uint256 }
   consumerNonce is any uint256 not yet used in consumerNonceUsed(consumer, nonce) — pick randomly.
   totalFeeUSDC >= 10000 * queryCount (MIN_QUERY_FEE is $0.01).
4. Settlement: anyone may call settleQuery(SettlementData, signature). Submit from a throwaway
   gas-only wallet — never put the indexer key on the server. The contract pulls the consumer's
   USDC: 98% to the indexer, 1% to the treasury, 1% to a CLAWD buyback-and-burn reserve.
5. The node must: watch the registered (contract, eventSig) logs on Base, serve query responses
   over HTTP gated by the payment check (signature recovers consumer; nonce unused on-chain;
   USDC allowance and balance >= fee), then submit settleQuery. Keep it stateless — rebuild the
   index from eth_getLogs at boot so restarts are safe.

Build this node for (TARGET_CONTRACT, EVENT_SIGNATURE) = (<put your pair here>), with a /health
endpoint and a register script. Any language and stack you prefer.`;

const CAST_COMMANDS = `# 1. Approve USDC for the stake ($1 minimum)
cast send 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \\
  'approve(address,uint256)' ${CONTRACT} 1000000 \\
  --rpc-url https://mainnet.base.org --private-key $INDEXER_KEY

# 2. Stake
cast send ${CONTRACT} \\
  'depositBaseStake(uint256)' 1000000 \\
  --rpc-url https://mainnet.base.org --private-key $INDEXER_KEY

# 3. Register your (contract, eventSig) pair — boost 0 for now
#    eventSig = topic0 = keccak of the event signature, e.g. Transfer(address,address,uint256):
#    0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
cast send ${CONTRACT} \\
  'register(address,bytes32,uint96)' $TARGET_CONTRACT $EVENT_SIG 0 \\
  --rpc-url https://mainnet.base.org --private-key $INDEXER_KEY

# 4. Your regId (what consumers reference):
cast keccak $(cast abi-encode 'f(address,address,bytes32)' $INDEXER_ADDRESS $TARGET_CONTRACT $EVENT_SIG)`;

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-xs btn-primary"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
};

const AgentsPage: NextPage = () => {
  return (
    <div className="flex flex-col items-center px-4 sm:px-8 py-12">
      <div className="w-full max-w-4xl">
        <p className="font-mono text-xs text-base-content/50 uppercase tracking-widest mb-3">Bring your own agent</p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight !leading-tight mb-5">
          Run an indexer.
          <br />
          Earn 98% of every query.
        </h1>
        <p className="text-base-content/70 text-lg leading-relaxed max-w-2xl mb-2">
          Indexers are agents: they watch one <span className="font-mono text-sm">(contract, eventSig)</span> pair on
          Base, answer paid queries over HTTP, and settle on-chain.{" "}
          <strong>We don&apos;t care how you build yours</strong> — any language, any host, any AI. Stake $1, register
          the pair, keep your endpoint alive. That&apos;s the whole job.
        </p>

        {/* Economics strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-base-300 border border-base-300 rounded-(--radius-box) overflow-hidden my-10">
          {[
            ["$1", "minimum stake"],
            ["98%", "of fees to you"],
            ["$0.01", "minimum query fee"],
            ["0 gas", "for your consumers"],
          ].map(([big, small]) => (
            <div key={small} className="bg-base-100 p-5">
              <div className="text-2xl font-bold tracking-tight">{big}</div>
              <div className="text-xs text-base-content/60 uppercase tracking-wider mt-1">{small}</div>
            </div>
          ))}
        </div>

        <h2 className="text-2xl font-bold tracking-tight mt-14 mb-6">Three ways in</h2>

        {/* Pathway 1 */}
        <div className="border border-base-300 rounded-(--radius-box) p-6 sm:p-8 mb-6 bg-base-100">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-lg font-bold m-0">
              <span className="font-mono text-base-content/40 mr-3">01</span>Fork the reference node
            </h3>
            <span className="badge badge-outline font-mono text-xs">~15 minutes</span>
          </div>
          <p className="text-base-content/70 text-sm leading-relaxed mt-0">
            Our production node is open source — the same one serving{" "}
            <a href="https://clawd-answers-production.up.railway.app" target="_blank" rel="noreferrer" className="link">
              CLAWD Answers
            </a>
            . TypeScript, ~600 lines, no database. Fork it, point it at your event pair, deploy to Railway.
          </p>
          <ol className="text-sm text-base-content/70 leading-7 list-decimal list-inside my-3">
            <li>
              Fork{" "}
              <a href={REFERENCE_REPO} target="_blank" rel="noreferrer" className="link font-mono text-xs">
                {REFERENCE_REPO.replace("https://github.com/", "")}
              </a>{" "}
              → <span className="font-mono text-xs">indexer-server/</span>
            </li>
            <li>
              Edit <span className="font-mono text-xs">src/abi.ts</span> (your event) and{" "}
              <span className="font-mono text-xs">src/questions.ts</span> (what you sell)
            </li>
            <li>
              <span className="font-mono text-xs">cp .env.example .env</span> →{" "}
              <span className="font-mono text-xs">npm run register</span> (stakes $1, registers your pair)
            </li>
            <li>
              Deploy: Railway → root directory <span className="font-mono text-xs">indexer-server</span> → set env vars
              → done
            </li>
          </ol>
          <a className="btn btn-primary btn-sm" href={REFERENCE_REPO} target="_blank" rel="noreferrer">
            Open the reference repo
          </a>
        </div>

        {/* Pathway 2 */}
        <div className="border border-base-300 rounded-(--radius-box) p-6 sm:p-8 mb-6 bg-base-100">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-lg font-bold m-0">
              <span className="font-mono text-base-content/40 mr-3">02</span>Let your AI build it
            </h3>
            <span className="badge badge-outline font-mono text-xs">any stack</span>
          </div>
          <p className="text-base-content/70 text-sm leading-relaxed mt-0">
            Paste this prompt into Claude Code, Cursor, or whatever agent you run. It contains the complete protocol
            spec — your agent fills in the stack. Swap in your target contract and event before sending.
          </p>
          <div className="relative mt-4">
            <div className="absolute right-3 top-3 z-10">
              <CopyButton text={AGENT_PROMPT} />
            </div>
            <pre className="bg-base-200 border border-base-300 rounded-(--radius-box) p-4 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto">
              {AGENT_PROMPT}
            </pre>
          </div>
        </div>

        {/* Pathway 3 */}
        <div className="border border-base-300 rounded-(--radius-box) p-6 sm:p-8 mb-6 bg-base-100">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-lg font-bold m-0">
              <span className="font-mono text-base-content/40 mr-3">03</span>Raw contract, your infra
            </h3>
            <span className="badge badge-outline font-mono text-xs">cast + anything</span>
          </div>
          <p className="text-base-content/70 text-sm leading-relaxed mt-0">
            Already run indexing infra (Ponder, subgraphs, your own)? You only need the on-chain registration and the
            EIP-712 payment check. Registration is three transactions:
          </p>
          <div className="relative mt-4">
            <div className="absolute right-3 top-3 z-10">
              <CopyButton text={CAST_COMMANDS} />
            </div>
            <pre className="bg-base-200 border border-base-300 rounded-(--radius-box) p-4 text-xs leading-relaxed overflow-x-auto max-h-80 overflow-y-auto">
              {CAST_COMMANDS}
            </pre>
          </div>
          <p className="text-base-content/60 text-xs leading-relaxed mb-0">
            Then gate your HTTP responses on the consumer&apos;s signed{" "}
            <span className="font-mono">SettlementData</span> and submit <span className="font-mono">settleQuery</span>{" "}
            from a gas-only wallet — full struct and domain are in the prompt above, or use the{" "}
            <Link href="/register" className="link">
              Register
            </Link>{" "}
            page to do the staking from your browser wallet instead.
          </p>
        </div>

        {/* Honest risk note */}
        <div className="border border-base-content rounded-(--radius-box) p-6 sm:p-8 mt-10 bg-base-100">
          <h3 className="text-base font-bold mt-0 mb-2">⚠ Before you stake more than pocket change</h3>
          <p className="text-base-content/70 text-sm leading-relaxed m-0">
            The dispute proof verifier (<span className="font-mono text-xs">LogInclusionVerifier</span>) is not yet
            deployed, so an indexer cannot currently win a dispute by revealing a proof — any dispute resolves for the
            disputer after ~24h. Until it ships: <strong>register with zero boost</strong>, treat your $1 base stake as
            at-risk (max loss 20% per dispute), and keep your endpoint alive — a dead endpoint on a live registration is
            disputable. Track status in{" "}
            <a
              href={`${REFERENCE_REPO}/blob/clawd-answers/NEXT_STEPS.md`}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              NEXT_STEPS.md
            </a>
            .
          </p>
        </div>

        <div className="flex gap-3 mt-10 flex-wrap">
          <Link href="/register" className="btn btn-primary">
            Register on-chain →
          </Link>
          <a className="btn" href={`https://basescan.org/address/${CONTRACT}`} target="_blank" rel="noreferrer">
            Contract on BaseScan
          </a>
        </div>
      </div>
    </div>
  );
};

export default AgentsPage;
