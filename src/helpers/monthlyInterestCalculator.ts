import { UserBalanceEvent, UserPosition } from "ponder:schema";
import {
    getMonthTimestamps,
    calculateLiquidityIndexAtTimestamp,
    calculateActualBalance
} from "./interestCalculations";
import { calculateNetDeposits } from "./userPositionManager";
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
        console.log(`🔍 Querying UserBalanceEvent for user ${user}, asset ${asset}, target timestamp: ${timestamp}`);

        // Handle both indexing context (db.sql) and API context (db)
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

        console.log(`📊 Found ${events.length} balance events before target timestamp`);

        if (!events || events.length === 0) {
            // No balance events found before the target timestamp
            // This could mean the user had no position at that time
            console.log(`⚠️ No balance events found for user ${user}, asset ${asset} before timestamp ${timestamp}`);
            return 0n;
        }

        const mostRecentEvent = events[0];
        console.log(`✅ Found balance event at timestamp ${mostRecentEvent.timestamp}, scaled balance: ${mostRecentEvent.scaledBalance.toString()}`);

        return BigInt(mostRecentEvent.scaledBalance);

    } catch (error) {
        console.error(`❌ Error getting scaled balance at timestamp for user ${user}, asset ${asset}:`, error);
        // Return 0 as fallback to prevent calculation errors
        return 0n;
    }
}

/**
 * Get all unique assets that a user had positions in during a specific month
 * This looks at what positions were active at the start of the month, plus any new positions opened during the month
 */
async function getUserAssetsForMonth(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const { db } = context;

    try {
        const assetsWithPositions = new Set<string>();

        console.log(`🔍 Finding assets for ${user} during month:`);
        console.log(`📅 Period: ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);

        // 1. Find all assets where user had non-zero scaled balance at the START of the month
        // This catches existing positions that were already open
        const startOfMonthAssets = await getAssetsWithBalanceAtTimestamp(context, user, startTimestamp);
        startOfMonthAssets.forEach(asset => {
            assetsWithPositions.add(asset);
            console.log(`✅ Found existing position at month start: ${asset}`);
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
            console.log(`✅ Found activity during month: ${event.asset}`);
        });

        console.log(`📊 Total unique assets found: ${assetsWithPositions.size}`);
        console.log(`📊 Assets: [${Array.from(assetsWithPositions).join(', ')}]`);

        return Array.from(assetsWithPositions);

    } catch (error) {
        console.error(`❌ Error getting user assets for month:`, error);
        return [];
    }
}

/**
 * Helper function to get all assets where a user had non-zero scaled balance at a specific timestamp
 */
async function getAssetsWithBalanceAtTimestamp(
    context: any,
    user: string,
    timestamp: number
): Promise<string[]> {
    const { db } = context;
    const assetsWithBalance: string[] = [];

    try {
        // Get all unique assets this user has ever interacted with from TWO sources:

        // 1. From UserBalanceEvent records
        console.log(`🔍 Querying UserBalanceEvent for user: ${user}`);
        const dbQuery = db.sql || db;
        const allUserEvents = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(eq(UserBalanceEvent.user, user as `0x${string}`));

        console.log(`📊 Found ${allUserEvents.length} events in UserBalanceEvent table`);

        // 2. From current UserPosition records
        console.log(`🔍 Querying UserPosition for user: ${user}`);
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
            console.log(`🔍 Checking ${asset} at timestamp ${timestamp}: balance = ${scaledBalance.toString()}`);
            if (scaledBalance > 0n) {
                // @ts-ignore
                assetsWithBalance.push(asset);
                console.log(`✅ Asset ${asset} had balance ${scaledBalance.toString()} at timestamp ${timestamp}`);
            }
        }

        return assetsWithBalance;

    } catch (error) {
        console.error(`❌ Error getting assets with balance at timestamp:`, error);
        return [];
    }
}

/**
 * Enhanced monthly yield calculation that handles intra-month positions
 * Breaks down the month into segments based on balance changes and calculates interest for each segment
 *
 * Algorithm:
 * 1. Get all balance events during the month
 * 2. Create time segments: [monthStart, event1, event2, ..., monthEnd]
 * 3. For each segment, calculate: (scaledBalance * liquidityIndexGrowth)
 * 4. Sum interest from all segments
 */
async function calculateSegmentedMonthlyYield(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    totalYield: bigint;
    segments: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        scaledBalance: bigint;
        actualBalance: bigint;
        startLiquidityIndex: bigint;
        endLiquidityIndex: bigint;
        segmentYield: bigint;
        durationDays: number;
    }>;
}> {
    console.log(`🔧 Enhanced yield calculation for ${asset}`);

    // Get all balance events during the month, ordered chronologically
    const dbQuery = context.db.sql || context.db;
    const monthlyEvents = await dbQuery
        .select()
        .from(UserBalanceEvent)
        .where(
            and(
                eq(UserBalanceEvent.user, user as `0x${string}`),
                eq(UserBalanceEvent.asset, asset as `0x${string}`),
                gte(UserBalanceEvent.timestamp, startTimestamp),
                lte(UserBalanceEvent.timestamp, endTimestamp)
            )
        )
        .orderBy(UserBalanceEvent.timestamp);

    console.log(`📊 Found ${monthlyEvents.length} balance events during month`);

    // Create time segments for interest calculation
    const segments = await createTimeSegments(context, user, asset, startTimestamp, endTimestamp, monthlyEvents);

    console.log(`📊 Created ${segments.length} time segments`);

    // Calculate interest for each segment and collect detailed information
    let totalInterest = 0n;
    const detailedSegments = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) continue; // Skip if segment is undefined

        const segmentInterest = await calculateSegmentInterest(context, asset, segment);
        totalInterest += segmentInterest;

        // Get liquidity indices for this segment
        const startLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime);
        const endLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime);

        const actualBalance = calculateActualBalance(segment.scaledBalance, startLiquidityIndex);
        const durationDays = (segment.endTime - segment.startTime) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: segment.startTime,
            endTime: segment.endTime,
            startDate: new Date(segment.startTime * 1000).toISOString(),
            endDate: new Date(segment.endTime * 1000).toISOString(),
            scaledBalance: segment.scaledBalance,
            actualBalance,
            startLiquidityIndex,
            endLiquidityIndex,
            segmentYield: segmentInterest,
            durationDays: Math.round(durationDays * 100) / 100 // Round to 2 decimal places
        });

        console.log(`📊 Segment ${i + 1}: ${new Date(segment.startTime * 1000).toISOString()} to ${new Date(segment.endTime * 1000).toISOString()}`);
        console.log(`   Balance: ${segment.scaledBalance.toString()}, Interest: ${segmentInterest.toString()}`);
    }

    console.log(`💰 Total segmented interest: ${totalInterest.toString()}`);
    return {
        totalYield: totalInterest,
        segments: detailedSegments
    };
}

/**
 * Create time segments based on balance events
 */
async function createTimeSegments(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number,
    events: any[]
): Promise<Array<{
    startTime: number;
    endTime: number;
    scaledBalance: bigint;
}>> {
    const segments = [];

    // Start with balance at beginning of month
    let currentTime = startTimestamp;
    let currentBalance = await getScaledBalanceAtTimestamp(context, user, asset, startTimestamp);

    // Create segments between events
    for (const event of events) {
        if (event.timestamp > currentTime) {
            // Create segment from currentTime to event.timestamp
            segments.push({
                startTime: currentTime,
                endTime: event.timestamp,
                scaledBalance: currentBalance
            });

            currentTime = event.timestamp;
        }

        // Update balance after this event
        currentBalance = event.scaledBalance;
    }

    // Create final segment from last event to end of month
    if (currentTime < endTimestamp) {
        segments.push({
            startTime: currentTime,
            endTime: endTimestamp,
            scaledBalance: currentBalance
        });
    }

    return segments;
}

/**
 * Get the maximum scaled balance the user had during the month
 * This helps explain yield when start/end balances are 0
 */
async function getMaxBalanceDuringMonth(
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
 * Get all assets a user had positions in during a custom time period
 * Similar to getUserAssetsForMonth but for arbitrary date ranges
 */
async function getUserAssetsForPeriod(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<string[]> {
    const { db } = context;

    try {
        const assetsWithPositions = new Set<string>();

        console.log(`🔍 Finding assets for ${user} during custom period:`);
        console.log(`📅 Period: ${new Date(startTimestamp * 1000).toISOString()} to ${new Date(endTimestamp * 1000).toISOString()}`);

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
            console.log(`✅ Found activity during period: ${event.asset}`);
        });

        console.log(`📊 Total unique assets found: ${assetsWithPositions.size}`);
        console.log(`📊 Assets: [${Array.from(assetsWithPositions).join(', ')}]`);

        return Array.from(assetsWithPositions);

    } catch (error) {
        console.error(`❌ Error getting user assets for custom period:`, error);
        return [];
    }
}

/**
 * Enhanced custom period yield calculation that handles intra-period positions
 * Adapts the monthly segmented calculation for arbitrary date ranges
 */
async function calculateSegmentedCustomPeriodYield(
    context: any,
    user: string,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    totalYield: bigint;
    segments: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        scaledBalance: bigint;
        actualBalance: bigint;
        startLiquidityIndex: bigint;
        endLiquidityIndex: bigint;
        segmentYield: bigint;
        durationDays: number;
    }>;
}> {
    console.log(`🔧 Enhanced yield calculation for ${asset} over custom period`);

    // Get all balance events during the period, ordered chronologically
    const dbQuery = context.db.sql || context.db;
    const periodEvents = await dbQuery
        .select()
        .from(UserBalanceEvent)
        .where(
            and(
                eq(UserBalanceEvent.user, user as `0x${string}`),
                eq(UserBalanceEvent.asset, asset as `0x${string}`),
                gte(UserBalanceEvent.timestamp, startTimestamp),
                lte(UserBalanceEvent.timestamp, endTimestamp)
            )
        )
        .orderBy(UserBalanceEvent.timestamp);

    console.log(`📊 Found ${periodEvents.length} balance events during custom period`);

    // Create time segments for interest calculation
    const segments = await createTimeSegments(context, user, asset, startTimestamp, endTimestamp, periodEvents);

    console.log(`📊 Created ${segments.length} time segments`);

    // Calculate interest for each segment and collect detailed information
    let totalInterest = 0n;
    const detailedSegments = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        if (!segment) continue; // Skip if segment is undefined

        const segmentInterest = await calculateSegmentInterest(context, asset, segment);
        totalInterest += segmentInterest;

        // Get liquidity indices for this segment
        const startLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime);
        const endLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime);

        const actualBalance = calculateActualBalance(segment.scaledBalance, startLiquidityIndex);
        const durationDays = (segment.endTime - segment.startTime) / (24 * 60 * 60);

        detailedSegments.push({
            startTime: segment.startTime,
            endTime: segment.endTime,
            startDate: new Date(segment.startTime * 1000).toISOString(),
            endDate: new Date(segment.endTime * 1000).toISOString(),
            scaledBalance: segment.scaledBalance,
            actualBalance,
            startLiquidityIndex,
            endLiquidityIndex,
            segmentYield: segmentInterest,
            durationDays: Math.round(durationDays * 100) / 100 // Round to 2 decimal places
        });

        console.log(`📊 Segment ${i + 1}: ${new Date(segment.startTime * 1000).toISOString()} to ${new Date(segment.endTime * 1000).toISOString()}`);
        console.log(`   Balance: ${segment.scaledBalance.toString()}, Interest: ${segmentInterest.toString()}`);
    }

    console.log(`💰 Total segmented interest: ${totalInterest.toString()}`);
    return {
        totalYield: totalInterest,
        segments: detailedSegments
    };
}

/**
 * Get maximum balance during a custom period
 * Adapts the monthly version for arbitrary date ranges
 */
async function getMaxBalanceDuringPeriod(
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
 * Calculate interest earned in a specific time segment
 */
async function calculateSegmentInterest(
    context: any,
    asset: string,
    segment: {
        startTime: number;
        endTime: number;
        scaledBalance: bigint;
    }
): Promise<bigint> {
    if (segment.scaledBalance === 0n || segment.startTime >= segment.endTime) {
        return 0n;
    }

    // Get liquidity indices at segment boundaries
    const startIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.startTime);
    const endIndex = await calculateLiquidityIndexAtTimestamp(context, asset, segment.endTime);

    // Calculate actual balances
    const startActualBalance = calculateActualBalance(segment.scaledBalance, startIndex);
    const endActualBalance = calculateActualBalance(segment.scaledBalance, endIndex);

    // Interest earned = growth in actual balance (no deposits/withdrawals in this segment)
    const interest = endActualBalance - startActualBalance;

    return interest;
}

/**
 * Calculate yield data for a specific user over a custom time period
 * Returns yield data for all assets the user had positions in during that period
 * Uses the same calculation logic as monthly yield but for arbitrary date ranges
 */
export async function calculateUserCustomPeriodYield(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<Array<{
    user: string;
    asset: string;
    periodYield: bigint;
    startScaledBalance: bigint;
    endScaledBalance: bigint;
    startActualBalance: bigint;
    endActualBalance: bigint;
    startLiquidityIndex: bigint;
    endLiquidityIndex: bigint;
    netDeposits: bigint;
    startTimestamp: number;
    endTimestamp: number;
    hadPositionDuringPeriod: boolean;
    maxBalanceDuringPeriod: bigint;
    transactionCount: number;
    segments?: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        scaledBalance: bigint;
        actualBalance: bigint;
        startLiquidityIndex: bigint;
        endLiquidityIndex: bigint;
        segmentYield: bigint;
        durationDays: number;
    }>;
}>> {
    try {
        console.log(`📅 Calculating custom period yield for ${user} from ${startTimestamp} to ${endTimestamp}`);

        // Get all assets user had positions in during this period
        const assets = await getUserAssetsForPeriod(context, user, startTimestamp, endTimestamp);
        console.log(`🎯 Found ${assets.length} assets for user ${user} in custom period:`, assets);

        if (assets.length === 0) {
            return [];
        }

        const results = [];

        for (const asset of assets) {
            try {
                // Get scaled balances at period boundaries
                const startScaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, startTimestamp);
                const endScaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, endTimestamp);

                // Get liquidity indices at period boundaries
                const startLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, startTimestamp);
                const endLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, endTimestamp);

                // Calculate actual balances
                const startActualBalance = calculateActualBalance(startScaledBalance, startLiquidityIndex);
                const endActualBalance = calculateActualBalance(endScaledBalance, endLiquidityIndex);

                // Get period events for this asset to calculate additional metrics
                const dbQuery = context.db.sql || context.db;
                const periodEvents = await dbQuery
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

                // Calculate net deposits during the period
                const netDeposits = await calculateNetDeposits(context, user, asset, startTimestamp, endTimestamp);

                // Enhanced calculation: Handle intra-period positions
                const segmentedResult = await calculateSegmentedCustomPeriodYield(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestamp
                );

                const periodYield = segmentedResult.totalYield;
                const segments = segmentedResult.segments;

                // Calculate additional metrics for better understanding
                const hadPositionDuringPeriod = periodEvents.length > 0 || startScaledBalance > 0n;
                const maxBalanceDuringPeriod = await getMaxBalanceDuringPeriod(context, user, asset, startTimestamp, endTimestamp);

                results.push({
                    user,
                    asset,
                    periodYield,
                    startScaledBalance,
                    endScaledBalance,
                    startActualBalance,
                    endActualBalance,
                    startLiquidityIndex,
                    endLiquidityIndex,
                    netDeposits,
                    startTimestamp,
                    endTimestamp,
                    // Additional context fields
                    hadPositionDuringPeriod,
                    maxBalanceDuringPeriod,
                    transactionCount: periodEvents.length,
                    // Detailed segment information
                    segments
                });

                console.log(`✅ Calculated yield for ${asset}: ${periodYield.toString()}`);

            } catch (error) {
                console.error(`❌ Error calculating yield for asset ${asset}:`, error);
                // Continue with other assets even if one fails
            }
        }

        console.log(`📊 Completed custom period yield calculation for ${user}. Found ${results.length} assets with data.`);
        return results;

    } catch (error) {
        console.error(`❌ Error in calculateUserCustomPeriodYield for user ${user}:`, error);
        throw error;
    }
}

/**
 * Calculate monthly yield data for a specific user and month
 * Returns yield data for all assets the user had positions in during that month
 */
export async function calculateUserMonthlyYield(
    context: any,
    user: string,
    year: number,
    month: number
): Promise<Array<{
    user: string;
    asset: string;
    year: number;
    month: number;
    monthlyYield: bigint;
    startScaledBalance: bigint;
    endScaledBalance: bigint;
    startActualBalance: bigint;
    endActualBalance: bigint;
    startLiquidityIndex: bigint;
    endLiquidityIndex: bigint;
    netDeposits: bigint;
    startTimestamp: number;
    endTimestamp: number;
    hadPositionDuringMonth: boolean;
    maxBalanceDuringMonth: bigint;
    transactionCount: number;
    segments?: Array<{
        startTime: number;
        endTime: number;
        startDate: string;
        endDate: string;
        scaledBalance: bigint;
        actualBalance: bigint;
        startLiquidityIndex: bigint;
        endLiquidityIndex: bigint;
        segmentYield: bigint;
        durationDays: number;
    }>;
}>> {
    try {
        // Get month boundaries
        const { startTimestamp, endTimestamp } = getMonthTimestamps(year, month);
        console.log(`📅 Calculating monthly yield for ${user} for ${year}-${month} (${startTimestamp} to ${endTimestamp})`);

        // Get all assets user had positions in during this month
        const assets = await getUserAssetsForMonth(context, user, startTimestamp, endTimestamp);
        console.log(`🎯 Found ${assets.length} assets for user ${user} in ${year}-${month}:`, assets);

        if (assets.length === 0) {
            return [];
        }

        const results = [];

        for (const asset of assets) {
            try {
                // Get scaled balances at month boundaries
                const startScaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, startTimestamp);
                const endScaledBalance = await getScaledBalanceAtTimestamp(context, user, asset, endTimestamp);

                // Get liquidity indices at month boundaries
                const startLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, startTimestamp);
                const endLiquidityIndex = await calculateLiquidityIndexAtTimestamp(context, asset, endTimestamp);

                // Calculate actual balances
                const startActualBalance = calculateActualBalance(startScaledBalance, startLiquidityIndex);
                const endActualBalance = calculateActualBalance(endScaledBalance, endLiquidityIndex);

                // Get monthly events for this asset to calculate additional metrics
                const dbQuery = context.db.sql || context.db;
                const monthlyEvents = await dbQuery
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

                // Calculate net deposits during the month
                const netDeposits = await calculateNetDeposits(context, user, asset, startTimestamp, endTimestamp);

                // Enhanced calculation: Handle intra-month positions
                const segmentedResult = await calculateSegmentedMonthlyYield(
                    context,
                    user,
                    asset,
                    startTimestamp,
                    endTimestamp
                );

                const monthlyYield = segmentedResult.totalYield;
                const segments = segmentedResult.segments;

                // Calculate additional metrics for better understanding
                const hadPositionDuringMonth = monthlyEvents.length > 0 || startScaledBalance > 0n;
                const maxBalanceDuringMonth = await getMaxBalanceDuringMonth(context, user, asset, startTimestamp, endTimestamp);

                results.push({
                    user,
                    asset,
                    year,
                    month,
                    monthlyYield,
                    startScaledBalance,
                    endScaledBalance,
                    startActualBalance,
                    endActualBalance,
                    startLiquidityIndex,
                    endLiquidityIndex,
                    netDeposits,
                    startTimestamp,
                    endTimestamp,
                    // Additional context fields
                    hadPositionDuringMonth,
                    maxBalanceDuringMonth,
                    transactionCount: monthlyEvents.length,
                    // Detailed segment information
                    segments
                });

            } catch (error) {
                console.error(`❌ Error calculating yield for asset ${asset}:`, error);
                // Continue with other assets even if one fails
            }
        }

        return results;

    } catch (error) {
        console.error(`❌ Error calculating monthly yield for user ${user}:`, error);
        return [];
    }
}
