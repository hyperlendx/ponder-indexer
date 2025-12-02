import { OracleAbi } from "../../abis/OracleAbi";
import { IsolatedAbi } from "../../abis/IsolatedAbi";
import { IsolatedPairOracleAbi } from "../../abis/IsolatedPairOracleAbi";
import { AssetPriceSnapshot, IsolatedPairPriceSnapshot } from "ponder:schema";
import { eq, and, lte, gte, desc } from "ponder";

import config from "../../ponder.config";

export async function getOraclePrice(context: any, reserve: string){
    const priceData = await context.client.readContract({
        abi: OracleAbi,
        address: config.contracts.Oracle.address,
        functionName: "getAssetPrice",
        args: [reserve]
    });

    return priceData;
}

export async function getIsolatedOraclePrice(context: any, pair: string){
    const prices = await getIsolatedOraclePrices(context, pair);
    return prices ? prices.priceHigh : null;
}

/**
 * Get both low and high prices from an isolated pair's oracle
 * @returns { priceLow, priceHigh } or null if error
 */
export async function getIsolatedOraclePrices(context: any, pair: string): Promise<{ priceLow: bigint; priceHigh: bigint } | null> {
    try {
        // Validate pair address
        if (!pair || pair === "0xNEW" || pair === "0x0000000000000000000000000000000000000000") {
            console.error(`[getIsolatedOraclePrices] Invalid pair address: ${pair}`);
            return null;
        }

        // First, get the oracle address from the pair's exchangeRateInfo
        const exchangeRateInfo = await context.client.readContract({
            abi: IsolatedAbi,
            address: pair,
            functionName: "exchangeRateInfo",
            args: []
        });

        if (!exchangeRateInfo) {
            console.error(`[getIsolatedOraclePrices] exchangeRateInfo returned null for pair ${pair}`);
            return null;
        }

        // Get oracle address (first field in the tuple)
        const oracleAddress = exchangeRateInfo[0];

        // Check if oracle address is valid (not zero address)
        if (!oracleAddress || oracleAddress === "0x0000000000000000000000000000000000000000") {
            console.error(`[getIsolatedOraclePrices] Invalid oracle address for pair ${pair}: ${oracleAddress}`);
            return null;
        }

        // Get the price from the oracle using getPrices function (no args needed)
        // Returns (_isBadData, _priceLow, _priceHigh)
        const priceData = await context.client.readContract({
            abi: IsolatedPairOracleAbi,
            address: oracleAddress,
            functionName: "getPrices",
            args: []
        });

        // Validate price data structure
        if (!priceData || priceData.length < 3) {
            console.error(`[getIsolatedOraclePrices] Oracle returned invalid price data for pair ${pair}`);
            return null;
        }

        const [_isBadData, _priceLow, _priceHigh] = priceData;

        // Check if the oracle marked the data as bad
        if (_isBadData) {
            console.error(`[getIsolatedOraclePrices] Oracle marked price data as bad for pair ${pair}`);
            return null;
        }

        return { priceLow: _priceLow, priceHigh: _priceHigh };

    } catch (error: any) {
        console.error(`[getIsolatedOraclePrices] Error getting oracle price for pair ${pair}:`, error);
        console.error(`[getIsolatedOraclePrices] Error details:`, error.message);
        return null;
    }
}

/**
 * Get the most appropriate asset price for a time segment
 * Finds the closest price snapshot to the segment's midpoint time from the oracle snapshots
 *
 * @param context - Ponder context with database access
 * @param asset - Asset address (for regular pools) or pair address (for isolated pairs)
 * @param startTime - Segment start timestamp
 * @param endTime - Segment end timestamp
 * @param isIsolatedPair - Whether this is for an isolated pair
 * @returns Asset price as bigint (8 decimals precision) or 0n if not found
 */
export async function getAssetPriceForSegment(
    context: any,
    asset: string,
    startTime: number,
    endTime: number,
    isIsolatedPair: boolean = false
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    // Calculate segment midpoint for finding closest price
    const segmentMidpoint = Math.floor((startTime + endTime) / 2);

    try {
        if (isIsolatedPair) {
            // For isolated pairs, query IsolatedPairPriceSnapshot
            // Get the most recent snapshot before or at the segment midpoint
            const snapshots = await dbQuery.select().from(IsolatedPairPriceSnapshot).where(
                and(
                    eq(IsolatedPairPriceSnapshot.pair, asset as `0x${string}`),
                    lte(IsolatedPairPriceSnapshot.timestamp, segmentMidpoint)
                )
            ).orderBy(desc(IsolatedPairPriceSnapshot.timestamp)).limit(1);

            if (snapshots.length > 0 && snapshots[0].priceHigh > 0n) {
                return snapshots[0].priceHigh;
            }

        } else {
            // For regular pools, query AssetPriceSnapshot
            // Get the most recent snapshot before or at the segment midpoint
            const snapshots = await dbQuery.select().from(AssetPriceSnapshot).where(
                and(
                    eq(AssetPriceSnapshot.asset, asset as `0x${string}`),
                    lte(AssetPriceSnapshot.timestamp, segmentMidpoint)
                )
            ).orderBy(desc(AssetPriceSnapshot.timestamp)).limit(1);

            if (snapshots.length > 0 && snapshots[0].price > 0n) {
                return snapshots[0].price;
            }
        }

        return 0n; // No price found

    } catch (error) {
        console.error(`Error fetching asset price for segment: ${error}`);
        return 0n;
    }
}