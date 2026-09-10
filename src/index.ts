import {ponder} from "ponder:registry";
import {
    Borrow,
    Repay,
    Supply,
    Withdraw,
    LiquidationCall,
    ReserveDataEvent,
    AssetPriceSnapshot,
} from "ponder:schema";

import {CorePoolAbi} from "../abis/CorePoolAbi";
import config from "../ponder.config";

import {getOraclePrice} from "./helpers/getPrice";
import {updateUserPosition} from "./helpers/userPositionManager";
import {calculateScaledBalance} from "./helpers/aave";
import {
    recordReserveDataUpdate,
    finalizeDailyAnchors,
    getLiquidityIndexForEvent,
    getVariableBorrowIndexForEvent,
} from "./helpers/reserveState";
import {USDC_ADDRESS, USDC_DECIMALS, isUSDC} from "./helpers/usdc";
import {isWithdrawAdapter} from "./helpers/adapters";
import {applyHTokenBalanceTransfer} from "./helpers/hTokenTransfers";

/** Store the canonical periodic USDC price series used by all reports. */
async function snapshotUSDCPrice(context: any, blockNumber: bigint, timestamp: number): Promise<void> {
    try {
        const price = await getOraclePrice(context, USDC_ADDRESS);
        if (price > 0n) {
            await context.db.insert(AssetPriceSnapshot).values({
                id: `${USDC_ADDRESS.toLowerCase()}-${blockNumber}`, // text id: keep every address key lowercase
                asset: USDC_ADDRESS,
                price,
                decimals: USDC_DECIMALS,
                blockNumber,
                timestamp,
            }).onConflictDoNothing();
        }
    } catch (error) {
        console.error(`[AssetPriceSnapshot] Error fetching USDC price at block ${blockNumber}:`, error);
    }
}

// ============================================================================
// This indexer tracks ONLY the USDC reserve of the HyperLend core pool, and only
// the events the yield API reads (supply, withdraw, borrow, repay, liquidation,
// reserve data updates, hUSDC transfers). ponder.config.ts restricts which
// CorePool logs are fetched (event filters on the indexed reserve args); every
// handler below re-checks the reserve so the USDC-only invariant is explicit and
// survives config changes.
// ============================================================================

// hUSDC BalanceTransfer: the user's supply moved to another holder without a
// Supply/Withdraw. Without this, a user who transfers hUSDC away keeps earning
// "yield" in the API on a balance they no longer hold.
ponder.on("USDCHToken:BalanceTransfer", async ({event, context}) => {
    await applyHTokenBalanceTransfer(
        context,
        {from: event.args.from, to: event.args.to, value: event.args.value, index: event.args.index},
        {
            timestamp: Number(event.block.timestamp),
            txHash: event.transaction.hash,
            blockNumber: event.block.number,
            logIndex: event.log.logIndex,
        }
    );
});

// Borrow Event Handler
ponder.on("CorePool:Borrow", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const timestamp = Number(event.block.timestamp);
    const variableBorrowIndex = await getVariableBorrowIndexForEvent(
        context,
        event.args.reserve,
        timestamp,
        event.transaction.hash
    );
    const scaledAmount = calculateScaledBalance(event.args.amount, variableBorrowIndex);

    await context.db.insert(Borrow).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        onBehalfOf: event.args.onBehalfOf,
        amount: event.args.amount,
        scaledAmount,
        variableBorrowIndex,
        interestRateMode: event.args.interestRateMode,
        borrowRate: event.args.borrowRate,
        referralCode: event.args.referralCode,
        timestamp,
    });
});

// Repay Event Handler
ponder.on("CorePool:Repay", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;
    const variableBorrowIndex = await getVariableBorrowIndexForEvent(
        context,
        event.args.reserve,
        timestamp,
        event.transaction.hash
    );
    const scaledAmount = calculateScaledBalance(event.args.amount, variableBorrowIndex);

    await context.db.insert(Repay).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        repayer: event.args.repayer,
        amount: event.args.amount,
        scaledAmount,
        variableBorrowIndex,
        useATokens: event.args.useATokens,
        timestamp: timestamp,
    });

    // When useATokens=true the pool burns hTokens to repay the debt. The burned hTokens
    // belong to msg.sender, i.e. event.args.repayer, not necessarily to the debtor
    // (event.args.user), so the supply position reduced here is the repayer's.
    if (event.args.useATokens) {
        // Liquidity index from the in-memory reserve state (updated by the ReserveDataUpdated
        // event emitted earlier in this same transaction)
        const currentLiquidityIndex = await getLiquidityIndexForEvent(
            context,
            event.args.reserve,
            timestamp,
            event.transaction.hash
        );

        // Calculate scaled balance from repay amount
        const scaledBalance = calculateScaledBalance(event.args.amount, currentLiquidityIndex);

        // Update the repayer's position with a negative scaled balance (like a withdraw)
        await updateUserPosition(
            context,
            event.args.repayer,
            event.args.reserve,
            -scaledBalance, // Negative for reducing supply
            'withdraw', // Treat as withdraw since aTokens are being burned
            timestamp,
            event.transaction.hash,
            blockNumber,
            event.log.logIndex,
            currentLiquidityIndex
        );
    }
});

// Supply Event Handler - Enhanced for Interest Tracking
ponder.on("CorePool:Supply", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;

    // Insert the historical Supply transaction record
    await context.db.insert(Supply).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        onBehalfOf: event.args.onBehalfOf,
        amount: event.args.amount,
        referralCode: event.args.referralCode,
        timestamp: timestamp,
    });

    // Liquidity index from the in-memory reserve state (updated by the ReserveDataUpdated
    // event emitted earlier in this same transaction)
    const currentLiquidityIndex = await getLiquidityIndexForEvent(
        context,
        event.args.reserve,
        timestamp,
        event.transaction.hash
    );

    // Calculate scaled balance from deposit amount
    const scaledBalance = calculateScaledBalance(event.args.amount, currentLiquidityIndex);

    // Update user position with scaled balance tracking
    await updateUserPosition(
        context,
        event.args.onBehalfOf,
        event.args.reserve,
        scaledBalance,
        'deposit',
        timestamp,
        event.transaction.hash,
        blockNumber,
        event.log.logIndex,
        currentLiquidityIndex
    );
});

// Withdraw Event Handler
ponder.on("CorePool:Withdraw", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;

    // Withdrawals through a known adapter (gateway, collateral swapper, repay adapter):
    // event.args.user is the adapter, which pulled the user's hTokens with transferFrom
    // in this same transaction; the actual user is transaction.from. The matching
    // BalanceTransfer(user -> adapter) is skipped by the hToken handler (see adapters.ts).
    const actualUser = isWithdrawAdapter(event.args.user) ? event.transaction.from : event.args.user;

    // Insert the historical Withdraw transaction record
    await context.db.insert(Withdraw).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        onBehalfOf: actualUser,
        to: event.args.to,
        amount: event.args.amount,
        timestamp: timestamp,
    });

    // Liquidity index from the in-memory reserve state (updated by the ReserveDataUpdated
    // event emitted earlier in this same transaction)
    const currentLiquidityIndex = await getLiquidityIndexForEvent(
        context,
        event.args.reserve,
        timestamp,
        event.transaction.hash
    );

    // Calculate scaled balance from withdrawal amount
    const scaledBalance = calculateScaledBalance(event.args.amount, currentLiquidityIndex);

    // Update user position with scaled balance tracking
    await updateUserPosition(
        context,
        actualUser,
        event.args.reserve,
        -scaledBalance, // Negative for withdrawals
        'withdraw',
        timestamp,
        event.transaction.hash,
        blockNumber,
        event.log.logIndex,
        currentLiquidityIndex
    );
});

// LiquidationCall Event Handler - kept when USDC is the collateral OR the debt asset
ponder.on("CorePool:LiquidationCall", async ({event, context}) => {
    if (!isUSDC(event.args.collateralAsset) && !isUSDC(event.args.debtAsset)) return;

    const timestamp = Number(event.block.timestamp);
    const [liquidityIndex, variableBorrowIndex] = await Promise.all([
        isUSDC(event.args.collateralAsset)
            ? getLiquidityIndexForEvent(context, USDC_ADDRESS, timestamp, event.transaction.hash)
            : Promise.resolve(0n),
        isUSDC(event.args.debtAsset)
            ? getVariableBorrowIndexForEvent(context, USDC_ADDRESS, timestamp, event.transaction.hash)
            : Promise.resolve(0n),
    ]);

    await context.db.insert(LiquidationCall).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        collateralAsset: event.args.collateralAsset,
        debtAsset: event.args.debtAsset,
        user: event.args.user,
        debtToCover: event.args.debtToCover,
        liquidatedCollateralAmount: event.args.liquidatedCollateralAmount,
        scaledDebtToCover: variableBorrowIndex > 0n
            ? calculateScaledBalance(event.args.debtToCover, variableBorrowIndex)
            : 0n,
        scaledCollateralAmount: liquidityIndex > 0n
            ? calculateScaledBalance(event.args.liquidatedCollateralAmount, liquidityIndex)
            : 0n,
        liquidator: event.args.liquidator,
        receiveAToken: event.args.receiveAToken,
        timestamp,
    });
});

// ReserveDataUpdated Event Handler - Enhanced for Interest Tracking
ponder.on("CorePool:ReserveDataUpdated", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;

    // Store one canonical reserve-state row for both API history and interest calculations.
    await context.db.insert(ReserveDataEvent).values({
        id: `${event.transaction.hash}_${event.log.logIndex}_${event.args.reserve}`,
        txHash: event.transaction.hash,
        reserve: event.args.reserve,
        liquidityIndex: event.args.liquidityIndex,
        liquidityRate: event.args.liquidityRate,
        variableBorrowIndex: event.args.variableBorrowIndex,
        variableBorrowRate: event.args.variableBorrowRate,
        timestamp: timestamp,
        blockNumber: blockNumber,
        logIndex: event.log.logIndex,
    });

    // Update the in-memory reserve state used by the balance handlers of this same
    // transaction, and write DailyReserveIndex rows for any UTC midnight crossed since
    // the previous update.
    await recordReserveDataUpdate(
        context.db,
        event.args.reserve,
        {
            timestamp,
            liquidityIndex: event.args.liquidityIndex,
            liquidityRate: event.args.liquidityRate,
            variableBorrowIndex: event.args.variableBorrowIndex,
            variableBorrowRate: event.args.variableBorrowRate,
        },
        blockNumber
    );
});

// ============================================================================
// USDC oracle price snapshots
// ============================================================================

// The USDC reserve was added to the pool after the CorePool startBlock. Until the
// reserve is listed, the oracle has no price source for it, so we check the
// reserves list (at most once per RESERVES_REFRESH_INTERVAL blocks) before
// querying the oracle. Once listed, the flag stays true (reserves are never removed).
let usdcReserveListed = false;
let lastReservesRefreshBlock: bigint | null = null;
const RESERVES_REFRESH_INTERVAL = 3600n;

async function isUsdcReserveListed(context: any, blockNumber: bigint): Promise<boolean> {
    if (usdcReserveListed) return true;

    if (lastReservesRefreshBlock !== null && blockNumber - lastReservesRefreshBlock < RESERVES_REFRESH_INTERVAL) {
        return false;
    }

    const reserves: readonly `0x${string}`[] = await context.client.readContract({
        abi: CorePoolAbi,
        address: config.contracts.CorePool.address,
        functionName: "getReservesList",
        args: []
    });

    lastReservesRefreshBlock = blockNumber;
    usdcReserveListed = reserves.some((reserve) => isUSDC(reserve));

    if (usdcReserveListed) {
        console.log(`[ChainlinkOracleUpdate] USDC reserve is listed on the core pool as of block ${blockNumber}`);
    }

    return usdcReserveListed;
}

// Daily USDC oracle anchor, and DailyReserveIndex rows for
// midnights that passed without any USDC reserve activity
ponder.on("ChainlinkOracleUpdate:block", async ({event, context}) => {
    const blockNumber = event.block.number;
    const timestamp = Number(event.block.timestamp);

    try {
        await finalizeDailyAnchors(context.db, USDC_ADDRESS, timestamp);

        if (!(await isUsdcReserveListed(context, blockNumber))) {
            return;
        }

        await snapshotUSDCPrice(context, blockNumber, timestamp);
    } catch (error) {
        console.error(`[ChainlinkOracleUpdate] Error fetching USDC price at block ${blockNumber}:`, error);
    }
});
