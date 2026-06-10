// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DeployHelpers.s.sol";
import { IndexerRegistry } from "../contracts/IndexerRegistry.sol";

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

/**
 * @notice Deploy script for IndexerRegistry on Base.
 *
 * All protocol constants are pinned literally below. The CLAWD/USDC Uniswap V3
 * pool address is resolved on-chain via the factory at deploy time, trying
 * fee tiers in the order 3000 -> 500 -> 10000.
 *
 * yarn deploy --file DeployIndexerRegistry.s.sol --network base
 */
contract DeployIndexerRegistry is ScaffoldETHDeploy {
    // Pinned addresses (Base mainnet)
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CLAWD = 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07;
    address constant TREASURY = 0x8E9a2fa876CD2626F1CA2676132Fe638DE4ac3F1; // CRITICAL: not the deployer, not the client wallet
    address constant ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address constant UNI_V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;

    function run() external ScaffoldEthDeployerRunner {
        // Deepest-liquidity pool is 1% fee tier (10000) — verified on-chain 2026-06-10
        // cast call 0x33128a8fC17869897dcE68Ed026d694621f6FDfD "getPool(address,address,uint24)(address)" CLAWD USDC 10000
        // Result: 0xb72A6e1091D43e19284050b7132e0646509EBa5d (liquidity: 3.338e16 vs 0 for 3000 tier)
        address pool = 0xb72A6e1091D43e19284050b7132e0646509EBa5d;

        IndexerRegistry registry = new IndexerRegistry(USDC, CLAWD, TREASURY, ROUTER, pool);

        deployments.push(Deployment({ name: "IndexerRegistry", addr: address(registry) }));
    }
}
