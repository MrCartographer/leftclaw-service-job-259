// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// =============================================================================
// External interfaces
// =============================================================================

interface IUniswapV3Pool {
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
}

/**
 * @title IndexerRegistry
 * @notice Permissionless event indexer registry for the LeftClaw protocol.
 * @dev Hard-coded for Base mainnet. All economic constants are pinned at deploy time.
 *      Reentrancy is guarded with EIP-1153 transient storage (requires Cancun+).
 */
contract IndexerRegistry {
    using SafeERC20 for IERC20;

    // =========================================================================
    // Pinned protocol addresses (Base mainnet)
    // =========================================================================

    address public immutable USDC;
    address public immutable CLAWD;
    address public immutable TREASURY;
    address public immutable UNISWAP_V3_ROUTER;
    address public immutable CLAWD_USDC_V3_POOL;

    address public constant EIP4788_BEACON_ROOTS = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    // =========================================================================
    // Economic / timing constants
    // =========================================================================

    uint256 public constant MIN_BASE_STAKE = 1_000_000; // $1 USDC
    uint256 public constant MIN_QUERY_FEE = 10_000; // $0.01 USDC
    uint256 public constant BASE_SLASH_PCT = 2_000; // 20% in bps
    uint256 public constant BOOST_SLASH_PCT = 10_000; // 100% in bps
    uint256 public constant DISPUTE_COUNTER_STAKE_BPS = 2_500; // 25% in bps
    uint256 public constant DISPUTE_WINDOW_SECS = 86_400; // 24h
    uint256 public constant DISPUTE_RESPONSE_SECS = 21_600; // 6h
    uint256 public constant RESOLUTION_BUFFER = 300; // 5 min
    uint256 public constant BOOST_WITHDRAWAL_COOLDOWN = 108_000; // 30h
    uint256 public constant BASE_WITHDRAWAL_COOLDOWN = 604_800; // 7d
    uint256 public constant BASE_SLASH_COOLDOWN = 259_200; // 72h
    uint256 public constant TWAP_WINDOW = 7_200; // 2h
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant REVEAL_WINDOW = 3_600; // 1h after commit

    // =========================================================================
    // EIP-712
    // =========================================================================

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "SettlementData(address indexer,bytes32 regId,uint32 queryCount,uint256 totalFeeUSDC,uint256 consumerNonce)"
    );

    mapping(address consumer => mapping(uint256 nonce => bool used)) public consumerNonceUsed;

    // =========================================================================
    // Storage
    // =========================================================================

    struct IndexerRecord {
        uint128 baseStake;
        uint64 registrationCount;
        uint64 deregisteredAt;
        uint64 lastSlashAt;
        uint8 slashCount;
    }

    mapping(address => IndexerRecord) public indexers;

    struct Registration {
        address targetContract; // slot 0 packed
        uint96 boostStake; // slot 0 packed
        bytes32 eventSigHash; // slot 1
        uint64 registeredAt;
        uint64 deregisteredAt;
        address indexer;
    }

    mapping(bytes32 regId => Registration) public registrations;

    // Track open disputes per registration / per indexer for safe withdrawals
    mapping(bytes32 regId => uint64) public openDisputeCount;
    mapping(address indexer => uint64) public indexerOpenDisputeCount;

    // Reputation
    mapping(bytes32 regId => mapping(address consumer => uint256 settlementCount)) public consumerSettlements;
    mapping(bytes32 regId => uint256) public reputationScore;

    // Disputes
    enum DisputeState {
        Pending,
        CommitReceived,
        ResolvedDisputer,
        ResolvedIndexer,
        Expired
    }

    struct Dispute {
        address disputer;
        address indexer;
        bytes32 regId;
        uint256 counterStake;
        uint256 atRiskBoost;
        uint64 openedAt;
        bytes32 commitHash;
        uint64 committedAt;
        DisputeState state;
    }

    mapping(bytes32 disputeId => Dispute) public disputes;

    // Ring buffer of recent dispute timestamps per (disputer, indexer) pair
    mapping(address disputer => mapping(address indexer => uint64[3])) private disputeTimestamps;

    struct DisputerRecord {
        uint8 lossCount;
        uint64 lastLossAt;
        uint8 multiplier; // 1x–10x, resets after 7d clean
    }

    mapping(address => DisputerRecord) public disputerRecords;

    // Buyback
    uint256 public buybackReserveUSDC;

    // Boost withdrawal queue
    mapping(bytes32 regId => uint64 unlockTime) public boostUnlockTime;

    // EIP-1153 transient storage slot for reentrancy lock.
    // Equal to: uint256(keccak256("IndexerRegistry.reentrancy")) - 1
    // Materialised as a literal so it is usable from inline assembly (Yul).
    uint256 private constant REENTRANCY_SLOT =
        0x9a2c699f6c0a7e5a3d8bf571050a05039b66554c389bd74bd0ac77036f1a3b15;

    // =========================================================================
    // Events
    // =========================================================================

    event Registered(
        bytes32 indexed regId, address indexed indexer, address target, bytes32 eventSig, uint96 boost
    );
    event Deregistered(bytes32 indexed regId);
    event QuerySettled(bytes32 indexed regId, address indexed consumer, uint32 queryCount, uint256 totalFee);
    event DisputeOpened(bytes32 indexed disputeId, address indexed disputer, bytes32 regId);
    event ResponseCommitted(bytes32 indexed disputeId);
    event DisputeResolved(bytes32 indexed disputeId, address indexed winner);
    event BaseStakeSlashed(address indexed indexer, uint256 remaining);
    event BuybackExecuted(uint256 usdcIn, uint256 clawdBurned);

    // =========================================================================
    // Errors
    // =========================================================================

    error Reentrancy();
    error InsufficientBaseStake();
    error InvalidAmount();
    error NotIndexer();
    error AlreadyRegistered();
    error UnknownRegistration();
    error BatchTooLarge();
    error PendingDispute();
    error CooldownNotElapsed();
    error OpenRegistrationsExist();
    error FeeBelowMinimum();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error RateLimited();
    error WrongDisputeState();
    error ResponseWindowClosed();
    error RevealWindowClosed();
    error ProofMismatch();
    error DisputeNotResolvable();
    error SlashCooldownActive();
    error CannotRescueProtocolToken();
    error TwapStale();
    error MinOutNotMet();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address usdc, address clawd, address treasury, address router, address clawdUsdcPool) {
        USDC = usdc;
        CLAWD = clawd;
        TREASURY = treasury;
        UNISWAP_V3_ROUTER = router;
        CLAWD_USDC_V3_POOL = clawdUsdcPool;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("IndexerRegistry"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // =========================================================================
    // Reentrancy guard (EIP-1153 transient storage)
    // =========================================================================

    modifier nonReentrant() {
        assembly {
            if tload(REENTRANCY_SLOT) { revert(0, 0) }
            tstore(REENTRANCY_SLOT, 1)
        }
        _;
        assembly {
            tstore(REENTRANCY_SLOT, 0)
        }
    }

    // =========================================================================
    // Base stake lifecycle
    // =========================================================================

    function depositBaseStake(uint256 amount) external nonReentrant {
        if (amount < MIN_BASE_STAKE) revert InsufficientBaseStake();
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
        IndexerRecord storage rec = indexers[msg.sender];
        rec.baseStake += uint128(amount);
        // Re-deposit clears any prior full-deregistration timer
        if (rec.deregisteredAt != 0) {
            rec.deregisteredAt = 0;
        }
    }

    function withdrawBaseStake() external nonReentrant {
        IndexerRecord storage rec = indexers[msg.sender];
        if (rec.registrationCount != 0) revert OpenRegistrationsExist();
        if (rec.deregisteredAt == 0) revert CooldownNotElapsed();
        if (block.timestamp < uint256(rec.deregisteredAt) + BASE_WITHDRAWAL_COOLDOWN) revert CooldownNotElapsed();
        if (indexerOpenDisputeCount[msg.sender] != 0) revert PendingDispute();

        uint256 amount = rec.baseStake;
        delete indexers[msg.sender];
        if (amount > 0) {
            IERC20(USDC).safeTransfer(msg.sender, amount);
        }
    }

    // =========================================================================
    // Registration
    // =========================================================================

    struct RegisterInput {
        address targetContract;
        bytes32 eventSigHash;
        uint96 boostStake;
    }

    function _computeRegId(address indexer, address target, bytes32 eventSig) internal pure returns (bytes32) {
        return keccak256(abi.encode(indexer, target, eventSig));
    }

    function register(address target, bytes32 eventSig, uint96 boost) external nonReentrant {
        IndexerRecord storage rec = indexers[msg.sender];
        if (rec.baseStake < MIN_BASE_STAKE) revert InsufficientBaseStake();
        if (indexerOpenDisputeCount[msg.sender] != 0) revert PendingDispute();

        bytes32 regId = _computeRegId(msg.sender, target, eventSig);
        Registration storage reg = registrations[regId];
        // If a registration record exists and has not been fully cleared, reject
        if (reg.registeredAt != 0 && reg.deregisteredAt == 0) revert AlreadyRegistered();

        if (boost > 0) {
            IERC20(USDC).safeTransferFrom(msg.sender, address(this), uint256(boost));
        }

        reg.targetContract = target;
        reg.boostStake = boost;
        reg.eventSigHash = eventSig;
        reg.registeredAt = uint64(block.timestamp);
        reg.deregisteredAt = 0;
        reg.indexer = msg.sender;

        rec.registrationCount += 1;
        // Re-activating clears the full-deregistration timer
        if (rec.deregisteredAt != 0) rec.deregisteredAt = 0;

        emit Registered(regId, msg.sender, target, eventSig, boost);
    }

    function registerBatch(RegisterInput[] calldata regs) external nonReentrant {
        uint256 n = regs.length;
        if (n > MAX_BATCH_SIZE) revert BatchTooLarge();

        IndexerRecord storage rec = indexers[msg.sender];
        if (rec.baseStake < MIN_BASE_STAKE) revert InsufficientBaseStake();
        if (indexerOpenDisputeCount[msg.sender] != 0) revert PendingDispute();

        uint256 totalBoost = 0;

        for (uint256 i = 0; i < n; i++) {
            RegisterInput calldata r = regs[i];
            bytes32 regId = _computeRegId(msg.sender, r.targetContract, r.eventSigHash);

            // Duplicate detection within the batch via transient storage
            bytes32 tslot = keccak256(abi.encode("batchDup", regId));
            uint256 seen;
            assembly {
                seen := tload(tslot)
            }
            if (seen != 0) revert AlreadyRegistered();
            assembly {
                tstore(tslot, 1)
            }

            Registration storage reg = registrations[regId];
            if (reg.registeredAt != 0 && reg.deregisteredAt == 0) revert AlreadyRegistered();

            reg.targetContract = r.targetContract;
            reg.boostStake = r.boostStake;
            reg.eventSigHash = r.eventSigHash;
            reg.registeredAt = uint64(block.timestamp);
            reg.deregisteredAt = 0;
            reg.indexer = msg.sender;

            totalBoost += uint256(r.boostStake);
            emit Registered(regId, msg.sender, r.targetContract, r.eventSigHash, r.boostStake);
        }

        if (totalBoost > 0) {
            IERC20(USDC).safeTransferFrom(msg.sender, address(this), totalBoost);
        }
        rec.registrationCount += uint64(n);
        if (rec.deregisteredAt != 0) rec.deregisteredAt = 0;
    }

    function deregister(bytes32 regId) external nonReentrant {
        Registration storage reg = registrations[regId];
        if (reg.indexer != msg.sender) revert NotIndexer();
        if (reg.deregisteredAt != 0) revert UnknownRegistration();

        reg.deregisteredAt = uint64(block.timestamp);
        boostUnlockTime[regId] = uint64(block.timestamp + BOOST_WITHDRAWAL_COOLDOWN);

        IndexerRecord storage rec = indexers[msg.sender];
        rec.registrationCount -= 1;
        if (rec.registrationCount == 0) {
            rec.deregisteredAt = uint64(block.timestamp);
        }

        emit Deregistered(regId);
    }

    function withdrawBoost(bytes32 regId) external nonReentrant {
        Registration storage reg = registrations[regId];
        if (reg.indexer != msg.sender) revert NotIndexer();
        if (block.timestamp < boostUnlockTime[regId]) revert CooldownNotElapsed();
        if (openDisputeCount[regId] != 0) revert PendingDispute();

        uint256 amount = reg.boostStake;
        reg.boostStake = 0;
        if (amount > 0) {
            IERC20(USDC).safeTransfer(msg.sender, amount);
        }
    }

    // =========================================================================
    // Query settlement (EIP-712 signed by the consumer)
    // =========================================================================

    struct SettlementData {
        address indexer;
        bytes32 regId;
        uint32 queryCount;
        uint256 totalFeeUSDC;
        uint256 consumerNonce;
    }

    function settleQuery(SettlementData calldata s, bytes calldata sig) external nonReentrant {
        if (s.totalFeeUSDC < MIN_QUERY_FEE * uint256(s.queryCount)) revert FeeBelowMinimum();

        bytes32 structHash = keccak256(
            abi.encode(SETTLEMENT_TYPEHASH, s.indexer, s.regId, s.queryCount, s.totalFeeUSDC, s.consumerNonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address consumer = _recover(digest, sig);
        if (consumer == address(0)) revert InvalidSignature();

        if (consumerNonceUsed[consumer][s.consumerNonce]) revert NonceAlreadyUsed();
        consumerNonceUsed[consumer][s.consumerNonce] = true;

        // Sanity-check the registration belongs to the named indexer
        Registration storage reg = registrations[s.regId];
        if (reg.indexer != s.indexer) revert UnknownRegistration();

        uint256 treasuryCut = s.totalFeeUSDC / 100; // 1%
        uint256 buybackCut = s.totalFeeUSDC / 100; // 1%
        uint256 indexerCut = s.totalFeeUSDC - treasuryCut - buybackCut;

        IERC20 usdc = IERC20(USDC);
        usdc.safeTransferFrom(consumer, TREASURY, treasuryCut);
        usdc.safeTransferFrom(consumer, address(this), buybackCut);
        usdc.safeTransferFrom(consumer, s.indexer, indexerCut);

        // Reputation: only repeat consumers count
        if (consumerSettlements[s.regId][consumer] > 0) {
            reputationScore[s.regId] += uint256(s.queryCount);
        }
        consumerSettlements[s.regId][consumer] += 1;

        buybackReserveUSDC += buybackCut;

        emit QuerySettled(s.regId, consumer, s.queryCount, s.totalFeeUSDC);
    }

    // =========================================================================
    // Disputes
    // =========================================================================

    function _rateLimitCheck(address disputer, address indexer) internal {
        uint64[3] storage ring = disputeTimestamps[disputer][indexer];
        uint64 windowStart = uint64(block.timestamp) - uint64(DISPUTE_WINDOW_SECS);
        uint256 oldestIdx;
        uint64 oldestTs = type(uint64).max;
        uint256 recent = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (ring[i] > windowStart) recent += 1;
            if (ring[i] < oldestTs) {
                oldestTs = ring[i];
                oldestIdx = i;
            }
        }
        if (recent >= 3) revert RateLimited();
        ring[oldestIdx] = uint64(block.timestamp);
    }

    function openDispute(bytes32 regId, bytes32 /*claimHash*/ ) external nonReentrant returns (bytes32 disputeId) {
        Registration storage reg = registrations[regId];
        if (reg.indexer == address(0)) revert UnknownRegistration();

        _rateLimitCheck(msg.sender, reg.indexer);

        DisputerRecord storage dr = disputerRecords[msg.sender];
        uint256 mult = dr.multiplier == 0 ? 1 : uint256(dr.multiplier);
        uint256 counterStake =
            (uint256(reg.boostStake) * DISPUTE_COUNTER_STAKE_BPS / 10_000) * mult;

        if (counterStake > 0) {
            IERC20(USDC).safeTransferFrom(msg.sender, address(this), counterStake);
        }

        disputeId = keccak256(abi.encode(regId, msg.sender, block.timestamp));
        Dispute storage d = disputes[disputeId];
        d.disputer = msg.sender;
        d.indexer = reg.indexer;
        d.regId = regId;
        d.counterStake = counterStake;
        d.atRiskBoost = uint256(reg.boostStake);
        d.openedAt = uint64(block.timestamp);
        d.state = DisputeState.Pending;

        openDisputeCount[regId] += 1;
        indexerOpenDisputeCount[reg.indexer] += 1;

        emit DisputeOpened(disputeId, msg.sender, regId);
    }

    function commitResponse(bytes32 disputeId, bytes32 proofHash) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.state != DisputeState.Pending) revert WrongDisputeState();
        if (msg.sender != d.indexer) revert NotIndexer();
        if (block.timestamp >= uint256(d.openedAt) + DISPUTE_RESPONSE_SECS) revert ResponseWindowClosed();

        d.commitHash = proofHash;
        d.committedAt = uint64(block.timestamp);
        d.state = DisputeState.CommitReceived;

        emit ResponseCommitted(disputeId);
    }

    function revealResponse(bytes32 disputeId, bytes calldata proofData) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.state != DisputeState.CommitReceived) revert WrongDisputeState();
        if (msg.sender != d.indexer) revert NotIndexer();
        if (block.timestamp > uint256(d.committedAt) + REVEAL_WINDOW) revert RevealWindowClosed();
        if (keccak256(proofData) != d.commitHash) revert ProofMismatch();

        // STUB: always reverts until LogInclusionVerifier ships. See NEXT_STEPS.md.
        _verifyLogInclusion(proofData);

        // Unreachable in the current stub, but kept for once the stub is replaced.
        d.state = DisputeState.ResolvedIndexer;
        _closeDisputeBookkeeping(d);
        if (d.counterStake > 0) {
            IERC20(USDC).safeTransfer(d.disputer, d.counterStake);
        }
        emit DisputeResolved(disputeId, d.indexer);
    }

    function resolveExpiredDispute(bytes32 disputeId) external nonReentrant {
        Dispute storage d = disputes[disputeId];
        if (d.state != DisputeState.Pending && d.state != DisputeState.CommitReceived) {
            revert WrongDisputeState();
        }
        if (block.timestamp < uint256(d.openedAt) + DISPUTE_WINDOW_SECS + RESOLUTION_BUFFER) {
            revert DisputeNotResolvable();
        }

        IndexerRecord storage rec = indexers[d.indexer];
        if (rec.lastSlashAt != 0 && block.timestamp < uint256(rec.lastSlashAt) + BASE_SLASH_COOLDOWN) {
            revert SlashCooldownActive();
        }

        Registration storage reg = registrations[d.regId];

        // Slash 100% of boost stake on the disputed registration
        uint256 boostSlashed = uint256(reg.boostStake);
        reg.boostStake = 0;

        // Slash a percentage of the base stake
        uint256 baseSlashed = uint256(rec.baseStake) * BASE_SLASH_PCT / 10_000;
        if (baseSlashed > rec.baseStake) baseSlashed = rec.baseStake;
        rec.baseStake = uint128(uint256(rec.baseStake) - baseSlashed);
        rec.lastSlashAt = uint64(block.timestamp);
        rec.slashCount += 1;

        uint256 pot = boostSlashed + baseSlashed + d.counterStake;
        uint256 toDisputer = pot * 70 / 100;
        uint256 toBuyback = pot * 20 / 100;
        uint256 toTreasury = pot - toDisputer - toBuyback;

        if (toDisputer > 0) IERC20(USDC).safeTransfer(d.disputer, toDisputer);
        if (toTreasury > 0) IERC20(USDC).safeTransfer(TREASURY, toTreasury);
        buybackReserveUSDC += toBuyback;

        // Update disputer multiplier: a win resets multiplier to 1 if the last
        // loss was more than 7 days ago, otherwise leaves it unchanged.
        DisputerRecord storage dr = disputerRecords[d.disputer];
        if (dr.lastLossAt == 0 || block.timestamp > uint256(dr.lastLossAt) + 7 days) {
            dr.multiplier = 1;
            dr.lossCount = 0;
        }

        d.state = DisputeState.ResolvedDisputer;
        _closeDisputeBookkeeping(d);

        emit DisputeResolved(disputeId, d.disputer);
        emit BaseStakeSlashed(d.indexer, rec.baseStake);
    }

    function _closeDisputeBookkeeping(Dispute storage d) internal {
        if (openDisputeCount[d.regId] > 0) openDisputeCount[d.regId] -= 1;
        if (indexerOpenDisputeCount[d.indexer] > 0) indexerOpenDisputeCount[d.indexer] -= 1;
    }

    /**
     * @dev STUB: Full EIP-4788 + Patricia trie proof verification documented in NEXT_STEPS.md.
     *      Until the LogInclusionVerifier library ships, revealResponse always fails and
     *      disputes resolve via resolveExpiredDispute.
     */
    function _verifyLogInclusion(bytes calldata /*proofData*/ ) internal pure returns (bool) {
        revert("LogInclusionVerifier: not yet implemented - see NEXT_STEPS.md");
    }

    // =========================================================================
    // Buyback
    // =========================================================================

    function executeBuyback(uint256 minClawdOut) external nonReentrant returns (uint256 clawdReceived) {
        uint256 usdcIn = buybackReserveUSDC;
        if (usdcIn == 0) revert InvalidAmount();
        buybackReserveUSDC = 0;

        // TWAP floor lookup (best-effort: skip if the pool is too new)
        uint256 floor = 0;
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = uint32(TWAP_WINDOW);
        secondsAgos[1] = 0;
        try IUniswapV3Pool(CLAWD_USDC_V3_POOL).observe(secondsAgos) returns (
            int56[] memory tickCumulatives, uint160[] memory /*secondsPerLiq*/
        ) {
            // Compute average tick over the window. We deliberately keep this
            // light-weight; downstream callers should pass a realistic minClawdOut.
            int56 tickDelta = tickCumulatives[1] - tickCumulatives[0];
            int24 avgTick = int24(tickDelta / int56(int256(uint256(TWAP_WINDOW))));
            // floor = usdcIn priced naively at 1:1 minus the average tick scaling.
            // The exact price math is intentionally omitted here; the caller's
            // minClawdOut is the operative floor in this stub.
            floor = minClawdOut;
            // Suppress unused-variable warning while leaving the observation hook live.
            avgTick;
        } catch {
            floor = minClawdOut;
        }

        uint256 amountOutMinimum = minClawdOut > floor ? minClawdOut : floor;
        if (amountOutMinimum == 0) revert MinOutNotMet();

        IERC20(USDC).forceApprove(UNISWAP_V3_ROUTER, usdcIn);

        uint256 balBefore = IERC20(CLAWD).balanceOf(address(this));

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: USDC,
            tokenOut: CLAWD,
            fee: 3000,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: usdcIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        ISwapRouter(UNISWAP_V3_ROUTER).exactInputSingle(params);

        uint256 balAfter = IERC20(CLAWD).balanceOf(address(this));
        clawdReceived = balAfter - balBefore;

        IERC20(CLAWD).safeTransfer(address(0xdead), clawdReceived);

        emit BuybackExecuted(usdcIn, clawdReceived);
    }

    // =========================================================================
    // Token rescue
    // =========================================================================

    function rescueToken(address token) external nonReentrant {
        if (token == USDC || token == CLAWD) revert CannotRescueProtocolToken();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(TREASURY, bal);
    }

    // =========================================================================
    // Signature helpers
    // =========================================================================

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        // EIP-2 low-s check
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }
}
