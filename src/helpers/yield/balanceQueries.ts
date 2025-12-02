import { UserBalanceEvent, UserPosition, Borrow, Repay, LiquidationCall, Supply, Withdraw } from "ponder:schema";
import { eq, and, lte, desc, gte } from "ponder";

/**
 * Enhanced balance result that includes both balance and contributing events
 */
export interface BalanceWithEvents {
    balance: bigint;
    events: Array<{
        eventType: 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out' | 'borrow' | 'repay';
        timestamp: number;
        date: string;
        amount: string;
        txHash: string;
        assetPrice?: string; // Oracle price of the asset at the time of the event
    }>;
}

/**
 * Get scaled balance at a specific timestamp by looking at balance events
 * Finds the most recent UserBalanceEvent at or before the target timestamp
 * and returns the scaled balance from that event.
 *
 * IMPORTANT: This function now accounts for liquidations. When a user's collateral
 * is liquidated, the liquidatedCollateralAmount is subtracted from their balance.
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
        let scaledBalance = BigInt(mostRecentEvent.scaledBalance);

        // Account for liquidations: subtract liquidated collateral amounts
        // Query all liquidations where this user's collateral (this asset) was liquidated
        const liquidations = await dbQuery
            .select()
            .from(LiquidationCall)
            .where(
                and(
                    eq(LiquidationCall.user, user as `0x${string}`),
                    eq(LiquidationCall.collateralAsset, asset as `0x${string}`),
                    lte(LiquidationCall.timestamp, timestamp)
                )
            );

        // Subtract liquidated collateral amounts
        // Note: liquidatedCollateralAmount is in actual token amounts, not scaled
        // We need to convert it to scaled balance by dividing by the liquidity index at liquidation time
        for (const liquidation of liquidations) {
            // Import the function to calculate liquidity index
            const { calculateLiquidityIndexAtTimestamp } = await import("../aave/liquidityIndex");

            // Get liquidity index at the time of liquidation
            const liquidityIndexAtLiquidation = await calculateLiquidityIndexAtTimestamp(
                context,
                asset,
                Number(liquidation.timestamp)
            );

            // Convert actual liquidated amount to scaled amount
            // scaledAmount = actualAmount * RAY / liquidityIndex
            const RAY = 1000000000000000000000000000n; // 1e27
            const scaledLiquidatedAmount = (liquidation.liquidatedCollateralAmount * RAY) / liquidityIndexAtLiquidation;

            scaledBalance -= scaledLiquidatedAmount;
        }

        return scaledBalance > 0n ? scaledBalance : 0n;

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
 * Get all assets a user had positions in during a custom time period
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
        ].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

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
 * 3. Get all liquidation events where debt was repaid (debtToCover)
 * 4. Calculate: scaledBorrowBalance = Σ(borrows) - Σ(repays) - Σ(liquidated debt)
 *
 * IMPORTANT: This function now accounts for liquidations. When a user's debt
 * is liquidated, the debtToCover is subtracted from their borrow balance.
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

        // Get all liquidation events where this user's debt (this asset) was liquidated
        const liquidations = await dbQuery
            .select()
            .from(LiquidationCall)
            .where(
                and(
                    eq(LiquidationCall.user, user as `0x${string}`),
                    eq(LiquidationCall.debtAsset, asset as `0x${string}`),
                    lte(LiquidationCall.timestamp, timestamp)
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

        // Subtract liquidated debt amounts
        // Note: debtToCover is in actual token amounts, not scaled
        // We need to convert it to scaled balance by dividing by the borrow index at liquidation time
        for (const liquidation of liquidations) {
            // Import the function to calculate borrow index
            const { calculateVariableBorrowIndexAtTimestamp } = await import("../aave/borrowIndex");

            // Get borrow index at the time of liquidation
            const borrowIndexAtLiquidation = await calculateVariableBorrowIndexAtTimestamp(
                context,
                asset,
                Number(liquidation.timestamp)
            );

            // Convert actual debt amount to scaled amount
            // scaledAmount = actualAmount * RAY / borrowIndex
            const RAY = 1000000000000000000000000000n; // 1e27
            const scaledDebtAmount = (liquidation.debtToCover * RAY) / borrowIndexAtLiquidation;

            scaledBorrowBalance -= scaledDebtAmount;
        }

        return scaledBorrowBalance > 0n ? scaledBorrowBalance : 0n;

    } catch (error) {
        console.error(`❌ Error getting scaled borrow balance at timestamp for user ${user}, asset ${asset}:`, error);
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

/**
 * Enhanced version of getScaledBalanceAtTimestamp that also returns contributing events
 *
 * @param context - Ponder context
 * @param user - User address
 * @param asset - Asset address
 * @param timestamp - Target timestamp
 * @returns Scaled balance and contributing events with asset prices
 */
export async function getScaledBalanceWithEvents(
    context: any,
    user: string,
    asset: string,
    timestamp: number
): Promise<BalanceWithEvents> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        // Get all balance events up to timestamp
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
            .orderBy(desc(UserBalanceEvent.timestamp));

        if (!events || events.length === 0) {
            return { balance: 0n, events: [] };
        }

        // Get the most recent balance
        const balance = BigInt(events[0].scaledBalance);

        // Fetch Supply and Withdraw events to get prices
        // We need to match by txHash to get the correct price for each event
        const [supplyEvents, withdrawEvents] = await Promise.all([
            dbQuery.select().from(Supply).where(
                and(
                    eq(Supply.reserve, asset as `0x${string}`),
                    lte(Supply.timestamp, timestamp)
                )
            ),
            dbQuery.select().from(Withdraw).where(
                and(
                    eq(Withdraw.reserve, asset as `0x${string}`),
                    lte(Withdraw.timestamp, timestamp)
                )
            )
        ]);

        // Create a map of txHash -> price for quick lookup
        const priceMap = new Map<string, bigint>();
        for (const supply of supplyEvents) {
            priceMap.set(supply.txHash, supply.price);
        }
        for (const withdraw of withdrawEvents) {
            priceMap.set(withdraw.txHash, withdraw.price);
        }

        // Format all events for response with prices
        const formattedEvents = events.map((event: any) => {
            const price = priceMap.get(event.txHash);
            return {
                eventType: event.eventType as 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out' | 'borrow' | 'repay',
                timestamp: Number(event.timestamp),
                date: new Date(Number(event.timestamp) * 1000).toISOString(),
                amount: event.transactionAmount.toString(),
                txHash: event.txHash,
                assetPrice: price?.toString()
            };
        }).sort((a: any, b: any) => a.timestamp - b.timestamp);

        return { balance, events: formattedEvents };

    } catch (error) {
        console.error(`❌ Error getting scaled balance with events for user ${user}, asset ${asset}:`, error);
        return { balance: 0n, events: [] };
    }
}

/**
 * Enhanced version of getScaledBorrowBalanceAtTimestamp that also returns contributing events
 *
 * @param context - Ponder context
 * @param user - User address
 * @param asset - Asset address
 * @param timestamp - Target timestamp
 * @returns Scaled borrow balance and contributing events
 */
export async function getScaledBorrowBalanceWithEvents(
    context: any,
    user: string,
    asset: string,
    timestamp: number
): Promise<BalanceWithEvents> {
    const { db } = context;
    const dbQuery = db.sql || db;

    try {
        // Get all borrow and repay events up to timestamp
        const [borrowEvents, repayEvents] = await Promise.all([
            dbQuery
                .select()
                .from(Borrow)
                .where(
                    and(
                        eq(Borrow.onBehalfOf, user as `0x${string}`),
                        eq(Borrow.reserve, asset as `0x${string}`),
                        lte(Borrow.timestamp, timestamp)
                    )
                ),
            dbQuery
                .select()
                .from(Repay)
                .where(
                    and(
                        eq(Repay.user, user as `0x${string}`),
                        eq(Repay.reserve, asset as `0x${string}`),
                        lte(Repay.timestamp, timestamp)
                    )
                )
        ]);

        // Calculate scaled borrow balance
        let balance = 0n;
        const events: BalanceWithEvents['events'] = [];

        // Add borrow events
        for (const event of borrowEvents) {
            balance += event.amount;
            events.push({
                eventType: 'borrow',
                timestamp: Number(event.timestamp),
                date: new Date(Number(event.timestamp) * 1000).toISOString(),
                amount: event.amount.toString(),
                txHash: event.txHash,
                assetPrice: event.price?.toString() // Borrow events already have price field
            });
        }

        // Subtract repay events
        for (const event of repayEvents) {
            balance -= event.amount;
            events.push({
                eventType: 'repay',
                timestamp: Number(event.timestamp),
                date: new Date(Number(event.timestamp) * 1000).toISOString(),
                amount: event.amount.toString(),
                txHash: event.txHash,
                assetPrice: event.price?.toString() // Repay events already have price field
            });
        }

        // Sort events by timestamp
        events.sort((a, b) => a.timestamp - b.timestamp);

        return { balance, events };

    } catch (error) {
        console.error(`❌ Error getting scaled borrow balance with events for user ${user}, asset ${asset}:`, error);
        return { balance: 0n, events: [] };
    }
}
