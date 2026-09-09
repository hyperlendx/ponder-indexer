import { onchainTable, index } from "ponder";

// User entities for tracking current deposit balances
export const User = onchainTable("user", (t) => ({
    id: t.hex().primaryKey(), // User address
    totalDepositCount: t.integer().default(0), // Number of different tokens deposited
    lastUpdated: t.integer(), // Timestamp of last balance update
}));

export const UserDeposit = onchainTable(
    "user_deposit",
    (t) => ({
        id: t.text().primaryKey(), // Composite key: `${userAddress}_${tokenAddress}`
        user: t.hex(), // User address
        token: t.hex(), // Token/reserve address
        currentBalance: t.bigint(), // Current net deposit balance (deposits - withdrawals)
        lastUpdated: t.integer(), // Timestamp of last update
    }),
    (table) => ({
        userIdx: index().on(table.user),
        tokenIdx: index().on(table.token),
        balanceIdx: index().on(table.currentBalance),
    })
);

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
        onBehalfOfReserveTimestampIdx: index().on(table.onBehalfOf, table.reserve, table.timestamp),
    })
);

export const Repay = onchainTable(
    "repay",
    (t) => ({
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
    }),
    (table) => ({
        userReserveTimestampIdx: index().on(table.user, table.reserve, table.timestamp),
    })
);

export const Supply = onchainTable(
    "supply",
    (t) => ({
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
    }),
    (table) => ({
        onBehalfOfReserveTimestampIdx: index().on(table.onBehalfOf, table.reserve, table.timestamp),
        reserveTimestampIdx: index().on(table.reserve, table.timestamp),
    })
);

export const Withdraw = onchainTable(
    "withdraw",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pool: t.hex(),
        reserve: t.hex(),
        user: t.hex(),
        onBehalfOf: t.hex(),
        to: t.hex(),
        amount: t.bigint(),
        timestamp: t.integer(),
        price: t.bigint(),
    }),
    (table) => ({
        onBehalfOfReserveTimestampIdx: index().on(table.onBehalfOf, table.reserve, table.timestamp),
        reserveTimestampIdx: index().on(table.reserve, table.timestamp),
    })
);

export const LiquidationCall = onchainTable(
    "liquidation_call",
    (t) => ({
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
    }),
    (table) => ({
        userIdx: index().on(table.user),
        userCollateralTimestampIdx: index().on(table.user, table.collateralAsset, table.timestamp),
        userDebtTimestampIdx: index().on(table.user, table.debtAsset, table.timestamp),
    })
);

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

/// hTOKENS

export const HTokenTransfer = onchainTable("hToken_transfer", (t) => ({
    id: t.text().primaryKey(),
    txHash: t.hex(),
    reserve: t.hex(),
    from: t.hex(),
    to: t.hex(),
    value: t.bigint(),
    index: t.bigint()
}));

// Store reserve data events for liquidityIndex and variableBorrowIndex tracking
export const ReserveDataEvent = onchainTable(
    "reserve_data_event",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        reserve: t.hex(),
        liquidityIndex: t.bigint(),
        liquidityRate: t.bigint(),
        variableBorrowIndex: t.bigint(),
        variableBorrowRate: t.bigint(),
        timestamp: t.integer(),
        blockNumber: t.bigint(),
        logIndex: t.integer(), // Orders several updates of the same reserve within one block
    }),
    (table) => ({
        reserveIdx: index().on(table.reserve),
        timestampIdx: index().on(table.timestamp),
        reserveTimestampIdx: index().on(table.reserve, table.timestamp),
    })
);

// Snapshot of the reserve state (the last ReserveDataEvent) as of each UTC midnight.
// Written at index time so the API can resolve the liquidity/borrow index at any
// day boundary (and at any timestamp in a day without reserve activity) without
// scanning ReserveDataEvent. One row per reserve per day.
export const DailyReserveIndex = onchainTable(
    "daily_reserve_index",
    (t) => ({
        id: t.text().primaryKey(), // `${reserve}-${day}`
        reserve: t.hex(),
        day: t.integer(), // UTC midnight this snapshot is valid for (unix seconds)
        eventTimestamp: t.integer(), // Timestamp of the last ReserveDataEvent at or before `day`
        blockNumber: t.bigint(), // Block of that ReserveDataEvent
        liquidityIndex: t.bigint(),
        liquidityRate: t.bigint(),
        variableBorrowIndex: t.bigint(),
        variableBorrowRate: t.bigint(),
    }),
    (table) => ({
        reserveDayIdx: index().on(table.reserve, table.day),
    })
);

// Store user balance events for scaled balance tracking
export const UserBalanceEvent = onchainTable(
    "user_balance_event",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        user: t.hex(),
        asset: t.hex(),
        scaledBalance: t.bigint(), // Total balance after transaction
        transactionAmount: t.bigint(), // Actual transaction amount (scaled)
        eventType: t.text(), // 'deposit', 'withdraw', 'transfer_in', 'transfer_out'
        timestamp: t.integer(),
        blockNumber: t.bigint(),
        logIndex: t.integer(), // Log index of the triggering event, for deterministic ordering within a block
        liquidityIndex: t.bigint(),
        assetPrice: t.bigint(), // Oracle price of the asset at the time of the event (8 decimals precision)
    }),
    (table) => ({
        userIdx: index().on(table.user),
        assetIdx: index().on(table.asset),
        userAssetIdx: index().on(table.user, table.asset),
        timestampIdx: index().on(table.timestamp),
        eventTypeIdx: index().on(table.eventType),
        userAssetTimestampIdx: index().on(table.user, table.asset, table.timestamp),
    })
);

// Store current user positions with scaled and actual balances
export const UserPosition = onchainTable(
    "user_position",
    (t) => ({
        id: t.text().primaryKey(), // ${user}_${asset}
        user: t.hex(),
        asset: t.hex(),
        scaledBalance: t.bigint(),
        actualBalance: t.bigint(),
        totalDeposits: t.bigint(), // Cumulative deposits in underlying asset
        totalWithdrawals: t.bigint(), // Cumulative withdrawals in underlying asset
        lastUpdated: t.integer(),
        lastLiquidityIndex: t.bigint(),
    }),
    (table) => ({
        userIdx: index().on(table.user),
        assetIdx: index().on(table.asset),
        userAssetIdx: index().on(table.user, table.asset),
        lastUpdatedIdx: index().on(table.lastUpdated),
    })
);

// Store periodic oracle price snapshots for all assets
export const AssetPriceSnapshot = onchainTable(
    "asset_price_snapshot",
    (t) => ({
        id: t.text().primaryKey(), // asset-blockNumber
        asset: t.hex(),
        price: t.bigint(), // Oracle price (8 decimals precision)
        decimals: t.integer(), // Token decimals (e.g., 6 for USDT, 18 for WETH)
        blockNumber: t.bigint(),
        timestamp: t.integer(),
    }),
    (table) => ({
        assetIdx: index().on(table.asset),
        timestampIdx: index().on(table.timestamp),
        blockNumberIdx: index().on(table.blockNumber),
        assetTimestampIdx: index().on(table.asset, table.timestamp),
        assetBlockIdx: index().on(table.asset, table.blockNumber),
    })
);
