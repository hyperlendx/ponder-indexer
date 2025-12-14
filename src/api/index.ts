import {db} from "ponder:api";
import schema from "ponder:schema";
import {Hono} from "hono";
import {graphql, eq, and, desc} from "ponder";
import {
    calculateUserDailyYieldBreakdown,
    calculateUserDailyPortfolioValue,
} from "../helpers/yield/yieldReports";
import {
    calculateAllIsolatedPairPositions,
    calculateDailyIsolatedPairYields,
    calculateUserDailyIsolatedPairPortfolioValue,
} from "../helpers/yield/isolatedPair";
import {cors} from 'hono/cors'

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

        // Use the simplified yield calculation with detailed breakdowns
        const {calculateUserYieldPositions} = await import("../helpers/yield/positionCalculations");
        const positions = await calculateUserYieldPositions(context, userAddress, fromTimestamp, toTimestamp);

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

        // Format the response data - only activity metrics, yield calculations, and detailed breakdowns
        // USD values are already calculated in calculateUserYieldPositions
        const formattedAssets = positions.map(pos => ({
            asset: pos.asset,
            totalYieldEarned: pos.totalYieldEarned.toString(),
            totalBorrowCost: pos.totalBorrowCost.toString(),
            totalDeposited: pos.totalDeposited.toString(),
            totalWithdrawn: pos.totalWithdrawn.toString(),
            totalBorrowed: pos.totalBorrowed.toString(),
            totalRepaid: pos.totalRepaid.toString(),
            // USD values (pre-calculated in calculateUserYieldPositions)
            totalYieldEarnedUSD: pos.totalYieldEarnedUSD,
            totalBorrowCostUSD: pos.totalBorrowCostUSD,
            totalDepositedUSD: pos.totalDepositedUSD,
            totalWithdrawnUSD: pos.totalWithdrawnUSD,
            totalBorrowedUSD: pos.totalBorrowedUSD,
            totalRepaidUSD: pos.totalRepaidUSD,
            totalRawDepositedUSD: pos.totalRawDepositedUSD,
            totalRawBorrowedUSD: pos.totalRawBorrowedUSD,
            totalScaledDepositedUSD: pos.totalScaledDepositedUSD,
            totalScaledBorrowedUSD: pos.totalScaledBorrowedUSD,
            // Other fields
            totalScaledDeposited: pos.totalScaledDeposited.toString(),
            totalScaledBorrowed: pos.totalScaledBorrowed.toString(),
            totalRawDeposited: pos.totalRawDeposited.toString(),
            totalRawBorrowed: pos.totalRawBorrowed.toString(),
            netDeposits: pos.netDeposits.toString(),
            netBorrows: pos.netBorrows.toString(),
            events: pos.events, // Already formatted with string amounts and assetPrice
            events_before_period: pos.events_before_period, // Events that contributed to starting balances
            starting_balances: {
                deposits: pos.starting_balances.deposits.toString(),
                borrows: pos.starting_balances.borrows.toString(),
                scaledDeposits: pos.starting_balances.scaledDeposits.toString(),
                scaledBorrows: pos.starting_balances.scaledBorrows.toString(),
                rawDeposits: pos.starting_balances.rawDeposits.toString(),
                rawBorrows: pos.starting_balances.rawBorrows.toString()
            },
            yieldSegments: pos.yieldSegments.map(seg => ({
                startTime: seg.startTime,
                endTime: seg.endTime,
                startDate: seg.startDate,
                endDate: seg.endDate,
                scaledBalance: seg.scaledBalance.toString(),
                actualBalance: seg.actualBalance.toString(),
                startLiquidityIndex: seg.startLiquidityIndex.toString(),
                endLiquidityIndex: seg.endLiquidityIndex.toString(),
                segmentYield: seg.segmentYield.toString(),
                segmentYieldUSD: seg.segmentYieldUSD, // USD value for this segment
                durationDays: seg.durationDays,
                assetPrice: seg.assetPrice, // Asset price during this segment
                assetPriceTimestamp: seg.assetPriceTimestamp // Timestamp of the price snapshot
            })),
            borrowCostSegments: pos.borrowCostSegments.map(seg => ({
                startTime: seg.startTime,
                endTime: seg.endTime,
                startDate: seg.startDate,
                endDate: seg.endDate,
                scaledBorrowBalance: seg.scaledBorrowBalance.toString(),
                actualBorrowBalance: seg.actualBorrowBalance.toString(),
                startBorrowIndex: seg.startBorrowIndex.toString(),
                endBorrowIndex: seg.endBorrowIndex.toString(),
                segmentBorrowCost: seg.segmentBorrowCost.toString(),
                segmentBorrowCostUSD: seg.segmentBorrowCostUSD, // USD value for this segment
                durationDays: seg.durationDays,
                assetPrice: seg.assetPrice, // Asset price during this segment
                assetPriceTimestamp: seg.assetPriceTimestamp // Timestamp of the price snapshot
            }))
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
        return c.json({
            error: "Failed to calculate custom period yield data",
            details: error instanceof Error ? error.message : String(error)
        }, 500);
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

        console.log(`Starting isolated pair yield calculation for user ${userAddress} from ${fromTimestamp} to ${toTimestamp}`);

        // Use the simplified isolated yield calculation with detailed breakdowns
        const {calculateUserIsolatedYieldPositions} = await import("../helpers/yield/isolatedPair/positionCalculations");

        console.log("About to call calculateUserIsolatedYieldPositions...");
        const positions = await calculateUserIsolatedYieldPositions(context, userAddress, fromTimestamp, toTimestamp);
        console.log(`Calculation completed, found ${positions.length} positions`);

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

        // Format the response data - only activity metrics, yield calculations, and detailed breakdowns
        const formattedPairs = positions.map((pos) => {
            return {
            pair: pos.pair,
            totalYieldEarned: pos.totalYieldEarned?.toString() ?? '0',
            totalBorrowCost: pos.totalBorrowCost?.toString() ?? '0',
            totalDeposited: pos.totalDeposited?.toString() ?? '0',
            totalWithdrawn: pos.totalWithdrawn?.toString() ?? '0',
            totalBorrowed: pos.totalBorrowed?.toString() ?? '0',
            totalRepaid: pos.totalRepaid?.toString() ?? '0',
            totalCollateralAdded: pos.totalCollateralAdded?.toString() ?? '0',
            totalCollateralRemoved: pos.totalCollateralRemoved?.toString() ?? '0',
            totalScaledDeposited: pos.totalScaledDeposited?.toString() ?? '0',
            totalScaledBorrowed: pos.totalScaledBorrowed?.toString() ?? '0',
            totalRawDeposited: pos.totalRawDeposited?.toString() ?? '0',
            totalRawBorrowed: pos.totalRawBorrowed?.toString() ?? '0',
            netDeposits: pos.netDeposits?.toString() ?? '0',
            netBorrows: pos.netBorrows?.toString() ?? '0',
            netCollateral: pos.netCollateral?.toString() ?? '0',
            // USD values (pre-calculated in calculateUserIsolatedYieldPositions)
            totalYieldEarnedUSD: pos.totalYieldEarnedUSD ?? '0.00',
            totalBorrowCostUSD: pos.totalBorrowCostUSD ?? '0.00',
            totalDepositedUSD: pos.totalDepositedUSD ?? '0.00',
            totalWithdrawnUSD: pos.totalWithdrawnUSD ?? '0.00',
            totalBorrowedUSD: pos.totalBorrowedUSD ?? '0.00',
            totalRepaidUSD: pos.totalRepaidUSD ?? '0.00',
            totalCollateralAddedUSD: pos.totalCollateralAddedUSD ?? '0.00',
            totalCollateralRemovedUSD: pos.totalCollateralRemovedUSD ?? '0.00',
            totalRawDepositedUSD: pos.totalRawDepositedUSD ?? '0.00',
            totalRawBorrowedUSD: pos.totalRawBorrowedUSD ?? '0.00',
            totalScaledDepositedUSD: pos.totalScaledDepositedUSD ?? '0.00',
            totalScaledBorrowedUSD: pos.totalScaledBorrowedUSD ?? '0.00',
            events: pos.events ?? [], // Already formatted with string amounts
            events_before_period: pos.events_before_period ?? [], // Events that contributed to starting balances
            starting_balances: {
                collateral: pos.starting_balances?.collateral?.toString() ?? '0',
                deposits: pos.starting_balances?.deposits?.toString() ?? '0',
                borrows: pos.starting_balances?.borrows?.toString() ?? '0',
                scaledDeposits: pos.starting_balances?.scaledDeposits?.toString() ?? '0',
                scaledBorrows: pos.starting_balances?.scaledBorrows?.toString() ?? '0',
                rawDeposits: pos.starting_balances?.rawDeposits?.toString() ?? '0',
                rawBorrows: pos.starting_balances?.rawBorrows?.toString() ?? '0'
            },
            yieldSegments: (pos.yieldSegments ?? []).map((seg) => {
                if (!seg) {
                    console.error(`yieldSegment is null/undefined!`);
                    throw new Error(`yieldSegment is null/undefined`);
                }
                return {
                    startTime: seg.startTime,
                    endTime: seg.endTime,
                    startDate: seg.startDate,
                    endDate: seg.endDate,
                    assetShares: seg.assetShares?.toString() ?? '0',
                    actualAssetAmount: seg.actualAssetAmount?.toString() ?? '0',
                    startExchangeRate: seg.startExchangeRate?.toString() ?? '0',
                    endExchangeRate: seg.endExchangeRate?.toString() ?? '0',
                    segmentYield: seg.segmentYield?.toString() ?? '0',
                    segmentYieldUSD: seg.segmentYieldUSD ?? '0.00', // USD value for this segment
                    durationDays: seg.durationDays ?? 0,
                    assetAddress: seg.assetAddress ?? '', // Asset token address
                    assetPrice: seg.assetPrice ?? '0', // Asset price during this segment
                    assetPriceTimestamp: seg.assetPriceTimestamp // Timestamp of the price snapshot
                };
            }),
            borrowCostSegments: (pos.borrowCostSegments ?? []).map((seg) => {
                if (!seg) {
                    console.error(`borrowCostSegment is null/undefined!`);
                    throw new Error(`borrowCostSegment is null/undefined`);
                }
                return {
                    startTime: seg.startTime,
                    endTime: seg.endTime,
                    startDate: seg.startDate,
                    endDate: seg.endDate,
                    borrowShares: seg.borrowShares?.toString() ?? '0',
                    actualBorrowAmount: seg.actualBorrowAmount?.toString() ?? '0',
                    startExchangeRate: seg.startExchangeRate?.toString() ?? '0',
                    endExchangeRate: seg.endExchangeRate?.toString() ?? '0',
                    segmentBorrowCost: seg.segmentBorrowCost?.toString() ?? '0',
                    segmentBorrowCostUSD: seg.segmentBorrowCostUSD ?? '0.00', // USD value for this segment
                    durationDays: seg.durationDays ?? 0,
                    assetAddress: seg.assetAddress ?? '', // Asset token address
                    assetPrice: seg.assetPrice ?? '0', // Asset price during this segment
                    assetPriceTimestamp: seg.assetPriceTimestamp // Timestamp of the price snapshot
                };
            })
        };
        });

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
        // @ts-ignore
        console.error("Error details:", error.message);
        return c.json({
            error: "Failed to calculate isolated pair yield data",
            // @ts-ignore
            details: error.message,
            user: userAddress,
            fromTimestamp,
            toTimestamp
        }, 500);
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
        const yieldData = await calculateUserDailyYieldBreakdown(context, userAddress, fromTimestamp, toTimestamp);

        // Note: yieldData.dailyValues now includes all days in the period (including zero-yield days)
        // Only return empty response if no data could be calculated at all (e.g., no assets found)
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
                    totalDaysInPeriod: expectedDays,
                    hasPartialDay: false
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period",
                note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = yieldData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            assetYield: day.assetYield.toString(),
            borrowCost: day.borrowCost.toString(),
            netYield: day.netYield.toString(),
            assetYieldUSD: day.assetYieldUSD,
            borrowCostUSD: day.borrowCostUSD,
            netYieldUSD: day.netYieldUSD,
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                assetPrice: asset.assetPrice,
                assetPriceTimestamp: asset.assetPriceTimestamp,
                assetYield: asset.assetYield.toString(),
                borrowCost: asset.borrowCost.toString(),
                netYield: asset.netYield.toString(),
                assetYieldUSD: asset.assetYieldUSD,
                borrowCostUSD: asset.borrowCostUSD,
                netYieldUSD: asset.netYieldUSD,
                segments: asset.segments, // Already converted to strings in the helper function
                borrowSegments: asset.borrowSegments // Already converted to strings in the helper function
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
                totalDaysInPeriod: yieldData.dailyValues.length
            },
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places"
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

        // Clear exchange rate cache for this request to prevent stale data
        const {clearExchangeRateCache} = await import("../helpers/yield/isolatedPair/exchangeRate");
        clearExchangeRateCache();

        // Calculate daily yield for isolated pairs
        const yieldData = await calculateDailyIsolatedPairYields(context, userAddress, fromTimestamp, toTimestamp);

        if (yieldData.dailyValues.length === 0) {
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
                    totalDaysInPeriod: expectedDays
                },
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period",
                note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedBreakdown = yieldData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            dailyYield: day.dailyYield.toString(),
            assetYieldUSD: day.assetYieldUSD,
            borrowCostUSD: day.borrowCostUSD,
            netYieldUSD: day.netYieldUSD,
            pairs: day.pairs.map(pair => ({
                pair: pair.pair,
                assetAddress: pair.assetAddress,
                assetPrice: pair.assetPrice,
                assetPriceTimestamp: pair.assetPriceTimestamp,
                assetYield: pair.assetYield.toString(),
                borrowCost: pair.borrowCost.toString(),
                netYield: pair.netYield.toString(),
                assetYieldUSD: pair.assetYieldUSD,
                borrowCostUSD: pair.borrowCostUSD,
                netYieldUSD: pair.netYieldUSD
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
                totalDaysInPeriod: yieldData.dailyValues.length
            },
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places. IMPORTANT: assetYield and borrowCost can be NEGATIVE. They represent value changes: assetYield = change in deposit value (can be negative if exchange rate drops), borrowCost = change in debt value (can be negative if debt shrinks, which is a gain). netYield = assetYield - borrowCost."
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

        if (portfolioData.dailyValues.length === 0) {
            // Calculate expected number of days for empty response
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: expectedDays,
                dailyPortfolioValues: [],
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No positions found for this user during the specified period"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedPortfolio = portfolioData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            portfolioValue: day.portfolioValue.toString(),
            totalSupplied: day.totalSupplied.toString(),
            totalBorrowed: day.totalBorrowed.toString(),
            portfolioValueUSD: day.portfolioValueUSD,
            totalSuppliedUSD: day.totalSuppliedUSD,
            totalBorrowedUSD: day.totalBorrowedUSD,
            assets: day.assets.map(asset => ({
                asset: asset.asset,
                supplied: asset.supplied.toString(),
                borrowed: asset.borrowed.toString(),
                netPosition: asset.netPosition.toString(),
                suppliedUSD: asset.suppliedUSD,
                borrowedUSD: asset.borrowedUSD,
                netPositionUSD: asset.netPositionUSD,
                assetPrice: asset.assetPrice, // Oracle price used for USD calculations (8 decimals)
                assetPriceTimestamp: asset.assetPriceTimestamp // Timestamp when the price was recorded
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: portfolioData.dailyValues.length,
            dailyPortfolioValues: serializedPortfolio,
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places. Portfolio values represent actual balances (including accrued interest/yield) at the END of each day (23:59:59 UTC)."
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

        // Clear exchange rate cache for this request to prevent stale data
        const {clearExchangeRateCache} = await import("../helpers/yield/isolatedPair/exchangeRate");
        clearExchangeRateCache();

        // Calculate daily portfolio values for isolated pairs
        const portfolioData = await calculateUserDailyIsolatedPairPortfolioValue(context, userAddress, fromTimestamp, toTimestamp);

        if (portfolioData.dailyValues.length === 0) {
            const expectedDays = Math.ceil((toTimestamp - fromTimestamp) / (24 * 60 * 60));
            return c.json({
                user: userAddress,
                fromTimestamp,
                toTimestamp,
                fromDate: new Date(fromTimestamp * 1000).toISOString(),
                toDate: new Date(toTimestamp * 1000).toISOString(),
                days: expectedDays,
                dailyPortfolioValues: [],
                calculatedAt: Math.floor(Date.now() / 1000),
                message: "No isolated pair positions found for this user during the specified period"
            });
        }

        // Convert all BigInt values to strings for JSON serialization
        const serializedPortfolio = portfolioData.dailyValues.map(day => ({
            date: day.date,
            timestamp: day.timestamp,
            portfolioValue: day.portfolioValue.toString(),
            totalSupplied: day.totalSupplied.toString(),
            totalBorrowed: day.totalBorrowed.toString(),
            portfolioValueUSD: day.portfolioValueUSD,
            totalSuppliedUSD: day.totalSuppliedUSD,
            totalBorrowedUSD: day.totalBorrowedUSD,
            pairs: day.pairs.map(pair => ({
                pair: pair.pair,
                collateralAddress: pair.collateralAddress,
                assetAddress: pair.assetAddress,
                collateralAmount: pair.collateralAmount.toString(),
                assetAmount: pair.assetAmount.toString(),
                borrowAmount: pair.borrowAmount.toString(),
                netPosition: pair.netPosition.toString(),
                collateralUSD: pair.collateralUSD,
                assetUSD: pair.assetUSD,
                borrowedUSD: pair.borrowedUSD,
                netPositionUSD: pair.netPositionUSD,
                collateralPrice: pair.collateralPrice, // Collateral USD price from Chainlink (8 decimals)
                collateralPriceTimestamp: pair.collateralPriceTimestamp, // Timestamp when the collateral price was recorded
                assetPrice: pair.assetPrice, // Asset USD price from Chainlink (8 decimals)
                assetPriceTimestamp: pair.assetPriceTimestamp // Timestamp when the asset price was recorded
            }))
        }));

        return c.json({
            user: userAddress,
            fromTimestamp,
            toTimestamp,
            fromDate: new Date(fromTimestamp * 1000).toISOString(),
            toDate: new Date(toTimestamp * 1000).toISOString(),
            days: portfolioData.dailyValues.length,
            dailyPortfolioValues: serializedPortfolio,
            calculatedAt: Math.floor(Date.now() / 1000),
            note: "USD values are calculated using historical oracle prices from the database events and formatted with 4 decimal places. Portfolio values represent actual balances (including accrued interest/yield) at the END of each day (23:59:59 UTC)."
        });

    } catch (error) {
        console.error("Error calculating isolated pair daily portfolio values:", error);
        return c.json({error: "Failed to calculate isolated pair daily portfolio values"}, 500);
    }
});

// Debug endpoint to check for duplicate UserBalanceEvent records
app.get("/debug/duplicate-events/:address", async (c) => {
    const userAddress = c.req.param("address");

    if (!userAddress || !/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({error: "Invalid user address format"}, 400);
    }

    try {
        const context = {db};
        const dbQuery = context.db.sql || context.db;

        // Get all UserBalanceEvent records for this user
        const {UserBalanceEvent} = await import("ponder:schema");
        const allEvents = await dbQuery
            .select()
            .from(UserBalanceEvent)
            .where(eq(UserBalanceEvent.user, userAddress as `0x${string}`))
            .orderBy(UserBalanceEvent.timestamp, UserBalanceEvent.asset);

        // Group events by transaction hash, user, asset, and event type
        const eventGroups = new Map();
        const duplicates = [];

        for (const event of allEvents) {
            const key = `${event.txHash}_${event.user}_${event.asset}_${event.eventType}`;

            if (!eventGroups.has(key)) {
                eventGroups.set(key, []);
            }
            eventGroups.get(key).push(event);
        }

        // Find groups with multiple events (potential duplicates)
        for (const [key, events] of eventGroups) {
            if (events.length > 1) {
                duplicates.push({
                    key,
                    count: events.length,
                    events: events.map(e => ({
                        id: e.id,
                        txHash: e.txHash,
                        asset: e.asset,
                        scaledBalance: e.scaledBalance.toString(),
                        transactionAmount: e.transactionAmount.toString(),
                        eventType: e.eventType,
                        timestamp: e.timestamp
                    }))
                });
            }
        }

        return c.json({
            user: userAddress,
            totalEvents: allEvents.length,
            duplicateGroups: duplicates.length,
            duplicates: duplicates
        });

    } catch (error) {
        console.error("Error checking for duplicate events:", error);
        return c.json({error: "Failed to check for duplicate events"}, 500);
    }
});

// Compare Option A (proxy-based) vs Option B (transfer-based) position tracking
// This endpoint helps evaluate which approach produces more accurate results
app.get("/user/:address/compare-position-tracking", async (c) => {
    const userAddress = c.req.param("address");
    const assetParam = c.req.query("asset"); // Optional: filter by specific asset

    if (!userAddress) {
        return c.json({ error: "User address is required" }, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
        return c.json({ error: "Invalid user address format" }, 400);
    }

    try {
        const normalizedUser = userAddress.toLowerCase() as `0x${string}`;

        // Query Option A positions (proxy-based)
        let optionAPositions;
        if (assetParam) {
            const normalizedAsset = assetParam.toLowerCase() as `0x${string}`;
            optionAPositions = await db
                .select()
                .from(schema.UserPosition)
                .where(
                    and(
                        eq(schema.UserPosition.user, normalizedUser),
                        eq(schema.UserPosition.asset, normalizedAsset)
                    )
                );
        } else {
            optionAPositions = await db
                .select()
                .from(schema.UserPosition)
                .where(eq(schema.UserPosition.user, normalizedUser));
        }

        // Query Option B positions (transfer-based)
        let optionBPositions;
        if (assetParam) {
            const normalizedAsset = assetParam.toLowerCase() as `0x${string}`;
            optionBPositions = await db
                .select()
                .from(schema.UserPositionTransferBased)
                .where(
                    and(
                        eq(schema.UserPositionTransferBased.user, normalizedUser),
                        eq(schema.UserPositionTransferBased.asset, normalizedAsset)
                    )
                );
        } else {
            optionBPositions = await db
                .select()
                .from(schema.UserPositionTransferBased)
                .where(eq(schema.UserPositionTransferBased.user, normalizedUser));
        }

        // Create a map of all assets from both options
        const allAssets = new Set<string>();
        optionAPositions.forEach(p => p.asset && allAssets.add(p.asset));
        optionBPositions.forEach(p => p.asset && allAssets.add(p.asset));

        // Build comparison for each asset
        const comparisons = Array.from(allAssets).map(asset => {
            const optionA = optionAPositions.find(p => p.asset === asset);
            const optionB = optionBPositions.find(p => p.asset === asset);

            const scaledBalanceA = optionA?.scaledBalance ?? 0n;
            const scaledBalanceB = optionB?.scaledBalance ?? 0n;
            const actualBalanceA = optionA?.actualBalance ?? 0n;
            const actualBalanceB = optionB?.actualBalance ?? 0n;

            const scaledDiff = scaledBalanceA - scaledBalanceB;
            const actualDiff = actualBalanceA - actualBalanceB;

            return {
                asset,
                optionA: optionA ? {
                    scaledBalance: scaledBalanceA.toString(),
                    actualBalance: actualBalanceA.toString(),
                    totalDeposits: (optionA.totalDeposits ?? 0n).toString(),
                    totalWithdrawals: (optionA.totalWithdrawals ?? 0n).toString(),
                    lastUpdated: optionA.lastUpdated,
                    lastLiquidityIndex: (optionA.lastLiquidityIndex ?? 0n).toString(),
                } : null,
                optionB: optionB ? {
                    scaledBalance: scaledBalanceB.toString(),
                    actualBalance: actualBalanceB.toString(),
                    totalDeposits: (optionB.totalDeposits ?? 0n).toString(),
                    totalWithdrawals: (optionB.totalWithdrawals ?? 0n).toString(),
                    lastUpdated: optionB.lastUpdated,
                    lastLiquidityIndex: (optionB.lastLiquidityIndex ?? 0n).toString(),
                } : null,
                difference: {
                    scaledBalance: scaledDiff.toString(),
                    actualBalance: actualDiff.toString(),
                    // Positive means Option A has more, negative means Option B has more
                    interpretation: scaledDiff === 0n
                        ? "MATCH"
                        : scaledDiff > 0n
                            ? "Option A shows MORE balance (possible missing withdraw in Option A)"
                            : "Option B shows MORE balance (possible missing deposit in Option A)",
                },
                hasDiscrepancy: scaledDiff !== 0n,
            };
        });

        // Summary statistics
        const totalAssets = comparisons.length;
        const matchingAssets = comparisons.filter(c => !c.hasDiscrepancy).length;
        const discrepantAssets = comparisons.filter(c => c.hasDiscrepancy).length;

        return c.json({
            user: normalizedUser,
            summary: {
                totalAssets,
                matchingAssets,
                discrepantAssets,
                allMatch: discrepantAssets === 0,
            },
            comparisons: comparisons.sort((a, b) => {
                // Sort discrepancies first
                if (a.hasDiscrepancy && !b.hasDiscrepancy) return -1;
                if (!a.hasDiscrepancy && b.hasDiscrepancy) return 1;
                return a.asset.localeCompare(b.asset);
            }),
            explanation: {
                optionA: "Proxy-based tracking: Uses hardcoded proxy addresses (WrappedTokenGateway, CollateralSwapper, LeverageHelper) to attribute Supply/Withdraw events to the correct user",
                optionB: "Transfer-based tracking: Tracks ALL hToken balance changes via BalanceTransfer events (mints, burns, transfers)",
                recommendation: "If Option B shows correct on-chain balances while Option A doesn't, consider switching to Option B or adding missing proxy addresses to Option A",
            },
        });

    } catch (error) {
        console.error("Error comparing position tracking:", error);
        return c.json({ error: "Failed to compare position tracking" }, 500);
    }
});

// Get detailed event history comparison for a specific user and asset
app.get("/user/:address/compare-events/:asset", async (c) => {
    const userAddress = c.req.param("address");
    const assetAddress = c.req.param("asset");
    const limitParam = c.req.query("limit");

    if (!userAddress || !assetAddress) {
        return c.json({ error: "User address and asset address are required" }, 400);
    }

    // Validate hex address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress) || !/^0x[a-fA-F0-9]{40}$/.test(assetAddress)) {
        return c.json({ error: "Invalid address format" }, 400);
    }

    const limit = limitParam ? parseInt(limitParam) : 100;

    try {
        const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
        const normalizedAsset = assetAddress.toLowerCase() as `0x${string}`;

        // Query Option A events
        const optionAEvents = await db
            .select()
            .from(schema.UserBalanceEvent)
            .where(
                and(
                    eq(schema.UserBalanceEvent.user, normalizedUser),
                    eq(schema.UserBalanceEvent.asset, normalizedAsset)
                )
            )
            .orderBy(desc(schema.UserBalanceEvent.timestamp))
            .limit(limit);

        // Query Option B events
        const optionBEvents = await db
            .select()
            .from(schema.UserBalanceEventTransferBased)
            .where(
                and(
                    eq(schema.UserBalanceEventTransferBased.user, normalizedUser),
                    eq(schema.UserBalanceEventTransferBased.asset, normalizedAsset)
                )
            )
            .orderBy(desc(schema.UserBalanceEventTransferBased.timestamp))
            .limit(limit);

        // Format events for comparison
        const formatEvent = (e: any) => ({
            txHash: e.txHash,
            eventType: e.eventType,
            timestamp: e.timestamp,
            date: new Date(e.timestamp * 1000).toISOString(),
            transactionAmount: e.transactionAmount.toString(),
            scaledBalanceAfter: e.scaledBalance.toString(),
            liquidityIndex: e.liquidityIndex.toString(),
        });

        return c.json({
            user: normalizedUser,
            asset: normalizedAsset,
            optionA: {
                name: "Proxy-based tracking",
                eventCount: optionAEvents.length,
                events: optionAEvents.map(formatEvent),
            },
            optionB: {
                name: "Transfer-based tracking",
                eventCount: optionBEvents.length,
                events: optionBEvents.map(formatEvent),
            },
            analysis: {
                eventCountDiff: optionAEvents.length - optionBEvents.length,
                note: "Compare event types and transaction amounts to identify discrepancies. Option B may have additional 'transfer_in'/'transfer_out' events that Option A misses.",
            },
        });

    } catch (error) {
        console.error("Error comparing events:", error);
        return c.json({ error: "Failed to compare events" }, 500);
    }
});

export default app;
