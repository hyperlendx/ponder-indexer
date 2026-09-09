import { OracleAbi } from "../../abis/OracleAbi";
import { AssetPriceSnapshot } from "ponder:schema";
import { eq, and, lte, desc } from "ponder";

import config from "../../ponder.config";

/**
 * Read the current oracle price of a core pool reserve (8 decimals precision)
 */
export async function getOraclePrice(context: any, reserve: string){
    const priceData = await context.client.readContract({
        abi: OracleAbi,
        address: config.contracts.Oracle.address,
        functionName: "getAssetPrice",
        args: [reserve]
    });

    return priceData;
}

/**
 * Get the most appropriate asset price for a time segment
 * Finds the closest price snapshot to the segment's midpoint time from the oracle snapshots
 *
 * @param context - Ponder context with database access
 * @param asset - Asset address
 * @param startTime - Segment start timestamp
 * @param endTime - Segment end timestamp
 * @returns Asset price as bigint (8 decimals precision) or 0n if not found
 */
export async function getAssetPriceForSegment(
    context: any,
    asset: string,
    startTime: number,
    endTime: number
): Promise<bigint> {
    const { db } = context;
    const dbQuery = db.sql || db;

    // Calculate segment midpoint for finding closest price
    const segmentMidpoint = Math.floor((startTime + endTime) / 2);

    try {
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

        return 0n; // No price found

    } catch (error) {
        console.error(`Error fetching asset price for segment: ${error}`);
        return 0n;
    }
}
