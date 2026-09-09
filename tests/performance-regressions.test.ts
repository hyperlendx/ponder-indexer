import {describe, expect, it, vi} from "vitest";
import {buildBorrowSegments, buildSupplySegments} from "../src/helpers/yield/yieldCalculations";
import {buildReportDayEnds} from "../src/helpers/yield/yieldReports";
import {PriceSeries} from "../src/helpers/yield/priceSeries";
import {USDC_ADDRESS} from "../src/helpers/usdc";

describe("bounded report helpers", () => {
    it("builds supply segments in one chronological pass", () => {
        expect(buildSupplySegments(0, 30, 10n, [
            {timestamp: 10, scaledBalance: 20n},
            {timestamp: 20, scaledBalance: 5n},
        ])).toEqual([
            {startTime: 0, endTime: 10, scaledBalance: 10n},
            {startTime: 10, endTime: 20, scaledBalance: 20n},
            {startTime: 20, endTime: 30, scaledBalance: 5n},
        ]);
    });

    it("builds borrow segments from scaled deltas", () => {
        expect(buildBorrowSegments(0, 30, 0n, [
            {timestamp: 5, amount: 10n, eventType: "borrow"},
            {timestamp: 15, amount: 4n, eventType: "repay"},
        ])).toEqual([
            {startTime: 5, endTime: 15, scaledBorrowBalance: 10n},
            {startTime: 15, endTime: 30, scaledBorrowBalance: 6n},
        ]);
    });

    it("applies inclusive-start events once before the first segment", () => {
        expect(buildSupplySegments(10, 20, 5n, [
            {timestamp: 10, scaledBalance: 8n},
        ])).toEqual([
            {startTime: 10, endTime: 20, scaledBalance: 8n},
        ]);
        expect(buildBorrowSegments(10, 20, 5n, [
            {timestamp: 10, amount: 2n, eventType: "borrow"},
        ])).toEqual([
            {startTime: 10, endTime: 20, scaledBorrowBalance: 7n},
        ]);
    });

    it("does not create an empty day when a report ends at midnight", () => {
        expect(buildReportDayEnds(0, 86_400)).toEqual([
            {date: "1970-01-01", timestamp: 86_399},
        ]);
    });

    it("fetches one sparse price point per requested timestamp and caches it", async () => {
        const execute = vi.fn().mockResolvedValue({rows: [
            {requested_timestamp: 100, price_timestamp: 90, price: "100000000", decimals: 6},
            {requested_timestamp: 200, price_timestamp: 180, price: "99000000", decimals: 6},
        ]});
        const prices = new PriceSeries({db: {sql: {execute}}}, USDC_ADDRESS);

        await prices.prefetch([100, 200, 100]);
        await prices.prefetch([100, 200]);

        expect(execute).toHaveBeenCalledTimes(1);
        expect(prices.priceAt(100)).toEqual({price: 100000000n, priceTimestamp: 90, decimals: 6});
        expect(prices.priceAt(200)).toEqual({price: 99000000n, priceTimestamp: 180, decimals: 6});
    });
});
