import { parseAbiItem, type Address, type Hex } from "viem";
import { publicClient } from "./chain.js";
import { config, PRIZE_POOL } from "./config.js";

// BETRSponsoredPrizePool — e.g. 0xfe8F003Cfa17442362d0F2c8F9C6dF9Bc410E5E3
// pays DOTA out to game winners on Base.
const prizeClaimedEvent = parseAbiItem(
  "event PrizeClaimed(address indexed winner, uint8 tokenType, address token, uint256 amount, uint256 tokenId, uint256 representation)",
);

export type PrizeRecord = {
  block: bigint;
  txHash: Hex;
  winner: Address;
  token: Address;
  amount: bigint;
};

const CHUNK = 9_000n;
const POLL_MS = 12_000;

/**
 * In-memory rolling index of PrizeClaimed events, same shape as TransferStore.
 * Only started when PRIZE_POOL_ADDRESS is configured.
 */
class PrizeStore {
  events: PrizeRecord[] = [];
  ready = false;
  latest = 0n;

  /** Events newer than `blocks` blocks ago. Store is sorted by block asc. */
  inWindow(blocks: bigint): PrizeRecord[] {
    const cutoff = this.latest - blocks;
    return this.events.filter(e => e.block > cutoff);
  }

  async start() {
    if (!PRIZE_POOL) return;
    this.latest = await publicClient.getBlockNumber();
    const windowStart = this.latest - config.backfillBlocks;

    for (let start = windowStart; start <= this.latest; start += CHUNK + 1n) {
      const end = start + CHUNK > this.latest ? this.latest : start + CHUNK;
      await this.ingest(start, end);
    }
    this.ready = true;
    console.log(`[prizes] backfill complete: ${this.events.length} PrizeClaimed events over ${config.backfillBlocks} blocks`);

    this.poll();
  }

  private poll() {
    setTimeout(async () => {
      try {
        const head = await publicClient.getBlockNumber();
        if (head > this.latest) {
          await this.ingest(this.latest + 1n, head);
          this.latest = head;
          this.prune();
        }
      } catch (e) {
        console.error(`[prizes] poll error: ${(e as Error).message}`);
      }
      this.poll();
    }, POLL_MS);
  }

  private async ingest(fromBlock: bigint, toBlock: bigint) {
    const logs = await publicClient.getLogs({
      address: PRIZE_POOL,
      event: prizeClaimedEvent,
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      this.events.push({
        block: log.blockNumber ?? 0n,
        txHash: log.transactionHash as Hex,
        winner: log.args.winner as Address,
        token: log.args.token as Address,
        amount: log.args.amount as bigint,
      });
    }
  }

  private prune() {
    const cutoff = this.latest - config.backfillBlocks;
    const firstKept = this.events.findIndex(e => e.block >= cutoff);
    if (firstKept > 0) this.events = this.events.slice(firstKept);
    else if (firstKept === -1 && this.events.length && this.events[this.events.length - 1].block < cutoff)
      this.events = [];
  }
}

export const prizeStore = new PrizeStore();
