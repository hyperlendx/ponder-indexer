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
    HTokenTransfer
} from "ponder:schema";

import { getOraclePrice, getIsolatedOraclePrice } from "./helpers/getPrice";

// HToken Transfer Event Handler
ponder.on("HTokens:BalanceTransfer", async ({ event, context }) => {
    await context.db.insert(HTokenTransfer).values({
        id: event.log.id,
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
    const { db, network, client, contracts } = context;

    let reservePrice = null;
    try {
        reservePrice = await getOraclePrice(context, event.args.reserve);
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await db.insert(Borrow).values({
        id: event.log.id,
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
        id: event.log.id,
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

// Supply Event Handler
ponder.on("CorePool:Supply", async ({ event, context }) => {
    const reservePrice = await getOraclePrice(context, event.args.reserve);

    await context.db.insert(Supply).values({
        id: event.log.id,
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

// Withdraw Event Handler
ponder.on("CorePool:Withdraw", async ({ event, context }) => {
    const reservePrice = await getOraclePrice(context, event.args.reserve);

    await context.db.insert(Withdraw).values({
        id: event.log.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        user: event.args.user,
        to: event.args.to,
        amount: event.args.amount,
        timestamp: Number(event.block.timestamp),
        price: reservePrice,
    });
});

// LiquidationCall Event Handler
ponder.on("CorePool:LiquidationCall", async ({ event, context }) => {
    const reservePriceCollateral = await getOraclePrice(context, event.args.collateralAsset);
    const reservePriceDebt = await getOraclePrice(context, event.args.debtAsset);

    await context.db.insert(LiquidationCall).values({
        id: event.log.id,
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
        id: event.log.id,
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

// ReserveDataUpdated Event Handler
ponder.on("CorePool:ReserveDataUpdated", async ({ event, context }) => {
    const reservePrice = await getOraclePrice(context, event.args.reserve);

    await context.db.insert(ReserveDataUpdated).values({
        id: event.log.id,
        txHash: event.transaction.hash,
        pool: event.log.address,
        reserve: event.args.reserve,
        liquidityRate: event.args.liquidityRate,
        stableBorrowRate: event.args.stableBorrowRate,
        variableBorrowRate: event.args.variableBorrowRate,
        liquidityIndex: event.args.liquidityIndex,
        variableBorrowIndex: event.args.variableBorrowIndex,
        timestamp: Number(event.block.timestamp),
        price: reservePrice,
    });
});

// ReserveUsedAsCollateralEnabled Event Handler
ponder.on("CorePool:ReserveUsedAsCollateralEnabled", async ({ event, context }) => {
    await context.db.insert(ReserveUsedAsCollateralEnabled).values({
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
        id: event.log.id,
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
