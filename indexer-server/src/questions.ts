import { formatUnits } from "viem";
import { erc20Abi } from "./abi.js";
import { publicClient } from "./chain.js";
import { BLOCKS_PER_DAY, CLAWD, DEAD } from "./config.js";
import { transferStore, type TransferRecord } from "./watcher.js";

const DAY = BLOCKS_PER_DAY;
const WEEK = BLOCKS_PER_DAY * 7n;

/** Compact CLAWD amount: 1234567.89e18 → "1.23M". */
function fmt(value: bigint): string {
  const n = Number(formatUnits(value, 18));
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Approximate wall-clock age of a block, from Base's 2s block time. */
function agoFromBlock(block: bigint): string {
  const secs = Number(transferStore.latest - block) * 2;
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

type Answer = {
  answer: string;
  detail?: string;
  txHash?: string;
};

export type Question = {
  id: string;
  text: string;
  emoji: string;
  compute: () => Promise<Answer> | Answer;
};

function topBy<K extends string>(
  events: TransferRecord[],
  key: (e: TransferRecord) => K,
  weight: (e: TransferRecord) => bigint,
): { who: K; total: bigint } | undefined {
  const tally = new Map<K, bigint>();
  for (const e of events) {
    const k = key(e);
    tally.set(k, (tally.get(k) ?? 0n) + weight(e));
  }
  let best: { who: K; total: bigint } | undefined;
  for (const [who, total] of tally) {
    if (!best || total > best.total) best = { who, total };
  }
  return best;
}

export const questions: Question[] = [
  {
    id: "transfers-24h",
    text: "How many CLAWD transfers happened in the last 24 hours?",
    emoji: "🔁",
    compute: () => {
      const n = transferStore.inWindow(DAY).length;
      return { answer: `${n} transfer${n === 1 ? "" : "s"}`, detail: `Counted over the last ${DAY} blocks (~24h).` };
    },
  },
  {
    id: "volume-24h",
    text: "How much CLAWD volume moved in the last 24 hours?",
    emoji: "🌊",
    compute: () => {
      const total = transferStore.inWindow(DAY).reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total)} CLAWD`, detail: "Sum of all Transfer values, ~24h window." };
    },
  },
  {
    id: "largest-7d",
    text: "What was the largest single CLAWD transfer this week?",
    emoji: "🐋",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      if (!events.length) return { answer: "No transfers in the last 7 days" };
      const max = events.reduce((a, e) => (e.value > a.value ? e : a));
      return {
        answer: `${fmt(max.value)} CLAWD`,
        detail: `${short(max.from)} → ${short(max.to)}, ${agoFromBlock(max.block)}.`,
        txHash: max.txHash,
      };
    },
  },
  {
    id: "unique-senders-7d",
    text: "How many unique wallets sent CLAWD this week?",
    emoji: "📤",
    compute: () => {
      const n = new Set(transferStore.inWindow(WEEK).map(e => e.from)).size;
      return { answer: `${n} unique sender${n === 1 ? "" : "s"}` };
    },
  },
  {
    id: "unique-receivers-7d",
    text: "How many unique wallets received CLAWD this week?",
    emoji: "📥",
    compute: () => {
      const n = new Set(transferStore.inWindow(WEEK).map(e => e.to)).size;
      return { answer: `${n} unique receiver${n === 1 ? "" : "s"}` };
    },
  },
  {
    id: "top-sender-7d",
    text: "Who was the most active CLAWD sender this week?",
    emoji: "🏃",
    compute: () => {
      const best = topBy(transferStore.inWindow(WEEK), e => e.from, () => 1n);
      if (!best) return { answer: "No transfers in the last 7 days" };
      return { answer: short(best.who), detail: `${best.total} transfers sent in 7 days. Full address: ${best.who}` };
    },
  },
  {
    id: "top-receiver-7d",
    text: "Which wallet received the most CLAWD this week?",
    emoji: "🧲",
    compute: () => {
      const best = topBy(transferStore.inWindow(WEEK), e => e.to, e => e.value);
      if (!best) return { answer: "No transfers in the last 7 days" };
      return { answer: short(best.who), detail: `${fmt(best.total)} CLAWD received in 7 days. Full address: ${best.who}` };
    },
  },
  {
    id: "burned-total",
    text: "How much CLAWD has been burned, all time?",
    emoji: "🔥",
    compute: async () => {
      const balance = await publicClient.readContract({
        address: CLAWD,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [DEAD],
      });
      return { answer: `${fmt(balance)} CLAWD`, detail: `Live balanceOf(0x…dEaD) — every protocol buyback burns here.` };
    },
  },
  {
    id: "burned-7d",
    text: "How much CLAWD was burned this week?",
    emoji: "♨️",
    compute: () => {
      const total = transferStore
        .inWindow(WEEK)
        .filter(e => e.to.toLowerCase() === DEAD.toLowerCase())
        .reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total)} CLAWD`, detail: "Transfers to 0x…dEaD over ~7 days." };
    },
  },
  {
    id: "latest-transfer",
    text: "When was the most recent CLAWD transfer, and how big?",
    emoji: "⏱️",
    compute: () => {
      const events = transferStore.events;
      if (!events.length) return { answer: "No transfers in the window" };
      const last = events[events.length - 1];
      return {
        answer: `${agoFromBlock(last.block)} — ${fmt(last.value)} CLAWD`,
        detail: `${short(last.from)} → ${short(last.to)}, block ${last.block}.`,
        txHash: last.txHash,
      };
    },
  },
  {
    id: "avg-transfer-24h",
    text: "What's the average CLAWD transfer size today?",
    emoji: "⚖️",
    compute: () => {
      const events = transferStore.inWindow(DAY);
      if (!events.length) return { answer: "No transfers in the last 24 hours" };
      const total = events.reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total / BigInt(events.length))} CLAWD`, detail: `Across ${events.length} transfers, ~24h window.` };
    },
  },
  {
    id: "whales-7d",
    text: "How many transfers over 1M CLAWD happened this week?",
    emoji: "🐳",
    compute: () => {
      const threshold = 1_000_000n * 10n ** 18n;
      const n = transferStore.inWindow(WEEK).filter(e => e.value >= threshold).length;
      return { answer: `${n} whale transfer${n === 1 ? "" : "s"}`, detail: "Threshold: 1,000,000 CLAWD." };
    },
  },
];

export const questionsById = new Map(questions.map(q => [q.id, q]));
