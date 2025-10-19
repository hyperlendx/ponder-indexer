import { UserBalanceEvent, UserPosition, Borrow, Repay } from "ponder:schema";
import { eq, and, lte, desc, gte } from "ponder";
import { calculateVariableBorrowIndexAtTimestamp } from "../aave/borrowIndex";
import { calculateActualBalance } from "../aave";

/**
 * Get scaled balance at a specific timestamp by looking at balance events
 * Finds the most recent UserBalanceEvent at or before the target timestamp
 * and returns the scaled balance from that event.
 */
export async function getScaledBalanceAtTimestamp(
    context: any,
    user: string,
    asset: string,
    timestamp: number
): Promise<bigint> {
    const { db } = context;

    try {
        // Query for the most recent UserBalanceEvent at or before the target timestamp
        // Use the userAssetIdx and timestampIdx indexes for efficient querying
        const dbQuery = db.sql || db;
        const events = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user as `0x${string}`),
                    eq(UserBalanceEvent.asset, asset as `0x${string}`),
                    lte(UserBalanceEvent.timestamp, timestamp)
                )
            )
            .orderBy(desc(UserBalanceEvent.timestamp))
            .limit(1); // Only need the most recent one

        if (!events || events.length === 0) {
            // No balance events found before the target timestamp
            // This could mean the user had no position at that time
            return 0n;
        }

        const mostRecentEvent = events[0];

        return BigInt(mostRecentEvent.scaledBalance);

    } catch (error) {
        console.error(`❌ Error getting scaled balance at timestamp for user ${user}, asset ${asset}:`, error);
        // Return 0 as fallback to prevent calculation errors
        return 0n;
    }
}

/**
 * Helper function to get all assets where a user had non-zero scaled balance at a specific timestamp
 */
export async function getAssetsWithBalanceAtTimestamp(
    context: any,
    user: string,
    timestamp: number
): Promise<string[]> {
    const { db } = context;
    const assetsWithBalance: string[] = [];

    try {
        // Get all unique assets this user has ever interacted with from TWO sources:

        // 1. From UserBalanceEvent records
        const dbQuery = db.sql || db;
        const allUserEvents = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(eq(UserBalanceEvent.user, user as `0x${string}`));

        // 2. From current UserPosition records
        const currentPositions = await dbQuery
            .select()
            .from(UserPosition)
            .where(eq(UserPosition.user, user as `0x${string}`));

        // Combine unique asset addresses from both sources
        const assetsFromEvents = new Set(allUserEvents.map((event: any) => event.asset));
        const assetsFromPositions = new Set(currentPositions.map((position: any) => position.asset));

        const uniqueAssets = [...new Set([...assetsFromEvents, ...assetsFromPositions])];

        // For each asset, check if user had non-zero balance at the timestamp
        for (const asset of uniqueAssets) {
            // @ts-ignore
            const scaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, timestamp);
            if (scaledBalance > 0n) {
                // @ts-ignore
                assetsWithBalance.push(asset);
            }
        }

        return assetsWithBalance;

    } catch (error) {
        console.error(`❌ Error getting assets with balance at timestamp:`, error);
        return [];
    }
}

/**
 * Get all unique assets that a user had positions in during a specific month
 * This looks at what positions were active at the start of the month, plus any new positions opened during the month
 */
export async function getUserAssetsForMonth(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const { db } = context;

    try {
        const assetsWithPositions = new Set<string>();

        // 1. Find all assets where user had non-zero scaled balance at the START of the month
        // This catches existing positions that were already open
        const startOfMonthAssets = await getAssetsWithBalanceAtTimestamp(context, user, startTimestamp);
        startOfMonthAssets.forEach(asset => {
            assetsWithPositions.add(asset);
        });

        // 2. Find all assets where user had balance events DURING the month
        // This catches new positions opened during the month
        const dbQuery = db.sql || db;
        const eventsThisMonth = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user as `0x${string}`),
                    gte(UserBalanceEvent.timestamp, startTimestamp),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            );

        eventsThisMonth.forEach((event: any) => {
            assetsWithPositions.add(event.asset);
        });

        return Array.from(assetsWithPositions);

    } catch (error) {
        console.error(`❌ Error getting user assets for month:`, error);
        return [];
    }
}

/**
 * Get all assets a user had positions in during a custom time period
 * Similar to getUserAssetsForMonth but for arbitrary date ranges
 */
export async function getUserAssetsForPeriod(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const { db } = context;

    try {
        const assetsWithPositions = new Set<string>();

        // 1. Find all assets where user had non-zero scaled balance at the START of the period
        // This catches existing positions that were already open
        const startOfPeriodAssets = await getAssetsWithBalanceAtTimestamp(context, user, startTimestamp);
        startOfPeriodAssets.forEach(asset => {
            assetsWithPositions.add(asset);
        });

        // 2. Find all assets where user had balance events DURING the period
        // This catches new positions opened during the period
        const dbQuery = db.sql || db;
        const eventsThisPeriod = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user as `0x${string}`),
                    gte(UserBalanceEvent.timestamp, startTimestamp),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            );

        eventsThisPeriod.forEach((event: any) => {
            assetsWithPositions.add(event.asset);
        });

        return Array.from(assetsWithPositions);

    } catch (error) {
        console.error(`❌ Error getting user assets for custom period:`, error);
        return [];
    }
}

/**
 * Get the maximum scaled balance the user had during the month
 * This helps explain yield when start/end balances are 0
 */
export async function getMaxBalanceDuringMonth(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const { db } = context;

    try {
        const dbQuery = db.sql || db;
        const events = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user as `0x${string}`),
                    eq(UserBalanceEvent.asset, asset as `0x${string}`),
                    gte(UserBalanceEvent.timestamp, startTimestamp),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            );

        // Include start balance
        const startBalance = await getScaledBalanceAtTimestamp(context, user, asset, startTimestamp);
        // @ts-ignore
        const allBalances = [startBalance, ...events.map(e => BigInt(e.scaledBalance))];

        return allBalances.reduce((max, current) => current > max ? current : max, 0n);

    } catch (error) {
        console.error(`Error getting max balance during month:`, error);
        return 0n;
    }
}

/**
 * Get maximum balance during a custom period
 * Adapts the monthly version for arbitrary date ranges
 */
export async function getMaxBalanceDuringPeriod(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const { db } = context;

    try {
        const dbQuery = db.sql || db;
        const events = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, user as `0x${string}`),
                    eq(UserBalanceEvent.asset, asset as `0x${string}`),
                    gte(UserBalanceEvent.timestamp, startTimestamp),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            );

        // Include start balance
        const startBalance = await getScaledBalanceAtTimestamp(context, user, asset, startTimestamp);
        // @ts-ignore
        const allBalances = [startBalance, ...events.map(e => BigInt(e.scaledBalance))];

        return allBalances.reduce((max, current) => current > max ? current : max, 0n);

    } catch (error) {
        console.error(`Error getting max balance during custom period:`, error);
        return 0n;
    }
}

/**
 * Get maximum borrow balance during a custom period
 * Similar to getMaxBalanceDuringPeriod but for borrows
 */
export async function getMaxBorrowBalanceDuringPeriod(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<bigint> {
    const { db } = context;

    try {
        const { Borrow, Repay } = await import("ponder:schema");
        const dbQuery = db.sql || db;

        // Get all borrow and repay events during the period
        const [borrowEvents, repayEvents] = await Promise.all([
            dbQuery
                .select()
                .from(Borrow)
                .where(
                    and(
                        eq(Borrow.onBehalfOf, user as `0x${string}`),
                        eq(Borrow.reserve, asset as `0x${string}`),
                        gte(Borrow.timestamp, startTimestamp),
                        lte(Borrow.timestamp, endTimestamp)
                    )
                ),
            dbQuery
                .select()
                .from(Repay)
                .where(
                    and(
                        eq(Repay.user, user as `0x${string}`),
                        eq(Repay.reserve, asset as `0x${string}`),
                        gte(Repay.timestamp, startTimestamp),
                        lte(Repay.timestamp, endTimestamp)
                    )
                )
        ]);

        // Get starting borrow balance
        const startBorrowBalance = await getScaledBorrowBalanceAtTimestamp(context, user, asset, startTimestamp);

        // Track all borrow balance snapshots
        const borrowBalances: bigint[] = [startBorrowBalance];

        // Combine and sort all events by timestamp
        const allEvents = [
            ...borrowEvents.map((e: any) => ({ timestamp: e.timestamp, amount: e.amount, type: 'borrow' })),
            ...repayEvents.map((e: any) => ({ timestamp: e.timestamp, amount: e.amount, type: 'repay' }))
        ].sort((a, b) => a.timestamp - b.timestamp);

        // Calculate running balance after each event
        let currentBalance = startBorrowBalance;
        for (const event of allEvents) {
            if (event.type === 'borrow') {
                currentBalance += event.amount;
            } else {
                currentBalance -= event.amount;
            }
            borrowBalances.push(currentBalance > 0n ? currentBalance : 0n);
        }

        // Return maximum
        return borrowBalances.reduce((max, current) => current > max ? current : max, 0n);

    } catch (error) {
        console.error(`Error getting max borrow balance during custom period:`, error);
        return 0n;
    }
}




/**
 * Get scaled borrow balance at a specific timestamp
 * Returns the SCALED balance (constant value before applying borrow index)
 * Similar to getScaledBalanceAtTimestamp but for borrows
 *
 * Algorithm:
 * 1. Get all borrow events up to the timestamp
 * 2. Get all repay events up to the timestamp
 * 3. Calculate: scaledBorrowBalance = Σ(borrows) - Σ(repays)
 */
export async function getScaledBorrowBalanceAtTimestamp(
    context: any,
    user: string,
    asset: string,
    timestamp: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const { Borrow, Repay } = await import("ponder:schema");

        // Get all borrow events up to timestamp
        const borrowEvents = await dbQuery
            .select()
            .from(Borrow)
            .where(
                and(
                    eq(Borrow.onBehalfOf, user as `0x${string}`),
                    eq(Borrow.reserve, asset as `0x${string}`),
                    lte(Borrow.timestamp, timestamp)
                )
            );

        // Get all repay events up to timestamp
        const repayEvents = await dbQuery
            .select()
            .from(Repay)
            .where(
                and(
                    eq(Repay.user, user as `0x${string}`),
                    eq(Repay.reserve, asset as `0x${string}`),
                    lte(Repay.timestamp, timestamp)
                )
            );

        // Calculate scaled borrow balance
        let scaledBorrowBalance = 0n;

        for (const event of borrowEvents) {
            scaledBorrowBalance += event.amount;
        }

        for (const event of repayEvents) {
            scaledBorrowBalance -= event.amount;
        }

        return scaledBorrowBalance > 0n ? scaledBorrowBalance : 0n;

    } catch (error) {
        console.error(`❌ Error getting scaled borrow balance at timestamp for user ${user}, asset ${asset}:`, error);
        return 0n;
    }
}

/**
 * Get borrowed balance at a specific timestamp with accrued interest
 *
 * This function properly calculates the borrowed amount including accrued interest
 * by using the variable borrow index, following AAVE's methodology.
 *
 * Algorithm:
 * 1. Get all borrow and repay events up to the timestamp
 * 2. Calculate scaled borrow balance (constant value)
 * 3. Get variable borrow index at the target timestamp
 * 4. Calculate actual borrowed amount: scaledBorrow * variableBorrowIndex / RAY
 *
 * Note: In AAVE, borrow amounts are stored as scaled values and grow over time
 * through the increasing variableBorrowIndex, similar to how supply balances work.
 */
export async function getBorrowedBalanceAtTimestamp(
    context: any,
    user: string,
    asset: string,
    timestamp: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        // Get all borrow events up to timestamp
        const borrowEvents = await dbQuery
            .select()
            .from(Borrow)
            .where(
                and(
                    eq(Borrow.onBehalfOf, user as `0x${string}`),
                    eq(Borrow.reserve, asset as `0x${string}`),
                    lte(Borrow.timestamp, timestamp)
                )
            );

        // Get all repay events up to timestamp
        const repayEvents = await dbQuery
            .select()
            .from(Repay)
            .where(
                and(
                    eq(Repay.user, user as `0x${string}`),
                    eq(Repay.reserve, asset as `0x${string}`),
                    lte(Repay.timestamp, timestamp)
                )
            );

        // Calculate scaled borrow balance
        // In AAVE, borrow amounts are stored as scaled values (constant)
        // The actual borrowed amount grows over time via the variableBorrowIndex
        let scaledBorrowBalance = 0n;

        for (const event of borrowEvents) {
            scaledBorrowBalance += event.amount;
        }

        for (const event of repayEvents) {
            scaledBorrowBalance -= event.amount;
        }

        // If no net borrowed amount, return 0
        if (scaledBorrowBalance <= 0n) {
            return 0n;
        }

        // Get the variable borrow index at the target timestamp
        const variableBorrowIndex = await calculateVariableBorrowIndexAtTimestamp(
            context,
            asset,
            timestamp
        );

        // Calculate actual borrowed amount with accrued interest
        // Formula: actualBorrow = scaledBorrow * variableBorrowIndex / RAY
        const actualBorrowedBalance = calculateActualBalance(
            scaledBorrowBalance,
            variableBorrowIndex
        );

        return actualBorrowedBalance > 0n ? actualBorrowedBalance : 0n;

    } catch (error) {
        console.error(`❌ Error calculating borrowed balance at timestamp for user ${user}, asset ${asset}:`, error);
        // Return 0 as fallback to prevent calculation errors
        return 0n;
    }
}

/**
 * Get all assets a user has borrowed during a time period
 * Returns unique asset addresses where user had borrow positions
 *
 * This function checks:
 * 1. Assets with non-zero borrow balance at START of period (existing borrows)
 * 2. Assets with borrow/repay events DURING the period (new borrows or activity)
 *
 */
export async function getUserBorrowedAssets(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        const assetsWithBorrows = new Set<string>();

        // 1. Find all assets where user had non-zero borrow balance at START of period
        // This catches existing borrows that were already open
        const borrowEventsBeforeStart = await dbQuery
            .select()
            .from(Borrow)
            .where(
                and(
                    eq(Borrow.onBehalfOf, user as `0x${string}`),
                    lte(Borrow.timestamp, startTimestamp)
                )
            );

        const repayEventsBeforeStart = await dbQuery
            .select()
            .from(Repay)
            .where(
                and(
                    eq(Repay.user, user as `0x${string}`),
                    lte(Repay.timestamp, startTimestamp)
                )
            );

        // Calculate which assets had non-zero borrow balance at start
        const borrowBalancesAtStart = new Map<string, bigint>();

        for (const event of borrowEventsBeforeStart) {
            const current = borrowBalancesAtStart.get(event.reserve) || 0n;
            borrowBalancesAtStart.set(event.reserve, current + event.amount);
        }

        for (const event of repayEventsBeforeStart) {
            const current = borrowBalancesAtStart.get(event.reserve) || 0n;
            borrowBalancesAtStart.set(event.reserve, current - event.amount);
        }

        // Add assets with non-zero borrow balance at start
        for (const [asset, balance] of borrowBalancesAtStart.entries()) {
            if (balance > 0n) {
                assetsWithBorrows.add(asset);
            }
        }

        // 2. Find all assets with borrow/repay events DURING the period
        const borrowEventsDuringPeriod = await dbQuery
            .select()
            .from(Borrow)
            .where(
                and(
                    eq(Borrow.onBehalfOf, user as `0x${string}`),
                    gte(Borrow.timestamp, startTimestamp),
                    lte(Borrow.timestamp, endTimestamp)
                )
            );

        const repayEventsDuringPeriod = await dbQuery
            .select()
            .from(Repay)
            .where(
                and(
                    eq(Repay.user, user as `0x${string}`),
                    gte(Repay.timestamp, startTimestamp),
                    lte(Repay.timestamp, endTimestamp)
                )
            );

        // Add assets with activity during period
        for (const event of borrowEventsDuringPeriod) {
            assetsWithBorrows.add(event.reserve);
        }
        for (const event of repayEventsDuringPeriod) {
            assetsWithBorrows.add(event.reserve);
        }

        return Array.from(assetsWithBorrows);

    } catch (error) {
        console.error(`❌ Error getting user borrowed assets for period:`, error);
        return [];
    }
}
