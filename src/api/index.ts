import {db} from "ponder:api";
import schema from "ponder:schema";
import {Hono} from "hono";
import {graphql} from "ponder";
import {calculateUserCustomPeriodYield, calculateUserDailyYieldBreakdown, calculateUserDailyPortfolioValue, calculateUserMonthlyYieldBreakdown, calculateUserMonthlyPortfolioValue} from "../helpers/yield/yieldReports";
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

// Get custom period yield data for a specific user and time range (core pool only)
// Uses comprehensive activity-based approach - shows ALL assets with activity during period
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

        // Use the comprehensive activity-based position calculation
        const { calculateUserCustomPeriodPositions } = await import("../helpers/yield/positionCalculations");
        const positions = await calculateUserCustomPeriodPositions(context, userAddress, fromTimestamp, toTimestamp);

        if (positions.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                assets: [],
                totalAssets: 0,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Format the response data with comprehensive metrics
        // DO NOT filter out assets with zero yield - return ALL assets with activity
        const formattedAssets = positions.map(pos => ({
            user: userAddress,
            asset: pos.asset,
            // Yield metrics
            yield: pos.totalYieldEarned.toString(),
            // Transaction activity during the period
            totalDeposited: pos.totalDeposited.toString(),
            totalWithdrawn: pos.totalWithdrawn.toString(),
            totalBorrowed: pos.totalBorrowed.toString(),
            totalRepaid: pos.totalRepaid.toString(),
            // Peak balances during the period
            maxSupplyBalance: pos.maxSupplyBalance.toString(),
            maxBorrowBalance: pos.maxBorrowBalance.toString(),
            // Current state at end of period
            currentSupplyBalance: pos.currentSupplyBalance.toString(),
            currentBorrowBalance: pos.currentBorrowBalance.toString(),
            // Derived metrics
            netDeposits: pos.netDeposits.toString(),
            netBorrows: pos.netBorrows.toString(),
            // Legacy fields for backward compatibility
            suppliedAmount: pos.currentSupplyBalance.toString(),
            borrowedAmount: pos.currentBorrowBalance.toString(),
            startDate: new Date(fromTimestamp * 1000).toISOString(),
            endDate: new Date(toTimestamp * 1000).toISOString()
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            assets: formattedAssets,
            totalAssets: formattedAssets.length,
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating custom period yield:", error);
        return c.json({error: "Failed to calculate custom period yield data"}, 500);
    }
});

// Get custom period yield data for isolated pairs only
// Uses comprehensive activity-based approach - shows ALL pairs with activity during period
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

        // Use the comprehensive activity-based position calculation
        const { calculateCustomPeriodIsolatedPairPositions } = await import("../helpers/yield/isolatedPair");
        const positions = await calculateCustomPeriodIsolatedPairPositions(context, userAddress, fromTimestamp, toTimestamp);

        if (positions.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                pairs: [],
                totalPairs: 0,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Format the response data with comprehensive metrics
        // DO NOT filter out pairs with zero yield - return ALL pairs with activity
        const formattedPairs = positions.map(pos => ({
            user: userAddress,
            pair: pos.pair,

            // Yield metrics
            assetYield: pos.totalAssetYield.toString(),
            borrowCost: pos.totalBorrowCost.toString(),
            netYield: pos.totalNetYield.toString(),

            // Transaction activity during the period
            totalDeposited: pos.totalDeposited.toString(),
            totalWithdrawn: pos.totalWithdrawn.toString(),
            totalBorrowed: pos.totalBorrowed.toString(),
            totalRepaid: pos.totalRepaid.toString(),
            totalCollateralAdded: pos.totalCollateralAdded.toString(),
            totalCollateralRemoved: pos.totalCollateralRemoved.toString(),

            // Peak balances during the period
            maxAssetAmount: pos.maxAssetAmount.toString(),
            maxBorrowAmount: pos.maxBorrowAmount.toString(),
            maxCollateralAmount: pos.maxCollateralAmount.toString(),

            // Current state at end of period
            currentAssetAmount: pos.currentAssetAmount.toString(),
            currentBorrowAmount: pos.currentBorrowAmount.toString(),
            currentCollateralAmount: pos.currentCollateralAmount.toString(),

            // Derived metrics
            netDeposits: pos.netDeposits.toString(),
            netBorrows: pos.netBorrows.toString(),
            netCollateral: pos.netCollateral.toString(),

            // Legacy fields for backward compatibility
            startDate: new Date(fromTimestamp * 1000).toISOString(),
            endDate: new Date(toTimestamp * 1000).toISOString()
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            pairs: formattedPairs,
            totalPairs: formattedPairs.length,
            calculatedAt: Math.floor(Date.now() / 1000)
        });

    } catch (error) {
        console.error("Error calculating isolated pair yield:", error);
        return c.json({error: "Failed to calculate isolated pair yield data"}, 500);
    }
});

// Get custom period positions (core pool only) - returns position balances at end of period
app.get("/user/:address/custom-period-positions", async (c) => {
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

        // Import the position calculation function
        const { calculateUserCustomPeriodPositions } = await import("../helpers/yield/positionCalculations");

        // Calculate positions for the period
        const positions = await calculateUserCustomPeriodPositions(context, userAddress, fromTimestamp, toTimestamp);

        if (positions.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                positions: [],
                totalAssets: 0,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Format positions for response with comprehensive data
        const formattedPositions = positions.map(pos => ({
            asset: pos.asset,
            // Transaction activity during the period
            totalDeposited: pos.totalDeposited.toString(),
            totalWithdrawn: pos.totalWithdrawn.toString(),
            totalBorrowed: pos.totalBorrowed.toString(),
            totalRepaid: pos.totalRepaid.toString(),
            // Calculated yield
            totalYieldEarned: pos.totalYieldEarned.toString(),
            // Peak balances during the period (deposits + accrued interest)
            maxSupplyBalance: pos.maxSupplyBalance.toString(),
            maxBorrowBalance: pos.maxBorrowBalance.toString(),
            // Current state at end of period
            currentSupplyBalance: pos.currentSupplyBalance.toString(),
            currentBorrowBalance: pos.currentBorrowBalance.toString(),
            // Derived metrics
            netDeposits: pos.netDeposits.toString(),
            netBorrows: pos.netBorrows.toString()
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            positions: formattedPositions,
            totalAssets: formattedPositions.length,
            calculatedAt: Math.floor(Date.now() / 1000),
        });

    } catch (error) {
        console.error("Error calculating custom period positions:", error);
        return c.json({error: "Failed to calculate custom period positions"}, 500);
    }
});

// Get custom period isolated pair positions - returns position balances at end of period
app.get("/user/:address/custom-period-isolated-positions", async (c) => {
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

        // Import the new comprehensive isolated pair position calculation function
        const { calculateCustomPeriodIsolatedPairPositions } = await import("../helpers/yield/isolatedPair");

        // Calculate comprehensive isolated pair positions for the period
        const positions = await calculateCustomPeriodIsolatedPairPositions(context, userAddress, fromTimestamp, toTimestamp);

        if (positions.length === 0) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                positions: [],
                totalPairs: 0,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Format positions for response with comprehensive data
        const formattedPositions = positions.map(pos => ({
            pair: pos.pair,
            // Transaction activity during the period
            totalDeposited: pos.totalDeposited.toString(),
            totalWithdrawn: pos.totalWithdrawn.toString(),
            totalBorrowed: pos.totalBorrowed.toString(),
            totalRepaid: pos.totalRepaid.toString(),
            totalCollateralAdded: pos.totalCollateralAdded.toString(),
            totalCollateralRemoved: pos.totalCollateralRemoved.toString(),
            // Calculated yield
            totalAssetYield: pos.totalAssetYield.toString(),
            totalBorrowCost: pos.totalBorrowCost.toString(),
            totalNetYield: pos.totalNetYield.toString(),
            // Peak balances during the period
            maxAssetAmount: pos.maxAssetAmount.toString(),
            maxBorrowAmount: pos.maxBorrowAmount.toString(),
            maxCollateralAmount: pos.maxCollateralAmount.toString(),
            // Current state at end of period
            currentAssetAmount: pos.currentAssetAmount.toString(),
            currentBorrowAmount: pos.currentBorrowAmount.toString(),
            currentCollateralAmount: pos.currentCollateralAmount.toString(),
            // Derived metrics
            netDeposits: pos.netDeposits.toString(),
            netBorrows: pos.netBorrows.toString(),
            netCollateral: pos.netCollateral.toString()
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            positions: formattedPositions,
            totalPairs: formattedPositions.length,
            calculatedAt: Math.floor(Date.now() / 1000),
        });

    } catch (error) {
        console.error("Error calculating custom period isolated positions:", error);
        return c.json({error: "Failed to calculate custom period isolated positions"}, 500);
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
                    averageDailyYield: "0",
                    maxDailyYield: "0",
                    minDailyYield: "0",
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
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                dailyYield: asset.dailyYield.toString(),
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
                averageDailyYield: averageDailyYield.toString(),
                maxDailyYield: maxDailyYield.toString(),
                minDailyYield: minDailyYield.toString(),
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
        const yieldData = await calculateDailyIsolatedPairYields(context, userAddress, fromTimestamp, toTimestamp);

        if (yieldData.dailyValues.length === 0 && !yieldData.currentValue) {
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
                currentValue: null,
                summary: {
                    totalYield: "0",
                    averageDailyYield: "0",
                    maxDailyYield: "0",
                    minDailyYield: "0",
                    daysWithYield: 0,
                    totalDaysInPeriod: expectedDays,
                    hasPartialDay: false
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for isolated pairs
        // Include currentValue in calculations if present
        const allValues = [...yieldData.dailyValues];
        if (yieldData.currentValue) {
            allValues.push(yieldData.currentValue);
        }

        const totalYield = allValues.reduce((sum, day) => sum + day.dailyYield, 0n);
        const daysWithYield = allValues.filter(day => day.dailyYield > 0n).length;
        const averageDailyYield = allValues.length > 0 ? totalYield / BigInt(allValues.length) : 0n;
        const maxDailyYield = allValues.reduce((max, day) => day.dailyYield > max ? day.dailyYield : max, 0n);
        const minDailyYield = allValues.reduce((min, day) => day.dailyYield < min ? day.dailyYield : min, allValues[0]?.dailyYield || 0n);

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = yieldData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            dailyYield: day.dailyYield.toString(),
            pairs: day.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                borrowYield: pair.borrowYield.toString(),
                netYield: pair.netYield.toString()
            }))
        }));

        // Serialize current value if present
        const serializedCurrentValue = yieldData.currentValue ? {
            date: yieldData.currentValue.date,
            timestamp: yieldData.currentValue.timestamp,
            dailyYield: yieldData.currentValue.dailyYield.toString(),
            isPartialDay: yieldData.currentValue.isPartialDay,
            pairs: yieldData.currentValue.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                borrowYield: pair.borrowYield.toString(),
                netYield: pair.netYield.toString()
            }))
        } : null;

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyBreakdown: serializedBreakdown,
            currentValue: serializedCurrentValue,
            summary: {
                totalYield: totalYield.toString(),
                averageDailyYield: averageDailyYield.toString(),
                maxDailyYield: maxDailyYield.toString(),
                minDailyYield: minDailyYield.toString(),
                daysWithYield: daysWithYield,
                totalDaysInPeriod: yieldData.dailyValues.length,
                hasPartialDay: !!yieldData.currentValue
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
        const portfolioData = await calculateUserDailyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        if (portfolioData.dailyValues.length === 0 && !portfolioData.currentValue) {
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
                currentValue: null,
                summary: {
                    averagePortfolioValue: "0",
                    maxPortfolioValue: "0",
                    minPortfolioValue: "0",
                    totalDaysInPeriod: expectedDays,
                    hasPartialDay: false
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for regular pool
        // Include currentValue in calculations if present
        const allValues = [...portfolioData.dailyValues];
        if (portfolioData.currentValue) {
            allValues.push(portfolioData.currentValue);
        }

        const totalPortfolioValue = allValues.reduce((sum, day) => sum + day.portfolioValue, 0n);
        const averagePortfolioValue = allValues.length > 0 ? totalPortfolioValue / BigInt(allValues.length) : 0n;
        const maxPortfolioValue = allValues.reduce((max, day) => day.portfolioValue > max ? day.portfolioValue : max, allValues[0]?.portfolioValue || 0n);
        const minPortfolioValue = allValues.reduce((min, day) => day.portfolioValue < min ? day.portfolioValue : min, allValues[0]?.portfolioValue || 0n);

        // Convert all BigInt values to strings for JSON serialization
        const serializedPortfolio = portfolioData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            portfolioValue: day.portfolioValue.toString(),
            totalSupplied: day.totalSupplied.toString(),
            totalBorrowed: day.totalBorrowed.toString(),
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                borrowed: asset.borrowed.toString(),
                netPosition: asset.netPosition.toString()
            }))
        }));

        // Serialize current value if present
        const serializedCurrentValue = portfolioData.currentValue ? {
            date: portfolioData.currentValue.date,
            timestamp: portfolioData.currentValue.timestamp,
            portfolioValue: portfolioData.currentValue.portfolioValue.toString(),
            totalSupplied: portfolioData.currentValue.totalSupplied.toString(),
            totalBorrowed: portfolioData.currentValue.totalBorrowed.toString(),
            isPartialDay: portfolioData.currentValue.isPartialDay,
            assets: portfolioData.currentValue.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                borrowed: asset.borrowed.toString(),
                netPosition: asset.netPosition.toString()
            }))
        } : null;

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
            dailyPortfolioValues: serializedPortfolio,
            currentValue: serializedCurrentValue,
            summary: {
                averagePortfolioValue: averagePortfolioValue.toString(),
                maxPortfolioValue: maxPortfolioValue.toString(),
                minPortfolioValue: minPortfolioValue.toString(),
                totalDaysInPeriod: portfolioData.dailyValues.length,
                hasPartialDay: !!portfolioData.currentValue
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

        // Check if endTimestamp is at a day boundary (midnight UTC)
        const endDate = new Date(toTimestamp * 1000);
        const endDayStart = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) / 1000;
        const isPartialDay = toTimestamp !== endDayStart;

        // Calculate isolated pair positions for each complete day
        const dailyIsolatedPairs: Array<{
            date: string;
            timestamp: number;
            portfolioValue: bigint;
            totalSupplied: bigint;
            totalBorrowed: bigint;
            pairs: Array<any>;
        }> = [];

        // Generate daily timestamps (only complete days)
        const oneDaySeconds = 24 * 60 * 60;
        const endTimestampForDays = isPartialDay ? endDayStart : toTimestamp;

        for (let ts = fromTimestamp; ts <= endTimestampForDays; ts += oneDaySeconds) {
            const dayTimestamp = Math.min(ts, endTimestampForDays);
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
                    assetAmount: pos.assetAmount.toString(),
                    borrowAmount: pos.borrowAmount.toString()
                }))
            });
        }

        // Calculate current value if partial day
        let currentValue: {
            date: string;
            timestamp: number;
            portfolioValue: string;
            totalSupplied: string;
            totalBorrowed: string;
            isPartialDay: boolean;
            pairs: Array<any>;
        } | null = null;

        if (isPartialDay) {
            const currentPositions = await calculateAllIsolatedPairPositions(context, userAddress, toTimestamp, fromTimestamp);
            const currentTotalSupplied = currentPositions.reduce((sum, pos) => sum + pos.collateralAmount + pos.assetAmount, 0n);
            const currentTotalBorrowed = currentPositions.reduce((sum, pos) => sum + pos.borrowAmount, 0n);
            const currentPortfolioValue = currentTotalSupplied - currentTotalBorrowed;

            currentValue = {
                date: endDate.toISOString().split('T')[0]!,
                timestamp: toTimestamp,
                portfolioValue: currentPortfolioValue.toString(),
                totalSupplied: currentTotalSupplied.toString(),
                totalBorrowed: currentTotalBorrowed.toString(),
                isPartialDay: true,
                pairs: currentPositions.map(pos => ({
                    pair: pos.pair,
                    collateralAmount: pos.collateralAmount.toString(),
                    assetAmount: pos.assetAmount.toString(),
                    borrowAmount: pos.borrowAmount.toString()
                }))
            };
        }

        if (dailyIsolatedPairs.length === 0 && !currentValue) {
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: Math.round((toTimestamp - fromTimestamp) / (24 * 60 * 60) * 100) / 100,
                dailyPortfolioValues: [],
                currentValue: null,
                summary: {
                    averagePortfolioValue: "0",
                    maxPortfolioValue: "0",
                    minPortfolioValue: "0",
                    totalDaysInPeriod: expectedDays,
                    hasPartialDay: false
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for isolated pairs
        // Include currentValue in calculations if present
        let totalPortfolioValue = dailyIsolatedPairs.reduce((sum, day) => sum + day.portfolioValue, 0n);
        let maxPortfolioValue = dailyIsolatedPairs.length > 0
            ? dailyIsolatedPairs.reduce((max, day) => day.portfolioValue > max ? day.portfolioValue : max, 0n)
            : 0n;
        let minPortfolioValue = dailyIsolatedPairs.length > 0
            ? dailyIsolatedPairs.reduce((min, day) => day.portfolioValue < min ? day.portfolioValue : min, dailyIsolatedPairs[0]?.portfolioValue || 0n)
            : 0n;

        let valueCount = dailyIsolatedPairs.length;
        if (currentValue) {
            const currentPortfolioValueBigInt = BigInt(currentValue.portfolioValue);
            totalPortfolioValue += currentPortfolioValueBigInt;
            maxPortfolioValue = currentPortfolioValueBigInt > maxPortfolioValue ? currentPortfolioValueBigInt : maxPortfolioValue;
            minPortfolioValue = valueCount === 0 ? currentPortfolioValueBigInt : (currentPortfolioValueBigInt < minPortfolioValue ? currentPortfolioValueBigInt : minPortfolioValue);
            valueCount++;
        }

        const averagePortfolioValue = valueCount > 0 ? totalPortfolioValue / BigInt(valueCount) : 0n;

        // Convert all BigInt values to strings for JSON serialization
        const serializedPortfolio = dailyIsolatedPairs.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            portfolioValue: day.portfolioValue.toString(),
            totalSupplied: day.totalSupplied.toString(),
            totalBorrowed: day.totalBorrowed.toString(),
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
            currentValue: currentValue,
            summary: {
                averagePortfolioValue: averagePortfolioValue.toString(),
                maxPortfolioValue: maxPortfolioValue.toString(),
                minPortfolioValue: minPortfolioValue.toString(),
                totalDaysInPeriod: dailyIsolatedPairs.length,
                hasPartialDay: !!currentValue
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
        const yieldData = await calculateUserMonthlyYieldBreakdown(context, userAddress, fromTimestamp, toTimestamp);

        if (yieldData.monthlyValues.length === 0 && !yieldData.currentValue) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                months: 0,
                monthlyBreakdown: [],
                currentValue: null,
                summary: {
                    totalYield: "0",
                    averageMonthlyYield: "0",
                    maxMonthlyYield: "0",
                    minMonthlyYield: "0",
                    monthsWithYield: 0,
                    totalMonths: 0,
                    hasPartialMonth: false
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for regular pool
        // Include currentValue in calculations if present
        const allValues = [...yieldData.monthlyValues];
        if (yieldData.currentValue) {
            allValues.push(yieldData.currentValue);
        }

        const totalYield = allValues.reduce((sum, month) => sum + month.totalYield, 0n);
        const monthsWithYield = allValues.filter(month => month.totalYield > 0n).length;
        const averageMonthlyYield = allValues.length > 0 ? totalYield / BigInt(allValues.length) : 0n;
        const maxMonthlyYield = allValues.reduce((max, month) => month.totalYield > max ? month.totalYield : max, 0n);
        const minMonthlyYield = allValues.reduce((min, month) => month.totalYield < min ? month.totalYield : min, allValues[0]?.totalYield || 0n);

        // Format the response data for regular pool
        const formattedBreakdown = yieldData.monthlyValues.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            startDate: month.startDate,
            endDate: month.endDate,
            totalYield: month.totalYield.toString(),
            assets: month.assets.map(asset => ({
                asset: asset.asset,
                monthlyYield: asset.monthlyYield.toString(),
                netDeposits: asset.netDeposits.toString(),
                hadPositionDuringMonth: asset.hadPositionDuringMonth,
                maxBalanceDuringMonth: asset.maxBalanceDuringMonth.toString()
            }))
        }));

        // Serialize current value if present
        const serializedCurrentValue = yieldData.currentValue ? {
            year: yieldData.currentValue.year,
            month: yieldData.currentValue.month,
            monthName: yieldData.currentValue.monthName,
            startDate: yieldData.currentValue.startDate,
            endDate: yieldData.currentValue.endDate,
            totalYield: yieldData.currentValue.totalYield.toString(),
            isPartialMonth: yieldData.currentValue.isPartialMonth,
            daysInPeriod: yieldData.currentValue.daysInPeriod,
            assets: yieldData.currentValue.assets.map(asset => ({
                asset: asset.asset,
                monthlyYield: asset.monthlyYield.toString(),
                netDeposits: asset.netDeposits.toString(),
                hadPositionDuringMonth: asset.hadPositionDuringMonth,
                maxBalanceDuringMonth: asset.maxBalanceDuringMonth.toString()
            }))
        } : null;

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            months: yieldData.monthlyValues.length,
            monthlyBreakdown: formattedBreakdown,
            currentValue: serializedCurrentValue,
            summary: {
                totalYield: totalYield.toString(),
                averageMonthlyYield: averageMonthlyYield.toString(),
                maxMonthlyYield: maxMonthlyYield.toString(),
                minMonthlyYield: minMonthlyYield.toString(),
                monthsWithYield: monthsWithYield,
                totalMonths: yieldData.monthlyValues.length,
                hasPartialMonth: !!yieldData.currentValue
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
        const yieldData = await calculateMonthlyIsolatedPairYields(context, userAddress, fromTimestamp, toTimestamp);

        if (yieldData.monthlyValues.length === 0 && !yieldData.currentValue) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                months: 0,
                monthlyBreakdown: [],
                currentValue: null,
                summary: {
                    totalYield: "0",
                    averageMonthlyYield: "0",
                    maxMonthlyYield: "0",
                    minMonthlyYield: "0",
                    monthsWithYield: 0,
                    totalMonths: 0,
                    hasPartialMonth: false
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Calculate summary statistics for isolated pairs
        // Include currentValue in calculations if present
        const allValues = [...yieldData.monthlyValues];
        if (yieldData.currentValue) {
            allValues.push(yieldData.currentValue);
        }

        const totalYield = allValues.reduce((sum, month) => sum + month.monthlyYield, 0n);
        const monthsWithYield = allValues.filter(month => month.monthlyYield > 0n).length;
        const averageMonthlyYield = allValues.length > 0 ? totalYield / BigInt(allValues.length) : 0n;
        const maxMonthlyYield = allValues.reduce((max, month) => month.monthlyYield > max ? month.monthlyYield : max, 0n);
        const minMonthlyYield = allValues.reduce((min, month) => month.monthlyYield < min ? month.monthlyYield : min, allValues[0]?.monthlyYield || 0n);

        // Format the response data for isolated pairs
        const formattedBreakdown = yieldData.monthlyValues.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            startDate: month.startDate,
            endDate: month.endDate,
            monthlyYield: month.monthlyYield.toString(),
            pairs: month.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                borrowYield: pair.borrowYield.toString(),
                netYield: pair.netYield.toString()
            }))
        }));

        // Serialize current value if present
        const serializedCurrentValue = yieldData.currentValue ? {
            year: yieldData.currentValue.year,
            month: yieldData.currentValue.month,
            monthName: yieldData.currentValue.monthName,
            startDate: yieldData.currentValue.startDate,
            endDate: yieldData.currentValue.endDate,
            monthlyYield: yieldData.currentValue.monthlyYield.toString(),
            isPartialMonth: yieldData.currentValue.isPartialMonth,
            daysInPeriod: yieldData.currentValue.daysInPeriod,
            pairs: yieldData.currentValue.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                borrowYield: pair.borrowYield.toString(),
                netYield: pair.netYield.toString()
            }))
        } : null;

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            months: yieldData.monthlyValues.length,
            monthlyBreakdown: formattedBreakdown,
            currentValue: serializedCurrentValue,
            summary: {
                totalYield: totalYield.toString(),
                averageMonthlyYield: averageMonthlyYield.toString(),
                maxMonthlyYield: maxMonthlyYield.toString(),
                minMonthlyYield: minMonthlyYield.toString(),
                monthsWithYield: monthsWithYield,
                totalMonths: yieldData.monthlyValues.length,
                hasPartialMonth: !!yieldData.currentValue
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
        const portfolioData = await calculateUserMonthlyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        if (portfolioData.monthlyValues.length === 0 && !portfolioData.currentValue) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                months: 0,
                monthlyPositions: [],
                currentValue: null,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Format the response data
        const formattedPortfolio = portfolioData.monthlyValues.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            endDate: month.endDate,
            endTimestamp: month.endTimestamp,
            assets: month.assets.map(asset => ({
                asset: asset.asset,
                totalDeposited: asset.totalDeposited.toString(),
                totalWithdrawn: asset.totalWithdrawn.toString(),
                totalBorrowed: asset.totalBorrowed.toString(),
                totalRepaid: asset.totalRepaid.toString(),
                totalYieldEarned: asset.totalYieldEarned.toString(),
                maxSupplyBalance: asset.maxSupplyBalance.toString(),
                maxBorrowBalance: asset.maxBorrowBalance.toString(),
                currentSupplyBalance: asset.currentSupplyBalance.toString(),
                currentBorrowBalance: asset.currentBorrowBalance.toString(),
                netDeposits: asset.netDeposits.toString(),
                netBorrows: asset.netBorrows.toString()
            }))
        }));

        // Serialize current value if present
        const serializedCurrentValue = portfolioData.currentValue ? {
            year: portfolioData.currentValue.year,
            month: portfolioData.currentValue.month,
            monthName: portfolioData.currentValue.monthName,
            startDate: portfolioData.currentValue.startDate,
            endDate: portfolioData.currentValue.endDate,
            endTimestamp: portfolioData.currentValue.endTimestamp,
            isPartialMonth: portfolioData.currentValue.isPartialMonth,
            daysInPeriod: portfolioData.currentValue.daysInPeriod,
            assets: portfolioData.currentValue.assets.map(asset => ({
                asset: asset.asset,
                totalDeposited: asset.totalDeposited.toString(),
                totalWithdrawn: asset.totalWithdrawn.toString(),
                totalBorrowed: asset.totalBorrowed.toString(),
                totalRepaid: asset.totalRepaid.toString(),
                totalYieldEarned: asset.totalYieldEarned.toString(),
                maxSupplyBalance: asset.maxSupplyBalance.toString(),
                maxBorrowBalance: asset.maxBorrowBalance.toString(),
                currentSupplyBalance: asset.currentSupplyBalance.toString(),
                currentBorrowBalance: asset.currentBorrowBalance.toString(),
                netDeposits: asset.netDeposits.toString(),
                netBorrows: asset.netBorrows.toString()
            }))
        } : null;

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            months: portfolioData.monthlyValues.length,
            monthlyPositions: formattedPortfolio,
            currentValue: serializedCurrentValue,
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

        // Import the custom period positions function
        const { calculateCustomPeriodIsolatedPairPositions } = await import("../helpers/yield/isolatedPair/positionCalculations");

        // First, get the regular pool data to determine month boundaries
        const portfolioData = await calculateUserMonthlyPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        // Calculate isolated pair positions for each month
        const monthlyIsolatedPairs: Array<{
            year: number;
            month: number;
            monthName: string;
            endDate: string;
            endTimestamp: number;
            pairs: Array<any>;
        }> = [];

        // If no regular pool data, generate month boundaries manually
        if (portfolioData.monthlyValues.length === 0 && !portfolioData.currentValue) {
            // Generate monthly timestamps from fromTimestamp to toTimestamp using UTC
            const startDate = new Date(fromTimestamp * 1000);
            const endDate = new Date(toTimestamp * 1000);

            let currentDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

            while (currentDate <= endDate) {
                // Get end of month using UTC
                const year = currentDate.getUTCFullYear();
                const month = currentDate.getUTCMonth();

                // Last day of month: go to first day of next month and subtract 1 second
                const nextMonthStart = Date.UTC(year, month + 1, 1);
                const lastDayTimestamp = Math.floor((nextMonthStart - 1000) / 1000); // Last second of month
                const endTimestamp = Math.min(lastDayTimestamp, toTimestamp);

                // Calculate start of month timestamp
                const monthStartTimestamp = Math.floor(Date.UTC(year, month, 1) / 1000);

                // Use custom period positions to get comprehensive data including closed positions
                const positions = await calculateCustomPeriodIsolatedPairPositions(
                    context,
                    userAddress,
                    monthStartTimestamp,
                    endTimestamp
                );

                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                                   'July', 'August', 'September', 'October', 'November', 'December'];

                monthlyIsolatedPairs.push({
                    year,
                    month: month + 1,
                    monthName: monthNames[month]!,
                    endDate: new Date(endTimestamp * 1000).toISOString().split('T')[0]!,
                    endTimestamp,
                    pairs: positions.map(pos => ({
                        pair: pos.pair,
                        totalDeposited: pos.totalDeposited.toString(),
                        totalWithdrawn: pos.totalWithdrawn.toString(),
                        totalBorrowed: pos.totalBorrowed.toString(),
                        totalRepaid: pos.totalRepaid.toString(),
                        totalCollateralAdded: pos.totalCollateralAdded.toString(),
                        totalCollateralRemoved: pos.totalCollateralRemoved.toString(),
                        totalAssetYield: pos.totalAssetYield.toString(),
                        totalBorrowCost: pos.totalBorrowCost.toString(),
                        totalNetYield: pos.totalNetYield.toString(),
                        maxAssetAmount: pos.maxAssetAmount.toString(),
                        maxBorrowAmount: pos.maxBorrowAmount.toString(),
                        maxCollateralAmount: pos.maxCollateralAmount.toString(),
                        currentAssetAmount: pos.currentAssetAmount.toString(),
                        currentBorrowAmount: pos.currentBorrowAmount.toString(),
                        currentCollateralAmount: pos.currentCollateralAmount.toString(),
                        netDeposits: pos.netDeposits.toString(),
                        netBorrows: pos.netBorrows.toString(),
                        netCollateral: pos.netCollateral.toString()
                    }))
                });

                // Move to next month using UTC
                currentDate = new Date(Date.UTC(year, month + 1, 1));
            }
        } else {
            // Use regular pool month boundaries
            for (const regularMonth of portfolioData.monthlyValues) {
                // Calculate start of month timestamp
                const monthStartTimestamp = Math.floor(Date.UTC(regularMonth.year, regularMonth.month - 1, 1) / 1000);

                // Use custom period positions to get comprehensive data including closed positions
                const positions = await calculateCustomPeriodIsolatedPairPositions(
                    context,
                    userAddress,
                    monthStartTimestamp,
                    regularMonth.endTimestamp
                );

                monthlyIsolatedPairs.push({
                    year: regularMonth.year,
                    month: regularMonth.month,
                    monthName: regularMonth.monthName,
                    endDate: regularMonth.endDate,
                    endTimestamp: regularMonth.endTimestamp,
                    pairs: positions.map(pos => ({
                        pair: pos.pair,
                        totalDeposited: pos.totalDeposited.toString(),
                        totalWithdrawn: pos.totalWithdrawn.toString(),
                        totalBorrowed: pos.totalBorrowed.toString(),
                        totalRepaid: pos.totalRepaid.toString(),
                        totalCollateralAdded: pos.totalCollateralAdded.toString(),
                        totalCollateralRemoved: pos.totalCollateralRemoved.toString(),
                        totalAssetYield: pos.totalAssetYield.toString(),
                        totalBorrowCost: pos.totalBorrowCost.toString(),
                        totalNetYield: pos.totalNetYield.toString(),
                        maxAssetAmount: pos.maxAssetAmount.toString(),
                        maxBorrowAmount: pos.maxBorrowAmount.toString(),
                        maxCollateralAmount: pos.maxCollateralAmount.toString(),
                        currentAssetAmount: pos.currentAssetAmount.toString(),
                        currentBorrowAmount: pos.currentBorrowAmount.toString(),
                        currentCollateralAmount: pos.currentCollateralAmount.toString(),
                        netDeposits: pos.netDeposits.toString(),
                        netBorrows: pos.netBorrows.toString(),
                        netCollateral: pos.netCollateral.toString()
                    }))
                });
            }
        }

        // Calculate current partial month value if present in regular pool data
        let currentValue: {
            year: number;
            month: number;
            monthName: string;
            endDate: string;
            endTimestamp: number;
            isPartialMonth: boolean;
            daysInPeriod: number;
            pairs: Array<any>;
        } | undefined;

        if (portfolioData.currentValue) {
            // Calculate start of month timestamp
            const monthStartTimestamp = Math.floor(Date.UTC(portfolioData.currentValue.year, portfolioData.currentValue.month - 1, 1) / 1000);

            // Use custom period positions to get comprehensive data including closed positions
            const positions = await calculateCustomPeriodIsolatedPairPositions(
                context,
                userAddress,
                monthStartTimestamp,
                portfolioData.currentValue.endTimestamp
            );

            currentValue = {
                year: portfolioData.currentValue.year,
                month: portfolioData.currentValue.month,
                monthName: portfolioData.currentValue.monthName,
                endDate: portfolioData.currentValue.endDate,
                endTimestamp: portfolioData.currentValue.endTimestamp,
                isPartialMonth: portfolioData.currentValue.isPartialMonth,
                daysInPeriod: portfolioData.currentValue.daysInPeriod,
                pairs: positions.map(pos => ({
                    pair: pos.pair,
                    totalDeposited: pos.totalDeposited.toString(),
                    totalWithdrawn: pos.totalWithdrawn.toString(),
                    totalBorrowed: pos.totalBorrowed.toString(),
                    totalRepaid: pos.totalRepaid.toString(),
                    totalCollateralAdded: pos.totalCollateralAdded.toString(),
                    totalCollateralRemoved: pos.totalCollateralRemoved.toString(),
                    totalAssetYield: pos.totalAssetYield.toString(),
                    totalBorrowCost: pos.totalBorrowCost.toString(),
                    totalNetYield: pos.totalNetYield.toString(),
                    maxAssetAmount: pos.maxAssetAmount.toString(),
                    maxBorrowAmount: pos.maxBorrowAmount.toString(),
                    maxCollateralAmount: pos.maxCollateralAmount.toString(),
                    currentAssetAmount: pos.currentAssetAmount.toString(),
                    currentBorrowAmount: pos.currentBorrowAmount.toString(),
                    currentCollateralAmount: pos.currentCollateralAmount.toString(),
                    netDeposits: pos.netDeposits.toString(),
                    netBorrows: pos.netBorrows.toString(),
                    netCollateral: pos.netCollateral.toString()
                }))
            };
        }

        if (monthlyIsolatedPairs.length === 0 && !currentValue) {
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                months: 0,
                monthlyPortfolioValues: [],
                currentValue: null,
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Format the response data
        const formattedPortfolio = monthlyIsolatedPairs.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            endDate: month.endDate,
            endTimestamp: month.endTimestamp,
            pairs: month.pairs
        }));

        // Serialize current value if present
        const serializedCurrentValue = currentValue ? {
            year: currentValue.year,
            month: currentValue.month,
            monthName: currentValue.monthName,
            endDate: currentValue.endDate,
            endTimestamp: currentValue.endTimestamp,
            isPartialMonth: currentValue.isPartialMonth,
            daysInPeriod: currentValue.daysInPeriod,
            pairs: currentValue.pairs
        } : null;

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            months: monthlyIsolatedPairs.length,
            monthlyPortfolioValues: formattedPortfolio,
            currentValue: serializedCurrentValue,
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
