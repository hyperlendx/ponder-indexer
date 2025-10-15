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
            startDate: new Date(data.startTimestamp * 1000).toISOString(),
            endDate: new Date(data.endTimestamp * 1000).toISOString(),
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
                durationDays: segment.durationDays
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
                totalBorrowed: "0",
                totalYield: "0",
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
                borrowYield: y.borrowYield.toString(),
                netYield: y.netYield.toString(),

                // Start of period breakdown
                startPeriod: {
                    vaultDeposits: y.startAssetValue.toString(),
                    collateral: y.startCollateralBalance.toString(),
                    totalSupplied: startTotalSupplied.toString(),
                    totalBorrowed: y.startBorrowValue.toString(),
                    assetShares: y.startAssetShares.toString(),
                    borrowShares: y.startBorrowShares.toString(),
                    exchangeRate: y.startExchangeRate.toString()
                },

                // End of period breakdown
                endPeriod: {
                    vaultDeposits: y.endAssetValue.toString(),
                    collateral: y.endCollateralBalance.toString(),
                    totalSupplied: endTotalSupplied.toString(),
                    totalBorrowed: y.endBorrowValue.toString(),
                    assetShares: y.endAssetShares.toString(),
                    borrowShares: y.endBorrowShares.toString(),
                    exchangeRate: y.endExchangeRate.toString()
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
            totalBorrowed: totalBorrowed.toString(),
            totalYield: totalYield.toString(),
            totalPairs: formattedIsolatedPairs.length,
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

        // Format positions for response
        const formattedPositions = positions.map(pos => ({
            asset: pos.asset,
            supplyBalance: pos.depositedAmount.toString(),
            borrowBalance: pos.borrowedAmount.toString()
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

        // Import the isolated pair position calculation function and types
        const { calculateUserCustomPeriodIsolatedPositions } = await import("../helpers/yield/isolatedPair/customPeriodPositions");

        // Calculate isolated pair positions for the period
        const positions = await calculateUserCustomPeriodIsolatedPositions(context, userAddress, fromTimestamp, toTimestamp);

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

        // Format positions for response
        const formattedPositions = positions.map(pos => ({
            pair: pos.pair,
            collateralAmount: pos.collateralAmount.toString(),
            depositedAmount: pos.depositedAmount.toString(),
            borrowedAmount: pos.borrowedAmount.toString()
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
                    averageDailyYield: "0",
                    maxDailyYield: "0",
                    minDailyYield: "0",
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
            pairs: day.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                borrowYield: pair.borrowYield.toString(),
                netYield: pair.netYield.toString()
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
                    maxPortfolioValue: "0",
                    minPortfolioValue: "0",
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
            totalSupplied: day.totalSupplied.toString(),
            totalBorrowed: day.totalBorrowed.toString(),
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                borrowed: asset.borrowed.toString(),
                netPosition: asset.netPosition.toString()
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
                maxPortfolioValue: maxPortfolioValue.toString(),
                minPortfolioValue: minPortfolioValue.toString(),
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
                    assetAmount: pos.assetAmount.toString(),
                    borrowAmount: pos.borrowAmount.toString()
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
                    maxPortfolioValue: "0",
                    minPortfolioValue: "0",
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
            summary: {
                averagePortfolioValue: averagePortfolioValue.toString(),
                maxPortfolioValue: maxPortfolioValue.toString(),
                minPortfolioValue: minPortfolioValue.toString(),
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
                    averageMonthlyYield: "0",
                    maxMonthlyYield: "0",
                    minMonthlyYield: "0",
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
            assets: month.assets.map(asset => ({
                asset: asset.asset,
                monthlyYield: asset.monthlyYield.toString(),
                netDeposits: asset.netDeposits.toString(),
                hadPositionDuringMonth: asset.hadPositionDuringMonth,
                maxBalanceDuringMonth: asset.maxBalanceDuringMonth.toString()
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
                averageMonthlyYield: averageMonthlyYield.toString(),
                maxMonthlyYield: maxMonthlyYield.toString(),
                minMonthlyYield: minMonthlyYield.toString(),
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
                    averageMonthlyYield: "0",
                    maxMonthlyYield: "0",
                    minMonthlyYield: "0",
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
            pairs: month.pairs.map(pair => ({
                pair: pair.pair,
                assetYield: pair.assetYield.toString(),
                borrowYield: pair.borrowYield.toString(),
                netYield: pair.netYield.toString()
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
                averageMonthlyYield: averageMonthlyYield.toString(),
                maxMonthlyYield: maxMonthlyYield.toString(),
                minMonthlyYield: minMonthlyYield.toString(),
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
                    maxPortfolioValue: "0",
                    minPortfolioValue: "0",
                    currentPortfolioValue: "0",
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
        const formattedPortfolio = monthlyPortfolioData.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            endDate: month.endDate,
            endTimestamp: month.endTimestamp,
            portfolioValue: month.portfolioValue.toString(),
            totalSupplied: month.totalSupplied.toString(),
            totalBorrowed: month.totalBorrowed.toString(),
            assets: month.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                borrowed: asset.borrowed.toString(),
                netPosition: asset.netPosition.toString()
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
                maxPortfolioValue: maxPortfolioValue.toString(),
                minPortfolioValue: minPortfolioValue.toString(),
                currentPortfolioValue: currentPortfolioValue.toString(),
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
                        assetAmount: pos.assetAmount.toString(),
                        borrowAmount: pos.borrowAmount.toString()
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
                        assetAmount: pos.assetAmount.toString(),
                        borrowAmount: pos.borrowAmount.toString()
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
                    maxPortfolioValue: "0",
                    minPortfolioValue: "0",
                    currentPortfolioValue: "0",
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
        const formattedPortfolio = monthlyIsolatedPairs.map(month => ({
            year: month.year,
            month: month.month,
            monthName: month.monthName,
            endDate: month.endDate,
            endTimestamp: month.endTimestamp,
            portfolioValue: month.portfolioValue.toString(),
            totalSupplied: month.totalSupplied.toString(),
            totalBorrowed: month.totalBorrowed.toString(),
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
                maxPortfolioValue: maxPortfolioValue.toString(),
                minPortfolioValue: minPortfolioValue.toString(),
                currentPortfolioValue: currentPortfolioValue.toString(),
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
