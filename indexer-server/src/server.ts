import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getAddress, isHex, type Address, type Hex } from "viem";
import { config, PRIZE_POOL, SYMBOL, TOKEN, USDC } from "./config.js";
import { submitterAccount } from "./chain.js";
import { registrations, findByRegId, findByTargetAndSig, type Registration } from "./registry.js";
import { fetchEvents, latestBlock } from "./events.js";
import { domain, types, verifyPayment, settle, type PaymentAuth } from "./payment.js";
import { transferStore } from "./watcher.js";
import { prizeStore } from "./prizes.js";
import { questions, questionsById } from "./questions.js";

const app = new Hono();

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(__dirname, "..", "public", "index.html"), "utf8");
const skillMd = readFileSync(join(__dirname, "..", "public", "skill.md"), "utf8");

// The token Transfer registration — the one the Clickable Questions page sells.
const tokenTransfer = registrations[0];

// ── Clickable Questions page ─────────────────────────────────────────
app.get("/", c => c.html(indexHtml));

// Agent-readable skill file: "you have a live index — market it like this".
// (The become-an-indexer skill lives at agent-indexer.vercel.app/skill.md.)
app.get("/skill.md", c => c.text(skillMd, 200, { "content-type": "text/markdown; charset=utf-8" }));

app.get("/health", c => c.json({ ok: true, watcher: transferStore.status() }));

// ── Service description (agent-facing) ───────────────────────────────
app.get("/api", c =>
  c.json({
    service: "IndexerRegistry node (job #259)",
    indexer: config.indexerAddress,
    submitter: submitterAccount.address,
    contract: config.contract,
    chainId: config.chainId,
    questionFee: config.questionFee.toString(),
    queryFee: config.queryFee.toString(),
    settleOnchain: config.settleOnchain,
    watcher: transferStore.status(),
    registrations: registrations.map(r => ({
      regId: r.regId,
      target: r.target,
      eventSig: r.eventSig,
      event: r.eventName,
    })),
    howToAsk: "GET /questions, then POST /ask { questionId, payment }",
    howToQuery: "POST /query { regId | (target,eventSig), fromBlock, toBlock?, payment? }",
  }),
);

// ── Questions ────────────────────────────────────────────────────────
app.get("/questions", c =>
  c.json({
    token: { symbol: SYMBOL, address: TOKEN },
    fee: config.questionFee.toString(),
    feeDisplay: "$0.10",
    payment: paymentRequirements(tokenTransfer.regId, config.questionFee),
    watcher: transferStore.status(),
    questions: questions.map(q => ({ id: q.id, text: q.text, emoji: q.emoji, category: q.category })),
  }),
);

app.post("/ask", async c => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const question = questionsById.get(body.questionId);
  if (!question) return c.json({ error: "unknown questionId; see GET /questions" }, 404);

  if (!transferStore.ready) {
    return c.json({ error: `index warming up — backfilling ${SYMBOL} transfers, try again in a minute`, watcher: transferStore.status() }, 503);
  }

  if (!body.payment) {
    c.status(402);
    return c.json({ error: "payment required", ...paymentRequirements(tokenTransfer.regId, config.questionFee) });
  }

  const auth = parseAuth(body.payment);
  if ("error" in auth) return c.json({ error: auth.error }, 400);

  const check = await verifyPayment(tokenTransfer.regId, auth, config.questionFee);
  if (!check.ok) return c.json({ error: `payment invalid: ${check.reason}` }, 402);

  let result;
  try {
    result = await question.compute();
  } catch (e) {
    return c.json({ error: `answer computation failed: ${(e as Error).message}` }, 502);
  }

  const settlement = await trySettle(tokenTransfer.regId, auth);

  return c.json({
    questionId: question.id,
    question: question.text,
    ...result,
    asOfBlock: transferStore.latest.toString(),
    settlement,
  });
});

// ── Raw query endpoint (agent-native API, job-254 parity) ────────────
app.post("/query", async c => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  let reg: Registration | undefined;
  if (body.regId) reg = findByRegId(body.regId);
  else if (body.target && body.eventSig) reg = findByTargetAndSig(body.target, body.eventSig);
  if (!reg) {
    return c.json({ error: "no matching registration; see GET /api for what this node serves" }, 404);
  }

  let fromBlock: bigint;
  let toBlock: bigint;
  try {
    fromBlock = BigInt(body.fromBlock);
    toBlock = body.toBlock !== undefined ? BigInt(body.toBlock) : await latestBlock();
  } catch {
    return c.json({ error: "fromBlock (and optional toBlock) must be integers" }, 400);
  }
  if (toBlock < fromBlock) return c.json({ error: "toBlock < fromBlock" }, 400);

  if (!body.payment) {
    c.status(402);
    return c.json({ error: "payment required", ...paymentRequirements(reg.regId, config.queryFee) });
  }

  const auth = parseAuth(body.payment);
  if ("error" in auth) return c.json({ error: auth.error }, 400);

  const check = await verifyPayment(reg.regId, auth, config.queryFee);
  if (!check.ok) return c.json({ error: `payment invalid: ${check.reason}` }, 402);

  let events;
  try {
    events = await fetchEvents(reg.target, reg.eventSig, fromBlock, toBlock);
  } catch (e) {
    return c.json({ error: `event fetch failed: ${(e as Error).message}` }, 502);
  }

  const settlement = await trySettle(reg.regId, auth);

  return c.json({
    regId: reg.regId,
    event: reg.eventName,
    target: reg.target,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    count: events.length,
    events,
    settlement,
  });
});

function parseAuth(payment: any): PaymentAuth | { error: string } {
  try {
    if (!isHex(payment.consumer) || !isHex(payment.signature)) throw new Error("bad hex");
    return {
      consumer: getAddress(payment.consumer),
      queryCount: Number(payment.queryCount ?? 1),
      totalFeeUSDC: BigInt(payment.totalFeeUSDC),
      consumerNonce: BigInt(payment.consumerNonce),
      signature: payment.signature as Hex,
    };
  } catch {
    return { error: "payment must include consumer, totalFeeUSDC, consumerNonce, signature (and optional queryCount)" };
  }
}

// Settle on-chain (optional). If it reverts we still return the data but flag
// the failure — the signature remains valid for a later retry.
async function trySettle(regId: Hex, auth: PaymentAuth): Promise<{ txHash?: Hex; error?: string }> {
  if (!config.settleOnchain) return { error: "SETTLE_ONCHAIN=0 (data served, not settled)" };
  try {
    return { txHash: await settle(regId, auth) };
  } catch (e) {
    return { error: (e as Error).message.slice(0, 200) };
  }
}

function paymentRequirements(regId: Hex, fee: bigint, consumer?: Address) {
  return {
    scheme: "indexer-registry/SettlementData",
    network: "base",
    asset: USDC,
    payTo: config.contract,
    indexer: config.indexerAddress,
    regId,
    fee: fee.toString(),
    queryCount: 1,
    consumer: consumer ?? null,
    instructions: [
      "1. Approve USDC to the contract (payTo) for at least `fee`.",
      "2. Pick a random uint256 consumerNonce (any value unused in consumerNonceUsed).",
      "3. Sign the EIP-712 SettlementData { indexer, regId, queryCount, totalFeeUSDC, consumerNonce }.",
      "4. Re-POST with payment: { consumer, queryCount, totalFeeUSDC, consumerNonce, signature }.",
    ],
    eip712: { domain, types, primaryType: "SettlementData" },
  };
}

serve({ fetch: app.fetch, port: config.port }, info => {
  console.log(`[server] listening on :${info.port}`);
  console.log(`[server] indexer=${config.indexerAddress} submitter=${submitterAccount.address}`);
  console.log(`[server] contract=${config.contract} settleOnchain=${config.settleOnchain}`);
  registrations.forEach(r => console.log(`  - ${r.eventName} on ${r.target} regId=${r.regId}`));
  transferStore.start().catch(e => console.error(`[watcher] fatal: ${e.message}`));
  if (PRIZE_POOL) prizeStore.start().catch(e => console.error(`[prizes] fatal: ${e.message}`));
});
