/**
 * PriceSeries - oracle price snapshots of one asset for a bounded period,
 * loaded with two queries (the last snapshot before the period, and the
 * snapshots inside it) instead of the asset's entire snapshot history.
 */
import {AssetPriceSnapshot} from "ponder:schema";
import {eq, and, gt, lte, desc, asc} from "ponder";

export interface PriceSnapshot {
    timestamp: number;
    price: bigint;
    decimals: number | null;
}

export interface PricePoint {
    price: bigint;
    priceTimestamp: number; // 0 when no snapshot exists at or before the requested time
    decimals: number;
}

export class PriceSeries {
    /** Snapshots ascending by timestamp */
    private readonly snapshots: PriceSnapshot[];
    /** Decimals from the most recent snapshot in range (18 if none) */
    readonly decimals: number;

    constructor(snapshots: PriceSnapshot[]) {
        this.snapshots = snapshots;
        const latest = snapshots[snapshots.length - 1];
        this.decimals = latest && latest.decimals != null ? latest.decimals : 18;
    }

    /** Most recent snapshot at or before `timestamp` */
    priceAt(timestamp: number): PricePoint {
        let lo = 0;
        let hi = this.snapshots.length - 1;
        let found = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (this.snapshots[mid]!.timestamp <= timestamp) {
                found = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        if (found < 0) {
            return {price: 0n, priceTimestamp: 0, decimals: 18};
        }
        const snap = this.snapshots[found]!;
        return {price: snap.price, priceTimestamp: snap.timestamp, decimals: snap.decimals ?? 18};
    }
}

/**
 * Load the price snapshots needed to price anything in [startTimestamp, endTimestamp].
 */
export async function loadPriceSeries(
    context: any,
    asset: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<PriceSeries> {
    const db = context.db.sql || context.db;
    const columns = {
        timestamp: AssetPriceSnapshot.timestamp,
        price: AssetPriceSnapshot.price,
        decimals: AssetPriceSnapshot.decimals,
    };

    const [before, during] = await Promise.all([
        db
            .select(columns)
            .from(AssetPriceSnapshot)
            .where(
                and(
                    eq(AssetPriceSnapshot.asset, asset as `0x${string}`),
                    lte(AssetPriceSnapshot.timestamp, startTimestamp)
                )
            )
            .orderBy(desc(AssetPriceSnapshot.timestamp))
            .limit(1),
        db
            .select(columns)
            .from(AssetPriceSnapshot)
            .where(
                and(
                    eq(AssetPriceSnapshot.asset, asset as `0x${string}`),
                    gt(AssetPriceSnapshot.timestamp, startTimestamp),
                    lte(AssetPriceSnapshot.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(AssetPriceSnapshot.timestamp)),
    ]);

    const snapshots: PriceSnapshot[] = [...before, ...during].map((row: any) => ({
        timestamp: Number(row.timestamp),
        price: BigInt(row.price ?? 0n),
        decimals: row.decimals ?? null,
    }));

    return new PriceSeries(snapshots);
}
