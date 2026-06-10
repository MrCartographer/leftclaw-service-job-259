"use client";

import { useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import type { NextPage } from "next";
import { keccak256, parseUnits, toBytes } from "viem";
import { base } from "viem/chains";
import { useAccount, useSwitchChain } from "wagmi";
import { ClientOnly } from "~~/components/ClientOnly";
import { AddressInput } from "~~/components/scaffold-eth";
import deployedContracts from "~~/contracts/deployedContracts";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const REGISTRY_ADDRESS = deployedContracts[8453].IndexerRegistry.address as `0x${string}`;
const MIN_BASE_STAKE = 1_000_000n; // 1 USDC (6 decimals)

const isHexBytes32 = (value: string): value is `0x${string}` => /^0x[0-9a-fA-F]{64}$/.test(value);

const RegisterInner = () => {
  const { address: connectedAddress, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();

  const [target, setTarget] = useState<string>("");
  const [eventSigInput, setEventSigInput] = useState<string>("");
  const [eventSigText, setEventSigText] = useState<string>("");
  const [boostAmount, setBoostAmount] = useState<string>("1");

  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalCooldown, setApprovalCooldown] = useState(false);

  const [depositSubmitting, setDepositSubmitting] = useState(false);
  const [depositApprovalSubmitting, setDepositApprovalSubmitting] = useState(false);
  const [depositApprovalCooldown, setDepositApprovalCooldown] = useState(false);

  const [registerSubmitting, setRegisterSubmitting] = useState(false);

  const { data: indexerInfo, refetch: refetchIndexer } = useScaffoldReadContract({
    contractName: "IndexerRegistry",
    functionName: "indexers",
    args: [connectedAddress],
  });

  const baseStake = indexerInfo ? (indexerInfo[0] as bigint) : 0n;
  const needsBaseStake = baseStake < MIN_BASE_STAKE;

  const { data: allowance, refetch: refetchAllowance } = useScaffoldReadContract({
    contractName: "USDC",
    functionName: "allowance",
    args: [connectedAddress, REGISTRY_ADDRESS],
    query: { enabled: !!connectedAddress },
  });

  const { writeContractAsync: approveUSDC } = useScaffoldWriteContract({ contractName: "USDC" });
  const { writeContractAsync: writeRegistry } = useScaffoldWriteContract({ contractName: "IndexerRegistry" });

  const parsedBoost: bigint = (() => {
    try {
      const n = Number(boostAmount);
      if (Number.isNaN(n) || n <= 0) return 0n;
      return parseUnits(boostAmount, 6);
    } catch {
      return 0n;
    }
  })();

  const finalEventSig = isHexBytes32(eventSigInput) ? eventSigInput : "";
  const computedHash = eventSigText ? keccak256(toBytes(eventSigText)) : "";

  const wrongNetwork = !!chain && chain.id !== base.id;
  const needsApproval = (allowance as bigint | undefined) === undefined || (allowance as bigint) < parsedBoost;

  const handleApprove = async () => {
    if (approvalSubmitting || approvalCooldown) return;
    if (parsedBoost <= 0n) {
      notification.error("Enter a valid boost amount first");
      return;
    }
    setApprovalSubmitting(true);
    try {
      await approveUSDC({ functionName: "approve", args: [REGISTRY_ADDRESS, parsedBoost] });
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

  const handleDepositApprove = async () => {
    if (depositApprovalSubmitting || depositApprovalCooldown) return;
    setDepositApprovalSubmitting(true);
    try {
      await approveUSDC({ functionName: "approve", args: [REGISTRY_ADDRESS, MIN_BASE_STAKE] });
      setDepositApprovalCooldown(true);
      setTimeout(() => {
        setDepositApprovalCooldown(false);
        refetchAllowance();
      }, 4000);
    } catch (e) {
      console.error(e);
      notification.error("USDC approval failed");
    } finally {
      setDepositApprovalSubmitting(false);
    }
  };

  const handleDeposit = async () => {
    if (depositSubmitting) return;
    setDepositSubmitting(true);
    try {
      await writeRegistry({ functionName: "depositBaseStake", args: [MIN_BASE_STAKE] });
      notification.success("Base stake deposited");
      setTimeout(() => refetchIndexer(), 4000);
    } catch (e) {
      console.error(e);
      notification.error("Deposit failed");
    } finally {
      setDepositSubmitting(false);
    }
  };

  const handleRegister = async () => {
    if (registerSubmitting) return;
    if (!target) {
      notification.error("Enter a target contract address");
      return;
    }
    if (!finalEventSig) {
      notification.error("Enter a valid bytes32 event signature hash");
      return;
    }
    if (parsedBoost <= 0n) {
      notification.error("Enter a valid boost amount");
      return;
    }
    setRegisterSubmitting(true);
    try {
      await writeRegistry({
        functionName: "register",
        args: [target as `0x${string}`, finalEventSig, parsedBoost],
      });
      notification.success("Registered");
      setTarget("");
      setEventSigInput("");
      setEventSigText("");
    } catch (e) {
      console.error(e);
      notification.error("Register failed");
    } finally {
      setRegisterSubmitting(false);
    }
  };

  return (
    <>
      {/* Step 1: Base Stake */}
      <div className="card bg-base-100 shadow mb-6">
        <div className="card-body">
          <h2 className="card-title">Step 1 &mdash; Base stake</h2>
          <p className="text-sm text-base-content/70">
            Each indexer needs a minimum 1 USDC base stake before registering.
          </p>

          {!connectedAddress && (
            <button className="btn btn-primary mt-2" onClick={() => openConnectModal?.()}>
              Connect Wallet
            </button>
          )}

          {connectedAddress && (
            <div className="flex items-center gap-3 mt-2">
              <span className="badge badge-lg">Current: {(Number(baseStake) / 1e6).toFixed(2)} USDC</span>
              {needsBaseStake ? (
                <span className="badge badge-warning">Below minimum</span>
              ) : (
                <span className="badge badge-success">OK</span>
              )}
            </div>
          )}

          {connectedAddress && needsBaseStake && (
            <div className="flex flex-wrap gap-2 mt-3">
              {wrongNetwork ? (
                <button className="btn btn-warning" onClick={() => switchChain({ chainId: base.id })}>
                  Switch to Base
                </button>
              ) : (allowance as bigint | undefined) === undefined || (allowance as bigint) < MIN_BASE_STAKE ? (
                <button
                  className="btn btn-primary"
                  disabled={depositApprovalSubmitting || depositApprovalCooldown}
                  onClick={handleDepositApprove}
                >
                  {depositApprovalSubmitting
                    ? "Approving..."
                    : depositApprovalCooldown
                      ? "Approved, syncing..."
                      : "Approve $1 USDC"}
                </button>
              ) : (
                <button className="btn btn-primary" disabled={depositSubmitting} onClick={handleDeposit}>
                  {depositSubmitting ? "Depositing..." : "Deposit $1 USDC"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Register */}
      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <h2 className="card-title">Step 2 &mdash; Register</h2>

          <label className="form-control w-full mt-2">
            <div className="label">
              <span className="label-text">Target contract address</span>
            </div>
            <AddressInput value={target} onChange={setTarget} placeholder="0x..." />
          </label>

          <label className="form-control w-full mt-3">
            <div className="label">
              <span className="label-text">Event signature hash (bytes32)</span>
            </div>
            <input
              type="text"
              placeholder="0x... (32 bytes)"
              className="input input-bordered w-full font-mono text-sm"
              value={eventSigInput}
              onChange={e => setEventSigInput(e.target.value.trim())}
            />
            <div className="label">
              <span className="label-text-alt text-base-content/60">
                Or paste a signature string below to compute the hash.
              </span>
            </div>
            <input
              type="text"
              placeholder='e.g. "Transfer(address,address,uint256)"'
              className="input input-bordered w-full text-sm"
              value={eventSigText}
              onChange={e => setEventSigText(e.target.value)}
            />
            {computedHash && (
              <div className="text-xs mt-1 font-mono text-base-content/60 break-all">
                keccak256 = {computedHash}{" "}
                <button type="button" className="link" onClick={() => setEventSigInput(computedHash)}>
                  use this
                </button>
              </div>
            )}
          </label>

          <label className="form-control w-full mt-3">
            <div className="label">
              <span className="label-text">Boost stake (USDC)</span>
            </div>
            <input
              type="number"
              min="0"
              step="0.000001"
              className="input input-bordered w-full"
              value={boostAmount}
              onChange={e => setBoostAmount(e.target.value)}
            />
          </label>

          <div className="card-actions justify-end mt-4">
            {!connectedAddress ? (
              <button className="btn btn-primary" onClick={() => openConnectModal?.()}>
                Connect Wallet
              </button>
            ) : wrongNetwork ? (
              <button className="btn btn-warning" onClick={() => switchChain({ chainId: base.id })}>
                Switch to Base
              </button>
            ) : needsBaseStake ? (
              <button className="btn btn-primary" disabled>
                Deposit base stake first
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
              <button className="btn btn-primary" disabled={registerSubmitting} onClick={handleRegister}>
                {registerSubmitting ? "Registering..." : "Register"}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

const Register: NextPage = () => {
  return (
    <div className="flex flex-col grow w-full">
      <div className="px-4 lg:px-8 py-10 max-w-3xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-2">Register as an Indexer</h1>
        <p className="text-base-content/70 mb-6">
          Stake $1 USDC base + boost to register a <code className="text-sm">(target, eventSig)</code> pair.
        </p>
        <ClientOnly fallback={<div className="skeleton h-64 w-full" />}>
          <RegisterInner />
        </ClientOnly>
      </div>
    </div>
  );
};

export default Register;
