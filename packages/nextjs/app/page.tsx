"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { ClientOnly } from "~~/components/ClientOnly";
import { Address } from "~~/components/scaffold-eth";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

const truncate = (value: string, head = 8, tail = 6) =>
  value.length > head + tail + 2 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;

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

  const { data: registeredEvents, isLoading: regLoading } = useScaffoldEventHistory({
    contractName: "IndexerRegistry",
    eventName: "Registered",
    fromBlock: 0n,
    watch: true,
  });

  const { data: deregisteredEvents } = useScaffoldEventHistory({
    contractName: "IndexerRegistry",
    eventName: "Deregistered",
    fromBlock: 0n,
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
    if (!registeredEvents) return [];
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
          <div className="stat-desc">{regLoading ? "Loading events..." : "Live from Registered events"}</div>
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
        <Link href="/register" className="btn btn-primary btn-sm">
          Register
        </Link>
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
                  {regLoading ? "Loading registrations..." : "No active registrations yet."}
                </td>
              </tr>
            )}
            {activeRegs.map(r => (
              <tr key={r.regId}>
                <td className="font-mono text-xs">{truncate(r.regId, 8, 6)}</td>
                <td>
                  <Address address={r.target as `0x${string}`} format="short" size="sm" />
                </td>
                <td className="font-mono text-xs">{truncate(r.eventSig, 10, 6)}</td>
                <td>
                  <span className="badge badge-ghost">{formatUSDC(r.boost)}</span>
                </td>
                <td>
                  <Address address={r.indexer as `0x${string}`} format="short" size="sm" />
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
                      <Address address={r.target as `0x${string}`} format="short" size="sm" />
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
          <h1 className="text-3xl font-bold mb-2">IndexerRegistry</h1>
          <p className="text-base-content/70">
            Permissionless event indexers on Base. Indexers stake USDC to register{" "}
            <code className="text-sm">(targetContract, eventSig)</code> pairs and serve queries.
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
