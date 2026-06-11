import { type Address, type Hex } from "viem";
import { publicClient } from "./chain.js";
import { decodableEvents, type EventSig } from "./abi.js";

const MAX_RANGE = 9_000n; // stay under typical eth_getLogs provider limits

export type DecodedEvent = {
  blockNumber: string;
  txHash: Hex;
  logIndex: number;
  args: Record<string, string>;
};

/**
 * Fetch + decode logs for a (target, eventSig) over a block range. Stateless:
 * reads canonical chain on demand, so responses are always dispute-safe. Chunks
 * large ranges to avoid RPC getLogs limits.
 */
export async function fetchEvents(
  target: Address,
  eventSig: Hex,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<DecodedEvent[]> {
  const meta = decodableEvents[eventSig.toLowerCase() as EventSig];
  if (!meta) throw new Error(`Unsupported eventSig ${eventSig}`);

  const out: DecodedEvent[] = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_RANGE + 1n) {
    const end = start + MAX_RANGE > toBlock ? toBlock : start + MAX_RANGE;
    const logs = (await publicClient.getLogs({
      address: target,
      event: meta.abi as any,
      fromBlock: start,
      toBlock: end,
    })) as Array<{ args?: Record<string, unknown>; blockNumber: bigint | null; transactionHash: Hex; logIndex: number | null }>;
    for (const log of logs) {
      const args: Record<string, string> = {};
      for (const [k, v] of Object.entries(log.args ?? {})) {
        args[k] = typeof v === "bigint" ? v.toString() : String(v);
      }
      out.push({
        blockNumber: (log.blockNumber ?? 0n).toString(),
        txHash: log.transactionHash as Hex,
        logIndex: log.logIndex ?? 0,
        args,
      });
    }
  }
  return out;
}

export async function latestBlock(): Promise<bigint> {
  return publicClient.getBlockNumber();
}
