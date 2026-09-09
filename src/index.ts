import {ponder} from "ponder:registry";
import {
    Borrow,
    Repay,
    Supply,
    Withdraw,
    LiquidationCall,
    FlashLoan,
    ReserveDataUpdated,
    ReserveUsedAsCollateralEnabled,
    ReserveUsedAsCollateralDisabled,
    SwapBorrowRateMode,
    MintedToTreasury,
    MintUnbacked,
    BackUnbacked,
    RebalanceStableBorrowRate,
    IsolationModeTotalDebtUpdated,
    HTokenTransfer,
    ReserveDataEvent,
    AssetPriceSnapshot,
} from "ponder:schema";

import {CorePoolAbi} from "../abis/CorePoolAbi";
import config from "../ponder.config";

import {getOraclePrice} from "./helpers/getPrice";
import {updateUserPosition} from "./helpers/userPositionManager";
import {calculateScaledBalance, calculateLiquidityIndexAtTimestamp} from "./helpers/aave";
import {USDC_ADDRESS, USDC_DECIMALS, isUSDC} from "./helpers/usdc";
import {getAddress} from 'viem'

const wrappedTokenGatewayAddress = getAddress("0x49558c794ea2aC8974C9F27886DDfAa951E99171");
const collateralSwapperAddress = getAddress("0x7469AA4124cc6ee078f98B581198eB39d2487E79");
const liquidSwapRepayAdapter = getAddress("0x6C674165E3AFaD857fab8CB0E91BCC057b813F03");

// ============================================================================
// This indexer tracks ONLY the USDC reserve of the HyperLend core pool.
// ponder.config.ts restricts which CorePool logs are fetched (event filters on
// the indexed reserve/asset args); every handler below re-checks the reserve so
// the USDC-only invariant is explicit and survives config changes.
// ============================================================================

// USDC hToken BalanceTransfer Event Handler
// The contract address is pinned to the USDC hToken, so the underlying reserve is always USDC.
ponder.on("USDCHToken:BalanceTransfer", async ({event, context}) => {
    await context.db.insert(HTokenTransfer).values({
        id: event.id,
        txHash: event.transaction.hash,
        reserve: USDC_ADDRESS,
        from: event.args.from,
        to: event.args.to,
        value: event.args.value,
        index: event.args.index
    });
});

// Borrow Event Handler
ponder.on("CorePool:Borrow", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    let reservePrice = null;
    try {
        reservePrice = await getOraclePrice(context, event.args.reserve);
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(Borrow).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        onBehalfOf: event.args.onBehalfOf,
        amount: event.args.amount,
        interestRateMode: event.args.interestRateMode,
        borrowRate: event.args.borrowRate,
        referralCode: event.args.referralCode,
        timestamp: Number(event.block.timestamp),
        price: reservePrice,
    });
});

// Repay Event Handler
ponder.on("CorePool:Repay", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;

    await context.db.insert(Repay).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        repayer: event.args.repayer,
        amount: event.args.amount,
        useATokens: event.args.useATokens,
        timestamp: timestamp,
        price: reservePrice,
    });

    // When useATokens=true, the user is using their aTokens (supplied balance) to repay debt
    // This means we need to reduce their supply position by the repay amount
    if (event.args.useATokens) {
        // Get current liquidity index to calculate scaled balance
        const currentLiquidityIndex = await calculateLiquidityIndexAtTimestamp(
            context,
            event.args.reserve,
            timestamp,
            event.transaction.hash
        );

        // Calculate scaled balance from repay amount
        const scaledBalance = calculateScaledBalance(event.args.amount, currentLiquidityIndex);

        // Update user position with negative scaled balance (like a withdraw)
        await updateUserPosition(
            context,
            event.args.user,
            event.args.reserve,
            -scaledBalance, // Negative for reducing supply
            'withdraw', // Treat as withdraw since aTokens are being burned
            timestamp,
            event.transaction.hash,
            blockNumber,
            reservePrice
        );
    }
});

// Supply Event Handler - Enhanced for Interest Tracking
ponder.on("CorePool:Supply", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
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
        price: reservePrice,
    });

    // Get current liquidity index to calculate scaled balance
    // Pass the transaction hash to check for ReserveDataUpdated events in the same transaction
    const currentLiquidityIndex = await calculateLiquidityIndexAtTimestamp(
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
        reservePrice // Pass the oracle price
    );
});

// Withdraw Event Handler
ponder.on("CorePool:Withdraw", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;

    // Determine the actual user:
    // - For WrappedTokenGateway withdrawals: event.args.user is the gateway, actual user is transaction.from
    // - For CollateralSwapper withdrawals: event.args.user is the swapper, actual user is transaction.from
    // - For LeverageHelper withdrawals: event.args.user is the helper, actual user is transaction.from
    const isGatewayWithdrawal = getAddress(event.args.user) === wrappedTokenGatewayAddress;
    const isCollateralSwapWithdrawal = getAddress(event.args.user) === collateralSwapperAddress;
    const isLiquidSwapRepayAdapterWithdrawal = getAddress(event.args.user) === liquidSwapRepayAdapter;
    const actualUser = (isGatewayWithdrawal || isCollateralSwapWithdrawal || isLiquidSwapRepayAdapterWithdrawal) ? event.transaction.from : event.args.user;

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
        price: reservePrice,
    });

    // Get current liquidity index to calculate scaled balance
    // Pass the transaction hash to check for ReserveDataUpdated events in the same transaction
    const currentLiquidityIndex = await calculateLiquidityIndexAtTimestamp(
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
        reservePrice // Pass the oracle price
    );
});

// LiquidationCall Event Handler - kept when USDC is the collateral OR the debt asset
ponder.on("CorePool:LiquidationCall", async ({event, context}) => {
    if (!isUSDC(event.args.collateralAsset) && !isUSDC(event.args.debtAsset)) return;

    const reservePriceCollateral = await getOraclePrice(context, event.args.collateralAsset);
    const reservePriceDebt = await getOraclePrice(context, event.args.debtAsset);

    await context.db.insert(LiquidationCall).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        collateralAsset: event.args.collateralAsset,
        debtAsset: event.args.debtAsset,
        user: event.args.user,
        debtToCover: event.args.debtToCover,
        liquidatedCollateralAmount: event.args.liquidatedCollateralAmount,
        liquidator: event.args.liquidator,
        receiveAToken: event.args.receiveAToken,
        timestamp: Number(event.block.timestamp),
        priceCollateral: reservePriceCollateral,
        priceDebt: reservePriceDebt,
    });
});

// FlashLoan Event Handler
ponder.on("CorePool:FlashLoan", async ({event, context}) => {
    if (!isUSDC(event.args.asset)) return;

    const reservePrice = await getOraclePrice(context, event.args.asset);

    await context.db.insert(FlashLoan).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        target: event.args.target,
        initiator: event.args.initiator,
        asset: event.args.asset,
        amount: event.args.amount,
        interestRateMode: event.args.interestRateMode,
        premium: event.args.premium,
        referralCode: event.args.referralCode,
        timestamp: Number(event.block.timestamp),
        price: reservePrice,
    });
});

// ReserveDataUpdated Event Handler - Enhanced for Interest Tracking
ponder.on("CorePool:ReserveDataUpdated", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;

    // Insert historical ReserveDataUpdated record
    await context.db.insert(ReserveDataUpdated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        liquidityRate: event.args.liquidityRate,
        stableBorrowRate: event.args.stableBorrowRate,
        variableBorrowRate: event.args.variableBorrowRate,
        liquidityIndex: event.args.liquidityIndex,
        variableBorrowIndex: event.args.variableBorrowIndex,
        timestamp: timestamp,
        price: reservePrice,
    });

    // Insert ReserveDataEvent for interest calculations (both supply and borrow)
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
    });

    console.log(`📊 Reserve data updated for ${event.args.reserve}:`, {
        liquidityIndex: event.args.liquidityIndex.toString(),
        liquidityRate: event.args.liquidityRate.toString(),
        timestamp: timestamp
    });
});

// ReserveUsedAsCollateralEnabled Event Handler
ponder.on("CorePool:ReserveUsedAsCollateralEnabled", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    await context.db.insert(ReserveUsedAsCollateralEnabled).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        timestamp: Number(event.block.timestamp),
    });
});

// ReserveUsedAsCollateralDisabled Event Handler
ponder.on("CorePool:ReserveUsedAsCollateralDisabled", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    await context.db.insert(ReserveUsedAsCollateralDisabled).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        timestamp: Number(event.block.timestamp),
    });
});

// SwapBorrowRateMode Event Handler
ponder.on("CorePool:SwapBorrowRateMode", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    await context.db.insert(SwapBorrowRateMode).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        interestRateMode: event.args.interestRateMode,
        timestamp: Number(event.block.timestamp),
    });
});

// MintedToTreasury Event Handler
ponder.on("CorePool:MintedToTreasury", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const reservePrice = await getOraclePrice(context, event.args.reserve);

    await context.db.insert(MintedToTreasury).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        amountMinted: event.args.amountMinted,
        timestamp: Number(event.block.timestamp),
        price: reservePrice,
    });
});

// MintUnbacked Event Handler
ponder.on("CorePool:MintUnbacked", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const reservePrice = await getOraclePrice(context, event.args.reserve);

    await context.db.insert(MintUnbacked).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        onBehalfOf: event.args.onBehalfOf,
        amount: event.args.amount,
        referralCode: event.args.referralCode,
        timestamp: Number(event.block.timestamp),
        price: reservePrice,
    });
});

// BackUnbacked Event Handler
ponder.on("CorePool:BackUnbacked", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    const reservePrice = await getOraclePrice(context, event.args.reserve);

    await context.db.insert(BackUnbacked).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        backer: event.args.backer,
        amount: event.args.amount,
        fee: event.args.fee,
        timestamp: Number(event.block.timestamp),
        price: reservePrice,
    });
});

// RebalanceStableBorrowRate Event Handler
ponder.on("CorePool:RebalanceStableBorrowRate", async ({event, context}) => {
    if (!isUSDC(event.args.reserve)) return;

    await context.db.insert(RebalanceStableBorrowRate).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        timestamp: Number(event.block.timestamp),
    });
});

// IsolationModeTotalDebtUpdated Event Handler
ponder.on("CorePool:IsolationModeTotalDebtUpdated", async ({event, context}) => {
    if (!isUSDC(event.args.asset)) return;

    await context.db.insert(IsolationModeTotalDebtUpdated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        asset: event.args.asset,
        totalDebt: event.args.totalDebt,
        timestamp: Number(event.block.timestamp),
    });
});

// ============================================================================
// USDC oracle price snapshots
// ============================================================================

// The USDC reserve was added to the pool after the CorePool startBlock. Until the
// reserve is listed, the oracle has no price source for it, so we check the
// reserves list (refreshed every ~1 hour = 3600 blocks at ~1 block/sec) before
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

// USDC oracle price snapshot every 300 blocks
ponder.on("ChainlinkOracleUpdate:block", async ({event, context}) => {
    const blockNumber = event.block.number;
    const timestamp = Number(event.block.timestamp);

    try {
        if (!(await isUsdcReserveListed(context, blockNumber))) {
            return;
        }

        const price = await getOraclePrice(context, USDC_ADDRESS);

        if (price && price > 0n) {
            await context.db.insert(AssetPriceSnapshot).values({
                id: `${USDC_ADDRESS}-${blockNumber}`,
                asset: USDC_ADDRESS,
                price: price,
                decimals: USDC_DECIMALS,
                blockNumber: blockNumber,
                timestamp: timestamp,
            });
        }
    } catch (error) {
        console.error(`[ChainlinkOracleUpdate] Error fetching USDC price at block ${blockNumber}:`, error);
    }
});
