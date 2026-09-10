/**
 * ReserveIndexSeries - resolves the liquidity / variable borrow index of one
 * reserve at arbitrary timestamps with as few database round trips as possible.
 *
 * The index at time T is a pure function of the last ReserveDataEvent at or
 * before T (see liquidityIndexFromPoint). Instead of one query per timestamp,
 * this class resolves that "base" event from three progressively more
 * expensive sources, all fetched in batches:
 *
 *   1. DailyReserveIndex anchors: the base event as of each UTC midnight,
 *      written at index time. For a timestamp T, the anchor of the next midnight
 *      M >= T is the base of T whenever it happened at or before T (i.e. the
 *      reserve had no activity in (T, M]). This alone answers every day boundary
 *      and most day-end lookups.
 *   2. The reserve's ReserveDataEvent rows for the UTC day containing T, loaded
 *      once per day (only for days where an anchor cannot answer).
 *   3. A point query (last event <= T), used only when neither of the above can
 *      answer, e.g. before the DailyReserveIndex table has been backfilled.
 *
 * Call prefetch() with every timestamp a computation needs, then the *At()
 * methods resolve from memory.
 */
import {ReserveDataEvent, DailyReserveIndex} from "ponder:schema";
import {eq, and, gte, lte, lt, desc, asc, sql} from "ponder";
import {liquidityIndexFromPoint, type ReserveIndexPoint} from "../aave/liquidityIndex";
import {variableBorrowIndexFromPoint} from "../aave/borrowIndex";
import {RAY} from "../aave/rayMath";

const SECONDS_PER_DAY = 86400;
const MAX_DAY_QUERIES = 16;
const POINT_QUERY_BATCH_SIZE = 500;

function rowsFromResult(result: any): any[] {
    if (Array.isArray(result)) return result;
    return result?.rows ?? [];
}

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
        while (cursor < items.length) {
            const item = items[cursor++]!;
            await task(item);
        }
    });
    await Promise.all(workers);
}

function floorToMidnight(timestamp: number): number {
    return Math.floor(timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

function ceilToMidnight(timestamp: number): number {
    return Math.ceil(timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

const reserveDataColumns = {
    timestamp: ReserveDataEvent.timestamp,
    blockNumber: ReserveDataEvent.blockNumber,
    logIndex: ReserveDataEvent.logIndex,
    liquidityIndex: ReserveDataEvent.liquidityIndex,
    liquidityRate: ReserveDataEvent.liquidityRate,
    variableBorrowIndex: ReserveDataEvent.variableBorrowIndex,
    variableBorrowRate: ReserveDataEvent.variableBorrowRate,
};

function toPoint(row: {
    timestamp: number | null;
    liquidityIndex: bigint | null;
    liquidityRate: bigint | null;
    variableBorrowIndex: bigint | null;
    variableBorrowRate: bigint | null;
}): ReserveIndexPoint {
    return {
        timestamp: Number(row.timestamp),
        liquidityIndex: BigInt(row.liquidityIndex ?? 0n),
        liquidityRate: BigInt(row.liquidityRate ?? 0n),
        variableBorrowIndex: BigInt(row.variableBorrowIndex ?? 0n),
        variableBorrowRate: BigInt(row.variableBorrowRate ?? 0n),
    };
}

export class ReserveIndexSeries {
    private readonly reserve: `0x${string}`;
    private readonly db: any;

    /** DailyReserveIndex rows keyed by UTC midnight */
    private readonly anchors = new Map<number, ReserveIndexPoint>();
    /** Contiguous range of midnights for which anchors were loaded (inclusive) */
    private anchorRange: { from: number; to: number } | null = null;
    /** ReserveDataEvent rows per UTC day, ascending */
    private readonly dayRows = new Map<number, ReserveIndexPoint[]>();
    /** Results of point queries: last event at or before the timestamp (null = none) */
    private readonly points = new Map<number, ReserveIndexPoint | null>();
    /** Most recent event of the reserve overall, fetched lazily (null = table empty) */
    private latestOverall: ReserveIndexPoint | null | undefined = undefined;

    constructor(context: any, reserve: string) {
        this.db = context.db.sql || context.db;
        this.reserve = reserve as `0x${string}`;
    }

    /**
     * Load everything needed to answer the given timestamps from memory.
     */
    async prefetch(timestamps: number[]): Promise<void> {
        const unique = [...new Set(timestamps.filter(Number.isFinite).map(Math.trunc))];
        if (unique.length === 0) return;

        let minimum = unique[0]!;
        let maximum = unique[0]!;
        for (let index = 1; index < unique.length; index++) {
            const timestamp = unique[index]!;
            if (timestamp < minimum) minimum = timestamp;
            if (timestamp > maximum) maximum = timestamp;
        }
        await this.loadAnchors(minimum, maximum);

        let unresolved = unique.filter((ts) => this.resolveBase(ts) === undefined);
        if (unresolved.length > 0) {
            const days = [...new Set(unresolved.map(floorToMidnight).filter((day) => !this.dayRows.has(day)))];
            // Loading a complete day is useful when many requested timestamps
            // share it. If anchors are absent across a long period, avoid one
            // query per day and fall through to batched point lookups instead.
            if (days.length <= MAX_DAY_QUERIES) {
                await runWithConcurrency(days, 4, (day) => this.loadDay(day));
                unresolved = unresolved.filter((ts) => this.resolveBase(ts) === undefined);
            }
        }
        if (unresolved.length > 0) {
            await this.loadPoints(unresolved);
        }
    }

    async liquidityIndexAt(timestamp: number): Promise<bigint> {
        const base = await this.baseAt(timestamp);
        if (base === null) {
            // No reserve update at or before this timestamp: fall back to the most recent
            // update overall, or 1 RAY if the reserve has none at all.
            const latest = await this.getLatestOverall();
            return latest ? latest.liquidityIndex : RAY;
        }
        return liquidityIndexFromPoint(base, timestamp);
    }

    async variableBorrowIndexAt(timestamp: number): Promise<bigint> {
        const base = await this.baseAt(timestamp);
        if (base === null) {
            const latest = await this.getLatestOverall();
            return latest ? latest.variableBorrowIndex : RAY;
        }
        return variableBorrowIndexFromPoint(base, timestamp);
    }

    // ------------------------------------------------------------------------

    private async baseAt(timestamp: number): Promise<ReserveIndexPoint | null> {
        let base = this.resolveBase(timestamp);
        if (base === undefined) {
            await this.prefetch([timestamp]);
            base = this.resolveBase(timestamp);
        }
        return base ?? null;
    }

    /**
     * The last reserve update at or before `timestamp`, from memory.
     * Returns null when it is known that there is none, undefined when more data is needed.
     */
    private resolveBase(timestamp: number): ReserveIndexPoint | null | undefined {
        const nextMidnight = ceilToMidnight(timestamp);
        const anchor = this.anchors.get(nextMidnight);
        if (anchor && anchor.timestamp <= timestamp) {
            // No reserve activity between `timestamp` and the midnight, so the midnight's
            // base is also the base of `timestamp`.
            return anchor;
        }

        const day = floorToMidnight(timestamp);
        const rows = this.dayRows.get(day);
        if (rows) {
            let low = 0;
            let high = rows.length - 1;
            let found = -1;
            while (low <= high) {
                const middle = (low + high) >> 1;
                if (rows[middle]!.timestamp <= timestamp) {
                    found = middle;
                    low = middle + 1;
                } else {
                    high = middle - 1;
                }
            }
            if (found >= 0) return rows[found]!;
            // No activity in [day, timestamp]: the base is whatever was in force at midnight.
            const dayAnchor = this.anchors.get(day);
            if (dayAnchor) return dayAnchor;
        }

        if (this.points.has(timestamp)) {
            return this.points.get(timestamp);
        }
        return undefined;
    }

    private async loadAnchors(fromTimestamp: number, toTimestamp: number): Promise<void> {
        const from = floorToMidnight(fromTimestamp);
        const to = ceilToMidnight(toTimestamp);

        const ranges: Array<{ from: number; to: number }> = [];
        if (!this.anchorRange) {
            ranges.push({from, to});
        } else {
            if (from < this.anchorRange.from) ranges.push({from, to: this.anchorRange.from - SECONDS_PER_DAY});
            if (to > this.anchorRange.to) ranges.push({from: this.anchorRange.to + SECONDS_PER_DAY, to});
        }
        if (ranges.length === 0) return;

        await Promise.all(ranges.map(async ({from, to}) => {
            if (to < from) return;
            const rows = await this.db
                .select({
                    day: DailyReserveIndex.day,
                    eventTimestamp: DailyReserveIndex.eventTimestamp,
                    liquidityIndex: DailyReserveIndex.liquidityIndex,
                    liquidityRate: DailyReserveIndex.liquidityRate,
                    variableBorrowIndex: DailyReserveIndex.variableBorrowIndex,
                    variableBorrowRate: DailyReserveIndex.variableBorrowRate,
                })
                .from(DailyReserveIndex)
                .where(
                    and(
                        eq(DailyReserveIndex.reserve, this.reserve),
                        gte(DailyReserveIndex.day, from),
                        lte(DailyReserveIndex.day, to)
                    )
                );
            for (const row of rows) {
                this.anchors.set(Number(row.day), toPoint({...row, timestamp: row.eventTimestamp}));
            }
        }));

        this.anchorRange = this.anchorRange
            ? {from: Math.min(from, this.anchorRange.from), to: Math.max(to, this.anchorRange.to)}
            : {from, to};
    }

    private async loadDay(day: number): Promise<void> {
        const rows = await this.db
            .select(reserveDataColumns)
            .from(ReserveDataEvent)
            .where(
                and(
                    eq(ReserveDataEvent.reserve, this.reserve),
                    gte(ReserveDataEvent.timestamp, day),
                    lt(ReserveDataEvent.timestamp, day + SECONDS_PER_DAY)
                )
            )
            .orderBy(asc(ReserveDataEvent.timestamp), asc(ReserveDataEvent.blockNumber), asc(ReserveDataEvent.logIndex));
        this.dayRows.set(day, rows.map(toPoint));
    }

    private async loadPoints(timestamps: number[]): Promise<void> {
        for (let offset = 0; offset < timestamps.length; offset += POINT_QUERY_BATCH_SIZE) {
            const batch = timestamps.slice(offset, offset + POINT_QUERY_BATCH_SIZE);
            const values = sql.join(batch.map((timestamp) => sql`(${timestamp}::integer)`), sql`, `);
            const result = await this.db.execute(sql`
                with requested(requested_timestamp) as (values ${values})
                select
                    requested.requested_timestamp,
                    reserve_point.event_timestamp,
                    reserve_point.liquidity_index,
                    reserve_point.liquidity_rate,
                    reserve_point.variable_borrow_index,
                    reserve_point.variable_borrow_rate
                from requested
                left join lateral (
                    select
                        ${ReserveDataEvent.timestamp} as event_timestamp,
                        ${ReserveDataEvent.liquidityIndex} as liquidity_index,
                        ${ReserveDataEvent.liquidityRate} as liquidity_rate,
                        ${ReserveDataEvent.variableBorrowIndex} as variable_borrow_index,
                        ${ReserveDataEvent.variableBorrowRate} as variable_borrow_rate
                    from ${ReserveDataEvent}
                    -- Bind through the hex column encoder: stored addresses are lowercase.
                    where ${ReserveDataEvent.reserve} = ${sql.param(this.reserve, ReserveDataEvent.reserve)}
                      and ${ReserveDataEvent.timestamp} <= requested.requested_timestamp
                    order by
                        ${ReserveDataEvent.timestamp} desc,
                        ${ReserveDataEvent.blockNumber} desc,
                        ${ReserveDataEvent.logIndex} desc
                    limit 1
                ) as reserve_point on true
            `);

            const resolved = new Set<number>();
            for (const row of rowsFromResult(result)) {
                const timestamp = Number(row.requested_timestamp);
                const point = row.event_timestamp == null ? null : toPoint({
                    timestamp: row.event_timestamp,
                    liquidityIndex: row.liquidity_index,
                    liquidityRate: row.liquidity_rate,
                    variableBorrowIndex: row.variable_borrow_index,
                    variableBorrowRate: row.variable_borrow_rate,
                });
                this.points.set(timestamp, point);
                resolved.add(timestamp);
            }
            for (const timestamp of batch) {
                if (!resolved.has(timestamp)) this.points.set(timestamp, null);
            }
        }
    }

    private async getLatestOverall(): Promise<ReserveIndexPoint | null> {
        if (this.latestOverall === undefined) {
            const rows = await this.db
                .select(reserveDataColumns)
                .from(ReserveDataEvent)
                .where(eq(ReserveDataEvent.reserve, this.reserve))
                .orderBy(desc(ReserveDataEvent.timestamp), desc(ReserveDataEvent.blockNumber), desc(ReserveDataEvent.logIndex))
                .limit(1);
            this.latestOverall = rows.length > 0 ? toPoint(rows[0]) : null;
        }
        return this.latestOverall;
    }
}
