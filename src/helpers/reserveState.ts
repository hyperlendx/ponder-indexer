/**
 * Index-time reserve state.
 *
 * AAVE emits ReserveDataUpdated *before* the Supply / Withdraw / Borrow / Repay
 * event of the same transaction, and Ponder processes logs in order, so by the
 * time a balance-changing handler runs, the most recent ReserveDataUpdated seen
 * here is exactly the reserve state that event was executed against. Keeping it
 * in memory removes two ReserveDataEvent queries per balance event (the
 * same-transaction lookup had no usable index and scanned the whole reserve).
 *
 * The same state is used to write DailyReserveIndex rows: for every UTC
 * midnight, the last ReserveDataEvent at or before it. The API resolves indices
 * at day boundaries from those rows instead of scanning ReserveDataEvent.
 *
 * Note: HyperEVM has instant finality, so the in-memory state cannot be
 * invalidated by a reorg in practice. Even if it were, every balance-changing
 * handler is preceded by a ReserveDataUpdated in its own transaction, which
 * refreshes the state before use.
 */
import {DailyReserveIndex} from "ponder:schema";
import {calculateLiquidityIndexAtTimestamp, liquidityIndexFromPoint, type ReserveIndexPoint} from "./aave/liquidityIndex";
import {calculateVariableBorrowIndexAtTimestamp, variableBorrowIndexFromPoint} from "./aave/borrowIndex";

const SECONDS_PER_DAY = 86400;

interface ReserveState extends ReserveIndexPoint {
    blockNumber: bigint;
    /** Next UTC midnight for which a DailyReserveIndex row still has to be written */
    nextMidnight: number;
}

const reserveStates: Map<string, ReserveState> = new Map();

function key(reserve: string): string {
    return reserve.toLowerCase();
}

/** First UTC midnight at or after `timestamp` */
function ceilToMidnight(timestamp: number): number {
    return Math.ceil(timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;
}

async function writeDailyAnchor(db: any, reserve: `0x${string}`, day: number, base: ReserveState): Promise<void> {
    await db.insert(DailyReserveIndex).values({
        id: `${reserve}-${day}`,
        reserve,
        day,
        eventTimestamp: base.timestamp,
        blockNumber: base.blockNumber,
        liquidityIndex: base.liquidityIndex,
        liquidityRate: base.liquidityRate,
        variableBorrowIndex: base.variableBorrowIndex,
        variableBorrowRate: base.variableBorrowRate,
    }).onConflictDoNothing();
}

/**
 * Record a ReserveDataUpdated event. Finalizes every UTC midnight between the
 * previous update and this one (the previous update is the last event at or
 * before those midnights), then becomes the current state.
 */
export async function recordReserveDataUpdate(
    db: any,
    reserve: `0x${string}`,
    point: ReserveIndexPoint,
    blockNumber: bigint
): Promise<void> {
    const previous = reserveStates.get(key(reserve));
    const current: ReserveState = {
        ...point,
        blockNumber,
        nextMidnight: previous ? previous.nextMidnight : ceilToMidnight(point.timestamp),
    };

    while (current.nextMidnight <= point.timestamp) {
        // A midnight strictly before this event still had the previous state in force;
        // a midnight equal to this event's timestamp is described by this event.
        const base = current.nextMidnight < point.timestamp && previous ? previous : current;
        await writeDailyAnchor(db, reserve, current.nextMidnight, base);
        current.nextMidnight += SECONDS_PER_DAY;
    }

    reserveStates.set(key(reserve), current);
}

/**
 * Called from the periodic block handler: write DailyReserveIndex rows for every
 * midnight strictly before `blockTimestamp` that no ReserveDataUpdated has
 * covered yet. Any such midnight is after the current state's timestamp
 * (otherwise recordReserveDataUpdate would have finalized it), so the current
 * state is exactly the last update at or before it. Midnights equal to the block
 * timestamp are left for the next call, in case this very block also carries an
 * update at that second.
 */
export async function finalizeDailyAnchors(db: any, reserve: `0x${string}`, blockTimestamp: number): Promise<void> {
    const state = reserveStates.get(key(reserve));
    if (!state) return;

    while (state.nextMidnight < blockTimestamp) {
        await writeDailyAnchor(db, reserve, state.nextMidnight, state);
        state.nextMidnight += SECONDS_PER_DAY;
    }
}

/**
 * Liquidity index to apply to a balance-changing event at `timestamp`.
 * Uses the in-memory state (exact: same transaction, or linear accrual since the
 * last update). Falls back to the database only if no ReserveDataUpdated has
 * been seen for the reserve yet in this process (e.g. right after a restart).
 */
export async function getLiquidityIndexForEvent(
    context: any,
    reserve: string,
    timestamp: number,
    txHash: string
): Promise<bigint> {
    const state = reserveStates.get(key(reserve));
    if (state && state.timestamp <= timestamp) {
        return liquidityIndexFromPoint(state, timestamp);
    }
    return calculateLiquidityIndexAtTimestamp(context, reserve, timestamp, txHash);
}

/** Variable borrow index to apply to a debt-changing event. */
export async function getVariableBorrowIndexForEvent(
    context: any,
    reserve: string,
    timestamp: number,
    txHash: string
): Promise<bigint> {
    const state = reserveStates.get(key(reserve));
    if (state && state.timestamp <= timestamp) {
        return variableBorrowIndexFromPoint(state, timestamp);
    }
    return calculateVariableBorrowIndexAtTimestamp(context, reserve, timestamp, txHash);
}
