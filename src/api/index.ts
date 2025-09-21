import { db } from "ponder:api";
import { UserDeposit, ReserveDataEvent } from "ponder:schema";
import schema from "ponder:schema";
import { Hono } from "hono";
import { eq, graphql, and, desc, lte } from "ponder";
import { getUserPositions } from "../helpers/userPositionManager";
import { calculateUserMonthlyYield } from "../helpers/monthlyInterestCalculator";
import { calculateLiquidityIndexAtTimestamp, formatRayValue } from "../helpers/interestCalculations";

const app = new Hono();

// Add GraphQL endpoint
app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

// Custom API endpoint to get user's current deposits
app.get("/user/:address/deposits", async (c) => {
    const userAddress = c.req.param("address");

    if (!userAddress) {
        return c.json({ error: "User address is required" }, 400);
    }

    try {
        // Get current deposits for the user using Drizzle
        const deposits = await db
            .select()
            .from(UserDeposit)
            .where(eq(UserDeposit.user, userAddress as `0x${string}`));

        // Group deposits by token address
        const groupedDeposits: Record<string, any[]> = {};
        const uniqueTokens = new Set<string>();

        deposits.forEach(deposit => {
            const tokenAddress = deposit.token;

            if(!tokenAddress) return;

            uniqueTokens.add(tokenAddress);

            // Initialize array for this token if it doesn't exist
            if (!groupedDeposits[tokenAddress]) {
                groupedDeposits[tokenAddress] = [];
            }

            // Add the complete deposit record to the token's array
            groupedDeposits[tokenAddress].push({
                id: deposit.id,
                user: deposit.user,
                token: deposit.token,
                currentBalance: deposit.currentBalance?.toString(),
                lastUpdated: deposit.lastUpdated
            });
        });

        return c.json({
            user: userAddress,
            deposits: groupedDeposits,
            totalTokens: uniqueTokens.size
        });
    } catch (error) {
        console.error("Error fetching user deposits:", error);
        return c.json({ error: "Failed to fetch user deposits" }, 500);
    }
});

// Enhanced Interest Tracking API Endpoints



// Get user's current positions with interest tracking
app.get("/user/:address/positions", async (c) => {
    const userAddress = c.req.param("address");

    if (!userAddress) {
        return c.json({ error: "User address is required" }, 400);
    }

    try {
        // Create a mock context for helper functions
        const context = { db };
        const positions = await getUserPositions(context, userAddress);
        console.log("positions", positions);
        const formattedPositions = positions.map(pos => ({
            asset: pos.asset,
            scaledBalance: pos.scaledBalance.toString(),
            actualBalance: pos.actualBalance.toString(),
            totalDeposits: pos.totalDeposits.toString(),
            totalWithdrawals: pos.totalWithdrawals.toString(),
            currentYield: pos.currentYield.toString(),
            lastUpdated: pos.lastUpdated,
            // Format for display
            actualBalanceFormatted: formatRayValue(pos.actualBalance),
            currentYieldFormatted: formatRayValue(pos.currentYield),
        }));

        return c.json({
            user: userAddress,
            positions: formattedPositions,
            totalPositions: formattedPositions.length,
            timestamp: Math.floor(Date.now() / 1000)
        });
    } catch (error) {
        console.error("Error fetching user positions123:", userAddress);
        return c.json({ error: "Failed to fetch user positions" }, 500);
    }
});

// Get reserve data events for a specific asset
app.get("/reserve/:asset/events", async (c) => {
    const asset = c.req.param("asset");
    const limitParam = c.req.query("limit") || "50";
    const offsetParam = c.req.query("offset") || "0";

    if (!asset) {
        return c.json({ error: "Asset address is required" }, 400);
    }

    const limit = parseInt(limitParam);
    const offset = parseInt(offsetParam);

    if (isNaN(limit) || isNaN(offset) || limit < 1 || limit > 1000) {
        return c.json({ error: "Invalid limit (1-1000) or offset" }, 400);
    }

    try {
        const events = await db
            .select()
            .from(ReserveDataEvent)
            .where(eq(ReserveDataEvent.reserve, asset as `0x${string}`))
            .orderBy(desc(ReserveDataEvent.timestamp))
            .limit(limit)
            .offset(offset);


        const formattedEvents = events.map(event => ({
            id: event.id,
            txHash: event.txHash,
            reserve: event.reserve,
            liquidityIndex: event.liquidityIndex?.toString(),
            liquidityIndexFormatted: formatRayValue(event.liquidityIndex || 0n),
            liquidityRate: event.liquidityRate?.toString(),
            liquidityRateFormatted: formatRayValue(event.liquidityRate || 0n),
            timestamp: event.timestamp,
            blockNumber: event.blockNumber?.toString(),
            // @ts-ignore
            date: new Date(event.timestamp * 1000).toISOString()
        }));

        return c.json({
            asset,
            events: formattedEvents,
            pagination: {
                limit,
                offset,
                count: formattedEvents.length
            }
        });
    } catch (error) {
        console.error("Error fetching reserve events:", error);
        return c.json({ error: "Failed to fetch reserve events" }, 500);
    }
});

// Get reserve liquidity index at a specific timestamp
app.get("/api/reserves/:reserveAddress/liquidity-index", async (c) => {
    const reserveAddress = c.req.param("reserveAddress");
    const timestampParam = c.req.query("timestamp");

    if (!reserveAddress) {
        return c.json({ error: "Reserve address is required" }, 400);
    }

    // Validate reserve address format (basic hex address validation)
    if (!/^0x[a-fA-F0-9]{40}$/.test(reserveAddress)) {
        return c.json({
            error: "Invalid reserve address format",
            code: "INVALID_ADDRESS",
            reserveAddress
        }, 400);
    }

    try {
        // Parse timestamp or use current timestamp
        let timestamp: number;
        if (timestampParam) {
            timestamp = parseInt(timestampParam);
            if (isNaN(timestamp) || timestamp < 0) {
                return c.json({
                    error: "Invalid timestamp parameter",
                    code: "INVALID_TIMESTAMP"
                }, 400);
            }
        } else {
            timestamp = Math.floor(Date.now() / 1000);
        }

        const context = { db };
        const liquidityIndex = await calculateLiquidityIndexAtTimestamp(
            context,
            reserveAddress,
            timestamp
        );

        return c.json({
            reserveAddress,
            timestamp,
            liquidityIndex: liquidityIndex.toString(),
            liquidityIndexFormatted: formatRayValue(liquidityIndex),
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating liquidity index:", error);
        return c.json({
            error: "Failed to calculate liquidity index",
            code: "CALCULATION_ERROR",
            reserveAddress
        }, 500);
    }
});

// Get monthly yield data for a specific user and month
app.get("/user/:address/monthly-yield/:year/:month", async (c) => {
    const userAddress = c.req.param("address");
    const yearParam = c.req.param("year");
    const monthParam = c.req.param("month");

    if (!userAddress || !yearParam || !monthParam) {
        return c.json({ error: "User address, year, and month are required" }, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({ error: "Invalid user address format" }, 400);
    }

    const year = parseInt(yearParam);
    const month = parseInt(monthParam);

    // Validate year and month
    if (isNaN(year) || isNaN(month) || year < 2020 || year > 2030 || month < 1 || month > 12) {
        return c.json({ error: "Invalid year (2020-2030) or month (1-12)" }, 400);
    }

    try {
        const context = { db };

        // Calculate monthly yield data
        const yieldData = await calculateUserMonthlyYield(context, userAddress, year, month);

        if (yieldData.length === 0) {
            return c.json({
                user: userAddress,
                year,
                month,
                monthlyYields: [],
                message: "No positions found for this user and month"
            });
        }

        // Format the response data
        const formattedYields = yieldData.map(data => ({
            user: data.user,
            asset: data.asset,
            year: data.year,
            month: data.month,
            monthlyYield: data.monthlyYield.toString(),
            startScaledBalance: data.startScaledBalance.toString(),
            endScaledBalance: data.endScaledBalance.toString(),
            startActualBalance: data.startActualBalance.toString(),
            endActualBalance: data.endActualBalance.toString(),
            startLiquidityIndex: data.startLiquidityIndex.toString(),
            endLiquidityIndex: data.endLiquidityIndex.toString(),
            netDeposits: data.netDeposits.toString(),
            startTimestamp: data.startTimestamp,
            endTimestamp: data.endTimestamp,
            // Add context fields for better understanding
            hadPositionDuringMonth: data.hadPositionDuringMonth || false,
            maxBalanceDuringMonth: data.maxBalanceDuringMonth?.toString() || "0",
            transactionCount: data.transactionCount || 0,
            // Add formatted values for easier reading
            monthlyYieldFormatted: formatRayValue(data.monthlyYield),
            startActualBalanceFormatted: formatRayValue(data.startActualBalance),
            endActualBalanceFormatted: formatRayValue(data.endActualBalance),
            netDepositsFormatted: formatRayValue(data.netDeposits),
            maxBalanceDuringMonthFormatted: formatRayValue(data.maxBalanceDuringMonth || 0n),
            startDate: new Date(data.startTimestamp * 1000).toISOString(),
            endDate: new Date(data.endTimestamp * 1000).toISOString(),
            // Add explanation for confusing cases
            explanation: getYieldExplanation(data),
            // Add detailed segment information for transparency
            segments: data.segments?.map(segment => ({
                startTime: segment.startTime,
                endTime: segment.endTime,
                startDate: segment.startDate,
                endDate: segment.endDate,
                scaledBalance: segment.scaledBalance.toString(),
                actualBalance: segment.actualBalance.toString(),
                startLiquidityIndex: segment.startLiquidityIndex.toString(),
                endLiquidityIndex: segment.endLiquidityIndex.toString(),
                segmentYield: segment.segmentYield.toString(),
                durationDays: segment.durationDays,
                // Formatted values for readability
                scaledBalanceFormatted: formatRayValue(segment.scaledBalance),
                actualBalanceFormatted: formatRayValue(segment.actualBalance),
                segmentYieldFormatted: formatRayValue(segment.segmentYield),
                startLiquidityIndexFormatted: formatRayValue(segment.startLiquidityIndex),
                endLiquidityIndexFormatted: formatRayValue(segment.endLiquidityIndex)
            })) || []
        }));

        return c.json({
            user: userAddress,
            year,
            month,
            monthlyYields: formattedYields,
            totalAssets: formattedYields.length,
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating monthly yield:", error);
        return c.json({ error: "Failed to calculate monthly yield data" }, 500);
    }
});

/**
 * Generate explanation for yield calculations to help users understand the data
 */
function getYieldExplanation(data: any): string {
    const startBalance = BigInt(data.startScaledBalance || 0);
    const endBalance = BigInt(data.endScaledBalance || 0);
    const monthlyYield = BigInt(data.monthlyYield || 0);
    const netDeposits = BigInt(data.netDeposits || 0);
    const hadPosition = data.hadPositionDuringMonth;
    const transactionCount = data.transactionCount || 0;

    // Case 1: Normal ongoing position
    if (startBalance > 0n && endBalance > 0n) {
        return "User held position throughout the month and earned interest";
    }

    // Case 2: New position opened during month
    if (startBalance === 0n && endBalance > 0n && netDeposits > 0n) {
        return "User opened new position during the month and earned interest";
    }

    // Case 3: Position closed during month (the confusing case!)
    if (startBalance > 0n && endBalance === 0n && monthlyYield > 0n) {
        return "User closed position during month but earned interest while position was active";
    }

    // Case 4: Temporary position (opened and closed same month)
    if (startBalance === 0n && endBalance === 0n && monthlyYield > 0n && hadPosition) {
        return "User had temporary position during month and earned interest while active";
    }

    // Case 5: No activity
    if (monthlyYield === 0n && !hadPosition) {
        return "No position or activity during this month";
    }

    // Case 6: Zero yield asset
    if (monthlyYield === 0n && (startBalance > 0n || endBalance > 0n)) {
        return "Position held but asset has 0% interest rate";
    }

    return "Standard yield calculation";
}

// Custom health check endpoint
app.get("/custom-health", async (c) => {
    return c.json({ status: "ok", timestamp: Date.now() });
});

export default app;
