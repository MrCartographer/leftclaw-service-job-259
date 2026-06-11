import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { CLAWD, config } from "./config.js";
import { decodableEvents, type EventSig } from "./abi.js";

/**
 * regId = keccak256(abi.encode(indexer, target, eventSig)) — matches
 * IndexerRegistry._computeRegId. NOTE: abi.encode (padded), not encodePacked —
 * this differs from the job-254 contract.
 */
export function computeRegId(indexer: Address, target: Address, eventSig: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "bytes32" }],
      [indexer, target, eventSig],
    ),
  );
}

export type Registration = {
  regId: Hex;
  target: Address;
  eventSig: Hex;
  eventName: string;
};

/**
 * What this server serves: CLAWD Transfer, registered on-chain by the indexer
 * wallet. regId is derived the same way the contract derives it, so consumers
 * can cross-check against the chain.
 */
export const registrations: Registration[] = (Object.keys(decodableEvents) as EventSig[]).map(eventSig => ({
  regId: computeRegId(config.indexerAddress, CLAWD, eventSig),
  target: CLAWD,
  eventSig,
  eventName: decodableEvents[eventSig].name,
}));

const byRegId = new Map(registrations.map(r => [r.regId.toLowerCase(), r]));

export function findByRegId(regId: string): Registration | undefined {
  return byRegId.get(regId.toLowerCase());
}

export function findByTargetAndSig(target: string, eventSig: string): Registration | undefined {
  const t = getAddress(target);
  return registrations.find(r => r.target === t && r.eventSig.toLowerCase() === eventSig.toLowerCase());
}
