import { ponder } from "@/generated";

import { getOraclePrice } from "./helpers/getPrice";

ponder.on("CorePool:Borrow", async ({ event, context }) => {
    const { Borrow } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    await Borrow.create({
        id: event.log.id,
        data: {
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
            price: reservePrice
        }
    });
});

ponder.on("CorePool:Repay", async ({ event, context }) => {
    const { Repay } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    await Repay.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            user: event.args.user,
            repayer: event.args.repayer,
            amount: event.args.amount,
            useATokens: event.args.useATokens,
            timestamp: Number(event.block.timestamp),
            price: reservePrice
        }
    });
});

ponder.on("CorePool:Supply", async ({ event, context }) => {
    const { Supply } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    await Supply.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            user: event.args.user,
            onBehalfOf: event.args.onBehalfOf,
            amount: event.args.amount,
            referralCode: event.args.referralCode,
            timestamp: Number(event.block.timestamp),
            price: reservePrice
        }
    });
});

ponder.on("CorePool:Withdraw", async ({ event, context }) => {
    const { Withdraw } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    await Withdraw.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            user: event.args.user,
            to: event.args.to,
            amount: event.args.amount,
            timestamp: Number(event.block.timestamp),
            price: reservePrice
        }
    });
});

ponder.on("CorePool:LiquidationCall", async ({ event, context }) => {
    const { LiquidationCall } = context.db;

    const reservePriceCollateral = await getOraclePrice(context, event.args.collateralAsset);
    const reservePriceDebt = await getOraclePrice(context, event.args.debtAsset);
    await LiquidationCall.create({
        id: event.log.id,
        data: {
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
            priceDebt: reservePriceDebt
        }
    });
});

ponder.on("CorePool:FlashLoan", async ({ event, context }) => {
    const { FlashLoan } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.asset);
    await FlashLoan.create({
        id: event.log.id,
        data: {
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
            price: reservePrice
        }
    });
});


ponder.on("CorePool:ReserveDataUpdated", async ({ event, context }) => {
    const { ReserveDataUpdated } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    await ReserveDataUpdated.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            liquidityRate: event.args.liquidityRate,
            stableBorrowRate: event.args.stableBorrowRate,
            variableBorrowRate: event.args.variableBorrowRate,
            liquidityIndex: event.args.liquidityIndex,
            variableBorrowIndex: event.args.variableBorrowIndex,
            timestamp: Number(event.block.timestamp),
            price: reservePrice
        }
    });
});

ponder.on("CorePool:ReserveUsedAsCollateralEnabled", async ({ event, context }) => {
    const { ReserveUsedAsCollateralEnabled } = context.db;

    await ReserveUsedAsCollateralEnabled.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            user: event.args.user,
            timestamp: Number(event.block.timestamp)
        }
    });
});

ponder.on("CorePool:ReserveUsedAsCollateralDisabled", async ({ event, context }) => {
    const { ReserveUsedAsCollateralDisabled } = context.db;

    await ReserveUsedAsCollateralDisabled.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            user: event.args.user,
            timestamp: Number(event.block.timestamp)
        }
    });
});

ponder.on("CorePool:SwapBorrowRateMode", async ({ event, context }) => {
    const { SwapBorrowRateMode } = context.db;

    await SwapBorrowRateMode.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            user: event.args.user,
            interestRateMode: event.args.interestRateMode,
            timestamp: Number(event.block.timestamp)
        }
    });
});

ponder.on("CorePool:UserEModeSet", async ({ event, context }) => {
    const { UserEModeSet } = context.db;

    await UserEModeSet.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            user: event.args.user,
            categoryId: event.args.categoryId,
            timestamp: Number(event.block.timestamp)
        }
    });
});

ponder.on("CorePool:MintedToTreasury", async ({ event, context }) => {
    const { MintedToTreasury } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    await MintedToTreasury.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            amountMinted: event.args.amountMinted,
            timestamp: Number(event.block.timestamp),
            price: reservePrice
        }
    });
});

ponder.on("CorePool:MintUnbacked", async ({ event, context }) => {
    const { MintUnbacked } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    await MintUnbacked.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            user: event.args.user,
            onBehalfOf: event.args.onBehalfOf,
            amount: event.args.amount,
            referralCode: event.args.referralCode,
            timestamp: Number(event.block.timestamp),
            price: reservePrice
        }
    });
});

ponder.on("CorePool:BackUnbacked", async ({ event, context }) => {
    const { BackUnbacked } = context.db;

    const reservePrice = await getOraclePrice(context, event.args.reserve);
    await BackUnbacked.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            backer: event.args.backer,
            amount: event.args.amount,
            fee: event.args.fee,
            timestamp: Number(event.block.timestamp),
            price: reservePrice
        }
    });
});

ponder.on("CorePool:RebalanceStableBorrowRate", async ({ event, context }) => {
    const { RebalanceStableBorrowRate } = context.db;

    await RebalanceStableBorrowRate.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            reserve: event.args.reserve,
            user: event.args.user,
            timestamp: Number(event.block.timestamp)
        }
    });
});

ponder.on("CorePool:IsolationModeTotalDebtUpdated", async ({ event, context }) => {
    const { IsolationModeTotalDebtUpdated } = context.db;

    await IsolationModeTotalDebtUpdated.create({
        id: event.log.id,
        data: {
            txHash: event.transaction.hash,
            pool: event.log.address,
            asset: event.args.asset,
            totalDebt: event.args.totalDebt,
            timestamp: Number(event.block.timestamp)
        }
    });
});