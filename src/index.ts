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
    IsolationModeTotalDebtUpdated 
} from "ponder:schema";

import { getOraclePrice } from "./helpers/getPrice";

// Borrow Event Handler
ponder.on("CorePool:Borrow", async ({ event, context }) => {
    let reservePrice = null;
    try {
        reservePrice = await getOraclePrice(context, event.args.reserve);
    } catch (e: any) {
        console.error(`Error fetching reserve price: ${e.message}`);
    }

    await context.db.insert(Borrow).values({
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
