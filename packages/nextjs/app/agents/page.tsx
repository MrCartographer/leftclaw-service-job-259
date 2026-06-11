"use client";

import { useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";

const CONTRACT = "0x3be578A72d1c4ffDBB2AA2418a7fb749BCDBA313";
const SKILL_URL = "https://agent-indexer.vercel.app/skill.md";

const AGENT_ONE_LINER = `Read ${SKILL_URL} and execute it. Build and operate an indexer node for (TARGET_CONTRACT, EVENT_SIGNATURE) = (<put your pair here>).`;

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

        <h2 className="text-2xl font-bold tracking-tight mt-14 mb-6">Two ways in</h2>

        {/* Pathway 1 — agent + skill.md */}
        <div className="border border-base-300 rounded-(--radius-box) p-6 sm:p-8 mb-6 bg-base-100">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-lg font-bold m-0">
              <span className="font-mono text-base-content/40 mr-3">01</span>Hand it to your agent
            </h3>
            <span className="badge badge-outline font-mono text-xs">one sentence</span>
          </div>
          <p className="text-base-content/70 text-sm leading-relaxed mt-0">
            The entire protocol — registration commands, payment spec, node requirements, risks — lives in one
            agent-readable skill file. Paste this into Claude Code, Cursor, or whatever agent you run, swap in your
            target pair, and let it work:
          </p>
          <div className="relative mt-4 mb-3">
            <div className="absolute right-3 top-3 z-10">
              <CopyButton text={AGENT_ONE_LINER} />
            </div>
            <pre className="bg-base-200 border border-base-300 rounded-(--radius-box) p-4 pr-20 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap">
              {AGENT_ONE_LINER}
            </pre>
          </div>
          <p className="text-base-content/60 text-xs leading-relaxed mb-3">
            The skill file includes a live production node to crib request/response shapes from. Prefer to read it
            yourself first?
          </p>
          <a className="btn btn-primary btn-sm" href={SKILL_URL} target="_blank" rel="noreferrer">
            View skill.md
          </a>
        </div>

        {/* Pathway 2 — raw */}
        <div className="border border-base-300 rounded-(--radius-box) p-6 sm:p-8 mb-6 bg-base-100">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h3 className="text-lg font-bold m-0">
              <span className="font-mono text-base-content/40 mr-3">02</span>Raw contract, your infra
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
            from a gas-only wallet — the full struct and domain are in{" "}
            <a href={SKILL_URL} target="_blank" rel="noreferrer" className="link">
              skill.md
            </a>
            , or use the{" "}
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
            disputable.
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
