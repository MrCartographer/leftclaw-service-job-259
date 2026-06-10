//SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./DeployHelpers.s.sol";
import { DeployIndexerRegistry } from "./DeployIndexerRegistry.s.sol";

/**
 * @notice Main deployment script for all contracts
 * @dev Run this when you want to deploy multiple contracts at once
 *
 * Example: yarn deploy # runs this script(without`--file` flag)
 */
contract DeployScript is ScaffoldETHDeploy {
    function run() external {
        // Deploys all your contracts sequentially
        // Add new deployments here when needed

        DeployIndexerRegistry deployIndexerRegistry = new DeployIndexerRegistry();
        deployIndexerRegistry.run();
    }
}
