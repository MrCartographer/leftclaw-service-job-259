"use client";

import { useMemo, useState } from "react";
import type { NextPage } from "next";
import { formatUnits, keccak256, toBytes } from "viem";
import { ClientOnly } from "~~/components/ClientOnly";
import { Address, AddressInput } from "~~/components/scaffold-eth";
import { useScaffoldEventHistory } from "~~/hooks/scaffold-eth";

const RESPONSE_SCHEMA = `{
  "regId": "0x...",                  // bytes32 registration id
  "indexer": "0x...",                // indexer EOA / contract
  "queryCount": 1,                   // uint32 number of queries in this settlement
  "totalFeeUSDC": "1000",            // string-encoded uint256 (6-dec USDC)
  "consumerNonce": "...",            // uint256, unique per consumer
  "results": [                       // off-chain payload, indexer-defined
    {
      "blockNumber": 1234567,
      "txHash": "0x...",
      "logIndex": 0,
      "decoded": { /* ABI-decoded event */ }
    }
  ],
  "signature": "0x..."               // EIP-712 over SettlementInput
}`;

const isHexBytes32 = (value: string): value is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(value);
const isAddress = (value: string): value is `0x${string}` => /^0x[0-9a-fA-F]{40}$/.test(value);

const truncate = (value: string, head = 8, tail = 6) =>
  value.length > head + tail + 2 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;

const formatUSDC = (raw?: bigint) => {
  if (raw === undefined) return "$0.00";
  const n = Number(formatUnits(raw, 6));
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
};

const FindIndexers = () => {
  const [searchTarget, setSearchTarget] = useState<string>("");
  const [searchEventSig, setSearchEventSig] = useState<string>("");
  const [searchSigText, setSearchSigText] = useState<string>("");

  const { data: registeredEvents, isLoading } = useScaffoldEventHistory({
    contractName: "IndexerRegistry",
    eventName: "Registered",
    fromBlock: 47165937n, // contract deploy block
    watch: true,
  });

  const { data: deregisteredEvents } = useScaffoldEventHistory({
    contractName: "IndexerRegistry",
    eventName: "Deregistered",
    fromBlock: 47165937n, // contract deploy block
    watch: true,
  });

  const deregisteredSet = useMemo(() => {
    const set = new Set<string>();
    deregisteredEvents?.forEach(e => {
      const regId = (e.args as { regId?: string })?.regId;
      if (regId) set.add(regId.toLowerCase());
    });
    return set;
  }, [deregisteredEvents]);

  const computedSig = searchSigText ? keccak256(toBytes(searchSigText)) : "";

  const matches = useMemo(() => {
    if (!registeredEvents) return [];
    const sig = isHexBytes32(searchEventSig) ? searchEventSig.toLowerCase() : "";
    const tgt = isAddress(searchTarget) ? searchTarget.toLowerCase() : "";
    if (!sig && !tgt) return [];
    const rows = [];
    for (const ev of registeredEvents) {
      const args = ev.args as {
        regId?: string;
        indexer?: string;
        target?: string;
        eventSig?: string;
        boost?: bigint;
      };
      if (!args.regId || deregisteredSet.has(args.regId.toLowerCase())) continue;
      if (sig && args.eventSig?.toLowerCase() !== sig) continue;
      if (tgt && args.target?.toLowerCase() !== tgt) continue;
      rows.push({
        regId: args.regId,
        indexer: args.indexer ?? "",
        target: args.target ?? "",
        eventSig: args.eventSig ?? "",
        boost: args.boost ?? 0n,
      });
    }
    rows.sort((a, b) => (b.boost > a.boost ? 1 : -1));
    return rows;
  }, [registeredEvents, deregisteredSet, searchEventSig, searchTarget]);

  return (
    <div className="card bg-base-100 shadow mb-8">
      <div className="card-body">
        <h2 className="card-title">Find indexers</h2>
        <p className="text-sm text-base-content/70">
          Filter active registrations by target contract and event signature. Results sorted by boost stake.
        </p>

        <label className="form-control w-full mt-3">
          <div className="label">
            <span className="label-text">Target contract</span>
          </div>
          <AddressInput value={searchTarget} onChange={setSearchTarget} placeholder="0x..." />
        </label>

        <label className="form-control w-full mt-3">
          <div className="label">
            <span className="label-text">Event signature hash (bytes32)</span>
          </div>
          <input
            type="text"
            placeholder="0x... (32 bytes)"
            className="input input-bordered w-full font-mono text-sm"
            value={searchEventSig}
            onChange={e => setSearchEventSig(e.target.value.trim())}
          />
          <div className="label">
            <span className="label-text-alt text-base-content/60">Or compute from a signature string:</span>
          </div>
          <input
            type="text"
            placeholder='e.g. "Transfer(address,address,uint256)"'
            className="input input-bordered w-full text-sm"
            value={searchSigText}
            onChange={e => setSearchSigText(e.target.value)}
          />
          {computedSig && (
            <div className="text-xs mt-1 font-mono text-base-content/60 break-all">
              keccak256 = {computedSig}{" "}
              <button type="button" className="link" onClick={() => setSearchEventSig(computedSig)}>
                use this
              </button>
            </div>
          )}
        </label>

        <div className="mt-5 overflow-x-auto">
          <table className="table table-zebra">
            <thead>
              <tr>
                <th>regId</th>
                <th>Indexer</th>
                <th>Boost</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={3} className="text-center py-6 text-base-content/60">
                    Loading events...
                  </td>
                </tr>
              )}
              {!isLoading && matches.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center py-6 text-base-content/60">
                    Enter a target contract or event signature to search.
                  </td>
                </tr>
              )}
              {matches.map(r => (
                <tr key={r.regId}>
                  <td className="font-mono text-xs">{truncate(r.regId, 8, 6)}</td>
                  <td>
                    <Address address={r.indexer as `0x${string}`} format="short" size="sm" />
                  </td>
                  <td>
                    <span className="badge badge-ghost">{formatUSDC(r.boost)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const SchemaCard = () => {
  const [copied, setCopied] = useState(false);
  const copySchema = async () => {
    try {
      await navigator.clipboard.writeText(RESPONSE_SCHEMA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <section className="card bg-base-100 shadow">
      <div className="card-body">
        <div className="flex items-center justify-between">
          <h2 className="card-title">IndexerResponse schema</h2>
          <button className="btn btn-sm" onClick={copySchema}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-sm text-base-content/70">
          Reference JSON returned by an indexer node. The signature is verifiable on-chain via{" "}
          <code className="text-xs">settleQuery</code>.
        </p>
        <pre className="bg-base-200 p-4 rounded text-xs overflow-x-auto mt-2">
          <code>{RESPONSE_SCHEMA}</code>
        </pre>
      </div>
    </section>
  );
};

const Consumers: NextPage = () => {
  return (
    <div className="flex flex-col grow w-full">
      <div className="px-4 lg:px-8 py-10 max-w-5xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2">For Consumers</h1>
        <p className="text-base-content/70 mb-8">
          Pay per query for on-chain event data. No subscription, no API key, just micropayments over HTTP.
        </p>

        {/* Section 1: How it works (static, no wagmi needed) */}
        <section className="card bg-base-100 shadow mb-8">
          <div className="card-body">
            <h2 className="card-title">How it works</h2>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>
                <span className="font-semibold">Find an indexer</span> registered for the{" "}
                <code className="text-xs">(targetContract, eventSig)</code> pair you need.
              </li>
              <li>
                <span className="font-semibold">Hit the indexer node</span> over HTTP. The node returns{" "}
                <code className="text-xs">402 Payment Required</code> with x402 payment details.
              </li>
              <li>
                <span className="font-semibold">Sign an EIP-712</span> <code className="text-xs">SettlementInput</code>{" "}
                committing to pay USDC for <code className="text-xs">queryCount</code> queries.
              </li>
              <li>
                <span className="font-semibold">Receive an IndexerResponse</span> with decoded events. The indexer later
                calls <code className="text-xs">settleQuery</code> on-chain to collect your USDC.
              </li>
              <li>
                <span className="font-semibold">Dispute on mismatch.</span> If the response is wrong, open a dispute and
                slash the indexer&apos;s stake.
              </li>
            </ol>
          </div>
        </section>

        <ClientOnly fallback={<div className="skeleton h-64 w-full mb-8" />}>
          <FindIndexers />
        </ClientOnly>

        <SchemaCard />
      </div>
    </div>
  );
};

export default Consumers;
