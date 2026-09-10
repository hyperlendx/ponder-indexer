/**
 * Sparse oracle-price lookup for one asset.
 *
 * Report callers first prefetch the exact timestamps they need. Each batch is
 * resolved with one VALUES + LATERAL query, so a one-year report returns at
 * most one row per requested day/segment instead of materializing every
 * periodic oracle snapshot in the range.
 */
import {AssetPriceSnapshot} from "ponder:schema";
import {sql} from "ponder";
import {USDC_ADDRESS, USDC_DECIMALS} from "../usdc";

export interface PricePoint {
    price: bigint;
    priceTimestamp: number;
    decimals: number;
}

const PRICE_QUERY_BATCH_SIZE = 500;

function resultRows(result: any): any[] {
    if (Array.isArray(result)) return result;
    return result?.rows ?? [];
}

export class PriceSeries {
    private readonly db: any;
    private readonly asset: `0x${string}`;
    private readonly points = new Map<number, PricePoint>();
    decimals: number;

    constructor(context: any, asset: string) {
        this.db = context.db.sql || context.db;
        this.asset = asset as `0x${string}`;
        this.decimals = asset.toLowerCase() === USDC_ADDRESS.toLowerCase() ? USDC_DECIMALS : 18;
    }

    /** Resolve the most recent snapshot at or before each requested timestamp. */
    async prefetch(timestamps: number[]): Promise<void> {
        const missing: number[] = [];
        const seen = new Set<number>();

        for (const value of timestamps) {
            const timestamp = Math.trunc(value);
            if (!Number.isFinite(timestamp) || seen.has(timestamp) || this.points.has(timestamp)) continue;
            seen.add(timestamp);
            missing.push(timestamp);
        }

        for (let offset = 0; offset < missing.length; offset += PRICE_QUERY_BATCH_SIZE) {
            const batch = missing.slice(offset, offset + PRICE_QUERY_BATCH_SIZE);
            const values = sql.join(batch.map((timestamp) => sql`(${timestamp}::integer)`), sql`, `);
            const result = await this.db.execute(sql`
                with requested(requested_timestamp) as (values ${values})
                select
                    requested.requested_timestamp,
                    price_point.price_timestamp,
                    price_point.price,
                    price_point.decimals
                from requested
                left join lateral (
                    select
                        ${AssetPriceSnapshot.timestamp} as price_timestamp,
                        ${AssetPriceSnapshot.price} as price,
                        ${AssetPriceSnapshot.decimals} as decimals
                    from ${AssetPriceSnapshot}
                    -- Bind through the hex column encoder: stored addresses are lowercase.
                    where ${AssetPriceSnapshot.asset} = ${sql.param(this.asset, AssetPriceSnapshot.asset)}
                      and ${AssetPriceSnapshot.timestamp} <= requested.requested_timestamp
                    order by ${AssetPriceSnapshot.timestamp} desc
                    limit 1
                ) as price_point on true
            `);

            const resolved = new Set<number>();
            for (const row of resultRows(result)) {
                const requestedTimestamp = Number(row.requested_timestamp);
                const priceTimestamp = row.price_timestamp == null ? 0 : Number(row.price_timestamp);
                const decimals = row.decimals == null ? this.decimals : Number(row.decimals);
                this.decimals = decimals;
                this.points.set(requestedTimestamp, {
                    price: row.price == null ? 0n : BigInt(row.price),
                    priceTimestamp,
                    decimals,
                });
                resolved.add(requestedTimestamp);
            }

            // Be defensive across database drivers: a LEFT JOIN should return a
            // row for every request, but cache a miss if a driver omits one.
            for (const timestamp of batch) {
                if (!resolved.has(timestamp)) {
                    this.points.set(timestamp, {price: 0n, priceTimestamp: 0, decimals: this.decimals});
                }
            }
        }
    }

    priceAt(timestamp: number): PricePoint {
        return this.points.get(Math.trunc(timestamp)) ?? {
            price: 0n,
            priceTimestamp: 0,
            decimals: this.decimals,
        };
    }
}

export async function loadPriceSeries(context: any, asset: string): Promise<PriceSeries> {
    return new PriceSeries(context, asset);
}
