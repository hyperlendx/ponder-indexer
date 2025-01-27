import { onchainTable, index } from "ponder";

// New schema configuration
export const Borrow = onchainTable(
    "borrow",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pool: t.hex(),
        reserve: t.hex(),
        user: t.hex(),
        onBehalfOf: t.hex(),
        amount: t.bigint(),
        interestRateMode: t.integer(),
        borrowRate: t.bigint(),
        referralCode: t.integer(),
        timestamp: t.integer(),
        price: t.bigint(),
    }),
    (table) => ({
        onBehalfOfIdx: index().on(table.onBehalfOf),
    })
);

export const Repay = onchainTable("repay", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    user: t.hex(),
    repayer: t.hex(),
    amount: t.bigint(),
    useATokens: t.boolean(),
    timestamp: t.integer(),
    price: t.bigint(),
}));

export const Supply = onchainTable("supply", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    user: t.hex(),
    onBehalfOf: t.hex(),
    amount: t.bigint(),
    referralCode: t.integer(),
    timestamp: t.integer(),
    price: t.bigint(),
}));

export const Withdraw = onchainTable("withdraw", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    user: t.hex(),
    to: t.hex(),
    amount: t.bigint(),
    timestamp: t.integer(),
    price: t.bigint(),
}));

export const LiquidationCall = onchainTable("liquidation_call", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    collateralAsset: t.hex(),
    debtAsset: t.hex(),
    user: t.hex(),
    debtToCover: t.bigint(),
    liquidatedCollateralAmount: t.bigint(),
    liquidator: t.hex(),
    receiveAToken: t.boolean(),
    timestamp: t.integer(),
    priceCollateral: t.bigint(),
    priceDebt: t.bigint(),
}));

export const FlashLoan = onchainTable("flash_loan", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    target: t.hex(),
    initiator: t.hex(),
    asset: t.hex(),
    amount: t.bigint(),
    interestRateMode: t.integer(),
    premium: t.bigint(),
    referralCode: t.integer(),
    timestamp: t.integer(),
    price: t.bigint(),
}));

export const ReserveDataUpdated = onchainTable("reserve_data_updated", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    liquidityRate: t.bigint(),
    stableBorrowRate: t.bigint(),
    variableBorrowRate: t.bigint(),
    liquidityIndex: t.bigint(),
    variableBorrowIndex: t.bigint(),
    timestamp: t.integer(),
    price: t.bigint(),
}));

export const ReserveUsedAsCollateralEnabled = onchainTable("reserve_collateral_enabled", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    user: t.hex(),
    timestamp: t.integer(),
}));

export const ReserveUsedAsCollateralDisabled = onchainTable("reserve_collateral_disabled", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    user: t.hex(),
    timestamp: t.integer(),
}));

export const SwapBorrowRateMode = onchainTable("swap_borrow_rate_mode", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    user: t.hex(),
    interestRateMode: t.integer(),
    timestamp: t.integer(),
}));

export const UserEModeSet = onchainTable("user_emode_set", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    user: t.hex(),
    categoryId: t.integer(),
    timestamp: t.integer(),
}));

export const MintedToTreasury = onchainTable("minted_to_treasury", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    amountMinted: t.bigint(),
    timestamp: t.integer(),
    price: t.bigint(),
}));

export const MintUnbacked = onchainTable("mint_unbacked", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    user: t.hex(),
    onBehalfOf: t.hex(),
    amount: t.bigint(),
    referralCode: t.integer(),
    timestamp: t.integer(),
    price: t.bigint(),
}));

export const BackUnbacked = onchainTable("back_unbacked", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    backer: t.hex(),
    amount: t.bigint(),
    fee: t.bigint(),
    timestamp: t.integer(),
    price: t.bigint(),
}));

export const RebalanceStableBorrowRate = onchainTable("rebalance_stable_borrow_rate", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    reserve: t.hex(),
    user: t.hex(),
    timestamp: t.integer(),
}));

export const IsolationModeTotalDebtUpdated = onchainTable("isolation_mode_total_debt_updated", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    pool: t.hex(),
    asset: t.hex(),
    totalDebt: t.bigint(),
    timestamp: t.integer(),
}));
