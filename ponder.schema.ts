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
        price: t.bigint(),
    }),
    (table) => ({
        borrowerIdx: index().on(table.borrower),
        receiverIdx: index().on(table.receiver),
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
        price: t.bigint(),
    }),
    (table) => ({
        borrowerIdx: index().on(table.borrower),
        payerIdx: index().on(table.payer),
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
        price: t.bigint(),
    }),
    (table) => ({
        borrowerIdx: index().on(table.borrower),
        senderIdx: index().on(table.sender),
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
        price: t.bigint(),
    }),
    (table) => ({
        receiverIdx: index().on(table.receiver),
        senderIdx: index().on(table.sender),
        borrowerIdx: index().on(table.borrower),
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
        price: t.bigint(),
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
        price: t.bigint(),
    }),
    (table) => ({
        callerIdx: index().on(table.caller),
        ownerIdx: index().on(table.owner),
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
        price: t.bigint(),
    }),
    (table) => ({
        callerIdx: index().on(table.caller),
        ownerIdx: index().on(table.owner),
        receiverIdx: index().on(table.receiver),
    })
); 


export const LoopingManagers = onchainTable(
    "looping_managers",
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
