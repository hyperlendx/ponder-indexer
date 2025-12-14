import { ponder } from "ponder:registry";
import { and, eq } from "ponder";
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
    UserEModeSet,
    MintedToTreasury,
    MintUnbacked,
    BackUnbacked,
    RebalanceStableBorrowRate,
    IsolationModeTotalDebtUpdated,
    BorrowAssetIsolated,
    RepayAssetIsolated,
    RepayAssetWithCollateralIsolated,
    AddCollateralIsolated,
    RemoveCollateralIsolated,
    LiquidateIsolated,
    DepositIsolated,
    WithdrawIsolated,
    UpdateRateIsolated,
    AddInterestIsolated,
    HTokenTransfer,
    StrategyDeployed,
    ReserveDataEvent,
    AssetPriceSnapshot,
    IsolatedPairRegistry,
    IsolatedPairPriceSnapshot,
} from "ponder:schema";

import { CorePoolAbi } from "../abis/CorePoolAbi";
import { OracleAbi } from "../abis/OracleAbi";
import { IsolatedPairRegistry as IsolatedPairRegistryAbi } from "../abis/IsolatedPairRegistry";
import { UiDataProviderIsolatedAbi } from "../abis/UiDataProviderIsolatedAbi";
import { ChainlinkAggregatorAbi } from "../abis/ChainlinkAggregatorAbi";
import { IsolatedAbi } from "../abis/IsolatedAbi";
import { ERC20Abi } from "../abis/ERC20Abi";
import { HTokenAbi } from "../abis/HTokenAbi";
import config from "../ponder.config";

import { getOraclePrice, getIsolatedOraclePrice, getIsolatedOraclePrices, getIsolatedPairAssetInfo } from "./helpers/getPrice";
import { updateUserPosition, updateUserPositionTransferBased } from "./helpers/userPositionManager";
import { calculateScaledBalance, calculateLiquidityIndexAtTimestamp } from "./helpers/aave";
import { updateUserIsolatedPairTracking } from "./helpers/userIsolatedPairTracker";
import {
    calculateExchangeRateFromVaultState,
    getVaultStateAtTimestamp,
    updateVaultStateAfterDeposit,
    updateVaultStateAfterWithdraw,
    updateVaultStateAfterAddInterest,
    updateVaultStateAfterLiquidation,
    updateVaultStateAfterBorrow,
    updateVaultStateAfterRepay,
} from "./helpers/yield/isolatedPair/vaultState";
import { getAddress } from 'viem'

const wrappedTokenGatewayAddress = getAddress("0x49558c794ea2aC8974C9F27886DDfAa951E99171");
const collateralSwapperAddress = getAddress("0x7469AA4124cc6ee078f98B581198eB39d2487E79");
const liquidSwapRepayAdapter = getAddress("0x6C674165E3AFaD857fab8CB0E91BCC057b813F03");

// Option B runs in parallel with Option A, writing to separate tables for comparison
// Option A (Primary): Uses proxy address attribution (UserPosition, UserBalanceEvent tables)
// Option B (Secondary): Uses hToken transfer tracking (UserPositionTransferBased, UserBalanceEventTransferBased tables)

// Cache for token decimals to avoid repeated contract calls
const tokenDecimalsCache: Map<string, number> = new Map();

// Cache for hToken to underlying asset mapping (Option B)
const hTokenToUnderlyingCache: Map<string, `0x${string}`> = new Map();

/**
 * Get the underlying asset address for an hToken with caching
 * @param context - Ponder context with client
 * @param hTokenAddress - hToken address
 * @returns Underlying asset address
 */
async function getUnderlyingAsset(context: any, hTokenAddress: `0x${string}`): Promise<`0x${string}`> {
    const normalizedAddress = hTokenAddress.toLowerCase();

    // Check cache first
    if (hTokenToUnderlyingCache.has(normalizedAddress)) {
        return hTokenToUnderlyingCache.get(normalizedAddress)!;
    }

    // Fetch from contract
    try {
        const underlyingAsset = await context.client.readContract({
            abi: HTokenAbi,
            address: hTokenAddress,
            functionName: "UNDERLYING_ASSET_ADDRESS",
            args: []
        });

        hTokenToUnderlyingCache.set(normalizedAddress, underlyingAsset as `0x${string}`);
        return underlyingAsset as `0x${string}`;
    } catch (error) {
        console.error(`[getUnderlyingAsset] Error fetching underlying asset for ${hTokenAddress}:`, error);
        throw error;
    }
}

/**
 * Get token decimals with caching
 * @param context - Ponder context with client
 * @param tokenAddress - Token address
 * @returns Token decimals
 */
async function getTokenDecimals(context: any, tokenAddress: `0x${string}`): Promise<number> {
    const normalizedAddress = tokenAddress.toLowerCase();

    // Check cache first
    if (tokenDecimalsCache.has(normalizedAddress)) {
        return tokenDecimalsCache.get(normalizedAddress)!;
    }

    // Fetch from contract
    try {
        const decimals = await context.client.readContract({
            abi: ERC20Abi,
            address: tokenAddress,
            functionName: "decimals",
            args: []
        });

        const decimalsNum = Number(decimals);
        tokenDecimalsCache.set(normalizedAddress, decimalsNum);
        return decimalsNum;
    } catch (error) {
        console.error(`[getTokenDecimals] Error fetching decimals for ${tokenAddress}:`, error);
        // Default to 18 decimals if we can't fetch
        return 18;
    }
}

// HToken Transfer Event Handler - Enhanced for Interest Tracking
ponder.on("HTokens:BalanceTransfer", async ({ event, context }) => {
    const hTokenAddress = event.log.address;
    const zeroAddress = "0x0000000000000000000000000000000000000000";

    // Get the underlying asset address for this hToken
    let underlyingAsset: `0x${string}`;
    try {
        underlyingAsset = await getUnderlyingAsset(context, hTokenAddress);
    } catch (error) {
        console.error(`[BalanceTransfer] Failed to get underlying asset for hToken ${hTokenAddress}, skipping position update`);
        // Still insert the transfer record even if we can't get the underlying asset
        await context.db.insert(HTokenTransfer).values({
            id: event.id,
            txHash: event.transaction.hash,
            reserve: hTokenAddress, // Use hToken address as fallback
            from: event.args.from,
            to: event.args.to,
            value: event.args.value,
            index: event.args.index
        });
        return;
    }

    // Insert historical transfer record with correct underlying asset
    await context.db.insert(HTokenTransfer).values({
        id: event.id,
        txHash: event.transaction.hash,
        reserve: underlyingAsset, // Use underlying asset, not hToken address
        from: event.args.from,
        to: event.args.to,
        value: event.args.value,
        index: event.args.index
    });

    // Option B (Secondary): Track hToken transfers as position changes
    // This writes to separate tables (UserPositionTransferBased, UserBalanceEventTransferBased)
    // for comparison testing with Option A
    //
    // Option B tracks ALL balance changes via BalanceTransfer events:
    // - Mints (from=0x0): User receives hTokens from supply
    // - Burns (to=0x0): User loses hTokens from withdraw
    // - Transfers: User sends/receives hTokens to/from another address
    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;

    const isFromZero = event.args.from.toLowerCase() === zeroAddress;
    const isToZero = event.args.to.toLowerCase() === zeroAddress;

    // The value in BalanceTransfer is already the scaled balance (not actual)
    const scaledBalance = event.args.value;

    // Get oracle price for the asset
    let reservePrice: bigint | null = null;
    try {
        reservePrice = await getOraclePrice(context, underlyingAsset);
    } catch (e: any) {
        console.error(`[BalanceTransfer] Error fetching reserve price: ${e.message}`);
    }

    if (isFromZero) {
        // Mint: User receives hTokens (supply)
        // Only update the receiver (to address)
        await updateUserPositionTransferBased(
            context,
            event.args.to,
            underlyingAsset,
            scaledBalance, // Positive for incoming
            'deposit', // Treat mint as deposit
            timestamp,
            event.transaction.hash,
            blockNumber,
            reservePrice ?? 0n
        );
    } else if (isToZero) {
        // Burn: User loses hTokens (withdraw)
        // Only update the sender (from address)
        await updateUserPositionTransferBased(
            context,
            event.args.from,
            underlyingAsset,
            -scaledBalance, // Negative for outgoing
            'withdraw', // Treat burn as withdraw
            timestamp,
            event.transaction.hash,
            blockNumber,
            reservePrice ?? 0n
        );
    } else {
        // Transfer between two non-zero addresses
        // Update both sender and receiver
        await updateUserPositionTransferBased(
            context,
            event.args.from,
            underlyingAsset,
            -scaledBalance, // Negative for outgoing transfer
            'transfer_out',
            timestamp,
            event.transaction.hash,
            blockNumber,
            reservePrice ?? 0n
        );

        await updateUserPositionTransferBased(
            context,
            event.args.to,
            underlyingAsset,
            scaledBalance, // Positive for incoming transfer
            'transfer_in',
            timestamp,
            event.transaction.hash,
            blockNumber,
            reservePrice ?? 0n
        );
    }
});

// Borrow Event Handler
ponder.on("CorePool:Borrow", async ({ event, context }) => {
    const { db, chain, client, contracts } = context;

    let reservePrice = null;
    try {
        reservePrice = await getOraclePrice(context, event.args.reserve);
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await db.insert(Borrow).values({
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
ponder.on("CorePool:Repay", async ({ event, context }) => {
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
ponder.on("CorePool:Supply", async ({ event, context }) => {
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
ponder.on("CorePool:Withdraw", async ({ event, context }) => {
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

// LiquidationCall Event Handler
ponder.on("CorePool:LiquidationCall", async ({ event, context }) => {
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
ponder.on("CorePool:FlashLoan", async ({ event, context }) => {
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
ponder.on("CorePool:ReserveDataUpdated", async ({ event, context }) => {
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

    // TODO: Update all user positions for this reserve with new liquidity index
    // Temporarily disabled due to database API compatibility issues
    // Individual position updates are handled in balance change events
    // await updatePositionsForReserveUpdate(
    //     context,
    //     event.args.reserve,
    //     event.args.liquidityIndex,
    //     timestamp
    // );

    console.log(`📊 Reserve data updated for ${event.args.reserve}:`, {
        liquidityIndex: event.args.liquidityIndex.toString(),
        liquidityRate: event.args.liquidityRate.toString(),
        timestamp: timestamp
    });
});

// ReserveUsedAsCollateralEnabled Event Handler
ponder.on("CorePool:ReserveUsedAsCollateralEnabled", async ({ event, context }) => {
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
ponder.on("CorePool:ReserveUsedAsCollateralDisabled", async ({ event, context }) => {
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
ponder.on("CorePool:SwapBorrowRateMode", async ({ event, context }) => {
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

// UserEModeSet Event Handler
ponder.on("CorePool:UserEModeSet", async ({ event, context }) => {
    await context.db.insert(UserEModeSet).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        user: event.args.user,
        categoryId: event.args.categoryId,
        timestamp: Number(event.block.timestamp),
    });
});

// MintedToTreasury Event Handler
ponder.on("CorePool:MintedToTreasury", async ({ event, context }) => {
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
ponder.on("CorePool:MintUnbacked", async ({ event, context }) => {
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
ponder.on("CorePool:BackUnbacked", async ({ event, context }) => {
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
ponder.on("CorePool:RebalanceStableBorrowRate", async ({ event, context }) => {
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
ponder.on("CorePool:IsolationModeTotalDebtUpdated", async ({ event, context }) => {
    await context.db.insert(IsolationModeTotalDebtUpdated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        asset: event.args.asset,
        totalDebt: event.args.totalDebt,
        timestamp: Number(event.block.timestamp),
    });
});

/// ISOLATED PAIRS

ponder.on("IsolatedPair:BorrowAsset", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Get asset and collateral addresses and their USD prices from Chainlink oracles
    const assetInfo = await getIsolatedPairAssetInfo(context, event, pair);

    const borrowAmount = event.args._borrowAmount;
    const sharesAdded = event.args._sharesAdded;

    // Update vault state with borrow (increases totalBorrow)
    const newVaultState = await updateVaultStateAfterBorrow(
        context.db,
        pair,
        borrowAmount,
        sharesAdded,
        Number(event.block.timestamp),
        Number(event.block.number),
        event.transaction.hash,
        event.id
    );

    // Calculate exchange rate from the returned vault state
    const exchangeRate = newVaultState
        ? calculateExchangeRateFromVaultState(newVaultState.totalAssetAmount, newVaultState.totalAssetShares)
        : 1000000000000000000n; // Default 1:1 if no state

    await context.db.insert(BorrowAssetIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        borrower: event.args._borrower,
        receiver: event.args._receiver,
        borrowAmount: borrowAmount,
        sharesAdded: sharesAdded,
        timestamp: Number(event.block.timestamp),
        assetAddress: assetInfo.assetAddress,
        collateralAddress: assetInfo.collateralAddress,
        assetPrice: assetInfo.assetPrice,
        collateralPrice: assetInfo.collateralPrice,
        exchangeRate: exchangeRate
    });

    // Update tracking table
    await updateUserIsolatedPairTracking(
        context,
        event.args._borrower,
        pair,
        Number(event.block.timestamp),
        'borrow'
    );
});

ponder.on("IsolatedPair:RepayAsset", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Get asset and collateral addresses and their USD prices from Chainlink oracles
    const assetInfo = await getIsolatedPairAssetInfo(context, event, pair);

    const amountToRepay = event.args.amountToRepay;
    const sharesRepaid = event.args.shares;

    // Update vault state with repay (decreases totalBorrow)
    const newVaultState = await updateVaultStateAfterRepay(
        context.db,
        pair,
        amountToRepay,
        sharesRepaid,
        Number(event.block.timestamp),
        Number(event.block.number),
        event.transaction.hash,
        event.id
    );

    // Calculate exchange rate from the returned vault state
    const exchangeRate = newVaultState
        ? calculateExchangeRateFromVaultState(newVaultState.totalAssetAmount, newVaultState.totalAssetShares)
        : 1000000000000000000n; // Default 1:1 if no state

    await context.db.insert(RepayAssetIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        borrower: event.args.borrower,
        payer: event.args.payer,
        amountToRepay: amountToRepay,
        shares: sharesRepaid,
        timestamp: Number(event.block.timestamp),
        assetAddress: assetInfo.assetAddress,
        collateralAddress: assetInfo.collateralAddress,
        assetPrice: assetInfo.assetPrice,
        collateralPrice: assetInfo.collateralPrice,
        exchangeRate: exchangeRate
    });

    // Update tracking table
    await updateUserIsolatedPairTracking(
        context,
        event.args.borrower,
        pair,
        Number(event.block.timestamp),
        'repay'
    );
});

ponder.on("IsolatedPair:RepayAssetWithCollateral", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Get asset and collateral addresses and their USD prices from Chainlink oracles
    const assetInfo = await getIsolatedPairAssetInfo(context, event, pair);

    const amountRepaid = event.args._amountAssetOut;
    const sharesRepaid = event.args._sharesRepaid;

    // Update vault state with repay (decreases totalBorrow)
    const newVaultState = await updateVaultStateAfterRepay(
        context.db,
        pair,
        amountRepaid,
        sharesRepaid,
        Number(event.block.timestamp),
        Number(event.block.number),
        event.transaction.hash,
        event.id
    );

    // Calculate exchange rate from the returned vault state
    const exchangeRate = newVaultState
        ? calculateExchangeRateFromVaultState(newVaultState.totalAssetAmount, newVaultState.totalAssetShares)
        : 1000000000000000000n; // Default 1:1 if no state

    await context.db.insert(RepayAssetWithCollateralIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        borrower: event.args._borrower,
        swapperAddress: event.args._swapperAddress,
        collateralToSwap: event.args._collateralToSwap,
        amountAssetOut: amountRepaid,
        sharesRepaid: sharesRepaid,
        timestamp: Number(event.block.timestamp),
        assetAddress: assetInfo.assetAddress,
        collateralAddress: assetInfo.collateralAddress,
        assetPrice: assetInfo.assetPrice,
        collateralPrice: assetInfo.collateralPrice,
        exchangeRate: exchangeRate
    });

    // Update tracking table - this event both repays debt AND removes collateral
    // Track as 'repayWithCollateral' to distinguish from regular repay
    await updateUserIsolatedPairTracking(
        context,
        event.args._borrower,
        pair,
        Number(event.block.timestamp),
        'repayWithCollateral'
    );
});

ponder.on("IsolatedPair:AddCollateral", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Get asset and collateral addresses and their USD prices from Chainlink oracles
    const assetInfo = await getIsolatedPairAssetInfo(context, event, pair);

    await context.db.insert(AddCollateralIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        borrower: event.args.borrower,
        sender: event.args.sender,
        collateralAmount: event.args.collateralAmount,
        timestamp: Number(event.block.timestamp),
        assetAddress: assetInfo.assetAddress,
        collateralAddress: assetInfo.collateralAddress,
        assetPrice: assetInfo.assetPrice,
        collateralPrice: assetInfo.collateralPrice,
    });

    // Update tracking table
    await updateUserIsolatedPairTracking(
        context,
        event.args.borrower,
        pair,
        Number(event.block.timestamp),
        'addCollateral'
    );
});

ponder.on("IsolatedPair:RemoveCollateral", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Get asset and collateral addresses and their USD prices from Chainlink oracles
    const assetInfo = await getIsolatedPairAssetInfo(context, event, pair);

    await context.db.insert(RemoveCollateralIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        receiver: event.args._receiver,
        sender: event.args._sender,
        borrower: event.args._borrower,
        collateralAmount: event.args._collateralAmount,
        timestamp: Number(event.block.timestamp),
        assetAddress: assetInfo.assetAddress,
        collateralAddress: assetInfo.collateralAddress,
        assetPrice: assetInfo.assetPrice,
        collateralPrice: assetInfo.collateralPrice,
    });

    // Update tracking table
    await updateUserIsolatedPairTracking(
        context,
        event.args._borrower,
        pair,
        Number(event.block.timestamp),
        'removeCollateral'
    );
});

ponder.on("IsolatedPair:Liquidate", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Get asset and collateral addresses and their USD prices from Chainlink oracles
    const assetInfo = await getIsolatedPairAssetInfo(context, event, pair);

    // Asset state adjustments
    const assetSharesToAdjust = event.args._sharesToAdjust;
    const assetAmountToAdjust = event.args._amountToAdjust;
    // Borrow state adjustments (liquidation repays debt)
    const borrowSharesRepaid = event.args._sharesToLiquidate;
    const borrowAmountRepaid = event.args._amountLiquidatorToRepay;

    // Update vault state and get the new state back
    const newVaultState = await updateVaultStateAfterLiquidation(
        context.db,
        pair,
        assetSharesToAdjust,
        assetAmountToAdjust,
        borrowAmountRepaid,
        borrowSharesRepaid,
        Number(event.block.timestamp),
        Number(event.block.number),
        event.transaction.hash,
        event.id
    );

    // Calculate exchange rate from the returned vault state
    const exchangeRate = newVaultState
        ? calculateExchangeRateFromVaultState(newVaultState.totalAssetAmount, newVaultState.totalAssetShares)
        : 1000000000000000000n; // Default 1:1 if no state

    await context.db.insert(LiquidateIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        borrower: event.args._borrower,
        liquidator: event.transaction.from,
        collateralForLiquidator: event.args._collateralForLiquidator,
        sharesToLiquidate: event.args._sharesToLiquidate,
        amountLiquidatorToRepay: event.args._amountLiquidatorToRepay,
        feesAmount: event.args._feesAmount,
        sharesToAdjust: event.args._sharesToAdjust,
        amountToAdjust: event.args._amountToAdjust,
        timestamp: Number(event.block.timestamp),
        assetAddress: assetInfo.assetAddress,
        collateralAddress: assetInfo.collateralAddress,
        assetPrice: assetInfo.assetPrice,
        collateralPrice: assetInfo.collateralPrice,
        exchangeRate: exchangeRate
    });

    // Update tracking table for both borrower and liquidator
    await updateUserIsolatedPairTracking(
        context,
        event.args._borrower,
        pair,
        Number(event.block.timestamp),
        'liquidate'
    );

    await updateUserIsolatedPairTracking(
        context,
        event.transaction.from,
        pair,
        Number(event.block.timestamp),
        'liquidate'
    );
});

ponder.on("IsolatedPair:Deposit", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Get asset and collateral addresses and their USD prices from Chainlink oracles
    const assetInfo = await getIsolatedPairAssetInfo(context, event, pair);

    const assets = event.args.assets;
    const shares = event.args.shares;

    // Update vault state and get the new state back
    const newVaultState = await updateVaultStateAfterDeposit(
        context.db,
        pair,
        assets,
        shares,
        Number(event.block.timestamp),
        Number(event.block.number),
        event.transaction.hash,
        event.id
    );

    // Calculate exchange rate from the returned vault state
    const exchangeRate = newVaultState
        ? calculateExchangeRateFromVaultState(newVaultState.totalAssetAmount, newVaultState.totalAssetShares)
        : 1000000000000000000n; // Default 1:1 if no state

    await context.db.insert(DepositIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        caller: event.args.caller,
        owner: event.args.owner,
        assets: event.args.assets,
        shares: event.args.shares,
        timestamp: Number(event.block.timestamp),
        assetAddress: assetInfo.assetAddress,
        collateralAddress: assetInfo.collateralAddress,
        assetPrice: assetInfo.assetPrice,
        collateralPrice: assetInfo.collateralPrice,
        exchangeRate: exchangeRate
    });

    // Update tracking table
    await updateUserIsolatedPairTracking(
        context,
        event.args.owner,
        pair,
        Number(event.block.timestamp),
        'deposit'
    );
});

ponder.on("IsolatedPair:Withdraw", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Get asset and collateral addresses and their USD prices from Chainlink oracles
    const assetInfo = await getIsolatedPairAssetInfo(context, event, pair);

    const assets = event.args.assets;
    const shares = event.args.shares;

    // Update vault state and get the new state back
    const newVaultState = await updateVaultStateAfterWithdraw(
        context.db,
        pair,
        assets,
        shares,
        Number(event.block.timestamp),
        Number(event.block.number),
        event.transaction.hash,
        event.id
    );

    // Calculate exchange rate from the returned vault state
    const exchangeRate = newVaultState
        ? calculateExchangeRateFromVaultState(newVaultState.totalAssetAmount, newVaultState.totalAssetShares)
        : 1000000000000000000n; // Default 1:1 if no state

    await context.db.insert(WithdrawIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        caller: event.args.caller,
        owner: event.args.owner,
        receiver: event.args.receiver,
        assets: event.args.assets,
        shares: event.args.shares,
        timestamp: Number(event.block.timestamp),
        assetAddress: assetInfo.assetAddress,
        collateralAddress: assetInfo.collateralAddress,
        assetPrice: assetInfo.assetPrice,
        collateralPrice: assetInfo.collateralPrice,
        exchangeRate: exchangeRate
    });

    // Update tracking table
    await updateUserIsolatedPairTracking(
        context,
        event.args.owner,
        pair,
        Number(event.block.timestamp),
        'withdraw'
    );
});

// Isolated Pair Rate Events - Enable accurate exchange rate calculations

ponder.on("IsolatedPair:UpdateRate", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }
    await context.db.insert(UpdateRateIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        oldRatePerSec: event.args.oldRatePerSec,
        oldFullUtilizationRate: event.args.oldFullUtilizationRate,
        newRatePerSec: event.args.newRatePerSec,
        newFullUtilizationRate: event.args.newFullUtilizationRate,
        timestamp: Number(event.block.timestamp),
    });
});

ponder.on("IsolatedPair:AddInterest", async ({ event, context }) => {
    const pair = event.transaction.to;
    if (!pair) {
        throw new Error("transaction.to is null");
    }

    // Update vault state (totalAsset.amount increases by interestEarned, totalAsset.shares increases by feesShare)
    const newVaultState = await updateVaultStateAfterAddInterest(
        context.db,
        pair,
        event.args.interestEarned,
        event.args.feesShare,
        Number(event.block.timestamp),
        Number(event.block.number),
        event.transaction.hash,
        event.id
    );

    await context.db.insert(AddInterestIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: pair,
        interestEarned: event.args.interestEarned,
        rate: event.args.rate,
        feesAmount: event.args.feesAmount,
        feesShare: event.args.feesShare,
        timestamp: Number(event.block.timestamp),
    });
});

// Note: UpdateExchangeRate event is for collateral/asset oracle prices, NOT vault exchange rate
// We don't need to index it for vault accounting

ponder.on("LoopingStrategyManagerFactory:StrategyDeployed", async ({ event, context }) => {
    await context.db.insert(StrategyDeployed).values({
        id: event.id,
        txHash: event.transaction.hash,
        owner: event.args.owner,
        stratManager: event.args.stratManager,
        pool: event.args.pool,
        yieldAsset: event.args.yieldAsset,
        debtAsset: event.args.debtAsset,
    });
});

// Cache for reserves list - refreshed every ~1 hour (3600 blocks at ~1 block/sec)
let cachedReservesList: readonly `0x${string}`[] | null = null;
let cachedIsolatedPairsList: readonly `0x${string}`[] | null = null;
let lastReservesRefreshBlock: bigint = 0n;
const RESERVES_REFRESH_INTERVAL = 3600n; // Refresh reserves list every 3600 blocks

// Handler for AddPair events - track new isolated pairs
ponder.on("IsolatedPairRegistryContract:AddPair", async ({ event, context }) => {
    const pairAddress = event.args.pairAddress;
    const blockNumber = event.block.number;
    const timestamp = Number(event.block.timestamp);

    try {
        // Get asset and collateral addresses from pair contract
        const assetAddress = await context.client.readContract({
            abi: IsolatedAbi,
            address: pairAddress,
            functionName: "asset",
            args: []
        });

        const collateralAddress = await context.client.readContract({
            abi: IsolatedAbi,
            address: pairAddress,
            functionName: "collateralContract",
            args: []
        });

        // Get decimals for asset and collateral tokens
        const assetDecimals = await context.client.readContract({
            abi: IsolatedAbi,
            address: assetAddress as `0x${string}`,
            functionName: "decimals",
            args: []
        });

        const collateralDecimals = await context.client.readContract({
            abi: IsolatedAbi,
            address: collateralAddress as `0x${string}`,
            functionName: "decimals",
            args: []
        });

        await context.db.insert(IsolatedPairRegistry).values({
            id: pairAddress,
            asset: assetAddress as `0x${string}`,
            collateral: collateralAddress as `0x${string}`,
            assetDecimals: Number(assetDecimals),
            collateralDecimals: Number(collateralDecimals),
            createdAtBlock: blockNumber,
            createdAtTimestamp: timestamp,
        });

        console.log(`[IsolatedPairRegistry] New pair added: ${pairAddress} (asset: ${assetAddress}, collateral: ${collateralAddress}) at block ${blockNumber}`);
    } catch (error) {
        console.error(`[IsolatedPairRegistry] Error fetching pair data for ${pairAddress}:`, error);
        // Still insert the pair with minimal data
        await context.db.insert(IsolatedPairRegistry).values({
            id: pairAddress,
            asset: "0x0000000000000000000000000000000000000000" as `0x${string}`,
            collateral: "0x0000000000000000000000000000000000000000" as `0x${string}`,
            assetDecimals: 0,
            collateralDecimals: 0,
            createdAtBlock: blockNumber,
            createdAtTimestamp: timestamp,
        });
    }

    // Invalidate cache so it gets refreshed on next block interval
    cachedIsolatedPairsList = null;
});

// Oracle Price Updates for Core Pool Assets every 300 blocks
ponder.on("ChainlinkOracleUpdate:block", async ({ event, context }) => {
    const blockNumber = event.block.number;
    const timestamp = Number(event.block.timestamp);

    try {
        // Refresh reserves list if cache is empty or stale
        if (!cachedReservesList || blockNumber - lastReservesRefreshBlock >= RESERVES_REFRESH_INTERVAL) {
            const corePoolAddress = config.contracts.CorePool.address;
            const poolAddress = Array.isArray(corePoolAddress) ? corePoolAddress[0] : corePoolAddress;

            cachedReservesList = await context.client.readContract({
                abi: CorePoolAbi,
                address: poolAddress as `0x${string}`,
                functionName: "getReservesList",
                args: []
            });

            lastReservesRefreshBlock = blockNumber;
            console.log(`[ChainlinkOracleUpdate] Refreshed reserves list: ${cachedReservesList?.length} reserves`);
        }

        // === Core Pool Assets ===
        if (cachedReservesList && cachedReservesList.length > 0) {
            const oracleAddress = config.contracts.Oracle.address as `0x${string}`;
            const prices = await context.client.readContract({
                abi: OracleAbi,
                address: oracleAddress,
                functionName: "getAssetsPrices",
                args: [cachedReservesList]
            });

            for (let i = 0; i < cachedReservesList.length; i++) {
                const asset = cachedReservesList[i];
                const price = prices[i];

                if (asset && price && price > 0n) {
                    const decimals = await getTokenDecimals(context, asset);
                    await context.db.insert(AssetPriceSnapshot).values({
                        id: `${asset}-${blockNumber}`,
                        asset: asset,
                        price: price,
                        decimals: decimals,
                        blockNumber: blockNumber,
                        timestamp: timestamp,
                    });
                }
            }
        }

        console.log(`[ChainlinkOracleUpdate] Saved ${cachedReservesList?.length || 0} reserve price snapshots at block ${blockNumber}`);

    } catch (error) {
        console.error(`[ChainlinkOracleUpdate] Error fetching prices at block ${blockNumber}:`, error);
    }
});

// Separate cache for isolated pairs refresh
let lastIsolatedPairsRefreshBlock: bigint = 0n;

// Cache for pair metadata (asset, collateral, oracle addresses) - these don't change
interface PairMetadata {
    asset: `0x${string}`;
    collateral: `0x${string}`;
    chainlinkAssetOracle: `0x${string}`;
    chainlinkCollateralOracle: `0x${string}`;
    assetDecimals: number;
    collateralDecimals: number;
}
const pairMetadataCache: Map<string, PairMetadata> = new Map();

// Oracle Price Updates for Isolated Pairs every 300 blocks
// Also snapshots USD prices for asset and collateral tokens from Chainlink oracles
ponder.on("ChainlinkOracleIsolatedUpdate:block", async ({ event, context }) => {
    const blockNumber = event.block.number;
    const timestamp = Number(event.block.timestamp);
    const uiDataProviderAddress = config.contracts.UiDataProviderIsolated.address as `0x${string}`;

    // Track which assets we've already snapshotted to avoid duplicates
    const snapshotedAssets = new Set<string>();

    try {
        // Refresh isolated pairs list if cache is empty or stale
        if (!cachedIsolatedPairsList || blockNumber - lastIsolatedPairsRefreshBlock >= RESERVES_REFRESH_INTERVAL) {
            const registryAddress = config.contracts.IsolatedPairRegistryContract.address as `0x${string}`;
            cachedIsolatedPairsList = await context.client.readContract({
                abi: IsolatedPairRegistryAbi,
                address: registryAddress,
                functionName: "getAllPairAddresses",
                args: []
            });

            lastIsolatedPairsRefreshBlock = blockNumber;
            console.log(`[ChainlinkOracleIsolatedUpdate] Refreshed isolated pairs list: ${cachedIsolatedPairsList?.length} pairs`);
        }

        // === Isolated Pairs ===
        if (cachedIsolatedPairsList && cachedIsolatedPairsList.length > 0) {
            // Fetch all pair prices in parallel
            const pricePromises = cachedIsolatedPairsList.map(pair => getIsolatedOraclePrices(context, pair));
            const allPrices = await Promise.all(pricePromises);

            // Fetch metadata for pairs not in cache (in parallel)
            const uncachedPairs = cachedIsolatedPairsList.filter(pair => !pairMetadataCache.has(pair));
            if (uncachedPairs.length > 0) {
                const metadataPromises = uncachedPairs.map(async (pair) => {
                    try {
                        const pairData = await context.client.readContract({
                            abi: UiDataProviderIsolatedAbi,
                            address: uiDataProviderAddress,
                            functionName: "getPairData",
                            args: [pair]
                        });
                        if (pairData) {
                            const assetAddress = pairData.asset as `0x${string}`;
                            const collateralAddress = pairData.collateral as `0x${string}`;
                            // Fetch decimals in parallel
                            const [assetDecimals, collateralDecimals] = await Promise.all([
                                getTokenDecimals(context, assetAddress),
                                getTokenDecimals(context, collateralAddress)
                            ]);
                            return {
                                pair,
                                metadata: {
                                    asset: assetAddress,
                                    collateral: collateralAddress,
                                    chainlinkAssetOracle: pairData.exchangeRate.chainlinkAssetAddress as `0x${string}`,
                                    chainlinkCollateralOracle: pairData.exchangeRate.chainlinkCollateralAddress as `0x${string}`,
                                    assetDecimals,
                                    collateralDecimals
                                }
                            };
                        }
                        return null;
                    } catch (e) {
                        console.error(`[ChainlinkOracleIsolatedUpdate] Error fetching pair data for ${pair}:`, e);
                        return null;
                    }
                });
                const metadataResults = await Promise.all(metadataPromises);
                for (const result of metadataResults) {
                    if (result) {
                        pairMetadataCache.set(result.pair, result.metadata);
                    }
                }
            }

            // Collect unique Chainlink oracles to query
            const oraclesToQuery: Map<string, { oracle: `0x${string}`; asset: `0x${string}`; decimals: number }> = new Map();
            for (const pair of cachedIsolatedPairsList) {
                const metadata = pairMetadataCache.get(pair);
                if (metadata) {
                    const zeroAddr = "0x0000000000000000000000000000000000000000";
                    if (metadata.chainlinkAssetOracle && metadata.chainlinkAssetOracle !== zeroAddr && !snapshotedAssets.has(metadata.asset)) {
                        oraclesToQuery.set(metadata.asset, {
                            oracle: metadata.chainlinkAssetOracle,
                            asset: metadata.asset,
                            decimals: metadata.assetDecimals
                        });
                        snapshotedAssets.add(metadata.asset);
                    }
                    if (metadata.chainlinkCollateralOracle && metadata.chainlinkCollateralOracle !== zeroAddr && !snapshotedAssets.has(metadata.collateral)) {
                        oraclesToQuery.set(metadata.collateral, {
                            oracle: metadata.chainlinkCollateralOracle,
                            asset: metadata.collateral,
                            decimals: metadata.collateralDecimals
                        });
                        snapshotedAssets.add(metadata.collateral);
                    }
                }
            }

            // Fetch all Chainlink prices in parallel
            const oracleEntries = Array.from(oraclesToQuery.entries());
            const chainlinkPricePromises = oracleEntries.map(async ([_, info]) => {
                try {
                    const priceData = await context.client.readContract({
                        abi: ChainlinkAggregatorAbi,
                        address: info.oracle,
                        functionName: "latestRoundData",
                        args: []
                    });
                    return { asset: info.asset, price: priceData?.[1] ?? 0n, decimals: info.decimals };
                } catch (e) {
                    console.error(`[ChainlinkOracleIsolatedUpdate] Error fetching Chainlink price for ${info.asset}:`, e);
                    return { asset: info.asset, price: 0n, decimals: info.decimals };
                }
            });
            const chainlinkPrices = await Promise.all(chainlinkPricePromises);

            // Insert all snapshots
            for (let i = 0; i < cachedIsolatedPairsList.length; i++) {
                const pair = cachedIsolatedPairsList[i];
                const prices = allPrices[i];
                if (prices && prices.priceLow > 0n && prices.priceHigh > 0n) {
                    await context.db.insert(IsolatedPairPriceSnapshot).values({
                        id: `${pair}-${blockNumber}`,
                        pair: pair,
                        priceLow: prices.priceLow,
                        priceHigh: prices.priceHigh,
                        blockNumber: blockNumber,
                        timestamp: timestamp,
                    });
                }
            }

            for (const { asset, price, decimals } of chainlinkPrices) {
                if (price > 0n) {
                    await context.db.insert(AssetPriceSnapshot).values({
                        id: `${asset}-${blockNumber}`,
                        asset: asset,
                        price: price,
                        decimals: decimals,
                        blockNumber: blockNumber,
                        timestamp: timestamp,
                    });
                }
            }
        }

        console.log(`[ChainlinkOracleIsolatedUpdate] Saved ${cachedIsolatedPairsList?.length || 0} isolated pair price snapshots and ${snapshotedAssets.size} asset USD price snapshots at block ${blockNumber}`);

    } catch (error) {
        console.error(`[ChainlinkOracleIsolatedUpdate] Error fetching prices at block ${blockNumber}:`, error);
    }
})
