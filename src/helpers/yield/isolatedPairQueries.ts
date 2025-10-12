/**
 * Isolated Pair Query Functions
 * 
 * These functions handle querying and calculating balances for isolated lending pairs.
 * Isolated pairs use ERC4626-style shares-based accounting, different from the
 * index-based accounting used in the regular AAVE pool.
 */

import { 
    BorrowAssetIsolated, 
    RepayAssetIsolated, 
    AddCollateralIsolated, 
    RemoveCollateralIsolated, 
    DepositIsolated, 
    WithdrawIsolated 
} from "ponder:schema";
import { eq, and, lte, gte, or } from "ponder";

// Exchange rate precision (from IsolatedAbi: EXCHANGE_PRECISION = 1e18)
const EXCHANGE_PRECISION = 1000000000000000000n; // 1e18

/**
 * Get all isolated pairs a user has interacted with during a time period
 */
export async function getUserIsolatedPairs(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const dbQuery = context.db.sql || context.db;
    
    // Query all isolated pair events for this user in the time period
    const [borrows, repays, addCollateral, removeCollateral, deposits, withdraws] = await Promise.all([
        dbQuery.select().from(BorrowAssetIsolated).where(
            and(
                eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                gte(BorrowAssetIsolated.timestamp, startTimestamp),
                lte(BorrowAssetIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(RepayAssetIsolated).where(
            and(
                eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                gte(RepayAssetIsolated.timestamp, startTimestamp),
                lte(RepayAssetIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(AddCollateralIsolated).where(
            and(
                eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                gte(AddCollateralIsolated.timestamp, startTimestamp),
                lte(AddCollateralIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(RemoveCollateralIsolated).where(
            and(
                eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
                gte(RemoveCollateralIsolated.timestamp, startTimestamp),
                lte(RemoveCollateralIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(DepositIsolated).where(
            and(
                eq(DepositIsolated.owner, user as `0x${string}`),
                gte(DepositIsolated.timestamp, startTimestamp),
                lte(DepositIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(WithdrawIsolated).where(
            and(
                eq(WithdrawIsolated.owner, user as `0x${string}`),
                gte(WithdrawIsolated.timestamp, startTimestamp),
                lte(WithdrawIsolated.timestamp, endTimestamp)
            )
        )
    ]);
    
    // Collect unique pair addresses
    const pairSet = new Set<string>();
    
    borrows.forEach(e => pairSet.add(e.pair));
    repays.forEach(e => pairSet.add(e.pair));
    addCollateral.forEach(e => pairSet.add(e.pair));
    removeCollateral.forEach(e => pairSet.add(e.pair));
    deposits.forEach(e => pairSet.add(e.pair));
    withdraws.forEach(e => pairSet.add(e.pair));
    
    return Array.from(pairSet);
}

/**
 * Get collateral balance for a user in an isolated pair at a specific timestamp
 * Collateral = Σ(AddCollateral) - Σ(RemoveCollateral)
 */
export async function getIsolatedPairCollateralBalance(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    // Get all collateral events up to timestamp
    const [addEvents, removeEvents] = await Promise.all([
        dbQuery.select().from(AddCollateralIsolated).where(
            and(
                eq(AddCollateralIsolated.borrower, user as `0x${string}`),
                eq(AddCollateralIsolated.pair, pair as `0x${string}`),
                lte(AddCollateralIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(RemoveCollateralIsolated).where(
            and(
                eq(RemoveCollateralIsolated.borrower, user as `0x${string}`),
                eq(RemoveCollateralIsolated.pair, pair as `0x${string}`),
                lte(RemoveCollateralIsolated.timestamp, timestamp)
            )
        )
    ]);
    
    // Calculate net collateral
    let collateralBalance = 0n;
    
    for (const event of addEvents) {
        collateralBalance += event.collateralAmount;
    }
    
    for (const event of removeEvents) {
        collateralBalance -= event.collateralAmount;
    }
    
    return collateralBalance > 0n ? collateralBalance : 0n;
}

/**
 * Get asset shares for a user in an isolated pair at a specific timestamp
 * Asset Shares = Σ(Deposit.shares) - Σ(Withdraw.shares)
 */
export async function getIsolatedPairAssetShares(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    // Get all deposit/withdraw events up to timestamp
    const [deposits, withdraws] = await Promise.all([
        dbQuery.select().from(DepositIsolated).where(
            and(
                eq(DepositIsolated.owner, user as `0x${string}`),
                eq(DepositIsolated.pair, pair as `0x${string}`),
                lte(DepositIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(WithdrawIsolated).where(
            and(
                eq(WithdrawIsolated.owner, user as `0x${string}`),
                eq(WithdrawIsolated.pair, pair as `0x${string}`),
                lte(WithdrawIsolated.timestamp, timestamp)
            )
        )
    ]);
    
    // Calculate net shares
    let assetShares = 0n;
    
    for (const event of deposits) {
        assetShares += event.shares;
    }
    
    for (const event of withdraws) {
        assetShares -= event.shares;
    }
    
    return assetShares > 0n ? assetShares : 0n;
}

/**
 * Get borrow shares for a user in an isolated pair at a specific timestamp
 * Borrow Shares = Σ(BorrowAsset.sharesAdded) - Σ(RepayAsset.shares)
 */
export async function getIsolatedPairBorrowShares(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;
    
    // Get all borrow/repay events up to timestamp
    const [borrows, repays] = await Promise.all([
        dbQuery.select().from(BorrowAssetIsolated).where(
            and(
                eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                lte(BorrowAssetIsolated.timestamp, timestamp)
            )
        ),
        dbQuery.select().from(RepayAssetIsolated).where(
            and(
                eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                lte(RepayAssetIsolated.timestamp, timestamp)
            )
        )
    ]);
    
    // Calculate net borrow shares
    let borrowShares = 0n;
    
    for (const event of borrows) {
        borrowShares += event.sharesAdded;
    }
    
    for (const event of repays) {
        borrowShares -= event.shares;
    }
    
    return borrowShares > 0n ? borrowShares : 0n;
}

/**
 * Convert shares to assets using exchange rate
 * Formula: assets = shares × exchangeRate / EXCHANGE_PRECISION
 * 
 * Note: For isolated pairs, the exchange rate grows over time as interest accrues,
 * similar to how liquidity index works in the regular pool.
 */
export function convertSharesToAssets(
    shares: bigint,
    exchangeRate: bigint
): bigint {
    if (shares === 0n || exchangeRate === 0n) {
        return 0n;
    }
    
    // assets = shares × exchangeRate / EXCHANGE_PRECISION
    // Add rounding: (shares × exchangeRate + EXCHANGE_PRECISION/2) / EXCHANGE_PRECISION
    return (shares * exchangeRate + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
}

/**
 * Get exchange rate for an isolated pair at a specific timestamp
 *
 * This function retrieves the most recent exchange rate from indexed events.
 * The exchange rate is calculated from event data (assets/shares) and stored
 * in the database for each transaction.
 *
 * Exchange rate represents the vault's shares-to-assets conversion rate,
 * which grows over time as interest accrues (similar to ERC-4626 standard).
 */
export async function getIsolatedPairExchangeRate(
    context: any,
    pair: string,
    timestamp: number
): Promise<bigint> {
    const dbQuery = context.db.sql || context.db;

    // Try to get the most recent exchange rate from events before this timestamp
    // We'll check multiple event types to find the most recent one
    const [borrowEvents, repayEvents, depositEvents, withdrawEvents] = await Promise.all([
        dbQuery.select().from(BorrowAssetIsolated).where(
            and(
                eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                lte(BorrowAssetIsolated.timestamp, timestamp)
            )
        ).orderBy((table: any, { desc }: any) => [desc(table.timestamp)]).limit(1),
        dbQuery.select().from(RepayAssetIsolated).where(
            and(
                eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                lte(RepayAssetIsolated.timestamp, timestamp)
            )
        ).orderBy((table: any, { desc }: any) => [desc(table.timestamp)]).limit(1),
        dbQuery.select().from(DepositIsolated).where(
            and(
                eq(DepositIsolated.pair, pair as `0x${string}`),
                lte(DepositIsolated.timestamp, timestamp)
            )
        ).orderBy((table: any, { desc }: any) => [desc(table.timestamp)]).limit(1),
        dbQuery.select().from(WithdrawIsolated).where(
            and(
                eq(WithdrawIsolated.pair, pair as `0x${string}`),
                lte(WithdrawIsolated.timestamp, timestamp)
            )
        ).orderBy((table: any, { desc }: any) => [desc(table.timestamp)]).limit(1)
    ]);

    // Find the most recent event with an exchange rate
    let mostRecentRate = EXCHANGE_PRECISION; // Default to 1:1 if no events found
    let mostRecentTimestamp = 0;

    if (borrowEvents.length > 0 && borrowEvents[0].timestamp > mostRecentTimestamp && borrowEvents[0].exchangeRate) {
        mostRecentRate = borrowEvents[0].exchangeRate;
        mostRecentTimestamp = borrowEvents[0].timestamp;
    }

    if (repayEvents.length > 0 && repayEvents[0].timestamp > mostRecentTimestamp && repayEvents[0].exchangeRate) {
        mostRecentRate = repayEvents[0].exchangeRate;
        mostRecentTimestamp = repayEvents[0].timestamp;
    }

    if (depositEvents.length > 0 && depositEvents[0].timestamp > mostRecentTimestamp && depositEvents[0].exchangeRate) {
        mostRecentRate = depositEvents[0].exchangeRate;
        mostRecentTimestamp = depositEvents[0].timestamp;
    }

    if (withdrawEvents.length > 0 && withdrawEvents[0].timestamp > mostRecentTimestamp && withdrawEvents[0].exchangeRate) {
        mostRecentRate = withdrawEvents[0].exchangeRate;
    }

    return mostRecentRate;
}

/**
 * Calculate isolated pair positions for a user at a specific timestamp
 * Returns collateral, asset shares, borrow shares, and converted amounts
 */
export async function calculateIsolatedPairPosition(
    context: any,
    user: string,
    pair: string,
    timestamp: number
): Promise<{
    pair: string;
    collateralAmount: bigint;
    assetShares: bigint;
    borrowShares: bigint;
    assetAmount: bigint;
    borrowAmount: bigint;
    exchangeRate: bigint;
}> {
    // Get all balances in parallel
    const [collateralAmount, assetShares, borrowShares, exchangeRate] = await Promise.all([
        getIsolatedPairCollateralBalance(context, user, pair, timestamp),
        getIsolatedPairAssetShares(context, user, pair, timestamp),
        getIsolatedPairBorrowShares(context, user, pair, timestamp),
        getIsolatedPairExchangeRate(context, pair, timestamp)
    ]);

    // Convert shares to amounts
    const assetAmount = convertSharesToAssets(assetShares, exchangeRate);
    const borrowAmount = convertSharesToAssets(borrowShares, exchangeRate);

    return {
        pair,
        collateralAmount,
        assetShares,
        borrowShares,
        assetAmount,
        borrowAmount,
        exchangeRate
    };
}

/**
 * Calculate all isolated pair positions for a user at a specific timestamp
 * This is the main function used by APIs to get complete isolated pair data
 */
export async function calculateAllIsolatedPairPositions(
    context: any,
    user: string,
    timestamp: number,
    startTimestamp?: number
): Promise<Array<{
    pair: string;
    collateralAmount: bigint;
    assetShares: bigint;
    borrowShares: bigint;
    assetAmount: bigint;
    borrowAmount: bigint;
    exchangeRate: bigint;
}>> {
    // Get all pairs user has interacted with
    // Use a wide time range to catch all historical interactions
    const effectiveStartTimestamp = startTimestamp || 0;
    const pairs = await getUserIsolatedPairs(context, user, effectiveStartTimestamp, timestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Calculate position for each pair in parallel
    const positions = await Promise.all(
        pairs.map(pair => calculateIsolatedPairPosition(context, user, pair, timestamp))
    );

    // Filter out pairs with zero balances
    return positions.filter(pos =>
        pos.collateralAmount > 0n ||
        pos.assetShares > 0n ||
        pos.borrowShares > 0n
    );
}

/**
 * Calculate yields for all isolated pairs for a user during a custom period
 * This is used by the custom-period-yield API to show yields with collateral breakdown
 */
export async function calculateAllIsolatedPairYields(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    pair: string;
    assetYield: bigint;
    borrowYield: bigint;
    netYield: bigint;
    startAssetShares: bigint;
    endAssetShares: bigint;
    startBorrowShares: bigint;
    endBorrowShares: bigint;
    startExchangeRate: bigint;
    endExchangeRate: bigint;
    startCollateralBalance: bigint;
    endCollateralBalance: bigint;
    startAssetValue: bigint;
    endAssetValue: bigint;
    startBorrowValue: bigint;
    endBorrowValue: bigint;
}>> {
    // Get all pairs user has interacted with during this period
    const pairs = await getUserIsolatedPairs(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return [];
    }

    // Calculate yield for each pair in parallel
    const yields = await Promise.all(
        pairs.map(pair => calculateIsolatedPairYield(context, user, pair, startTimestamp, endTimestamp))
    );

    // Filter out pairs with no activity (no shares at start or end, no yield)
    return yields.filter(y =>
        y.startAssetShares > 0n ||
        y.endAssetShares > 0n ||
        y.startBorrowShares > 0n ||
        y.endBorrowShares > 0n ||
        y.startCollateralBalance > 0n ||
        y.endCollateralBalance > 0n ||
        y.netYield !== 0n
    );
}

/**
 * Get all events for a user in a specific pair during a time period
 * Returns events sorted by timestamp in ascending order
 */
async function getUserPairEvents(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    timestamp: number;
    type: 'deposit' | 'withdraw' | 'borrow' | 'repay';
    assetSharesDelta: bigint;
    borrowSharesDelta: bigint;
    exchangeRate: bigint;
}>> {
    const dbQuery = context.db.sql || context.db;

    // Query all events for this user and pair during the period
    const [deposits, withdraws, borrows, repays] = await Promise.all([
        dbQuery.select().from(DepositIsolated).where(
            and(
                eq(DepositIsolated.owner, user as `0x${string}`),
                eq(DepositIsolated.pair, pair as `0x${string}`),
                gte(DepositIsolated.timestamp, startTimestamp),
                lte(DepositIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(WithdrawIsolated).where(
            and(
                eq(WithdrawIsolated.owner, user as `0x${string}`),
                eq(WithdrawIsolated.pair, pair as `0x${string}`),
                gte(WithdrawIsolated.timestamp, startTimestamp),
                lte(WithdrawIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(BorrowAssetIsolated).where(
            and(
                eq(BorrowAssetIsolated.borrower, user as `0x${string}`),
                eq(BorrowAssetIsolated.pair, pair as `0x${string}`),
                gte(BorrowAssetIsolated.timestamp, startTimestamp),
                lte(BorrowAssetIsolated.timestamp, endTimestamp)
            )
        ),
        dbQuery.select().from(RepayAssetIsolated).where(
            and(
                eq(RepayAssetIsolated.borrower, user as `0x${string}`),
                eq(RepayAssetIsolated.pair, pair as `0x${string}`),
                gte(RepayAssetIsolated.timestamp, startTimestamp),
                lte(RepayAssetIsolated.timestamp, endTimestamp)
            )
        )
    ]);

    // Convert to unified event format
    const events: Array<{
        timestamp: number;
        type: 'deposit' | 'withdraw' | 'borrow' | 'repay';
        assetSharesDelta: bigint;
        borrowSharesDelta: bigint;
        exchangeRate: bigint;
    }> = [];

    for (const deposit of deposits) {
        events.push({
            timestamp: deposit.timestamp,
            type: 'deposit',
            assetSharesDelta: deposit.shares, // Positive - adding shares
            borrowSharesDelta: 0n,
            exchangeRate: deposit.exchangeRate
        });
    }

    for (const withdraw of withdraws) {
        events.push({
            timestamp: withdraw.timestamp,
            type: 'withdraw',
            assetSharesDelta: 0n - withdraw.shares, // Negative - removing shares
            borrowSharesDelta: 0n,
            exchangeRate: withdraw.exchangeRate
        });
    }

    for (const borrow of borrows) {
        events.push({
            timestamp: borrow.timestamp,
            type: 'borrow',
            assetSharesDelta: 0n,
            borrowSharesDelta: borrow.sharesAdded, // Positive - adding debt
            exchangeRate: borrow.exchangeRate
        });
    }

    for (const repay of repays) {
        events.push({
            timestamp: repay.timestamp,
            type: 'repay',
            assetSharesDelta: 0n,
            borrowSharesDelta: 0n - repay.shares, // Negative - reducing debt
            exchangeRate: repay.exchangeRate
        });
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    return events;
}

/**
 * Calculate yield for an isolated pair over a time period with MAXIMUM ACCURACY
 *
 * For isolated pairs, yield comes from:
 * 1. Asset shares: yield = shares × (endExchangeRate - startExchangeRate)
 * 2. Borrow shares: yield = -shares × (endExchangeRate - startExchangeRate) (negative because it's debt)
 * 3. Collateral: no yield (it's just collateral, not earning)
 *
 * Note: This function also returns collateral balances and asset/borrow values for
 * portfolio/exposure calculations, but collateral is NOT included in yield calculations.
 */
export async function calculateIsolatedPairYield(
    context: any,
    user: string,
    pair: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    pair: string;
    assetYield: bigint;
    borrowYield: bigint;
    netYield: bigint;
    startAssetShares: bigint;
    endAssetShares: bigint;
    startBorrowShares: bigint;
    endBorrowShares: bigint;
    startExchangeRate: bigint;
    endExchangeRate: bigint;
    startCollateralBalance: bigint;
    endCollateralBalance: bigint;
    startAssetValue: bigint;
    endAssetValue: bigint;
    startBorrowValue: bigint;
    endBorrowValue: bigint;
}> {
    // Get initial shares, collateral, and exchange rate at start of period
    const [startAssetShares, startBorrowShares, startCollateralBalance, startExchangeRate] = await Promise.all([
        getIsolatedPairAssetShares(context, user, pair, startTimestamp),
        getIsolatedPairBorrowShares(context, user, pair, startTimestamp),
        getIsolatedPairCollateralBalance(context, user, pair, startTimestamp),
        getIsolatedPairExchangeRate(context, pair, startTimestamp)
    ]);

    // Get all events during the period
    const events = await getUserPairEvents(context, user, pair, startTimestamp, endTimestamp);

    // Initialize tracking variables
    let currentAssetShares = startAssetShares;
    let currentBorrowShares = startBorrowShares;
    let currentExchangeRate = startExchangeRate;
    let currentTimestamp = startTimestamp;

    let totalAssetYield = 0n;
    let totalBorrowYield = 0n;

    // Process each event and calculate yield for the segment before it
    for (const event of events) {
        // Calculate exchange rate change since last event
        const exchangeRateChange = event.exchangeRate - currentExchangeRate;

        if (exchangeRateChange !== 0n) {
            // Calculate yield for this segment (from last event to this event)
            // Asset yield (positive - earning interest)
            if (currentAssetShares > 0n) {
                const segmentAssetYield = (currentAssetShares * exchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
                totalAssetYield += segmentAssetYield;
            }

            // Borrow yield (negative - paying interest)
            if (currentBorrowShares > 0n) {
                const segmentBorrowYield = -((currentBorrowShares * exchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION);
                totalBorrowYield += segmentBorrowYield;
            }
        }

        // Update shares based on this event
        currentAssetShares += event.assetSharesDelta;
        currentBorrowShares += event.borrowSharesDelta;
        currentExchangeRate = event.exchangeRate;
        currentTimestamp = event.timestamp;
    }

    // Calculate yield for the final segment (from last event to end of period)
    const endExchangeRate = await getIsolatedPairExchangeRate(context, pair, endTimestamp);
    const finalExchangeRateChange = endExchangeRate - currentExchangeRate;

    if (finalExchangeRateChange !== 0n) {
        // Asset yield for final segment
        if (currentAssetShares > 0n) {
            const finalAssetYield = (currentAssetShares * finalExchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION;
            totalAssetYield += finalAssetYield;
        }

        // Borrow yield for final segment
        if (currentBorrowShares > 0n) {
            const finalBorrowYield = -((currentBorrowShares * finalExchangeRateChange + EXCHANGE_PRECISION / 2n) / EXCHANGE_PRECISION);
            totalBorrowYield += finalBorrowYield;
        }
    }

    // Get final shares and collateral for return value
    const endAssetShares = currentAssetShares;
    const endBorrowShares = currentBorrowShares;
    const endCollateralBalance = await getIsolatedPairCollateralBalance(context, user, pair, endTimestamp);

    // Calculate asset and borrow values at start and end
    const startAssetValue = convertSharesToAssets(startAssetShares, startExchangeRate);
    const endAssetValue = convertSharesToAssets(endAssetShares, endExchangeRate);
    const startBorrowValue = convertSharesToAssets(startBorrowShares, startExchangeRate);
    const endBorrowValue = convertSharesToAssets(endBorrowShares, endExchangeRate);

    // Net yield = asset yield + borrow yield (borrow yield is already negative)
    const netYield = totalAssetYield + totalBorrowYield;

    return {
        pair,
        assetYield: totalAssetYield,
        borrowYield: totalBorrowYield,
        netYield,
        startAssetShares,
        endAssetShares,
        startBorrowShares,
        endBorrowShares,
        startExchangeRate,
        endExchangeRate,
        startCollateralBalance,
        endCollateralBalance,
        startAssetValue,
        endAssetValue,
        startBorrowValue,
        endBorrowValue
    };
}

/**
 * Calculate daily yield for all isolated pairs for a user
 */
export async function calculateDailyIsolatedPairYields(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    date: string;
    timestamp: number;
    dailyYield: bigint;
    pairs: Array<{
        pair: string;
        assetYield: bigint;
        borrowYield: bigint;
        netYield: bigint;
    }>;
}>> {
    // Get all pairs user has interacted with
    const pairs = await getUserIsolatedPairs(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return [];
    }

    const dailyYields: Array<{
        date: string;
        timestamp: number;
        dailyYield: bigint;
        pairs: Array<{
            pair: string;
            assetYield: bigint;
            borrowYield: bigint;
            netYield: bigint;
        }>;
    }> = [];

    // Generate daily timestamps
    const oneDaySeconds = 24 * 60 * 60;
    let currentDayStart = startTimestamp;

    while (currentDayStart < endTimestamp) {
        const currentDayEnd = Math.min(currentDayStart + oneDaySeconds, endTimestamp);

        // Calculate yield for each pair for this day
        const pairYields = await Promise.all(
            pairs.map(pair => calculateIsolatedPairYield(context, user, pair, currentDayStart, currentDayEnd))
        );

        // Filter out pairs with zero yield
        const nonZeroPairYields = pairYields
            .filter(py => py.netYield !== 0n)
            .map(py => ({
                pair: py.pair,
                assetYield: py.assetYield,
                borrowYield: py.borrowYield,
                netYield: py.netYield
            }));

        // Calculate total daily yield
        const dailyYield = pairYields.reduce((sum, py) => sum + py.netYield, 0n);

        dailyYields.push({
            date: new Date(currentDayStart * 1000).toISOString().split('T')[0],
            timestamp: currentDayStart,
            dailyYield,
            pairs: nonZeroPairYields
        });

        currentDayStart = currentDayEnd;
    }

    return dailyYields;
}

/**
 * Calculate monthly yield for all isolated pairs for a user
 */
export async function calculateMonthlyIsolatedPairYields(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    year: number;
    month: number;
    monthName: string;
    startDate: string;
    endDate: string;
    monthlyYield: bigint;
    pairs: Array<{
        pair: string;
        assetYield: bigint;
        borrowYield: bigint;
        netYield: bigint;
    }>;
}>> {
    // Get all pairs user has interacted with
    const pairs = await getUserIsolatedPairs(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return [];
    }

    const monthlyYields: Array<{
        year: number;
        month: number;
        monthName: string;
        startDate: string;
        endDate: string;
        monthlyYield: bigint;
        pairs: Array<{
            pair: string;
            assetYield: bigint;
            borrowYield: bigint;
            netYield: bigint;
        }>;
    }> = [];

    // Generate monthly periods
    const startDate = new Date(startTimestamp * 1000);
    const endDate = new Date(endTimestamp * 1000);

    let currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

    while (currentDate <= endDate) {
        const monthStart = Math.max(Math.floor(currentDate.getTime() / 1000), startTimestamp);

        // Get end of month
        const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        const monthEnd = Math.min(Math.floor(nextMonth.getTime() / 1000), endTimestamp);

        // Calculate yield for each pair for this month
        const pairYields = await Promise.all(
            pairs.map(pair => calculateIsolatedPairYield(context, user, pair, monthStart, monthEnd))
        );

        // Filter out pairs with zero yield
        const nonZeroPairYields = pairYields
            .filter(py => py.netYield !== 0n)
            .map(py => ({
                pair: py.pair,
                assetYield: py.assetYield,
                borrowYield: py.borrowYield,
                netYield: py.netYield
            }));

        // Calculate total monthly yield
        const monthlyYield = pairYields.reduce((sum, py) => sum + py.netYield, 0n);

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];

        monthlyYields.push({
            year: currentDate.getFullYear(),
            month: currentDate.getMonth() + 1,
            monthName: monthNames[currentDate.getMonth()],
            startDate: new Date(monthStart * 1000).toISOString().split('T')[0],
            endDate: new Date(monthEnd * 1000).toISOString().split('T')[0],
            monthlyYield,
            pairs: nonZeroPairYields
        });

        currentDate = nextMonth;
    }

    return monthlyYields;
}

