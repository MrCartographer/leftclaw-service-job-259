import { formatUnits } from "viem";
import { erc20Abi } from "./abi.js";
import { publicClient } from "./chain.js";
import { BLOCKS_PER_DAY, CLAWD, DEAD } from "./config.js";
import { transferStore, type TransferRecord } from "./watcher.js";

const DAY = BLOCKS_PER_DAY;
const WEEK = BLOCKS_PER_DAY * 7n;
const HOUR = BLOCKS_PER_DAY / 24n; // 1800 blocks ≈ 1h

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

/** Median of a sorted array of bigints. */
function median(sorted: bigint[]): bigint {
  if (!sorted.length) return 0n;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2n : sorted[mid];
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
  category: string;
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

  // ─── Pulse (last 1h / 24h) ────────────────────────────────────────────────

  {
    id: "transfers-1h",
    text: "How many CLAWD transfers happened in the last hour?",
    emoji: "⚡",
    category: "Pulse",
    compute: () => {
      const n = transferStore.inWindow(HOUR).length;
      return { answer: `${n} transfer${n === 1 ? "" : "s"}`, detail: `Counted over the last ${HOUR} blocks (~1h).` };
    },
  },
  {
    id: "volume-1h",
    text: "How much CLAWD volume moved in the last hour?",
    emoji: "💧",
    category: "Pulse",
    compute: () => {
      const total = transferStore.inWindow(HOUR).reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total)} CLAWD`, detail: "Sum of all Transfer values, ~1h window." };
    },
  },
  {
    id: "transfers-24h",
    text: "How many CLAWD transfers happened in the last 24 hours?",
    emoji: "🔁",
    category: "Pulse",
    compute: () => {
      const n = transferStore.inWindow(DAY).length;
      return { answer: `${n} transfer${n === 1 ? "" : "s"}`, detail: `Counted over the last ${DAY} blocks (~24h).` };
    },
  },
  {
    id: "volume-24h",
    text: "How much CLAWD volume moved in the last 24 hours?",
    emoji: "🌊",
    category: "Pulse",
    compute: () => {
      const total = transferStore.inWindow(DAY).reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total)} CLAWD`, detail: "Sum of all Transfer values, ~24h window." };
    },
  },
  {
    id: "avg-transfer-24h",
    text: "What's the average CLAWD transfer size today?",
    emoji: "⚖️",
    category: "Pulse",
    compute: () => {
      const events = transferStore.inWindow(DAY);
      if (!events.length) return { answer: "No transfers in the last 24 hours" };
      const total = events.reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total / BigInt(events.length))} CLAWD`, detail: `Across ${events.length} transfers, ~24h window.` };
    },
  },
  {
    id: "median-transfer-24h",
    text: "What's the median CLAWD transfer size today?",
    emoji: "📊",
    category: "Pulse",
    compute: () => {
      const events = transferStore.inWindow(DAY);
      if (!events.length) return { answer: "No transfers in the last 24 hours" };
      const sorted = [...events].map(e => e.value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return { answer: `${fmt(median(sorted))} CLAWD`, detail: `Median of ${events.length} transfers, ~24h window.` };
    },
  },
  {
    id: "latest-transfer",
    text: "When was the most recent CLAWD transfer, and how big?",
    emoji: "⏱️",
    category: "Pulse",
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
    id: "blocks-since-last",
    text: "How many blocks since the last CLAWD transfer?",
    emoji: "🕰️",
    category: "Pulse",
    compute: () => {
      const events = transferStore.events;
      if (!events.length) return { answer: "No transfers in the window" };
      const last = events[events.length - 1];
      const diff = transferStore.latest - last.block;
      return { answer: `${diff} block${diff === 1n ? "" : "s"} (~${Number(diff) * 2}s)`, detail: `Last transfer at block ${last.block}; head at ${transferStore.latest}.` };
    },
  },
  {
    id: "last-5-transfers",
    text: "What were the last 5 CLAWD transfers?",
    emoji: "📋",
    category: "Pulse",
    compute: () => {
      const events = transferStore.events;
      if (!events.length) return { answer: "No transfers in the window" };
      const last5 = events.slice(-5).reverse();
      const lines = last5.map(e => `${fmt(e.value)} CLAWD · ${short(e.from)} → ${short(e.to)} · ${agoFromBlock(e.block)}`);
      return { answer: `${last5.length} recent transfers`, detail: lines.join("\n") };
    },
  },

  // ─── Weekly stats ─────────────────────────────────────────────────────────

  {
    id: "largest-7d",
    text: "What was the largest single CLAWD transfer this week?",
    emoji: "🐋",
    category: "Weekly",
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
    id: "smallest-transfer-7d",
    text: "What was the smallest CLAWD transfer this week?",
    emoji: "🔬",
    category: "Weekly",
    compute: () => {
      const events = transferStore.inWindow(WEEK).filter(e => e.value > 0n);
      if (!events.length) return { answer: "No transfers in the last 7 days" };
      const min = events.reduce((a, e) => (e.value < a.value ? e : a));
      return {
        answer: `${fmt(min.value)} CLAWD`,
        detail: `${short(min.from)} → ${short(min.to)}, ${agoFromBlock(min.block)}.`,
        txHash: min.txHash,
      };
    },
  },
  {
    id: "unique-senders-7d",
    text: "How many unique wallets sent CLAWD this week?",
    emoji: "📤",
    category: "Weekly",
    compute: () => {
      const n = new Set(transferStore.inWindow(WEEK).map(e => e.from)).size;
      return { answer: `${n} unique sender${n === 1 ? "" : "s"}` };
    },
  },
  {
    id: "unique-receivers-7d",
    text: "How many unique wallets received CLAWD this week?",
    emoji: "📥",
    category: "Weekly",
    compute: () => {
      const n = new Set(transferStore.inWindow(WEEK).map(e => e.to)).size;
      return { answer: `${n} unique receiver${n === 1 ? "" : "s"}` };
    },
  },
  {
    id: "top-sender-7d",
    text: "Who was the most active CLAWD sender this week?",
    emoji: "🏃",
    category: "Weekly",
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
    category: "Weekly",
    compute: () => {
      const best = topBy(transferStore.inWindow(WEEK), e => e.to, e => e.value);
      if (!best) return { answer: "No transfers in the last 7 days" };
      return { answer: short(best.who), detail: `${fmt(best.total)} CLAWD received in 7 days. Full address: ${best.who}` };
    },
  },
  {
    id: "most-active-wallet-7d",
    text: "Which wallet was most active overall this week (sends + receives)?",
    emoji: "🌀",
    category: "Weekly",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      const tally = new Map<string, bigint>();
      for (const e of events) {
        tally.set(e.from, (tally.get(e.from) ?? 0n) + 1n);
        tally.set(e.to, (tally.get(e.to) ?? 0n) + 1n);
      }
      let best: { who: string; total: bigint } | undefined;
      for (const [who, total] of tally) {
        if (!best || total > best.total) best = { who, total };
      }
      if (!best) return { answer: "No transfers in the last 7 days" };
      return { answer: short(best.who), detail: `${best.total} total interactions (sends + receives). Full address: ${best.who}` };
    },
  },
  {
    id: "top-net-receiver-7d",
    text: "Which wallet accumulated the most CLAWD net this week?",
    emoji: "🏦",
    category: "Weekly",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      const net = new Map<string, bigint>();
      for (const e of events) {
        net.set(e.to, (net.get(e.to) ?? 0n) + e.value);
        net.set(e.from, (net.get(e.from) ?? 0n) - e.value);
      }
      let best: { who: string; total: bigint } | undefined;
      for (const [who, total] of net) {
        if (total > 0n && (!best || total > best.total)) best = { who, total };
      }
      if (!best) return { answer: "No transfers in the last 7 days" };
      return { answer: short(best.who), detail: `Net accumulated ${fmt(best.total)} CLAWD (inbound minus outbound). Full address: ${best.who}` };
    },
  },
  {
    id: "most-diverse-sender-7d",
    text: "Which wallet sent CLAWD to the most unique addresses this week?",
    emoji: "🕸️",
    category: "Weekly",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      const map = new Map<string, Set<string>>();
      for (const e of events) {
        if (!map.has(e.from)) map.set(e.from, new Set());
        map.get(e.from)!.add(e.to);
      }
      let best: { who: string; total: number } | undefined;
      for (const [who, tos] of map) {
        if (!best || tos.size > best.total) best = { who, total: tos.size };
      }
      if (!best) return { answer: "No transfers in the last 7 days" };
      return { answer: short(best.who), detail: `Sent to ${best.total} unique addresses. Full address: ${best.who}` };
    },
  },
  {
    id: "most-diverse-receiver-7d",
    text: "Which wallet received CLAWD from the most unique addresses this week?",
    emoji: "🌐",
    category: "Weekly",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      const map = new Map<string, Set<string>>();
      for (const e of events) {
        if (!map.has(e.to)) map.set(e.to, new Set());
        map.get(e.to)!.add(e.from);
      }
      let best: { who: string; total: number } | undefined;
      for (const [who, froms] of map) {
        if (!best || froms.size > best.total) best = { who, total: froms.size };
      }
      if (!best) return { answer: "No transfers in the last 7 days" };
      return { answer: short(best.who), detail: `Received from ${best.total} unique addresses. Full address: ${best.who}` };
    },
  },
  {
    id: "volume-today-vs-yesterday",
    text: "Is CLAWD volume up or down vs yesterday?",
    emoji: "📈",
    category: "Weekly",
    compute: () => {
      const today = transferStore.inWindow(DAY).reduce((a, e) => a + e.value, 0n);
      const yesterday = transferStore.inWindow(DAY * 2n).reduce((a, e) => a + e.value, 0n) - today;
      if (yesterday === 0n) return { answer: "No data for yesterday", detail: "Insufficient window to compare." };
      const pct = Number(((today - yesterday) * 100n) / yesterday);
      const dir = pct >= 0 ? "▲ up" : "▼ down";
      return {
        answer: `${dir} ${Math.abs(pct)}% vs yesterday`,
        detail: `Today: ${fmt(today)} CLAWD · Yesterday: ${fmt(yesterday)} CLAWD`,
      };
    },
  },
  {
    id: "busiest-day-7d",
    text: "Which day had the most CLAWD transfers this week?",
    emoji: "📅",
    category: "Weekly",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      if (!events.length) return { answer: "No transfers in the last 7 days" };
      const tally = new Map<bigint, number>();
      for (const e of events) {
        const dayBucket = e.block / DAY;
        tally.set(dayBucket, (tally.get(dayBucket) ?? 0) + 1);
      }
      let best: { bucket: bigint; count: number } | undefined;
      for (const [bucket, count] of tally) {
        if (!best || count > best.count) best = { bucket, count };
      }
      if (!best) return { answer: "No transfers in the last 7 days" };
      const daysAgo = Math.round(Number(transferStore.latest / DAY - best.bucket));
      const label = daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
      return { answer: `${label} — ${best.count} transfers`, detail: `Block bucket ~${best.bucket * DAY}` };
    },
  },
  {
    id: "busiest-hour-7d",
    text: "What hour of the day sees the most CLAWD activity this week?",
    emoji: "🕐",
    category: "Weekly",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      if (!events.length) return { answer: "No transfers in the last 7 days" };
      // Bucket by hour-of-day (0–23) using block offset from window start
      const tally = new Array<number>(24).fill(0);
      for (const e of events) {
        const blockAge = transferStore.latest - e.block;
        const secsAgo = Number(blockAge) * 2;
        const hourOfDay = ((Math.floor(secsAgo / 3600) % 24) + 24) % 24;
        tally[23 - hourOfDay]++;
      }
      const max = Math.max(...tally);
      const hour = tally.indexOf(max);
      return { answer: `Hour ~${hour}:00 UTC`, detail: `${max} transfers in that hour-of-day slot over the last 7 days.` };
    },
  },

  // ─── Whales & size ────────────────────────────────────────────────────────

  {
    id: "whales-1m-7d",
    text: "How many transfers over 1M CLAWD happened this week?",
    emoji: "🐳",
    category: "Whales",
    compute: () => {
      const threshold = 1_000_000n * 10n ** 18n;
      const n = transferStore.inWindow(WEEK).filter(e => e.value >= threshold).length;
      return { answer: `${n} whale transfer${n === 1 ? "" : "s"}`, detail: "Threshold: 1,000,000 CLAWD." };
    },
  },
  {
    id: "whales-10m-7d",
    text: "How many transfers over 10M CLAWD happened this week?",
    emoji: "🦈",
    category: "Whales",
    compute: () => {
      const threshold = 10_000_000n * 10n ** 18n;
      const n = transferStore.inWindow(WEEK).filter(e => e.value >= threshold).length;
      return { answer: `${n} mega-whale transfer${n === 1 ? "" : "s"}`, detail: "Threshold: 10,000,000 CLAWD." };
    },
  },
  {
    id: "whale-volume-pct-7d",
    text: "What % of this week's volume came from transfers over 1M CLAWD?",
    emoji: "🥧",
    category: "Whales",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      if (!events.length) return { answer: "No transfers in the last 7 days" };
      const threshold = 1_000_000n * 10n ** 18n;
      const total = events.reduce((a, e) => a + e.value, 0n);
      const whaleTotal = events.filter(e => e.value >= threshold).reduce((a, e) => a + e.value, 0n);
      if (total === 0n) return { answer: "0%" };
      const pct = Number((whaleTotal * 100n) / total);
      return { answer: `${pct}% whale-driven`, detail: `${fmt(whaleTotal)} of ${fmt(total)} CLAWD came from transfers ≥ 1M.` };
    },
  },
  {
    id: "micro-transfers-7d",
    text: "How many micro-transfers (under 1,000 CLAWD) happened this week?",
    emoji: "🦐",
    category: "Whales",
    compute: () => {
      const threshold = 1_000n * 10n ** 18n;
      const n = transferStore.inWindow(WEEK).filter(e => e.value < threshold && e.value > 0n).length;
      return { answer: `${n} micro-transfer${n === 1 ? "" : "s"}`, detail: "Threshold: < 1,000 CLAWD." };
    },
  },

  // ─── Burns ────────────────────────────────────────────────────────────────

  {
    id: "burned-total",
    text: "How much CLAWD has been burned, all time?",
    emoji: "🔥",
    category: "Burns",
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
    id: "burned-24h",
    text: "How much CLAWD was burned in the last 24 hours?",
    emoji: "🕯️",
    category: "Burns",
    compute: () => {
      const total = transferStore
        .inWindow(DAY)
        .filter(e => e.to.toLowerCase() === DEAD.toLowerCase())
        .reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total)} CLAWD`, detail: "Transfers to 0x…dEaD over ~24h." };
    },
  },
  {
    id: "burned-7d",
    text: "How much CLAWD was burned this week?",
    emoji: "♨️",
    category: "Burns",
    compute: () => {
      const total = transferStore
        .inWindow(WEEK)
        .filter(e => e.to.toLowerCase() === DEAD.toLowerCase())
        .reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total)} CLAWD`, detail: "Transfers to 0x…dEaD over ~7 days." };
    },
  },
  {
    id: "burn-pct-7d",
    text: "What % of CLAWD transfers this week went to the burn address?",
    emoji: "🧯",
    category: "Burns",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      if (!events.length) return { answer: "No transfers in the last 7 days" };
      const burns = events.filter(e => e.to.toLowerCase() === DEAD.toLowerCase()).length;
      const pct = ((burns / events.length) * 100).toFixed(1);
      return { answer: `${pct}% burn rate`, detail: `${burns} of ${events.length} transfers went to 0x…dEaD.` };
    },
  },
  {
    id: "largest-burn-7d",
    text: "What was the largest single CLAWD burn this week?",
    emoji: "💀",
    category: "Burns",
    compute: () => {
      const burns = transferStore.inWindow(WEEK).filter(e => e.to.toLowerCase() === DEAD.toLowerCase());
      if (!burns.length) return { answer: "No burns in the last 7 days" };
      const max = burns.reduce((a, e) => (e.value > a.value ? e : a));
      return {
        answer: `${fmt(max.value)} CLAWD`,
        detail: `Burned by ${short(max.from)}, ${agoFromBlock(max.block)}.`,
        txHash: max.txHash,
      };
    },
  },
  {
    id: "top-burner-7d",
    text: "Who burned the most CLAWD this week?",
    emoji: "🏆",
    category: "Burns",
    compute: () => {
      const burns = transferStore.inWindow(WEEK).filter(e => e.to.toLowerCase() === DEAD.toLowerCase());
      if (!burns.length) return { answer: "No burns in the last 7 days" };
      const best = topBy(burns, e => e.from, e => e.value);
      if (!best) return { answer: "No burns in the last 7 days" };
      return { answer: short(best.who), detail: `Burned ${fmt(best.total)} CLAWD this week. Full address: ${best.who}` };
    },
  },
  {
    id: "burn-wallets-7d",
    text: "How many unique wallets burned CLAWD this week?",
    emoji: "🪦",
    category: "Burns",
    compute: () => {
      const n = new Set(
        transferStore.inWindow(WEEK).filter(e => e.to.toLowerCase() === DEAD.toLowerCase()).map(e => e.from),
      ).size;
      return { answer: `${n} unique burner${n === 1 ? "" : "s"}`, detail: "Unique senders to 0x…dEaD in the last 7 days." };
    },
  },

  // ─── Window totals (indexed history) ─────────────────────────────────────

  {
    id: "total-transfers-window",
    text: "How many CLAWD transfers are in the indexed window?",
    emoji: "🗂️",
    category: "Index",
    compute: () => {
      const n = transferStore.events.length;
      return { answer: `${n.toLocaleString()} transfers`, detail: "All events held in the 7-day rolling index." };
    },
  },
  {
    id: "total-volume-window",
    text: "What is the total CLAWD volume in the indexed window?",
    emoji: "🏔️",
    category: "Index",
    compute: () => {
      const total = transferStore.events.reduce((a, e) => a + e.value, 0n);
      return { answer: `${fmt(total)} CLAWD`, detail: "Sum of all Transfer values across the 7-day index." };
    },
  },
  {
    id: "unique-senders-window",
    text: "How many unique wallets have sent CLAWD in the indexed window?",
    emoji: "👥",
    category: "Index",
    compute: () => {
      const n = new Set(transferStore.events.map(e => e.from)).size;
      return { answer: `${n} unique sender${n === 1 ? "" : "s"}`, detail: "Unique from-addresses across the 7-day index." };
    },
  },
  {
    id: "unique-receivers-window",
    text: "How many unique wallets have received CLAWD in the indexed window?",
    emoji: "📬",
    category: "Index",
    compute: () => {
      const n = new Set(transferStore.events.map(e => e.to)).size;
      return { answer: `${n} unique receiver${n === 1 ? "" : "s"}`, detail: "Unique to-addresses across the 7-day index." };
    },
  },
  {
    id: "longest-gap-7d",
    text: "What was the longest gap between CLAWD transfers this week?",
    emoji: "⏳",
    category: "Index",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      if (events.length < 2) return { answer: "Not enough data" };
      let maxGap = 0n;
      for (let i = 1; i < events.length; i++) {
        const gap = events[i].block - events[i - 1].block;
        if (gap > maxGap) maxGap = gap;
      }
      const secs = Number(maxGap) * 2;
      const label = secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.round(secs / 60)}m` : `${Math.round(secs / 3600)}h`;
      return { answer: `${label} gap`, detail: `${maxGap} blocks (~${label}) with no CLAWD transfers.` };
    },
  },
  {
    id: "zero-days-7d",
    text: "How many days in the last 7 had zero CLAWD transfers?",
    emoji: "🌵",
    category: "Index",
    compute: () => {
      const events = transferStore.inWindow(WEEK);
      const activeDays = new Set(events.map(e => e.block / DAY));
      const totalDays = 7;
      const zeroDays = totalDays - activeDays.size;
      return {
        answer: `${zeroDays} day${zeroDays === 1 ? "" : "s"} with no transfers`,
        detail: `${activeDays.size} of the last 7 days had at least one CLAWD transfer.`,
      };
    },
  },
];

export const questionsById = new Map(questions.map(q => [q.id, q]));
