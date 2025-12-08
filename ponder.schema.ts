import { onchainTable, index } from "ponder";

// export const UserCore = onchainTable("user", (t) => ({
//     id: t.text().primaryKey(), // User address
//     totalDeposits: t.bigint().default(0n), // Cumulative deposits across all reserves
//     totalBorrows: t.bigint().default(0n), // Cumulative borrows across all reserves
//     totalRepayments: t.bigint().default(0n), // Cumulative repayments across all reserves
//     totalWithdrawals: t.bigint().default(0n), // Cumulative withdrawals across all reserves
//     liquidationCount: t.integer().default(0), // Number of liquidations
// }));

// export const UserReserveCore = onchainTable("user_reserve", (t) => ({
//     id: t.text().primaryKey(), // Unique ID combining user and reserve (e.g., `${user}_${reserve}`)
//     user: t.hex(), // User address
//     reserve: t.hex(), // Reserve address
//     currentATokenBalance: t.bigint().default(0n), // Current balance of aTokens for the user in this reserve
//     currentDebt: t.bigint().default(0n), // Current debt of the user in this reserve
//     totalDeposits: t.bigint().default(0n), // Cumulative deposits in this reserve
//     totalBorrows: t.bigint().default(0n), // Cumulative borrows in this reserve
//     totalRepayments: t.bigint().default(0n), // Cumulative repayments in this reserve
//     totalWithdrawals: t.bigint().default(0n), // Cumulative withdrawals in this reserve
// }));

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
    onBehalfOf: t.hex(),
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

/// ISOLATED POOLS

export const BorrowAssetIsolated = onchainTable(
    "borrow_asset_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        borrower: t.hex(),
        receiver: t.hex(),
        borrowAmount: t.bigint(),
        sharesAdded: t.bigint(),
        timestamp: t.integer(),
        assetAddress: t.hex(), // The borrowed asset address
        collateralAddress: t.hex(), // The collateral asset address
        assetPrice: t.bigint(), // USD price of the asset (8 decimals)
        collateralPrice: t.bigint(), // USD price of the collateral (8 decimals)
        exchangeRate: t.bigint(), // Vault exchange rate (assets/shares)
    }),
    (table) => ({
        borrowerIdx: index().on(table.borrower),
        receiverIdx: index().on(table.receiver),
        // Composite indexes for efficient querying by user+pair+timestamp
        borrowerPairTimestampIdx: index().on(table.borrower, table.pair, table.timestamp),
        borrowerPairIdx: index().on(table.borrower, table.pair),
    })
);

export const RepayAssetIsolated = onchainTable(
    "repay_asset_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        borrower: t.hex(),
        payer: t.hex(),
        amountToRepay: t.bigint(),
        shares: t.bigint(),
        timestamp: t.integer(),
        assetAddress: t.hex(), // The borrowed asset address
        collateralAddress: t.hex(), // The collateral asset address
        assetPrice: t.bigint(), // USD price of the asset (8 decimals)
        collateralPrice: t.bigint(), // USD price of the collateral (8 decimals)
        exchangeRate: t.bigint(), // Vault exchange rate (assets/shares)
    }),
    (table) => ({
        borrowerIdx: index().on(table.borrower),
        payerIdx: index().on(table.payer),
        // Composite indexes for efficient querying by user+pair+timestamp
        borrowerPairTimestampIdx: index().on(table.borrower, table.pair, table.timestamp),
        borrowerPairIdx: index().on(table.borrower, table.pair),
    })
);

export const RepayAssetWithCollateralIsolated = onchainTable(
    "repay_asset_with_collateral_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        borrower: t.hex(),
        swapperAddress: t.hex(),
        collateralToSwap: t.bigint(),
        amountAssetOut: t.bigint(),
        sharesRepaid: t.bigint(),
        timestamp: t.integer(),
        assetAddress: t.hex(), // The borrowed asset address
        collateralAddress: t.hex(), // The collateral asset address
        assetPrice: t.bigint(), // USD price of the asset (8 decimals)
        collateralPrice: t.bigint(), // USD price of the collateral (8 decimals)
        exchangeRate: t.bigint(), // Vault exchange rate (assets/shares)
    }),
    (table) => ({
        borrowerIdx: index().on(table.borrower),
        // Composite indexes for efficient querying by user+pair+timestamp
        borrowerPairTimestampIdx: index().on(table.borrower, table.pair, table.timestamp),
        borrowerPairIdx: index().on(table.borrower, table.pair),
    })
);

export const AddCollateralIsolated = onchainTable(
    "add_collateral_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        borrower: t.hex(),
        sender: t.hex(),
        collateralAmount: t.bigint(),
        timestamp: t.integer(),
        assetAddress: t.hex(), // The borrowed asset address
        collateralAddress: t.hex(), // The collateral asset address
        assetPrice: t.bigint(), // USD price of the asset (8 decimals)
        collateralPrice: t.bigint(), // USD price of the collateral (8 decimals)
    }),
    (table) => ({
        borrowerIdx: index().on(table.borrower),
        senderIdx: index().on(table.sender),
        // Composite indexes for efficient querying by user+pair+timestamp
        borrowerPairTimestampIdx: index().on(table.borrower, table.pair, table.timestamp),
        borrowerPairIdx: index().on(table.borrower, table.pair),
    })
);

export const RemoveCollateralIsolated = onchainTable(
    "remove_collateral_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        receiver: t.hex(),
        sender: t.hex(),
        borrower: t.hex(),
        collateralAmount: t.bigint(),
        timestamp: t.integer(),
        assetAddress: t.hex(), // The borrowed asset address
        collateralAddress: t.hex(), // The collateral asset address
        assetPrice: t.bigint(), // USD price of the asset (8 decimals)
        collateralPrice: t.bigint(), // USD price of the collateral (8 decimals)
    }),
    (table) => ({
        receiverIdx: index().on(table.receiver),
        senderIdx: index().on(table.sender),
        borrowerIdx: index().on(table.borrower),
        // Composite indexes for efficient querying by user+pair+timestamp
        borrowerPairTimestampIdx: index().on(table.borrower, table.pair, table.timestamp),
        borrowerPairIdx: index().on(table.borrower, table.pair),
    })
);

export const LiquidateIsolated = onchainTable(
    "liquidate_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        borrower: t.hex(),
        liquidator: t.hex(),
        collateralForLiquidator: t.bigint(),
        sharesToLiquidate: t.bigint(),
        amountLiquidatorToRepay: t.bigint(),
        feesAmount: t.bigint(),
        sharesToAdjust: t.bigint(),
        amountToAdjust: t.bigint(),
        timestamp: t.integer(),
        assetAddress: t.hex(), // The borrowed asset address
        collateralAddress: t.hex(), // The collateral asset address
        assetPrice: t.bigint(), // USD price of the asset (8 decimals)
        collateralPrice: t.bigint(), // USD price of the collateral (8 decimals)
        exchangeRate: t.bigint(), // Vault exchange rate (assets/shares)
    }),
    (table) => ({
        liquidatorIdx: index().on(table.liquidator),
        borrowerIdx: index().on(table.borrower),
    })
);

export const DepositIsolated = onchainTable(
    "deposit_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        caller: t.hex(),
        owner: t.hex(),
        assets: t.bigint(),
        shares: t.bigint(),
        timestamp: t.integer(),
        assetAddress: t.hex(), // The borrowed asset address
        collateralAddress: t.hex(), // The collateral asset address
        assetPrice: t.bigint(), // USD price of the asset (8 decimals)
        collateralPrice: t.bigint(), // USD price of the collateral (8 decimals)
        exchangeRate: t.bigint(), // Vault exchange rate (assets/shares)
    }),
    (table) => ({
        callerIdx: index().on(table.caller),
        ownerIdx: index().on(table.owner),
        // Composite indexes for efficient querying by user+pair+timestamp
        ownerPairTimestampIdx: index().on(table.owner, table.pair, table.timestamp),
        ownerPairIdx: index().on(table.owner, table.pair),
    })
);

export const WithdrawIsolated = onchainTable(
    "withdraw_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        caller: t.hex(),
        owner: t.hex(),
        receiver: t.hex(),
        assets: t.bigint(),
        shares: t.bigint(),
        timestamp: t.integer(),
        assetAddress: t.hex(), // The borrowed asset address
        collateralAddress: t.hex(), // The collateral asset address
        assetPrice: t.bigint(), // USD price of the asset (8 decimals)
        collateralPrice: t.bigint(), // USD price of the collateral (8 decimals)
        exchangeRate: t.bigint(), // Vault exchange rate (assets/shares)
    }),
    (table) => ({
        callerIdx: index().on(table.caller),
        ownerIdx: index().on(table.owner),
        receiverIdx: index().on(table.receiver),
        // Composite indexes for efficient querying by user+pair+timestamp
        ownerPairTimestampIdx: index().on(table.owner, table.pair, table.timestamp),
        ownerPairIdx: index().on(table.owner, table.pair),
    })
);

// Track which isolated pairs each user has ever interacted with
// This enables fast lookups without scanning all event tables
export const UserIsolatedPairTracking = onchainTable(
    "user_isolated_pair_tracking",
    (t) => ({
        id: t.text().primaryKey(), // ${user}_${pair}
        user: t.hex(),
        pair: t.hex(),
        // Track which types of interactions exist
        hasDeposits: t.boolean().default(false),
        hasWithdraws: t.boolean().default(false),
        hasBorrows: t.boolean().default(false),
        hasRepays: t.boolean().default(false),
        hasCollateralAdded: t.boolean().default(false),
        hasCollateralRemoved: t.boolean().default(false),
        hasLiquidations: t.boolean().default(false),
        // Timestamps
        firstInteraction: t.integer(),
        lastInteraction: t.integer(),
    }),
    (table) => ({
        userIdx: index().on(table.user),
        pairIdx: index().on(table.pair),
        userPairIdx: index().on(table.user, table.pair),
    })
);

// Isolated Pair Rate Update Events
// These events enable accurate exchange rate calculations without approximation

export const UpdateRateIsolated = onchainTable(
    "update_rate_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        oldRatePerSec: t.bigint(),
        oldFullUtilizationRate: t.bigint(),
        newRatePerSec: t.bigint(),
        newFullUtilizationRate: t.bigint(),
        timestamp: t.integer(),
    }),
    (table) => ({
        pairIdx: index().on(table.pair),
        timestampIdx: index().on(table.timestamp),
        pairTimestampIdx: index().on(table.pair, table.timestamp),
    })
);

export const AddInterestIsolated = onchainTable(
    "add_interest_isolated",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        pair: t.hex(),
        interestEarned: t.bigint(),
        rate: t.bigint(),
        feesAmount: t.bigint(),
        feesShare: t.bigint(),
        timestamp: t.integer(),
    }),
    (table) => ({
        pairIdx: index().on(table.pair),
        timestampIdx: index().on(table.timestamp),
        pairTimestampIdx: index().on(table.pair, table.timestamp),
    })
);

// Note: UpdateExchangeRate event is for collateral/asset oracle prices, NOT vault exchange rate
// We don't need to track it for vault accounting

/// @notice Tracks the vault state (totalAsset and totalBorrow) for each isolated pair
/// @dev This mirrors the VaultAccount structs in the contract and is updated on every state-changing event
/// @dev totalBorrow is needed for precise interest rate extrapolation (interest accrues on borrowed amount)
export const IsolatedPairVaultState = onchainTable(
    "isolated_pair_vault_state",
    (t) => ({
        id: t.text().primaryKey(), // pair-timestamp-blockNumber
        pair: t.hex(),
        totalAssetAmount: t.bigint(), // totalAsset.amount - total assets in the vault
        totalAssetShares: t.bigint(), // totalAsset.shares - total shares outstanding
        totalBorrowAmount: t.bigint(), // totalBorrow.amount - total borrowed assets
        totalBorrowShares: t.bigint(), // totalBorrow.shares - total borrow shares outstanding
        timestamp: t.integer(),
        blockNumber: t.integer(),
        txHash: t.hex(),
    }),
    (table) => ({
        pairIdx: index().on(table.pair),
        timestampIdx: index().on(table.timestamp),
        pairTimestampIdx: index().on(table.pair, table.timestamp),
        pairBlockIdx: index().on(table.pair, table.blockNumber),
    })
);


export const StrategyDeployed = onchainTable(
    "strategy_deployed",
    (t) => ({
        id: t.text().primaryKey(),
        txHash: t.hex(),
        owner: t.hex(),
        stratManager: t.hex(),
        pool: t.hex(),
        yieldAsset: t.hex(),
        debtAsset: t.hex(),
    }),
    (table) => ({
        ownerIdx: index().on(table.owner),
        stratManagerIdx: index().on(table.stratManager),
    })
);


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
    }),
    (table) => ({
        reserveIdx: index().on(table.reserve),
        timestampIdx: index().on(table.timestamp),
        reserveTimestampIdx: index().on(table.reserve, table.timestamp),
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

// Store pre-calculated monthly interest earnings
export const UserMonthlyInterest = onchainTable(
    "user_monthly_interest",
    (t) => ({
        id: t.text().primaryKey(), // ${user}_${asset}_${year}_${month}
        user: t.hex(),
        asset: t.hex(),
        year: t.integer(),
        month: t.integer(), // 1-12
        interestEarned: t.bigint(), // Interest earned in underlying asset
        startScaledBalance: t.bigint(),
        endScaledBalance: t.bigint(),
        startLiquidityIndex: t.bigint(),
        endLiquidityIndex: t.bigint(),
        netDeposits: t.bigint(), // Net deposits during the month
        calculatedAt: t.integer(), // Timestamp when calculation was performed
    }),
    (table) => ({
        userIdx: index().on(table.user),
        assetIdx: index().on(table.asset),
        userAssetIdx: index().on(table.user, table.asset),
        yearMonthIdx: index().on(table.year, table.month),
        userYearMonthIdx: index().on(table.user, table.year, table.month),
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

// Track all isolated pairs created by the factory
export const IsolatedPairRegistry = onchainTable(
    "isolated_pair_registry",
    (t) => ({
        id: t.hex().primaryKey(), // pair address
        asset: t.hex(), // asset token address (e.g., USDT0)
        collateral: t.hex(), // collateral token address (e.g., WHLP)
        assetDecimals: t.integer(), // asset token decimals
        collateralDecimals: t.integer(), // collateral token decimals
        createdAtBlock: t.bigint(),
        createdAtTimestamp: t.integer(),
    }),
    (table) => ({
        createdAtBlockIdx: index().on(table.createdAtBlock),
        assetIdx: index().on(table.asset),
        collateralIdx: index().on(table.collateral),
    })
);

// Store periodic oracle price snapshots for isolated pairs
export const IsolatedPairPriceSnapshot = onchainTable(
    "isolated_pair_price_snapshot",
    (t) => ({
        id: t.text().primaryKey(), // pair-blockNumber
        pair: t.hex(),
        priceLow: t.bigint(), // Oracle low price
        priceHigh: t.bigint(), // Oracle high price
        blockNumber: t.bigint(),
        timestamp: t.integer(),
    }),
    (table) => ({
        pairIdx: index().on(table.pair),
        timestampIdx: index().on(table.timestamp),
        blockNumberIdx: index().on(table.blockNumber),
        pairTimestampIdx: index().on(table.pair, table.timestamp),
        pairBlockIdx: index().on(table.pair, table.blockNumber),
    })
);
