"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { ClientOnly } from "~~/components/ClientOnly";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const CACHE_KEY = "indexer-registry-regs-v1";

type CachedRow = { regId: string; indexer: string; target: string; eventSig: string; boost: string };

function loadCache(): CachedRow[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveCache(rows: CachedRow[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

const truncate = (value: string, head = 8, tail = 6) =>
  value.length > head + tail + 2 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;

// Logos keyed by lowercase address — target contracts and indexer wallets.
const TARGET_LOGOS: Record<string, string> = {
  "0x9f86db9fc6f7c9408e8fda3ff8ce4e78ac7a6b07": "/clawd.jpg", // CLAWD
  "0x5f09821cbb61e09d2a83124ae0b56aaa3ae85b07": "/dota-logo.jpg", // DOTA
};
const INDEXER_LOGOS: Record<string, string> = {
  "0x287820cbaa25153afdc1a84e73bb1300fdaa1d3c": "/BAYC8781.png",
};

const AddrLogo = ({ src, alt }: { src?: string; alt: string }) =>
  src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className="w-6 h-6 rounded-full object-cover" />
  ) : null;

const AddrLink = ({ address }: { address: string }) => (
  <a
    href={`https://basescan.org/address/${address}`}
    target="_blank"
    rel="noopener noreferrer"
    className="font-mono text-xs hover:underline"
  >
    {truncate(address, 6, 4)}
  </a>
);

const formatUSDC = (raw?: bigint) => {
  if (raw === undefined) return "$0.00";
  const n = Number(formatUnits(raw, 6));
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
};

type RegRow = {
  regId: string;
  indexer: string;
  target: string;
  eventSig: string;
  boost: bigint;
};

const HomeInner = () => {
  const { address: connectedAddress } = useAccount();

  const [cachedRegs, setCachedRegs] = useState<CachedRow[]>([]);

  useEffect(() => {
    setCachedRegs(loadCache());
  }, []);

  const { data: registeredEvents, isLoading: regLoading } = useScaffoldEventHistory({
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

  const { data: buybackReserve } = useScaffoldReadContract({
    contractName: "IndexerRegistry",
    functionName: "buybackReserveUSDC",
  });

  const deregisteredSet = useMemo(() => {
    const set = new Set<string>();
    deregisteredEvents?.forEach(e => {
      const regId = (e.args as { regId?: string })?.regId;
      if (regId) set.add(regId.toLowerCase());
    });
    return set;
  }, [deregisteredEvents]);

  const activeRegs: RegRow[] = useMemo(() => {
    // While events are loading, show cached data immediately
    if (!registeredEvents) {
      return cachedRegs
        .filter(r => !deregisteredSet.has(r.regId.toLowerCase()))
        .map(r => ({ ...r, boost: BigInt(r.boost) }));
    }
    const rows: RegRow[] = [];
    for (const ev of registeredEvents) {
      const args = ev.args as {
        regId?: string;
        indexer?: string;
        target?: string;
        eventSig?: string;
        boost?: bigint;
      };
      if (!args.regId || deregisteredSet.has(args.regId.toLowerCase())) continue;
      rows.push({
        regId: args.regId,
        indexer: args.indexer ?? "",
        target: args.target ?? "",
        eventSig: args.eventSig ?? "",
        boost: args.boost ?? 0n,
      });
    }
    // Persist to cache for next visit
    saveCache(rows.map(r => ({ ...r, boost: r.boost.toString() })));
    return rows;
  }, [registeredEvents, deregisteredSet]);

  const totalStaked = useMemo(() => activeRegs.reduce((acc, r) => acc + (r.boost ?? 0n), 0n), [activeRegs]);

  const myRegs = useMemo(() => {
    if (!connectedAddress) return [];
    return activeRegs.filter(r => r.indexer.toLowerCase() === connectedAddress.toLowerCase());
  }, [activeRegs, connectedAddress]);

  return (
    <>
      <div className="stats stats-vertical lg:stats-horizontal shadow w-full mb-8 bg-base-100">
        <div className="stat">
          <div className="stat-title">Active Registrations</div>
          <div className="stat-value text-primary">{activeRegs.length}</div>
          <div className="stat-desc">
            {regLoading && activeRegs.length === 0 ? "Loading events..." : "Live from Registered events"}
          </div>
        </div>
        <div className="stat">
          <div className="stat-title">Total Boost Staked</div>
          <div className="stat-value">{formatUSDC(totalStaked)}</div>
          <div className="stat-desc">Sum of active boost stakes</div>
        </div>
        <div className="stat">
          <div className="stat-title">Buyback Reserve</div>
          <div className="stat-value">{formatUSDC(buybackReserve as bigint | undefined)}</div>
          <div className="stat-desc">USDC accumulated for CLAWD buyback</div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-2xl font-bold">Active Registrations</h2>
        <div className="flex gap-2">
          <Link href="/agents" className="btn btn-sm">
            Run an agent
          </Link>
          <Link href="/register" className="btn btn-primary btn-sm">
            Register
          </Link>
        </div>
      </div>

      <div className="card bg-base-100 shadow overflow-x-auto">
        <table className="table table-zebra">
          <thead>
            <tr>
              <th>regId</th>
              <th>Target Contract</th>
              <th>Event Sig</th>
              <th>Boost</th>
              <th>Indexer</th>
            </tr>
          </thead>
          <tbody>
            {activeRegs.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-base-content/60 py-8">
                  {regLoading && cachedRegs.length === 0 ? "Loading registrations..." : "No active registrations yet."}
                </td>
              </tr>
            )}
            {activeRegs.map(r => (
              <tr key={r.regId}>
                <td className="font-mono text-xs">{truncate(r.regId, 8, 6)}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <AddrLogo src={TARGET_LOGOS[r.target.toLowerCase()]} alt="Target" />
                    <AddrLink address={r.target} />
                  </div>
                </td>
                <td className="font-mono text-xs">{truncate(r.eventSig, 10, 6)}</td>
                <td>
                  <span className="badge badge-ghost">{formatUSDC(r.boost)}</span>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <AddrLogo src={INDEXER_LOGOS[r.indexer.toLowerCase()]} alt="Indexer" />
                    <AddrLink address={r.indexer} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {connectedAddress && (
        <div className="mt-10">
          <h2 className="text-2xl font-bold mb-3">Your Registrations</h2>
          <div className="card bg-base-100 shadow overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>regId</th>
                  <th>Target Contract</th>
                  <th>Event Sig</th>
                  <th>Boost</th>
                </tr>
              </thead>
              <tbody>
                {myRegs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-base-content/60 py-6">
                      You have no active registrations.{" "}
                      <Link href="/register" className="link">
                        Create one
                      </Link>
                      .
                    </td>
                  </tr>
                )}
                {myRegs.map(r => (
                  <tr key={r.regId}>
                    <td className="font-mono text-xs">{truncate(r.regId, 8, 6)}</td>
                    <td>
                      <AddrLink address={r.target} />
                    </td>
                    <td className="font-mono text-xs">{truncate(r.eventSig, 10, 6)}</td>
                    <td>
                      <span className="badge badge-ghost">{formatUSDC(r.boost)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
};

const Home: NextPage = () => {
  return (
    <div className="flex flex-col grow w-full">
      <div className="px-4 lg:px-8 py-10 max-w-7xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Agent Indexer</h1>
          <p className="text-base-content/70">
            Permissionless event indexers on Base, powered by the <code className="text-sm">IndexerRegistry</code> smart
            contract. Indexers stake USDC to register <code className="text-sm">(targetContract, eventSig)</code> pairs
            and serve queries.
          </p>
        </div>
        <ClientOnly fallback={<div className="skeleton h-32 w-full" />}>
          <HomeInner />
        </ClientOnly>
      </div>
    </div>
  );
};

export default Home;
