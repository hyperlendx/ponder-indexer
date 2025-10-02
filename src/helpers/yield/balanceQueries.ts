import { UserBalanceEvent, UserPosition, Borrow, Repay } from "ponder:schema";
import { eq, and, lte, desc, gte } from "ponder";

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
            console.log(`✅ Found existing position at period start: ${asset}`);
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
 * Get borrowed balance at a specific timestamp
 * Calculates net borrowed amount (total borrows - total repays) up to the timestamp
 */
export async function getBorrowedBalanceAtTimestamp(
    context: any,
    user: string,
    asset: string,
    timestamp: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

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

    // Calculate net borrowed amount
    let totalBorrowed = 0n;
    for (const event of borrowEvents) {
        totalBorrowed += event.amount;
    }

    let totalRepaid = 0n;
    for (const event of repayEvents) {
        totalRepaid += event.amount;
    }

    const netBorrowed = totalBorrowed - totalRepaid;
    return netBorrowed > 0n ? netBorrowed : 0n;
}

/**
 * Get all assets a user has borrowed during a time period
 * Returns unique asset addresses where user had borrow activity
 */
export async function getUserBorrowedAssets(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const { db } = context;
    const dbQuery = db.sql || db;

    // Get all borrow events in the period
    const borrowEvents = await dbQuery
        .select()
        .from(Borrow)
        .where(
            and(
                eq(Borrow.onBehalfOf, user as `0x${string}`),
                gte(Borrow.timestamp, startTimestamp),
                lte(Borrow.timestamp, endTimestamp)
            )
        );

    // Get all repay events in the period
    const repayEvents = await dbQuery
        .select()
        .from(Repay)
        .where(
            and(
                eq(Repay.user, user as `0x${string}`),
                gte(Repay.timestamp, startTimestamp),
                lte(Repay.timestamp, endTimestamp)
            )
        );

    // Collect unique assets
    const assetSet = new Set<string>();
    for (const event of borrowEvents) {
        assetSet.add(event.reserve);
    }
    for (const event of repayEvents) {
        assetSet.add(event.reserve);
    }

    return Array.from(assetSet);
}
