import { ponder } from "ponder:registry";
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
    AddCollateralIsolated,
    RemoveCollateralIsolated,
    LiquidateIsolated,
    DepositIsolated,
    WithdrawIsolated,
    // UserCore,
    // UserReserveCore,
    HTokenTransfer,
    StrategyDeployed,
    User,
    UserDeposit,
    // New interest tracking tables
    ReserveDataEvent,
    UserBalanceEvent,
    UserPosition,
    UserMonthlyInterest
} from "ponder:schema";

import { getOraclePrice, getIsolatedOraclePrice } from "./helpers/getPrice";
import { updateUserDepositBalance } from "./helpers/userBalanceManager";
import { updateUserPosition, updatePositionsForReserveUpdate } from "./helpers/userPositionManager";
import { calculateScaledBalance, calculateLiquidityIndexAtTimestamp } from "./helpers/interestCalculations";

// HToken Transfer Event Handler - Enhanced for Interest Tracking
ponder.on("HTokens:BalanceTransfer", async ({ event, context }) => {
    // Insert historical transfer record
    await context.db.insert(HTokenTransfer).values({
        id: event.id,
        txHash: event.transaction.hash,
        reserve: event.log.address,
        from: event.args.from,
        to: event.args.to,
        value: event.args.value,
        index: event.args.index
    });
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

    // // Update User table
    // const existingUser = await db.find(UserCore, { id: event.args.onBehalfOf });
    // if (existingUser) {
    //     await db
    //         .update(UserCore, { id: event.args.onBehalfOf })
    //         .set({ totalBorrows: existingUser.totalBorrows || 0n + BigInt(event.args.amount) });
    // } else {
    //     await db.insert(UserCore).values({
    //         id: event.args.onBehalfOf,
    //         totalDeposits: 0n,
    //         totalBorrows: BigInt(event.args.amount),
    //         totalRepayments: 0n,
    //         totalWithdrawals: 0n,
    //         liquidationCount: 0,
    //     });
    // }

    // // Update UserReserve table
    // const userReserveId = `${event.args.onBehalfOf}_${event.args.reserve}`;
    // const existingUserReserve = await db.find(UserReserveCore, { "id": userReserveId });
    // if (existingUserReserve) {
    //     await db
    //         .update(UserReserveCore, { "id": userReserveId })
    //         .set({ 
    //             currentDebt: existingUserReserve.currentDebt || 0n + BigInt(event.args.amount),
    //             totalBorrows: existingUserReserve.totalBorrows || 0n + BigInt(event.args.amount),
    //         })
    // } else {
    //     await db.insert(UserReserveCore).values({
    //         id: userReserveId,
    //         user: event.args.onBehalfOf,
    //         reserve: event.args.reserve,
    //         currentATokenBalance: 0n,
    //         currentDebt: BigInt(event.args.amount),
    //         totalDeposits: 0n,
    //         totalBorrows: BigInt(event.args.amount),
    //         totalRepayments: 0n,
    //         totalWithdrawals: 0n,
    //     });
    // }
});

// Repay Event Handler
ponder.on("CorePool:Repay", async ({ event, context }) => {
    const reservePrice = await getOraclePrice(context, event.args.reserve);

    await context.db.insert(Repay).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        repayer: event.args.repayer,
        amount: event.args.amount,
        useATokens: event.args.useATokens,
        timestamp: Number(event.block.timestamp),
        price: reservePrice,
    });
});

// Supply Event Handler - Enhanced for Interest Tracking
ponder.on("CorePool:Supply", async ({ event, context }) => {
    console.log("🔥 Supply event detected!", {
        txHash: event.transaction.hash,
        reserve: event.args.reserve,
        amount: event.args.amount.toString(),
        user: event.args.user,
        onBehalfOf: event.args.onBehalfOf
    });

    console.log('blockNumber', event.block.number);
    if(event.block.number >= 13403427) {
        console.log('____________________________________________________________________________');
        console.log('event', event);

        console.log('blockNumber', event.block.number);
    }
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

    // Update user deposit balance (legacy system)
    await updateUserDepositBalance(
        context,
        event.args.onBehalfOf,
        event.args.reserve,
        event.args.amount, // Positive amount for deposits
        timestamp
    );

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
    console.log("event.args.onBehalfOf", event.args.onBehalfOf);
    if (event.args.onBehalfOf.toLowerCase() === '0x4d48bec025de3ad0f06ab8b8562c685c373f83bb'.toLowerCase()) {
        console.log("Scaled balance for 0x4d48bec025de3ad0f06ab8b8562c685c373f83bb:", scaledBalance.toString());
    }
    // Update user position with scaled balance tracking
    await updateUserPosition(
        context,
        event.args.onBehalfOf,
        event.args.reserve,
        scaledBalance,
        'deposit',
        timestamp,
        event.transaction.hash,
        blockNumber
    );
});

// Withdraw Event Handler - Enhanced for Interest Tracking
ponder.on("CorePool:Withdraw", async ({ event, context }) => {
    console.log("💸 Withdraw event detected!", {
        txHash: event.transaction.hash,
        reserve: event.args.reserve,
        amount: event.args.amount.toString(),
        user: event.args.user, // This might be WrappedTokenGateway
        to: event.args.to, // This might also be WrappedTokenGateway
        transactionFrom: event.transaction.from, // This is the actual user who initiated the transaction
        logAddress: event.log.address
    });

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    const timestamp = Number(event.block.timestamp);
    const blockNumber = event.block.number;

    // Insert the historical Withdraw transaction record
    await context.db.insert(Withdraw).values({
        id: event.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user, // Keep as-is for historical accuracy (pool contract)
        to: event.args.to, // The actual user receiving tokens
        amount: event.args.amount,
        timestamp: timestamp,
        price: reservePrice,
    });

    // Update user deposit balance (legacy system)
    // For WrappedTokenGateway withdrawals, the actual user is transaction.from
    const actualUser = event.transaction.from;

    console.log(`🔄 Updating balance for withdrawal:`, {
        eventUser: event.args.user,
        eventTo: event.args.to,
        actualUser: actualUser, // Use transaction.from as the real user
        token: event.args.reserve,
        withdrawAmount: event.args.amount.toString(),
        negativeAmount: (-event.args.amount).toString()
    });

    await updateUserDepositBalance(
        context,
        actualUser, // Use transaction.from - the actual user who initiated the withdrawal
        event.args.reserve,
        -event.args.amount, // Negative amount for withdrawals
        timestamp
    );

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
        actualUser, // Use transaction.from - the actual user who initiated the withdrawal
        event.args.reserve,
        -scaledBalance, // Negative for withdrawals
        'withdraw',
        timestamp,
        event.transaction.hash,
        blockNumber
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

    // Insert ReserveDataEvent for interest calculations
    await context.db.insert(ReserveDataEvent).values({
        id: `${event.transaction.hash}_${event.log.logIndex}_${event.args.reserve}`,
        txHash: event.transaction.hash,
        reserve: event.args.reserve,
        liquidityIndex: event.args.liquidityIndex,
        liquidityRate: event.args.liquidityRate,
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
    let price = null;

    try {
        //note: event.transaction.to can never be null
        price = await getIsolatedOraclePrice(context, event.transaction.to || "0xNEW");
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(BorrowAssetIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: event.transaction.to || "0xNEW",
        borrower: event.args._borrower,
        receiver: event.args._receiver,
        borrowAmount: event.args._borrowAmount,
        sharesAdded: event.args._sharesAdded,
        timestamp: Number(event.block.timestamp),
        price: price
    });
});

ponder.on("IsolatedPair:RepayAsset", async ({ event, context }) => {
    let price = null;

    try {
        price = await getIsolatedOraclePrice(context, event.transaction.to || "0xNEW");
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(RepayAssetIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: event.transaction.to || "0xNEW",
        borrower: event.args.borrower,
        payer: event.args.payer,
        amountToRepay: event.args.amountToRepay,
        shares: event.args.shares,
        timestamp: Number(event.block.timestamp),
        price: price,
    });
});

ponder.on("IsolatedPair:AddCollateral", async ({ event, context }) => {
    let price = null;

    try {
        price = await getIsolatedOraclePrice(context, event.transaction.to || "0xNEW");
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(AddCollateralIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: event.transaction.to || "0xNEW",
        borrower: event.args.borrower,
        sender: event.args.sender,
        collateralAmount: event.args.collateralAmount,
        timestamp: Number(event.block.timestamp),
        price: price,
    });
});

ponder.on("IsolatedPair:RemoveCollateral", async ({ event, context }) => {
    let price = null;

    try {
        price = await getIsolatedOraclePrice(context, event.transaction.to || "0xNEW");
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(RemoveCollateralIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: event.transaction.to || "0xNEW",
        receiver: event.args._receiver,
        sender: event.args._sender,
        borrower: event.args._borrower,
        collateralAmount: event.args._collateralAmount,
        timestamp: Number(event.block.timestamp),
        price: price,
    });
});

ponder.on("IsolatedPair:Liquidate", async ({ event, context }) => {
    let price = null;

    try {
        price = await getIsolatedOraclePrice(context, event.transaction.to || "0xNEW");
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(LiquidateIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: event.transaction.to || "0xNEW",
        borrower: event.args._borrower,
        liquidator: event.transaction.from,
        collateralForLiquidator: event.args._collateralForLiquidator,
        sharesToLiquidate: event.args._sharesToLiquidate,
        amountLiquidatorToRepay: event.args._amountLiquidatorToRepay,
        feesAmount: event.args._feesAmount,
        sharesToAdjust: event.args._sharesToAdjust,
        amountToAdjust: event.args._amountToAdjust,
        timestamp: Number(event.block.timestamp),
        price: price,
    });
});

ponder.on("IsolatedPair:Deposit", async ({ event, context }) => {
    let price = null;

    try {
        price = await getIsolatedOraclePrice(context, event.transaction.to || "0xNEW");
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(DepositIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: event.transaction.to || "0xNEW",
        caller: event.args.caller,
        owner: event.args.owner,
        assets: event.args.assets,
        shares: event.args.shares,
        timestamp: Number(event.block.timestamp),
        price: price,
    });
});

ponder.on("IsolatedPair:Withdraw", async ({ event, context }) => {
    let price = null;

    try {
        price = await getIsolatedOraclePrice(context, event.transaction.to || "0xNEW");
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(WithdrawIsolated).values({
        id: event.id,
        txHash: event.transaction.hash,
        pair: event.transaction.to || "0xNEW",
        caller: event.args.caller,
        owner: event.args.owner,
        receiver: event.args.receiver,
        assets: event.args.assets,
        shares: event.args.shares,
        timestamp: Number(event.block.timestamp),
        price: price,
    });
});

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
