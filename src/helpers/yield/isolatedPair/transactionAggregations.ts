/**
 * Isolated Pair Transaction Aggregation Functions
 * 
 * Functions for calculating total transaction amounts (deposits, withdrawals, borrows, repays)
 * during a specific time period for isolated pairs.
 */

import {
    BorrowAssetIsolated,
    RepayAssetIsolated,
    AddCollateralIsolated,
    RemoveCollateralIsolated,
    DepositIsolated,
    WithdrawIsolated
} from "ponder:schema";
import { eq, and, gte, lte } from "ponder";
import { convertSharesToAssets } from "./balanceQueries";

/**
 * Calculate total deposited amount (asset shares converted to assets) during a period
 * 
 * Sums all DepositIsolated events and converts shares to asset amounts using exchange rate.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Total deposited amount in asset tokens
 */
export async function calculateTotalDeposited(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    const deposits = await dbQuery.select().from(DepositIsolated).where(
        and(
            eq(DepositIsolated.owner, user as `0x${string}`),
            eq(DepositIsolated.pair, pair as `0x${string}`),
            gte(DepositIsolated.timestamp, startTimestamp),
            lte(DepositIsolated.timestamp, endTimestamp)
        )
    );
    
    let totalDeposited = 0n;
    
    for (const deposit of deposits) {
        // Convert shares to asset amount using the exchange rate at time of deposit
        const assetAmount = convertSharesToAssets(deposit.shares, deposit.exchangeRate);
        totalDeposited += assetAmount;
    }
    
    return totalDeposited;
}

/**
 * Calculate total withdrawn amount (asset shares converted to assets) during a period
 * 
 * Sums all WithdrawIsolated events and converts shares to asset amounts using exchange rate.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Total withdrawn amount in asset tokens
 */
export async function calculateTotalWithdrawn(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    const withdraws = await dbQuery.select().from(WithdrawIsolated).where(
        and(
            eq(WithdrawIsolated.owner, user as `0x${string}`),
            eq(WithdrawIsolated.pair, pair as `0x${string}`),
            gte(WithdrawIsolated.timestamp, startTimestamp),
            lte(WithdrawIsolated.timestamp, endTimestamp)
        )
    );
    
    let totalWithdrawn = 0n;
    
    for (const withdraw of withdraws) {
        // Convert shares to asset amount using the exchange rate at time of withdrawal
        const assetAmount = convertSharesToAssets(withdraw.shares, withdraw.exchangeRate);
        totalWithdrawn += assetAmount;
    }
    
    return totalWithdrawn;
}

/**
 * Calculate total borrowed amount (borrow shares converted to assets) during a period
 * 
 * Sums all BorrowAssetIsolated events and converts shares to asset amounts using exchange rate.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Total borrowed amount in asset tokens
 */
export async function calculateTotalBorrowed(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    const borrows = await dbQuery.select().from(BorrowAssetIsolated).where(
        and(
            eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
            eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
            gte(BorrowAssetIsolated.timestamp, startTimestamp),
            lte(BorrowAssetIsolated.timestamp, endTimestamp)
        )
    );
    
    let totalBorrowed = 0n;
    
    for (const borrow of borrows) {
        // Convert shares to asset amount using the exchange rate at time of borrow
        const assetAmount = convertSharesToAssets(borrow.sharesAdded, borrow.exchangeRate);
        totalBorrowed += assetAmount;
    }
    
    return totalBorrowed;
}

/**
 * Calculate total repaid amount (repay shares converted to assets) during a period
 * 
 * Sums all RepayAssetIsolated events and converts shares to asset amounts using exchange rate.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Total repaid amount in asset tokens
 */
export async function calculateTotalRepaid(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    const repays = await dbQuery.select().from(RepayAssetIsolated).where(
        and(
            eq(RepayAssetIsolated.borrower, user as `0x${string}`),
            eq(RepayAssetIsolated.pair, pair as `0x${string}`),
            gte(RepayAssetIsolated.timestamp, startTimestamp),
            lte(RepayAssetIsolated.timestamp, endTimestamp)
        )
    );
    
    let totalRepaid = 0n;
    
    for (const repay of repays) {
        // Convert shares to asset amount using the exchange rate at time of repay
        const assetAmount = convertSharesToAssets(repay.shares, repay.exchangeRate);
        totalRepaid += assetAmount;
    }
    
    return totalRepaid;
}

/**
 * Calculate total collateral added during a period
 * 
 * Sums all AddCollateralIsolated events.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Total collateral added
 */
export async function calculateTotalCollateralAdded(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    const addEvents = await dbQuery.select().from(AddCollateralIsolated).where(
        and(
            eq(AddCollateralIsolated.borrower, user as `0x${string}`),
            eq(AddCollateralIsolated.pair, pair as `0x${string}`),
            gte(AddCollateralIsolated.timestamp, startTimestamp),
            lte(AddCollateralIsolated.timestamp, endTimestamp)
        )
    );
    
    let totalAdded = 0n;
    
    for (const event of addEvents) {
        totalAdded += event.collateralAmount;
    }
    
    return totalAdded;
}

/**
 * Calculate total collateral removed during a period
 * 
 * Sums all RemoveCollateralIsolated events.
 * 
 * @param context - Ponder context with database access
 * @param user - User address
 * @param pair - Isolated pair address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Total collateral removed
 */
export async function calculateTotalCollateralRemoved(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    const removeEvents = await dbQuery.select().from(RemoveCollateralIsolated).where(
        and(
            eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
            eq(RemoveCollateralIsolated.pair, pair as `0x${string}`),
            gte(RemoveCollateralIsolated.timestamp, startTimestamp),
            lte(RemoveCollateralIsolated.timestamp, endTimestamp)
        )
    );
    
    let totalRemoved = 0n;
    
    for (const event of removeEvents) {
        totalRemoved += event.collateralAmount;
    }
    
    return totalRemoved;
}

