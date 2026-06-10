"use client";

import { useEffect, useMemo, useState } from "react";
import type { NextPage } from "next";
import { formatUnits } from "viem";
import { base } from "viem/chains";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { ClientOnly } from "~~/components/ClientOnly";
import deployedContracts from "~~/contracts/deployedContracts";
import externalContracts from "~~/contracts/externalContracts";
import { useScaffoldEventHistory, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const REGISTRY_ADDRESS = deployedContracts[8453].IndexerRegistry.address as `0x${string}`;
const USDC_ADDRESS = externalContracts[8453].USDC.address as `0x${string}`;
const USDC_ABI = externalContracts[8453].USDC.abi;

const isHexBytes32 = (value: string): value is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(value);

const truncate = (value: string, head = 8, tail = 6) =>
  value.length > head + tail + 2 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;

const formatUSDC = (raw?: bigint) => {
  if (raw === undefined || raw === null) return "$0.00";
  const n = Number(formatUnits(raw, 6));
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
};

const formatCountdown = (seconds: number) => {
  if (seconds <= 0) return "expired";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
};

const DisputesInner = () => {
  const { address: connectedAddress, chain } = useAccount();
  const { switchChain } = useSwitchChain();

  const [regIdInput, setRegIdInput] = useState<string>("");
  const [claimHashInput, setClaimHashInput] = useState<string>("");
  const [lookedUpRegId, setLookedUpRegId] = useState<`0x${string}` | undefined>(undefined);

  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalCooldown, setApprovalCooldown] = useState(false);
  const [openSubmitting, setOpenSubmitting] = useState(false);
  const [resolveSubmittingId, setResolveSubmittingId] = useState<string | null>(null);

  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: disputeWindowSecs } = useScaffoldReadContract({
    contractName: "IndexerRegistry",
    functionName: "DISPUTE_WINDOW_SECS",
  });
  const { data: resolutionBuffer } = useScaffoldReadContract({
    contractName: "IndexerRegistry",
    functionName: "RESOLUTION_BUFFER",
  });
  const { data: disputeResponseSecs } = useScaffoldReadContract({
    contractName: "IndexerRegistry",
    functionName: "DISPUTE_RESPONSE_SECS",
  });
  const { data: counterStakeBps } = useScaffoldReadContract({
    contractName: "IndexerRegistry",
    functionName: "DISPUTE_COUNTER_STAKE_BPS",
  });

  const { data: regData } = useScaffoldReadContract({
    contractName: "IndexerRegistry",
    functionName: "registrations",
    args: [lookedUpRegId ?? ("0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`)],
  });

  const lookupBoost: bigint = regData ? (regData[1] as bigint) : 0n;

  const { data: disputerRecord } = useScaffoldReadContract({
    contractName: "IndexerRegistry",
    functionName: "disputerRecords",
    args: [connectedAddress],
  });

  const lossCount = disputerRecord ? Number(disputerRecord[0] as number) : 0;
  const multiplier = disputerRecord ? Number(disputerRecord[2] as number) : 1;

  const counterStake = useMemo(() => {
    if (!lookupBoost || !counterStakeBps) return 0n;
    const baseAmount = (lookupBoost * (counterStakeBps as bigint)) / 10000n;
    const mult = BigInt(Math.max(1, multiplier));
    return baseAmount * mult;
  }, [lookupBoost, counterStakeBps, multiplier]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "allowance",
    args: connectedAddress ? [connectedAddress, REGISTRY_ADDRESS] : undefined,
    chainId: base.id,
    query: { enabled: !!connectedAddress },
  });

  const { writeContractAsync: approveUSDC } = useScaffoldWriteContract({ contractName: "USDC" });
  const { writeContractAsync: writeRegistry } = useScaffoldWriteContract({ contractName: "IndexerRegistry" });

  const { data: disputeOpenedEvents } = useScaffoldEventHistory({
    contractName: "IndexerRegistry",
    eventName: "DisputeOpened",
    fromBlock: 0n,
    watch: true,
    blockData: true,
  });

  const { data: disputeResolvedEvents } = useScaffoldEventHistory({
    contractName: "IndexerRegistry",
    eventName: "DisputeResolved",
    fromBlock: 0n,
    watch: true,
  });

  const resolvedSet = useMemo(() => {
    const set = new Set<string>();
    disputeResolvedEvents?.forEach(e => {
      const id = (e.args as { disputeId?: string })?.disputeId;
      if (id) set.add(id.toLowerCase());
    });
    return set;
  }, [disputeResolvedEvents]);

  const myDisputes = useMemo(() => {
    if (!connectedAddress || !disputeOpenedEvents) return [];
    return disputeOpenedEvents
      .filter(e => {
        const args = e.args as { disputer?: string };
        return args.disputer?.toLowerCase() === connectedAddress.toLowerCase();
      })
      .map(e => {
        const args = e.args as { disputeId?: string; disputer?: string; regId?: string };
        const blockTs = (e as unknown as { blockData?: { timestamp?: bigint } }).blockData?.timestamp;
        const ts = blockTs ? Number(blockTs) : 0;
        return {
          disputeId: args.disputeId ?? "",
          regId: args.regId ?? "",
          openedAt: ts,
          resolved: resolvedSet.has((args.disputeId ?? "").toLowerCase()),
        };
      })
      .reverse();
  }, [disputeOpenedEvents, connectedAddress, resolvedSet]);

  const wrongNetwork = !!chain && chain.id !== base.id;
  const needsApproval =
    (allowance as bigint | undefined) === undefined || (allowance as bigint) < counterStake || counterStake === 0n;

  const handleLookup = () => {
    if (!isHexBytes32(regIdInput)) {
      notification.error("regId must be a 32-byte hex string");
      return;
    }
    setLookedUpRegId(regIdInput as `0x${string}`);
  };

  const handleApprove = async () => {
    if (approvalSubmitting || approvalCooldown) return;
    if (counterStake <= 0n) {
      notification.error("Lookup the regId first to compute counter stake");
      return;
    }
    setApprovalSubmitting(true);
    try {
      await approveUSDC({ functionName: "approve", args: [REGISTRY_ADDRESS, counterStake] });
      setApprovalCooldown(true);
      setTimeout(() => {
        setApprovalCooldown(false);
        refetchAllowance();
      }, 4000);
    } catch (e) {
      console.error(e);
      notification.error("USDC approval failed");
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const handleOpenDispute = async () => {
    if (openSubmitting) return;
    if (!isHexBytes32(regIdInput)) {
      notification.error("regId must be a 32-byte hex string");
      return;
    }
    if (!isHexBytes32(claimHashInput)) {
      notification.error("claimHash must be a 32-byte hex string");
      return;
    }
    setOpenSubmitting(true);
    try {
      await writeRegistry({
        functionName: "openDispute",
        args: [regIdInput as `0x${string}`, claimHashInput as `0x${string}`],
      });
      notification.success("Dispute opened");
      setRegIdInput("");
      setClaimHashInput("");
      setLookedUpRegId(undefined);
    } catch (e) {
      console.error(e);
      notification.error("Open dispute failed");
    } finally {
      setOpenSubmitting(false);
    }
  };

  const handleResolveExpired = async (disputeId: string) => {
    if (resolveSubmittingId) return;
    setResolveSubmittingId(disputeId);
    try {
      await writeRegistry({
        functionName: "resolveExpiredDispute",
        args: [disputeId as `0x${string}`],
      });
      notification.success("Resolved");
    } catch (e) {
      console.error(e);
      notification.error("Resolve failed");
    } finally {
      setResolveSubmittingId(null);
    }
  };

  return (
    <>
      {/* Disputer record */}
      {connectedAddress && (
        <div className="card bg-base-100 shadow mb-6">
          <div className="card-body">
            <h2 className="card-title text-lg">Your Disputer Record</h2>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <span className="badge badge-lg">Loss Count: {lossCount}</span>
              <span className="badge badge-lg">Multiplier: {multiplier || 1}x</span>
              <span className="text-xs text-base-content/60">
                Higher multiplier = larger required counter-stake to discourage griefing.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Open dispute form */}
      <div className="card bg-base-100 shadow mb-8">
        <div className="card-body">
          <h2 className="card-title">Open a Dispute</h2>

          <label className="form-control w-full mt-2">
            <div className="label">
              <span className="label-text">regId (bytes32)</span>
            </div>
            <div className="join w-full">
              <input
                type="text"
                placeholder="0x... (32 bytes)"
                className="input input-bordered join-item w-full font-mono text-sm"
                value={regIdInput}
                onChange={e => setRegIdInput(e.target.value.trim())}
              />
              <button type="button" className="btn join-item" onClick={handleLookup}>
                Lookup
              </button>
            </div>
          </label>

          {lookedUpRegId && regData && (
            <div className="alert mt-3">
              <div className="flex flex-col gap-1 text-sm">
                <span>
                  Registration boost: <span className="font-semibold">{formatUSDC(lookupBoost)}</span>
                </span>
                <span>
                  Required counter-stake (at {multiplier || 1}x multiplier):{" "}
                  <span className="font-semibold">{formatUSDC(counterStake)}</span>
                </span>
              </div>
            </div>
          )}

          <label className="form-control w-full mt-3">
            <div className="label">
              <span className="label-text">Claim hash (bytes32) &mdash; commitment to your evidence</span>
            </div>
            <input
              type="text"
              placeholder="0x... (32 bytes)"
              className="input input-bordered w-full font-mono text-sm"
              value={claimHashInput}
              onChange={e => setClaimHashInput(e.target.value.trim())}
            />
          </label>

          <div className="card-actions justify-end mt-4">
            {!connectedAddress ? (
              <button className="btn btn-primary" disabled>
                Connect Wallet
              </button>
            ) : wrongNetwork ? (
              <button className="btn btn-warning" onClick={() => switchChain({ chainId: base.id })}>
                Switch to Base
              </button>
            ) : !lookedUpRegId ? (
              <button className="btn btn-primary" disabled>
                Lookup regId first
              </button>
            ) : needsApproval ? (
              <button
                className="btn btn-primary"
                disabled={approvalSubmitting || approvalCooldown}
                onClick={handleApprove}
              >
                {approvalSubmitting ? "Approving..." : approvalCooldown ? "Approved, syncing..." : "Approve USDC"}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={openSubmitting} onClick={handleOpenDispute}>
                {openSubmitting ? "Opening..." : "Open Dispute"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* My disputes */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Your Disputes</h2>

          <div className="overflow-x-auto">
            <table className="table table-zebra">
              <thead>
                <tr>
                  <th>disputeId</th>
                  <th>regId</th>
                  <th>Status</th>
                  <th>Response window</th>
                  <th>Expiry</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {!connectedAddress && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-base-content/60">
                      Connect a wallet to view your disputes.
                    </td>
                  </tr>
                )}
                {connectedAddress && myDisputes.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-base-content/60">
                      You have no disputes yet.
                    </td>
                  </tr>
                )}
                {myDisputes.map(d => {
                  const respDeadline = d.openedAt + Number(disputeResponseSecs ?? 0n);
                  const expiryDeadline = d.openedAt + Number(disputeWindowSecs ?? 0n) + Number(resolutionBuffer ?? 0n);
                  const responseRemaining = respDeadline - now;
                  const expiryRemaining = expiryDeadline - now;
                  const canResolve = !d.resolved && expiryRemaining <= 0;
                  return (
                    <tr key={d.disputeId}>
                      <td className="font-mono text-xs">{truncate(d.disputeId, 8, 6)}</td>
                      <td className="font-mono text-xs">{truncate(d.regId, 8, 6)}</td>
                      <td>
                        {d.resolved ? (
                          <span className="badge badge-success badge-sm">Resolved</span>
                        ) : (
                          <span className="badge badge-warning badge-sm">Open</span>
                        )}
                      </td>
                      <td className="text-xs">{d.resolved ? "—" : formatCountdown(responseRemaining)}</td>
                      <td className="text-xs">{d.resolved ? "—" : formatCountdown(expiryRemaining)}</td>
                      <td>
                        {canResolve && (
                          <button
                            className="btn btn-xs btn-primary"
                            disabled={resolveSubmittingId === d.disputeId}
                            onClick={() => handleResolveExpired(d.disputeId)}
                          >
                            {resolveSubmittingId === d.disputeId ? "Resolving..." : "Resolve Expired"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
};

const Disputes: NextPage = () => {
  return (
    <div className="flex flex-col grow w-full">
      <div className="px-4 lg:px-8 py-10 max-w-5xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2">Disputes</h1>
        <p className="text-base-content/70 mb-8">Challenge a faulty indexer response and slash their boost stake.</p>
        <ClientOnly fallback={<div className="skeleton h-64 w-full" />}>
          <DisputesInner />
        </ClientOnly>
      </div>
    </div>
  );
};

export default Disputes;
