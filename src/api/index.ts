import {db} from "ponder:api";
import {UserDeposit, ReserveDataEvent} from "ponder:schema";
import schema from "ponder:schema";
import {Hono} from "hono";
import {eq, graphql, desc} from "ponder";
import {getUserPositions} from "../helpers/userPositionManager";
import {calculateUserMonthlyYield, calculateUserCustomPeriodYield, calculateUserDailyYieldBreakdown, calculateUserDailyPortfolioValue, calculateUserMonthlyYieldBreakdown, calculateUserMonthlyPortfolioValue} from "../helpers/yield/yieldReports";
import {calculateLiquidityIndexAtTimestamp, formatRayValue, formatTokenBalance} from "../helpers/aave";
import {calculateAllIsolatedPairPositions, calculateAllIsolatedPairYields, calculateDailyIsolatedPairYields, calculateMonthlyIsolatedPairYields} from "../helpers/yield/isolatedPair";
import { cors } from 'hono/cors'

const app = new Hono();

//fix CORS
app.use('/*', cors({
  origin: '*',
  allowHeaders: ['Origin', 'Content-Type', 'Accept', 'Authorization'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
  credentials: false, // Must be false when using wildcard '*'
}))

// Add GraphQL endpoint
app.use("/", graphql({db, schema}));
app.use("/graphql", graphql({db, schema}));

// Custom API endpoint to get user's current deposits
app.get("/user/:address/deposits", async (c) => {
    const userAddress = c.req.param("address");

    if (!userAddress) {
        return c.json({error: "User address is required"}, 400);
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

            if (!tokenAddress) return;

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
        return c.json({error: "Failed to fetch user deposits"}, 500);
    }
});

// Enhanced Interest Tracking API Endpoints


// Get user's current positions with interest tracking
app.get("/user/:address/positions", async (c) => {
    const userAddress = c.req.param("address");

    if (!userAddress) {
        return c.json({error: "User address is required"}, 400);
    }

    try {
        // Create a mock context for helper functions
        const context = {db};
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
        return c.json({error: "Failed to fetch user positions"}, 500);
    }
});

// Get reserve data events for a specific asset
app.get("/reserve/:asset/events", async (c) => {
    const asset = c.req.param("asset");
    const limitParam = c.req.query("limit") || "50";
    const offsetParam = c.req.query("offset") || "0";

    if (!asset) {
        return c.json({error: "Asset address is required"}, 400);
    }

    const limit = parseInt(limitParam);
    const offset = parseInt(offsetParam);

    if (isNaN(limit) || isNaN(offset) || limit < 1 || limit > 1000) {
        return c.json({error: "Invalid limit (1-1000) or offset"}, 400);
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
        return c.json({error: "Failed to fetch reserve events"}, 500);
    }
});

// Get reserve liquidity index at a specific timestamp
app.get("/api/reserves/:reserveAddress/liquidity-index", async (c) => {
    const reserveAddress = c.req.param("reserveAddress");
    const timestampParam = c.req.query("timestamp");

    if (!reserveAddress) {
        return c.json({error: "Reserve address is required"}, 400);
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

        const context = {db};
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
        return c.json({error: "User address, year, and month are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const year = parseInt(yearParam);
    const month = parseInt(monthParam);

    // Validate year and month
    if (isNaN(year) || isNaN(month) || year < 2020 || year > 2030 || month < 1 || month > 12) {
        return c.json({error: "Invalid year (2020-2030) or month (1-12)"}, 400);
    }

    try {
        const context = {db};

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
            netDeposits: data.netDeposits.toString(),
            // Add context fields for better understanding
            hadPositionDuringMonth: data.hadPositionDuringMonth || false,
            maxBalanceDuringMonth: data.maxBalanceDuringMonth?.toString() || "0",
            // Add formatted values for easier reading
            monthlyYieldFormatted: formatRayValue(data.monthlyYield),
            netDepositsFormatted: formatRayValue(data.netDeposits),
            maxBalanceDuringMonthFormatted: formatRayValue(data.maxBalanceDuringMonth || 0n),
            startDate: new Date(data.startTimestamp * 1000).toISOString(),
            endDate: new Date(data.endTimestamp * 1000).toISOString(),
            // Add explanation for confusing cases
            explanation: getYieldExplanation(data),
            // Add detailed segment information for transparency (filter out empty segments)
            segments: data.segments?.filter(segment => segment.segmentYield !== 0n).map(segment => ({
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
        return c.json({error: "Failed to calculate monthly yield data"}, 500);
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

/**
 * Generate explanation for custom period yield calculations
 */
function getCustomPeriodYieldExplanation(data: any): string {
    const startBalance = BigInt(data.startScaledBalance || 0);
    const endBalance = BigInt(data.endScaledBalance || 0);
    const periodYield = BigInt(data.periodYield || 0);
    const netDeposits = BigInt(data.netDeposits || 0);
    const hadPosition = data.hadPositionDuringPeriod;

    // Case 1: Normal ongoing position
    if (startBalance > 0n && endBalance > 0n) {
        return "User held position throughout the period and earned interest";
    }

    // Case 2: New position opened during period
    if (startBalance === 0n && endBalance > 0n && netDeposits > 0n) {
        return "User opened new position during the period and earned interest";
    }

    // Case 3: Position closed during period
    if (startBalance > 0n && endBalance === 0n && periodYield > 0n) {
        return "User closed position during period but earned interest while position was active";
    }

    // Case 4: Temporary position (opened and closed same period)
    if (startBalance === 0n && endBalance === 0n && periodYield > 0n && hadPosition) {
        return "User had temporary position during period and earned interest while active";
    }

    // Case 5: No activity
    if (periodYield === 0n && !hadPosition) {
        return "No position or activity during this period";
    }

    // Case 6: Zero yield asset
    if (periodYield === 0n && (startBalance > 0n || endBalance > 0n)) {
        return "Position held but asset has 0% interest rate";
    }

    return "Standard yield calculation";
}

// Get custom period yield data for a specific user and time range
app.get("/user/:address/custom-period-yield", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 2 years)
    const maxPeriodSeconds = 2 * 365 * 24 * 60 * 60; // 2 years
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 2 years"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate custom period yield data for regular pool only
        const yieldData = await calculateUserCustomPeriodYield(context, userAddress, fromTimestamp, toTimestamp);

        if (yieldData.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                totalSupplied: "0",
                totalBorrowed: "0",
                totalSuppliedFormatted: "0.000000",
                totalBorrowedFormatted: "0.000000",
                assets: [],
                totalAssets: 0,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Format the response data
        const formattedYields = yieldData.map(data => ({
            user: data.user,
            asset: data.asset,
            yield: data.periodYield.toString(),
            netDeposits: data.netDeposits.toString(),
            suppliedAmount: data.suppliedAmount.toString(),
            borrowedAmount: data.borrowedAmount.toString(),
            // Add context fields for better understanding
            hadPositionDuringPeriod: data.hadPositionDuringPeriod || false,
            maxBalanceDuringPeriod: data.maxBalanceDuringPeriod?.toString() || "0",
            // Add formatted values for easier reading
            yieldFormatted: formatRayValue(data.periodYield),
            netDepositsFormatted: formatRayValue(data.netDeposits),
            suppliedAmountFormatted: formatRayValue(data.suppliedAmount),
            borrowedAmountFormatted: formatRayValue(data.borrowedAmount),
            maxBalanceDuringPeriodFormatted: formatRayValue(data.maxBalanceDuringPeriod || 0n),
            startDate: new Date(data.startTimestamp * 1000).toISOString(),
            endDate: new Date(data.endTimestamp * 1000).toISOString(),
            // Add explanation for confusing cases
            explanation: getCustomPeriodYieldExplanation(data),
            // Add detailed segment information for transparency (filter out empty segments)
            segments: data.segments?.filter(segment => segment.segmentYield !== 0n).map(segment => ({
                startTime: segment.startTime,
                endTime: segment.endTime,
                startDate: segment.startDate,
                endDate: segment.endDate,
                scaledBalance: segment.scaledBalance.toString(),
                actualBalance: segment.actualBalance.toString(),
                startLiquidityIndex: segment.startLiquidityIndex.toString(),
                endLiquidityIndex: segment.endLiquidityIndex.toString(),
                yield: segment.segmentYield.toString(),
                durationDays: segment.durationDays,
                // Formatted values for readability
                scaledBalanceFormatted: formatRayValue(segment.scaledBalance),
                actualBalanceFormatted: formatRayValue(segment.actualBalance),
                segmentYieldFormatted: formatRayValue(segment.segmentYield),
                startLiquidityIndexFormatted: formatRayValue(segment.startLiquidityIndex),
                endLiquidityIndexFormatted: formatRayValue(segment.endLiquidityIndex)
            })) || []
        }));

        // Filter out assets with no active position at end of period
        // This shows all assets where user has supplied or borrowed amounts (including pre-existing positions)
        const filteredYields = formattedYields.filter(data =>
            BigInt(data.suppliedAmount) > 0n || BigInt(data.borrowedAmount) > 0n
        );

        // Calculate totals for regular pool
        const totalSupplied = filteredYields.reduce((sum, asset) => sum + BigInt(asset.suppliedAmount), 0n);
        const totalBorrowed = filteredYields.reduce((sum, asset) => sum + BigInt(asset.borrowedAmount), 0n);

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            totalSupplied: totalSupplied.toString(),
            totalBorrowed: totalBorrowed.toString(),
            totalSuppliedFormatted: formatRayValue(totalSupplied),
            totalBorrowedFormatted: formatRayValue(totalBorrowed),
            assets: filteredYields,
            totalAssets: filteredYields.length,
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating custom period yield:", error);
        return c.json({error: "Failed to calculate custom period yield data"}, 500);
    }
});

// Get custom period yield data for isolated pairs only
app.get("/user/:address/custom-period-yield-isolated", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 2 years)
    const maxPeriodSeconds = 2 * 365 * 24 * 60 * 60; // 2 years
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 2 years"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate isolated pair yields during the period
        const isolatedPairYields = await calculateAllIsolatedPairYields(context, userAddress, fromTimestamp, toTimestamp);

        if (isolatedPairYields.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                pairs: [],
                totalSupplied: "0",
                totalSuppliedFormatted: "0.000000",
                totalBorrowed: "0",
                totalBorrowedFormatted: "0.000000",
                totalYield: "0",
                totalYieldFormatted: "0.000000",
                totalPairs: 0,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Format isolated pair yields with detailed breakdown
        const formattedIsolatedPairs = isolatedPairYields.map(y => {
            // Calculate total supplied = vault deposits + collateral
            const startTotalSupplied = y.startAssetValue + y.startCollateralBalance;
            const endTotalSupplied = y.endAssetValue + y.endCollateralBalance;

            return {
                pair: y.pair,

                // Yield metrics
                assetYield: y.assetYield.toString(),
                assetYieldFormatted: formatRayValue(y.assetYield),
                borrowYield: y.borrowYield.toString(),
                borrowYieldFormatted: formatRayValue(y.borrowYield),
                netYield: y.netYield.toString(),
                netYieldFormatted: formatRayValue(y.netYield),

                // Start of period breakdown
                startPeriod: {
                    vaultDeposits: y.startAssetValue.toString(),
                    vaultDepositsFormatted: formatRayValue(y.startAssetValue),
                    collateral: y.startCollateralBalance.toString(),
                    collateralFormatted: formatRayValue(y.startCollateralBalance),
                    totalSupplied: startTotalSupplied.toString(),
                    totalSuppliedFormatted: formatRayValue(startTotalSupplied),
                    totalBorrowed: y.startBorrowValue.toString(),
                    totalBorrowedFormatted: formatRayValue(y.startBorrowValue),
                    assetShares: y.startAssetShares.toString(),
                    borrowShares: y.startBorrowShares.toString(),
                    exchangeRate: y.startExchangeRate.toString(),
                    exchangeRateFormatted: formatRayValue(y.startExchangeRate)
                },

                // End of period breakdown
                endPeriod: {
                    vaultDeposits: y.endAssetValue.toString(),
                    vaultDepositsFormatted: formatRayValue(y.endAssetValue),
                    collateral: y.endCollateralBalance.toString(),
                    collateralFormatted: formatRayValue(y.endCollateralBalance),
                    totalSupplied: endTotalSupplied.toString(),
                    totalSuppliedFormatted: formatRayValue(endTotalSupplied),
                    totalBorrowed: y.endBorrowValue.toString(),
                    totalBorrowedFormatted: formatRayValue(y.endBorrowValue),
                    assetShares: y.endAssetShares.toString(),
                    borrowShares: y.endBorrowShares.toString(),
                    exchangeRate: y.endExchangeRate.toString(),
                    exchangeRateFormatted: formatRayValue(y.endExchangeRate)
                }
            };
        });

        // Calculate totals for isolated pairs (using end of period values)
        const totalSupplied = isolatedPairYields.reduce((sum, y) =>
            sum + y.endAssetValue + y.endCollateralBalance, 0n
        );
        const totalBorrowed = isolatedPairYields.reduce((sum, y) =>
            sum + y.endBorrowValue, 0n
        );
        const totalYield = isolatedPairYields.reduce((sum, y) =>
            sum + y.netYield, 0n
        );

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            pairs: formattedIsolatedPairs,
            totalSupplied: totalSupplied.toString(),
            totalSuppliedFormatted: formatRayValue(totalSupplied),
            totalBorrowed: totalBorrowed.toString(),
            totalBorrowedFormatted: formatRayValue(totalBorrowed),
            totalYield: totalYield.toString(),
            totalYieldFormatted: formatRayValue(totalYield),
            totalPairs: formattedIsolatedPairs.length,
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating isolated pair yield:", error);
        return c.json({error: "Failed to calculate isolated pair yield data"}, 500);
    }
});

// Get daily yield breakdown for a specific user over a custom time period
app.get("/user/:address/daily-yield-breakdown", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 1 year for daily breakdown)
    const maxPeriodSeconds = 365 * 24 * 60 * 60; // 1 year
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 1 year for daily breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate daily yield breakdown for regular pool only
        const dailyYieldData = await calculateUserDailyYieldBreakdown(context, userAddress, fromTimestamp, toTimestamp);

        // Note: dailyYieldData now includes all days in the period (including zero-yield days)
        // Only return empty response if no data could be calculated at all (e.g., no assets found)
        if (dailyYieldData.length === 0) {
            // Calculate expected number of days for empty response
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                dailyBreakdown: [],
                summary: {
                    totalYield: "0",
                    totalYieldFormatted: "0.000000",
                    averageDailyYield: "0",
                    averageDailyYieldFormatted: "0.000000",
                    maxDailyYield: "0",
                    maxDailyYieldFormatted: "0.000000",
                    minDailyYield: "0",
                    minDailyYieldFormatted: "0.000000",
                    daysWithYield: 0,
                    totalDaysInPeriod: expectedDays
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for regular pool
        const totalYield = dailyYieldData.reduce((sum, day) => sum + day.dailyYield, 0n);
        const daysWithYield = dailyYieldData.filter(day => day.dailyYield > 0n).length;
        const averageDailyYield = dailyYieldData.length > 0 ? totalYield / BigInt(dailyYieldData.length) : 0n;
        const maxDailyYield = dailyYieldData.reduce((max, day) => day.dailyYield > max ? day.dailyYield : max, 0n);
        const minDailyYield = dailyYieldData.reduce((min, day) => day.dailyYield < min ? day.dailyYield : min, dailyYieldData[0]?.dailyYield || 0n);

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = dailyYieldData.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            dailyYield: day.dailyYield.toString(),
            dailyYieldFormatted: day.dailyYieldFormatted,
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                dailyYield: asset.dailyYield.toString(),
                dailyYieldFormatted: asset.dailyYieldFormatted,
                segments: asset.segments // Already converted to strings in the helper function
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyBreakdown: serializedBreakdown,
            summary: {
                totalYield: totalYield.toString(),
                totalYieldFormatted: formatRayValue(totalYield),
                averageDailyYield: averageDailyYield.toString(),
                averageDailyYieldFormatted: formatRayValue(averageDailyYield),
                maxDailyYield: maxDailyYield.toString(),
                maxDailyYieldFormatted: formatRayValue(maxDailyYield),
                minDailyYield: minDailyYield.toString(),
                minDailyYieldFormatted: formatRayValue(minDailyYield),
                daysWithYield: daysWithYield,
                totalDaysInPeriod: dailyYieldData.length
            },
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating daily yield breakdown:", error);
        return c.json({error: "Failed to calculate daily yield breakdown"}, 500);
    }
});

// Get daily yield breakdown for isolated pairs only
app.get("/user/:address/daily-yield-breakdown-isolated", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 1 year for daily breakdown)
    const maxPeriodSeconds = 365 * 24 * 60 * 60; // 1 year
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 1 year for daily breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate daily yield for isolated pairs
        const isolatedPairYields = await calculateDailyIsolatedPairYields(context, userAddress, fromTimestamp, toTimestamp);

        if (isolatedPairYields.length === 0) {
            // Calculate expected number of days for empty response
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                dailyBreakdown: [],
                summary: {
                    totalYield: "0",
                    totalYieldFormatted: "0.000000",
                    averageDailyYield: "0",
                    averageDailyYieldFormatted: "0.000000",
                    maxDailyYield: "0",
                    maxDailyYieldFormatted: "0.000000",
                    minDailyYield: "0",
                    minDailyYieldFormatted: "0.000000",
                    daysWithYield: 0,
                    totalDaysInPeriod: expectedDays
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for isolated pairs
        const totalYield = isolatedPairYields.reduce((sum, day) => sum + day.dailyYield, 0n);
        const daysWithYield = isolatedPairYields.filter(day => day.dailyYield > 0n).length;
        const averageDailyYield = isolatedPairYields.length > 0 ? totalYield / BigInt(isolatedPairYields.length) : 0n;
        const maxDailyYield = isolatedPairYields.reduce((max, day) => day.dailyYield > max ? day.dailyYield : max, 0n);
        const minDailyYield = isolatedPairYields.reduce((min, day) => day.dailyYield < min ? day.dailyYield : min, isolatedPairYields[0]?.dailyYield || 0n);

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = isolatedPairYields.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            dailyYield: day.dailyYield.toString(),
            dailyYieldFormatted: formatRayValue(day.dailyYield),
            pairs: day.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                assetYieldFormatted: formatRayValue(pair.assetYield),
                borrowYield: pair.borrowYield.toString(),
                borrowYieldFormatted: formatRayValue(pair.borrowYield),
                netYield: pair.netYield.toString(),
                netYieldFormatted: formatRayValue(pair.netYield)
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyBreakdown: serializedBreakdown,
            summary: {
                totalYield: totalYield.toString(),
                totalYieldFormatted: formatRayValue(totalYield),
                averageDailyYield: averageDailyYield.toString(),
                averageDailyYieldFormatted: formatRayValue(averageDailyYield),
                maxDailyYield: maxDailyYield.toString(),
                maxDailyYieldFormatted: formatRayValue(maxDailyYield),
                minDailyYield: minDailyYield.toString(),
                minDailyYieldFormatted: formatRayValue(minDailyYield),
                daysWithYield: daysWithYield,
                totalDaysInPeriod: isolatedPairYields.length
            },
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating isolated pair daily yield breakdown:", error);
        return c.json({error: "Failed to calculate isolated pair daily yield breakdown"}, 500);
    }
});

// Get daily portfolio values for a specific user over a custom time period
// Portfolio Value = Total Supplied - Total Borrowed
app.get("/user/:address/daily-portfolio-value", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 1 year for daily breakdown)
    const maxPeriodSeconds = 365 * 24 * 60 * 60; // 1 year
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 1 year for daily breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate daily portfolio values for regular pool only
        const dailyPortfolioData = await calculateUserDailyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        if (dailyPortfolioData.length === 0) {
            // Calculate expected number of days for empty response
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                dailyPortfolioValues: [],
                summary: {
                    averagePortfolioValue: "0",
                    averagePortfolioValueFormatted: "0.000000",
                    maxPortfolioValue: "0",
                    maxPortfolioValueFormatted: "0.000000",
                    minPortfolioValue: "0",
                    minPortfolioValueFormatted: "0.000000",
                    totalDaysInPeriod: expectedDays
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for regular pool
        const totalPortfolioValue = dailyPortfolioData.reduce((sum, day) => sum + day.portfolioValue, 0n);
        const averagePortfolioValue = dailyPortfolioData.length > 0 ? totalPortfolioValue / BigInt(dailyPortfolioData.length) : 0n;
        const maxPortfolioValue = dailyPortfolioData.reduce((max, day) => day.portfolioValue > max ? day.portfolioValue : max, dailyPortfolioData[0]?.portfolioValue || 0n);
        const minPortfolioValue = dailyPortfolioData.reduce((min, day) => day.portfolioValue < min ? day.portfolioValue : min, dailyPortfolioData[0]?.portfolioValue || 0n);

        // Convert all BigInt values to strings for JSON serialization
        const serializedPortfolio = dailyPortfolioData.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            portfolioValue: day.portfolioValue.toString(),
            portfolioValueFormatted: day.portfolioValueFormatted,
            totalSupplied: day.totalSupplied.toString(),
            totalSuppliedFormatted: day.totalSuppliedFormatted,
            totalBorrowed: day.totalBorrowed.toString(),
            totalBorrowedFormatted: day.totalBorrowedFormatted,
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                suppliedFormatted: asset.suppliedFormatted,
                borrowed: asset.borrowed.toString(),
                borrowedFormatted: asset.borrowedFormatted,
                netPosition: asset.netPosition.toString(),
                netPositionFormatted: asset.netPositionFormatted
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyPortfolioValues: serializedPortfolio,
            summary: {
                averagePortfolioValue: averagePortfolioValue.toString(),
                averagePortfolioValueFormatted: formatTokenBalance(averagePortfolioValue, 18),
                maxPortfolioValue: maxPortfolioValue.toString(),
                maxPortfolioValueFormatted: formatTokenBalance(maxPortfolioValue, 18),
                minPortfolioValue: minPortfolioValue.toString(),
                minPortfolioValueFormatted: formatTokenBalance(minPortfolioValue, 18),
                totalDaysInPeriod: dailyPortfolioData.length
            },
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating daily portfolio values:", error);
        return c.json({error: "Failed to calculate daily portfolio values"}, 500);
    }
});

// Get daily portfolio values for isolated pairs only
app.get("/user/:address/daily-portfolio-value-isolated", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate reasonable time range (not more than 1 year for daily breakdown)
    const maxPeriodSeconds = 365 * 24 * 60 * 60; // 1 year
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 1 year for daily breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate isolated pair positions for each day
        const dailyIsolatedPairs: Array<{
            date: string;
            timestamp: number;
            portfolioValue: bigint;
            totalSupplied: bigint;
            totalBorrowed: bigint;
            pairs: Array<any>;
        }> = [];

        // Generate daily timestamps
        const oneDaySeconds = 24 * 60 * 60;
        for (let ts = fromTimestamp; ts <= toTimestamp; ts += oneDaySeconds) {
            const dayTimestamp = Math.min(ts, toTimestamp);
            const positions = await calculateAllIsolatedPairPositions(context, userAddress, dayTimestamp, fromTimestamp);

            const totalSupplied = positions.reduce((sum, pos) => sum + pos.collateralAmount + pos.assetAmount, 0n);
            const totalBorrowed = positions.reduce((sum, pos) => sum + pos.borrowAmount, 0n);
            const portfolioValue = totalSupplied - totalBorrowed;

            dailyIsolatedPairs.push({
                date: new Date(dayTimestamp * 1000).toISOString().split('T')[0]!,
                timestamp: dayTimestamp,
                portfolioValue,
                totalSupplied,
                totalBorrowed,
                pairs: positions.map(pos => ({
                    pair: pos.pair,
                    collateralAmount: pos.collateralAmount.toString(),
                    collateralAmountFormatted: formatRayValue(pos.collateralAmount),
                    assetAmount: pos.assetAmount.toString(),
                    assetAmountFormatted: formatRayValue(pos.assetAmount),
                    borrowAmount: pos.borrowAmount.toString(),
                    borrowAmountFormatted: formatRayValue(pos.borrowAmount)
                }))
            });
        }

        if (dailyIsolatedPairs.length === 0) {
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                dailyPortfolioValues: [],
                summary: {
                    averagePortfolioValue: "0",
                    averagePortfolioValueFormatted: "0.000000",
                    maxPortfolioValue: "0",
                    maxPortfolioValueFormatted: "0.000000",
                    minPortfolioValue: "0",
                    minPortfolioValueFormatted: "0.000000",
                    totalDaysInPeriod: expectedDays
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for isolated pairs
        const totalPortfolioValue = dailyIsolatedPairs.reduce((sum, day) => sum + day.portfolioValue, 0n);
        const averagePortfolioValue = dailyIsolatedPairs.length > 0 ? totalPortfolioValue / BigInt(dailyIsolatedPairs.length) : 0n;
        const maxPortfolioValue = dailyIsolatedPairs.reduce((max, day) => day.portfolioValue > max ? day.portfolioValue : max, 0n);
        const minPortfolioValue = dailyIsolatedPairs.reduce((min, day) => day.portfolioValue < min ? day.portfolioValue : min, dailyIsolatedPairs[0]?.portfolioValue || 0n);

        // Convert all BigInt values to strings for JSON serialization
        const serializedPortfolio = dailyIsolatedPairs.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            portfolioValue: day.portfolioValue.toString(),
            portfolioValueFormatted: formatRayValue(day.portfolioValue),
            totalSupplied: day.totalSupplied.toString(),
            totalSuppliedFormatted: formatRayValue(day.totalSupplied),
            totalBorrowed: day.totalBorrowed.toString(),
            totalBorrowedFormatted: formatRayValue(day.totalBorrowed),
            pairs: day.pairs
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyPortfolioValues: serializedPortfolio,
            summary: {
                averagePortfolioValue: averagePortfolioValue.toString(),
                averagePortfolioValueFormatted: formatTokenBalance(averagePortfolioValue, 18),
                maxPortfolioValue: maxPortfolioValue.toString(),
                maxPortfolioValueFormatted: formatTokenBalance(maxPortfolioValue, 18),
                minPortfolioValue: minPortfolioValue.toString(),
                minPortfolioValueFormatted: formatTokenBalance(minPortfolioValue, 18),
                totalDaysInPeriod: dailyIsolatedPairs.length
            },
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating isolated pair daily portfolio values:", error);
        return c.json({error: "Failed to calculate isolated pair daily portfolio values"}, 500);
    }
});

// Get monthly yield breakdown for a specific user over a custom time period
// Optimized for long-term analysis (≥ 1 month periods)
app.get("/user/:address/monthly-yield-breakdown", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate minimum time range (at least 1 month = ~30 days)
    const minPeriodSeconds = 30 * 24 * 60 * 60; // 30 days
    if (toTimestamp - fromTimestamp < minPeriodSeconds) {
        return c.json({error: "Time period must be at least 1 month (30 days). Use daily-yield-breakdown for shorter periods."}, 400);
    }

    // Validate reasonable time range (not more than 3 years for monthly breakdown)
    const maxPeriodSeconds = 3 * 365 * 24 * 60 * 60; // 3 years
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 3 years for monthly breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate monthly yield breakdown for regular pool only
        const monthlyYieldData = await calculateUserMonthlyYieldBreakdown(context, userAddress, fromTimestamp, toTimestamp);

        if (monthlyYieldData.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                months: 0,
                monthlyBreakdown: [],
                summary: {
                    totalYield: "0",
                    totalYieldFormatted: "0.000000",
                    averageMonthlyYield: "0",
                    averageMonthlyYieldFormatted: "0.000000",
                    maxMonthlyYield: "0",
                    maxMonthlyYieldFormatted: "0.000000",
                    minMonthlyYield: "0",
                    minMonthlyYieldFormatted: "0.000000",
                    monthsWithYield: 0,
                    totalMonths: 0
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for regular pool
        const totalYield = monthlyYieldData.reduce((sum, month) => sum + month.totalYield, 0n);
        const monthsWithYield = monthlyYieldData.filter(month => month.totalYield > 0n).length;
        const averageMonthlyYield = monthlyYieldData.length > 0 ? totalYield / BigInt(monthlyYieldData.length) : 0n;
        const maxMonthlyYield = monthlyYieldData.reduce((max, month) => month.totalYield > max ? month.totalYield : max, 0n);
        const minMonthlyYield = monthlyYieldData.reduce((min, month) => month.totalYield < min ? month.totalYield : min, monthlyYieldData[0]?.totalYield || 0n);

        // Format the response data for regular pool
        const formattedBreakdown = monthlyYieldData.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            startDate: month.startDate,
            endDate: month.endDate,
            totalYield: month.totalYield.toString(),
            totalYieldFormatted: formatRayValue(month.totalYield),
            assets: month.assets.map(asset => ({
                asset: asset.asset,
                monthlyYield: asset.monthlyYield.toString(),
                monthlyYieldFormatted: formatRayValue(asset.monthlyYield),
                netDeposits: asset.netDeposits.toString(),
                netDepositsFormatted: formatRayValue(asset.netDeposits),
                hadPositionDuringMonth: asset.hadPositionDuringMonth,
                maxBalanceDuringMonth: asset.maxBalanceDuringMonth.toString(),
                maxBalanceDuringMonthFormatted: formatRayValue(asset.maxBalanceDuringMonth)
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            months: monthlyYieldData.length,
            monthlyBreakdown: formattedBreakdown,
            summary: {
                totalYield: totalYield.toString(),
                totalYieldFormatted: formatRayValue(totalYield),
                averageMonthlyYield: averageMonthlyYield.toString(),
                averageMonthlyYieldFormatted: formatRayValue(averageMonthlyYield),
                maxMonthlyYield: maxMonthlyYield.toString(),
                maxMonthlyYieldFormatted: formatRayValue(maxMonthlyYield),
                minMonthlyYield: minMonthlyYield.toString(),
                minMonthlyYieldFormatted: formatRayValue(minMonthlyYield),
                monthsWithYield: monthsWithYield,
                totalMonths: monthlyYieldData.length
            },
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating monthly yield breakdown:", error);
        return c.json({error: "Failed to calculate monthly yield breakdown"}, 500);
    }
});

// Get monthly yield breakdown for isolated pairs only
app.get("/user/:address/monthly-yield-breakdown-isolated", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate minimum time range (at least 1 month = ~30 days)
    const minPeriodSeconds = 30 * 24 * 60 * 60; // 30 days
    if (toTimestamp - fromTimestamp < minPeriodSeconds) {
        return c.json({error: "Time period must be at least 1 month (30 days). Use daily-yield-breakdown for shorter periods."}, 400);
    }

    // Validate reasonable time range (not more than 3 years for monthly breakdown)
    const maxPeriodSeconds = 3 * 365 * 24 * 60 * 60; // 3 years
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 3 years for monthly breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate monthly yield for isolated pairs
        const isolatedPairYields = await calculateMonthlyIsolatedPairYields(context, userAddress, fromTimestamp, toTimestamp);

        if (isolatedPairYields.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                months: 0,
                monthlyBreakdown: [],
                summary: {
                    totalYield: "0",
                    totalYieldFormatted: "0.000000",
                    averageMonthlyYield: "0",
                    averageMonthlyYieldFormatted: "0.000000",
                    maxMonthlyYield: "0",
                    maxMonthlyYieldFormatted: "0.000000",
                    minMonthlyYield: "0",
                    minMonthlyYieldFormatted: "0.000000",
                    monthsWithYield: 0,
                    totalMonths: 0
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for isolated pairs
        const totalYield = isolatedPairYields.reduce((sum, month) => sum + month.monthlyYield, 0n);
        const monthsWithYield = isolatedPairYields.filter(month => month.monthlyYield > 0n).length;
        const averageMonthlyYield = isolatedPairYields.length > 0 ? totalYield / BigInt(isolatedPairYields.length) : 0n;
        const maxMonthlyYield = isolatedPairYields.reduce((max, month) => month.monthlyYield > max ? month.monthlyYield : max, 0n);
        const minMonthlyYield = isolatedPairYields.reduce((min, month) => month.monthlyYield < min ? month.monthlyYield : min, isolatedPairYields[0]?.monthlyYield || 0n);

        // Format the response data for isolated pairs
        const formattedBreakdown = isolatedPairYields.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            startDate: month.startDate,
            endDate: month.endDate,
            monthlyYield: month.monthlyYield.toString(),
            monthlyYieldFormatted: formatRayValue(month.monthlyYield),
            pairs: month.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                assetYieldFormatted: formatRayValue(pair.assetYield),
                borrowYield: pair.borrowYield.toString(),
                borrowYieldFormatted: formatRayValue(pair.borrowYield),
                netYield: pair.netYield.toString(),
                netYieldFormatted: formatRayValue(pair.netYield)
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            months: isolatedPairYields.length,
            monthlyBreakdown: formattedBreakdown,
            summary: {
                totalYield: totalYield.toString(),
                totalYieldFormatted: formatRayValue(totalYield),
                averageMonthlyYield: averageMonthlyYield.toString(),
                averageMonthlyYieldFormatted: formatRayValue(averageMonthlyYield),
                maxMonthlyYield: maxMonthlyYield.toString(),
                maxMonthlyYieldFormatted: formatRayValue(maxMonthlyYield),
                minMonthlyYield: minMonthlyYield.toString(),
                minMonthlyYieldFormatted: formatRayValue(minMonthlyYield),
                monthsWithYield: monthsWithYield,
                totalMonths: isolatedPairYields.length
            },
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating isolated pair monthly yield breakdown:", error);
        return c.json({error: "Failed to calculate isolated pair monthly yield breakdown"}, 500);
    }
});

// Get monthly portfolio values for a specific user over a custom time period
// Portfolio Value = Total Supplied - Total Borrowed (both with accrued interest)
app.get("/user/:address/monthly-portfolio-value", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate minimum time range (at least 1 month = ~30 days)
    const minPeriodSeconds = 30 * 24 * 60 * 60; // 30 days
    if (toTimestamp - fromTimestamp < minPeriodSeconds) {
        return c.json({error: "Time period must be at least 1 month (30 days). Use daily-portfolio-value for shorter periods."}, 400);
    }

    // Validate reasonable time range (not more than 3 years for monthly breakdown)
    const maxPeriodSeconds = 3 * 365 * 24 * 60 * 60; // 3 years
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 3 years for monthly breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // Calculate monthly portfolio values for regular pool only
        const monthlyPortfolioData = await calculateUserMonthlyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        if (monthlyPortfolioData.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                months: 0,
                monthlyPortfolioValues: [],
                summary: {
                    averagePortfolioValue: "0",
                    averagePortfolioValueFormatted: "0.000000",
                    maxPortfolioValue: "0",
                    maxPortfolioValueFormatted: "0.000000",
                    minPortfolioValue: "0",
                    minPortfolioValueFormatted: "0.000000",
                    currentPortfolioValue: "0",
                    currentPortfolioValueFormatted: "0.000000",
                    totalMonths: 0
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for regular pool
        const totalPortfolioValue = monthlyPortfolioData.reduce((sum, month) => sum + month.portfolioValue, 0n);
        const averagePortfolioValue = monthlyPortfolioData.length > 0 ? totalPortfolioValue / BigInt(monthlyPortfolioData.length) : 0n;
        const maxPortfolioValue = monthlyPortfolioData.reduce((max, month) => month.portfolioValue > max ? month.portfolioValue : max, monthlyPortfolioData[0]?.portfolioValue || 0n);
        const minPortfolioValue = monthlyPortfolioData.reduce((min, month) => month.portfolioValue < min ? month.portfolioValue : min, monthlyPortfolioData[0]?.portfolioValue || 0n);
        const currentPortfolioValue = monthlyPortfolioData[monthlyPortfolioData.length - 1]?.portfolioValue || 0n;

        // Format the response data
        const TOKEN_DECIMALS = 18;
        const formattedPortfolio = monthlyPortfolioData.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            endDate: month.endDate,
            endTimestamp: month.endTimestamp,
            portfolioValue: month.portfolioValue.toString(),
            portfolioValueFormatted: formatTokenBalance(month.portfolioValue, TOKEN_DECIMALS),
            totalSupplied: month.totalSupplied.toString(),
            totalSuppliedFormatted: formatTokenBalance(month.totalSupplied, TOKEN_DECIMALS),
            totalBorrowed: month.totalBorrowed.toString(),
            totalBorrowedFormatted: formatTokenBalance(month.totalBorrowed, TOKEN_DECIMALS),
            assets: month.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                suppliedFormatted: formatTokenBalance(asset.supplied, TOKEN_DECIMALS),
                borrowed: asset.borrowed.toString(),
                borrowedFormatted: formatTokenBalance(asset.borrowed, TOKEN_DECIMALS),
                netPosition: asset.netPosition.toString(),
                netPositionFormatted: formatTokenBalance(asset.netPosition, TOKEN_DECIMALS)
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            months: monthlyPortfolioData.length,
            monthlyPortfolioValues: formattedPortfolio,
            summary: {
                averagePortfolioValue: averagePortfolioValue.toString(),
                averagePortfolioValueFormatted: formatTokenBalance(averagePortfolioValue, TOKEN_DECIMALS),
                maxPortfolioValue: maxPortfolioValue.toString(),
                maxPortfolioValueFormatted: formatTokenBalance(maxPortfolioValue, TOKEN_DECIMALS),
                minPortfolioValue: minPortfolioValue.toString(),
                minPortfolioValueFormatted: formatTokenBalance(minPortfolioValue, TOKEN_DECIMALS),
                currentPortfolioValue: currentPortfolioValue.toString(),
                currentPortfolioValueFormatted: formatTokenBalance(currentPortfolioValue, TOKEN_DECIMALS),
                totalMonths: monthlyPortfolioData.length
            },
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating monthly portfolio values:", error);
        return c.json({error: "Failed to calculate monthly portfolio values"}, 500);
    }
});

// Get monthly portfolio values for isolated pairs only
app.get("/user/:address/monthly-portfolio-value-isolated", async (c) => {
    const userAddress = c.req.param("address");
    const fromTimestampParam = c.req.query("fromTimestamp");
    const toTimestampParam = c.req.query("toTimestamp");

    if (!userAddress || !fromTimestampParam || !toTimestampParam) {
        return c.json({error: "User address, fromTimestamp, and toTimestamp are required"}, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    const fromTimestamp = parseInt(fromTimestampParam);
    const toTimestamp = parseInt(toTimestampParam);

    // Validate timestamps
    if (isNaN(fromTimestamp) || isNaN(toTimestamp)) {
        return c.json({error: "Invalid timestamp format. Must be Unix timestamps in seconds"}, 400);
    }

    if (fromTimestamp < 0 || toTimestamp < 0) {
        return c.json({error: "Timestamps must be positive values"}, 400);
    }

    if (toTimestamp <= fromTimestamp) {
        return c.json({error: "toTimestamp must be greater than fromTimestamp"}, 400);
    }

    // Validate minimum time range (at least 1 month = ~30 days)
    const minPeriodSeconds = 30 * 24 * 60 * 60; // 30 days
    if (toTimestamp - fromTimestamp < minPeriodSeconds) {
        return c.json({error: "Time period must be at least 1 month (30 days). Use daily-portfolio-value for shorter periods."}, 400);
    }

    // Validate reasonable time range (not more than 3 years for monthly breakdown)
    const maxPeriodSeconds = 3 * 365 * 24 * 60 * 60; // 3 years
    if (toTimestamp - fromTimestamp > maxPeriodSeconds) {
        return c.json({error: "Time period cannot exceed 3 years for monthly breakdown"}, 400);
    }

    // Validate timestamps are not in the future (with 1 hour buffer for clock differences)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const futureBuffer = 3600; // 1 hour
    if (toTimestamp > currentTimestamp + futureBuffer) {
        return c.json({error: "toTimestamp cannot be in the future"}, 400);
    }

    try {
        const context = {db};

        // First, get the regular pool data to determine month boundaries
        const monthlyPortfolioData = await calculateUserMonthlyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        // Calculate isolated pair positions for each month
        const monthlyIsolatedPairs: Array<{
            year: number;
            month: number;
            monthName: string;
            endDate: string;
            endTimestamp: number;
            portfolioValue: bigint;
            totalSupplied: bigint;
            totalBorrowed: bigint;
            pairs: Array<any>;
        }> = [];

        // If no regular pool data, generate month boundaries manually
        if (monthlyPortfolioData.length === 0) {
            // Generate monthly timestamps from fromTimestamp to toTimestamp
            const startDate = new Date(fromTimestamp * 1000);
            const endDate = new Date(toTimestamp * 1000);

            let currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

            while (currentDate <= endDate) {
                // Get end of month
                const year = currentDate.getFullYear();
                const month = currentDate.getMonth();
                const lastDay = new Date(year, month + 1, 0);
                const endTimestamp = Math.min(Math.floor(lastDay.getTime() / 1000), toTimestamp);

                const positions = await calculateAllIsolatedPairPositions(context, userAddress, endTimestamp, fromTimestamp);

                const totalSupplied = positions.reduce((sum, pos) => sum + pos.collateralAmount + pos.assetAmount, 0n);
                const totalBorrowed = positions.reduce((sum, pos) => sum + pos.borrowAmount, 0n);
                const portfolioValue = totalSupplied - totalBorrowed;

                monthlyIsolatedPairs.push({
                    year,
                    month: month + 1,
                    monthName: currentDate.toLocaleString('default', { month: 'long' }),
                    endDate: lastDay.toISOString().split('T')[0]!,
                    endTimestamp,
                    portfolioValue,
                    totalSupplied,
                    totalBorrowed,
                    pairs: positions.map(pos => ({
                        pair: pos.pair,
                        collateralAmount: pos.collateralAmount.toString(),
                        collateralAmountFormatted: formatRayValue(pos.collateralAmount),
                        assetAmount: pos.assetAmount.toString(),
                        assetAmountFormatted: formatRayValue(pos.assetAmount),
                        borrowAmount: pos.borrowAmount.toString(),
                        borrowAmountFormatted: formatRayValue(pos.borrowAmount)
                    }))
                });

                // Move to next month
                currentDate = new Date(year, month + 1, 1);
            }
        } else {
            // Use regular pool month boundaries
            for (const regularMonth of monthlyPortfolioData) {
                const positions = await calculateAllIsolatedPairPositions(context, userAddress, regularMonth.endTimestamp, fromTimestamp);

                const totalSupplied = positions.reduce((sum, pos) => sum + pos.collateralAmount + pos.assetAmount, 0n);
                const totalBorrowed = positions.reduce((sum, pos) => sum + pos.borrowAmount, 0n);
                const portfolioValue = totalSupplied - totalBorrowed;

                monthlyIsolatedPairs.push({
                    year: regularMonth.year,
                    month: regularMonth.month,
                    monthName: regularMonth.monthName,
                    endDate: regularMonth.endDate,
                    endTimestamp: regularMonth.endTimestamp,
                    portfolioValue,
                    totalSupplied,
                    totalBorrowed,
                    pairs: positions.map(pos => ({
                        pair: pos.pair,
                        collateralAmount: pos.collateralAmount.toString(),
                        collateralAmountFormatted: formatRayValue(pos.collateralAmount),
                        assetAmount: pos.assetAmount.toString(),
                        assetAmountFormatted: formatRayValue(pos.assetAmount),
                        borrowAmount: pos.borrowAmount.toString(),
                        borrowAmountFormatted: formatRayValue(pos.borrowAmount)
                    }))
                });
            }
        }

        if (monthlyIsolatedPairs.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                months: 0,
                monthlyPortfolioValues: [],
                summary: {
                    averagePortfolioValue: "0",
                    averagePortfolioValueFormatted: "0.000000",
                    maxPortfolioValue: "0",
                    maxPortfolioValueFormatted: "0.000000",
                    minPortfolioValue: "0",
                    minPortfolioValueFormatted: "0.000000",
                    currentPortfolioValue: "0",
                    currentPortfolioValueFormatted: "0.000000",
                    totalMonths: 0
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for isolated pairs
        const totalPortfolioValue = monthlyIsolatedPairs.reduce((sum, month) => sum + month.portfolioValue, 0n);
        const averagePortfolioValue = monthlyIsolatedPairs.length > 0 ? totalPortfolioValue / BigInt(monthlyIsolatedPairs.length) : 0n;
        const maxPortfolioValue = monthlyIsolatedPairs.reduce((max, month) => month.portfolioValue > max ? month.portfolioValue : max, 0n);
        const minPortfolioValue = monthlyIsolatedPairs.reduce((min, month) => month.portfolioValue < min ? month.portfolioValue : min, monthlyIsolatedPairs[0]?.portfolioValue || 0n);
        const currentPortfolioValue = monthlyIsolatedPairs[monthlyIsolatedPairs.length - 1]?.portfolioValue || 0n;

        // Format the response data
        const TOKEN_DECIMALS = 18;
        const formattedPortfolio = monthlyIsolatedPairs.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            endDate: month.endDate,
            endTimestamp: month.endTimestamp,
            portfolioValue: month.portfolioValue.toString(),
            portfolioValueFormatted: formatTokenBalance(month.portfolioValue, TOKEN_DECIMALS),
            totalSupplied: month.totalSupplied.toString(),
            totalSuppliedFormatted: formatTokenBalance(month.totalSupplied, TOKEN_DECIMALS),
            totalBorrowed: month.totalBorrowed.toString(),
            totalBorrowedFormatted: formatTokenBalance(month.totalBorrowed, TOKEN_DECIMALS),
            pairs: month.pairs
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            months: monthlyIsolatedPairs.length,
            monthlyPortfolioValues: formattedPortfolio,
            summary: {
                averagePortfolioValue: averagePortfolioValue.toString(),
                averagePortfolioValueFormatted: formatTokenBalance(averagePortfolioValue, TOKEN_DECIMALS),
                maxPortfolioValue: maxPortfolioValue.toString(),
                maxPortfolioValueFormatted: formatTokenBalance(maxPortfolioValue, TOKEN_DECIMALS),
                minPortfolioValue: minPortfolioValue.toString(),
                minPortfolioValueFormatted: formatTokenBalance(minPortfolioValue, TOKEN_DECIMALS),
                currentPortfolioValue: currentPortfolioValue.toString(),
                currentPortfolioValueFormatted: formatTokenBalance(currentPortfolioValue, TOKEN_DECIMALS),
                totalMonths: monthlyIsolatedPairs.length
            },
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating isolated pair monthly portfolio values:", error);
        return c.json({error: "Failed to calculate isolated pair monthly portfolio values"}, 500);
    }
});

// Custom health check endpoint
app.get("/custom-health", async (c) => {
    return c.json({status: "ok", timestamp: Date.now()});
});

export default app;
