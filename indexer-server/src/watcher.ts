import { parseAbiItem, type Address, type Hex } from "viem";
import { publicClient } from "./chain.js";
import { config, SYMBOL, TOKEN } from "./config.js";

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export type TransferRecord = {
  block: bigint;
  txHash: Hex;
  logIndex: number;
  from: Address;
  to: Address;
  value: bigint;
};

const CHUNK = 9_000n;
const POLL_MS = 12_000;

/**
 * In-memory rolling index of the configured token's Transfer events. Backfills `backfillBlocks`
 * at boot (chunked to respect getLogs limits), then polls for new blocks and
 * prunes anything that falls out of the window. The store is a cache over the
 * canonical chain — a reboot rebuilds it identically, so there is nothing to
 * persist.
 */
class TransferStore {
  events: TransferRecord[] = [];
  ready = false;
  latest = 0n;
  windowStart = 0n;
  private backfillProgress = 0;

  status() {
    return {
      ready: this.ready,
      events: this.events.length,
      latestBlock: this.latest.toString(),
      windowStartBlock: this.windowStart.toString(),
      backfillProgressPct: this.ready ? 100 : this.backfillProgress,
    };
  }

  /** Events newer than `blocks` blocks ago. Store is sorted by block asc. */
  inWindow(blocks: bigint): TransferRecord[] {
    const cutoff = this.latest - blocks;
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].block <= cutoff) lo = mid + 1;
      else hi = mid;
    }
    return this.events.slice(lo);
  }

  async start() {
    this.latest = await publicClient.getBlockNumber();
    this.windowStart = this.latest - config.backfillBlocks;

    const total = Number(config.backfillBlocks);
    for (let start = this.windowStart; start <= this.latest; start += CHUNK + 1n) {
      const end = start + CHUNK > this.latest ? this.latest : start + CHUNK;
      await this.ingest(start, end);
      this.backfillProgress = Math.min(99, Math.round((Number(end - this.windowStart) / total) * 100));
    }
    this.ready = true;
    console.log(`[watcher] backfill complete: ${this.events.length} ${SYMBOL} transfers over ${config.backfillBlocks} blocks`);

    this.poll();
  }

  private async poll() {
    setTimeout(async () => {
      try {
        const head = await publicClient.getBlockNumber();
        if (head > this.latest) {
          await this.ingest(this.latest + 1n, head);
          this.latest = head;
          this.prune();
        }
      } catch (e) {
        console.error(`[watcher] poll error: ${(e as Error).message}`);
      }
      this.poll();
    }, POLL_MS);
  }

  private async ingest(fromBlock: bigint, toBlock: bigint) {
    const logs = await publicClient.getLogs({
      address: TOKEN,
      event: transferEvent,
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      this.events.push({
        block: log.blockNumber ?? 0n,
        txHash: log.transactionHash as Hex,
        logIndex: log.logIndex ?? 0,
        from: log.args.from as Address,
        to: log.args.to as Address,
        value: log.args.value as bigint,
      });
    }
  }

  private prune() {
    const cutoff = this.latest - config.backfillBlocks;
    if (this.windowStart >= cutoff) return;
    this.windowStart = cutoff;
    const firstKept = this.events.findIndex(e => e.block >= cutoff);
    if (firstKept > 0) this.events = this.events.slice(firstKept);
    else if (firstKept === -1) this.events = [];
  }
}

export const transferStore = new TransferStore();
