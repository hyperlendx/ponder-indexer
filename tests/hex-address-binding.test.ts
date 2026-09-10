/**
 * Regression test: Ponder's hex columns lowercase values on write, and drizzle's
 * raw sql`` templates bind interpolated values verbatim. Every raw query that
 * compares an address column must therefore bind the address through the
 * column encoder (sql.param(value, column)), otherwise checksummed addresses
 * silently match nothing and the yield API reports zero prices, zero starting
 * balances and a flat reserve index.
 *
 * Runs against an in-memory pglite database created from the real schema.
 */
import {describe, expect, it, beforeAll} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {drizzle} from "drizzle-orm/pglite";
import * as schema from "ponder:schema";
// Ponder's internal DDL generator (same output the indexer uses to create tables).
// @ts-ignore - untyped deep import
import {getSql} from "../node_modules/ponder/dist/esm/drizzle/kit/index.js";
import {PriceSeries} from "../src/helpers/yield/priceSeries";
import {ReserveIndexSeries} from "../src/helpers/yield/reserveIndexSeries";
import {loadUserAssetActivity} from "../src/helpers/yield/userAssetActivity";
import {USDC_ADDRESS} from "../src/helpers/usdc";

const RAY = 10n ** 27n;
const DAY = 86_400;
const T0 = 1_800_000_000 - (1_800_000_000 % DAY); // a UTC midnight
// Mixed case on purpose: this is how addresses arrive from URL params and constants.
const USER = "0xAbCdEf0000000000000000000000000000000001" as `0x${string}`;

let db: any;

beforeAll(async () => {
    const client = new PGlite();
    await client.exec("create sequence if not exists operation_id_seq");
    const ddl = getSql(schema as any);
    for (const statement of [...ddl.tables.sql, ...ddl.indexes.sql]) {
        await client.exec(statement);
    }
    db = drizzle(client, {schema});

    // Seed through the query builder, exactly like the indexer, so the hex encoder runs.
    await db.insert(schema.AssetPriceSnapshot).values({
        id: `${USDC_ADDRESS}-1`, asset: USDC_ADDRESS, price: 100_000_000n, decimals: 6,
        blockNumber: 1n, timestamp: T0 + 100,
    });
    await db.insert(schema.ReserveDataEvent).values({
        id: "rde-1", txHash: "0x01", reserve: USDC_ADDRESS,
        liquidityIndex: RAY, liquidityRate: RAY / 10n,
        variableBorrowIndex: RAY, variableBorrowRate: RAY / 5n,
        timestamp: T0 + 100, blockNumber: 1n, logIndex: 0,
    });
    await db.insert(schema.Borrow).values({
        id: "b-1", txHash: "0x02", pool: "0x00", reserve: USDC_ADDRESS, user: USER, onBehalfOf: USER,
        amount: 1_000_000n, scaledAmount: 1_000_000n, variableBorrowIndex: RAY, interestRateMode: 2,
        borrowRate: 0n, referralCode: 0, timestamp: T0 + 200,
    });
    await db.insert(schema.Supply).values({
        id: "s-1", txHash: "0x03", pool: "0x00", reserve: USDC_ADDRESS, user: USER, onBehalfOf: USER,
        amount: 5_000_000n, referralCode: 0, timestamp: T0 + 200,
    });
});

describe("raw SQL address binding", () => {
    it("the schema stores addresses lowercased", async () => {
        const rows = await db.select({asset: schema.AssetPriceSnapshot.asset}).from(schema.AssetPriceSnapshot);
        expect(USDC_ADDRESS).not.toBe(USDC_ADDRESS.toLowerCase());
        expect(rows[0].asset).toBe(USDC_ADDRESS.toLowerCase());
    });

    it("PriceSeries resolves a snapshot for a checksummed asset address", async () => {
        const prices = new PriceSeries({db}, USDC_ADDRESS);
        await prices.prefetch([T0 + 500]);
        expect(prices.priceAt(T0 + 500)).toEqual({price: 100_000_000n, priceTimestamp: T0 + 100, decimals: 6});
    });

    it("ReserveIndexSeries point query resolves the base event for a checksummed reserve", async () => {
        const series = new ReserveIndexSeries({db}, USDC_ADDRESS);
        // No daily anchors and more than 16 distinct days: forces the batched point query.
        const timestamps = Array.from({length: 20}, (_, i) => T0 + 500 + i * DAY);
        await series.prefetch(timestamps);
        const start = await series.liquidityIndexAt(timestamps[0]!);
        const end = await series.liquidityIndexAt(timestamps[19]!);
        expect(end).toBeGreaterThan(start);
    });

    it("loadUserAssetActivity starting aggregates see pre-period rows for checksummed user/asset", async () => {
        const activity = await loadUserAssetActivity({db}, USER, USDC_ADDRESS, T0 + 10 * DAY, {startTimestamp: T0 + DAY});
        expect(activity.startingScaledBorrowBalance).toBe(1_000_000n);
        expect(activity.startingRawBorrowBalance).toBe(1_000_000n);
        expect(activity.startingRawSupplyBalance).toBe(5_000_000n);
    });
});
