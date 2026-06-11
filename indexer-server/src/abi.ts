// Minimal ABI of the on-chain bits the server touches (IndexerRegistry, job #259).
export const registryAbi = [
  {
    type: "function",
    name: "settleQuery",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "s",
        type: "tuple",
        components: [
          { name: "indexer", type: "address" },
          { name: "regId", type: "bytes32" },
          { name: "queryCount", type: "uint32" },
          { name: "totalFeeUSDC", type: "uint256" },
          { name: "consumerNonce", type: "uint256" },
        ],
      },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "consumerNonceUsed",
    stateMutability: "view",
    inputs: [
      { name: "consumer", type: "address" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "used", type: "bool" }],
  },
  {
    type: "function",
    name: "registrations",
    stateMutability: "view",
    inputs: [{ name: "regId", type: "bytes32" }],
    outputs: [
      { name: "targetContract", type: "address" },
      { name: "boostStake", type: "uint96" },
      { name: "eventSigHash", type: "bytes32" },
      { name: "registeredAt", type: "uint64" },
      { name: "deregisteredAt", type: "uint64" },
      { name: "indexer", type: "address" },
    ],
  },
  {
    type: "function",
    name: "reputationScore",
    stateMutability: "view",
    inputs: [{ name: "regId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// Event ABIs for the CLAWD events we serve. topic0 (eventSig) is the key.
export const decodableEvents = {
  // Transfer(address,address,uint256)
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": {
    name: "Transfer",
    abi: {
      type: "event",
      name: "Transfer",
      inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
      ],
    },
  },
} as const;

export type EventSig = keyof typeof decodableEvents;

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
