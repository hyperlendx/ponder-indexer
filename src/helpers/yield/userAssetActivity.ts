/**
 * UserAssetActivity - everything the yield endpoints need to know about one
 * (user, asset) pair, loaded once with six user-scoped queries and then
 * evaluated in memory. Replaces the previous pattern of re-querying the same
 * rows from every helper (balance at T, balance with events, max balance,
 * totals, segments, ...).
 */
import {UserBalanceEvent, Borrow, Repay, LiquidationCall, Supply, Withdraw} from "ponder:schema";
import {eq, and, or, lte, asc} from "ponder";
import {RAY} from "../aave/rayMath";
import type {ReserveIndexSeries} from "./reserveIndexSeries";

export type BalanceEventRow = typeof UserBalanceEvent.$inferSelect;
export type BorrowRow = typeof Borrow.$inferSelect;
export type RepayRow = typeof Repay.$inferSelect;
export type LiquidationRow = typeof LiquidationCall.$inferSelect;
export type SupplyRow = typeof Supply.$inferSelect;
export type WithdrawRow = typeof Withdraw.$inferSelect;

/**
 * Event detail for transparency and verification
 */
export interface EventDetail {
    eventType: 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out' | 'borrow' | 'repay';
    timestamp: number;
    date: string;
    amount: string;
    txHash: string;
    assetPrice?: string; // Oracle price of the asset at the time of the event
}

export interface UserAssetActivity {
    user: `0x${string}`;
    asset: `0x${string}`;
    /** Rows are loaded up to and including this timestamp */
    endTimestamp: number;
    /** Ascending by (timestamp, block, log index) */
    balanceEvents: BalanceEventRow[];
    /** Ascending by timestamp */
    borrows: BorrowRow[];
    repays: RepayRow[];
    /** Liquidations of this user where the asset is the collateral or the debt, ascending */
    liquidations: LiquidationRow[];
    supplies: SupplyRow[];
    withdraws: WithdrawRow[];
}

function sameAddress(a: string | null | undefined, b: string): boolean {
    return !!a && a.toLowerCase() === b.toLowerCase();
}

/**
 * All assets the user has ever supplied, borrowed or repaid.
 */
export async function discoverUserAssets(context: any, user: string): Promise<string[]> {
    const db = context.db.sql || context.db;
    const userHex = user as `0x${string}`;

    const [supplied, borrowed, repaid] = await Promise.all([
        db.selectDistinct({asset: UserBalanceEvent.asset}).from(UserBalanceEvent).where(eq(UserBalanceEvent.user, userHex)),
        db.selectDistinct({asset: Borrow.reserve}).from(Borrow).where(eq(Borrow.onBehalfOf, userHex)),
        db.selectDistinct({asset: Repay.reserve}).from(Repay).where(eq(Repay.user, userHex)),
    ]);

    const assets = new Set<string>();
    for (const row of [...supplied, ...borrowed, ...repaid]) {
        if (row.asset) assets.add(row.asset);
    }
    return [...assets];
}

/**
 * Load the user's activity in one asset up to `endTimestamp` (inclusive).
 */
export async function loadUserAssetActivity(
    context: any,
    user: string,
    asset: string,
    endTimestamp: number
): Promise<UserAssetActivity> {
    const db = context.db.sql || context.db;
    const userHex = user as `0x${string}`;
    const assetHex = asset as `0x${string}`;

    const [balanceEvents, borrows, repays, liquidations, supplies, withdraws] = await Promise.all([
        db
            .select()
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, userHex),
                    eq(UserBalanceEvent.asset, assetHex),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(UserBalanceEvent.timestamp), asc(UserBalanceEvent.blockNumber), asc(UserBalanceEvent.logIndex)),
        db
            .select()
            .from(Borrow)
            .where(and(eq(Borrow.onBehalfOf, userHex), eq(Borrow.reserve, assetHex), lte(Borrow.timestamp, endTimestamp)))
            .orderBy(asc(Borrow.timestamp), asc(Borrow.id)),
        db
            .select()
            .from(Repay)
            .where(and(eq(Repay.user, userHex), eq(Repay.reserve, assetHex), lte(Repay.timestamp, endTimestamp)))
            .orderBy(asc(Repay.timestamp), asc(Repay.id)),
        db
            .select()
            .from(LiquidationCall)
            .where(
                and(
                    eq(LiquidationCall.user, userHex),
                    or(eq(LiquidationCall.collateralAsset, assetHex), eq(LiquidationCall.debtAsset, assetHex)),
                    lte(LiquidationCall.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(LiquidationCall.timestamp), asc(LiquidationCall.id)),
        db
            .select()
            .from(Supply)
            .where(and(eq(Supply.onBehalfOf, userHex), eq(Supply.reserve, assetHex), lte(Supply.timestamp, endTimestamp)))
            .orderBy(asc(Supply.timestamp), asc(Supply.id)),
        db
            .select()
            .from(Withdraw)
            .where(and(eq(Withdraw.onBehalfOf, userHex), eq(Withdraw.reserve, assetHex), lte(Withdraw.timestamp, endTimestamp)))
            .orderBy(asc(Withdraw.timestamp), asc(Withdraw.id)),
    ]);

    return {user: userHex, asset: assetHex, endTimestamp, balanceEvents, borrows, repays, liquidations, supplies, withdraws};
}

// ---------------------------------------------------------------------------
// In-memory evaluation
// ---------------------------------------------------------------------------

/** Most recent balance event at or before `timestamp` */
export function lastBalanceEventAt(activity: UserAssetActivity, timestamp: number): BalanceEventRow | undefined {
    let last: BalanceEventRow | undefined;
    for (const event of activity.balanceEvents) {
        if (Number(event.timestamp) <= timestamp) last = event;
        else break;
    }
    return last;
}

/**
 * Scaled supply balance at `timestamp` as recorded by the last balance event,
 * without accounting for liquidations.
 */
export function recordedScaledBalanceAt(activity: UserAssetActivity, timestamp: number): bigint {
    const last = lastBalanceEventAt(activity, timestamp);
    return last ? BigInt(last.scaledBalance ?? 0n) : 0n;
}

/**
 * Scaled supply balance at `timestamp`, net of collateral liquidated up to then
 * (each liquidated amount converted to scaled units with the liquidity index at
 * the liquidation time). Returns 0 if the user had no balance event yet.
 */
export async function scaledBalanceAt(
    activity: UserAssetActivity,
    timestamp: number,
    series: ReserveIndexSeries
): Promise<bigint> {
    const last = lastBalanceEventAt(activity, timestamp);
    if (!last) return 0n;

    let scaledBalance = BigInt(last.scaledBalance ?? 0n);

    const liquidations = activity.liquidations.filter(
        (l) => sameAddress(l.collateralAsset, activity.asset) && Number(l.timestamp) <= timestamp
    );
    if (liquidations.length > 0) {
        await series.prefetch(liquidations.map((l) => Number(l.timestamp)));
        for (const liquidation of liquidations) {
            const index = await series.liquidityIndexAt(Number(liquidation.timestamp));
            scaledBalance -= (BigInt(liquidation.liquidatedCollateralAmount ?? 0n) * RAY) / index;
        }
    }

    return scaledBalance > 0n ? scaledBalance : 0n;
}

/**
 * Borrow balance at `timestamp` as the sum of borrows minus repays, without
 * accounting for liquidations.
 */
export function recordedBorrowBalanceAt(activity: UserAssetActivity, timestamp: number): bigint {
    let balance = 0n;
    for (const borrow of activity.borrows) {
        if (Number(borrow.timestamp) <= timestamp) balance += BigInt(borrow.amount ?? 0n);
    }
    for (const repay of activity.repays) {
        if (Number(repay.timestamp) <= timestamp) balance -= BigInt(repay.amount ?? 0n);
    }
    return balance;
}

/**
 * Borrow balance at `timestamp`, net of debt repaid through liquidations up to
 * then (converted with the variable borrow index at the liquidation time).
 */
export async function scaledBorrowBalanceAt(
    activity: UserAssetActivity,
    timestamp: number,
    series: ReserveIndexSeries
): Promise<bigint> {
    let balance = recordedBorrowBalanceAt(activity, timestamp);

    const liquidations = activity.liquidations.filter(
        (l) => sameAddress(l.debtAsset, activity.asset) && Number(l.timestamp) <= timestamp
    );
    if (liquidations.length > 0) {
        await series.prefetch(liquidations.map((l) => Number(l.timestamp)));
        for (const liquidation of liquidations) {
            const index = await series.variableBorrowIndexAt(Number(liquidation.timestamp));
            balance -= (BigInt(liquidation.debtToCover ?? 0n) * RAY) / index;
        }
    }

    return balance > 0n ? balance : 0n;
}

/**
 * Whether the user had a position or any activity in this asset during the period:
 * a supply or borrow balance at the start, or a balance/borrow/repay event inside it.
 */
export async function isActiveInPeriod(
    activity: UserAssetActivity,
    startTimestamp: number,
    endTimestamp: number,
    series: ReserveIndexSeries
): Promise<boolean> {
    const inPeriod = (timestamp: number | null) =>
        Number(timestamp) >= startTimestamp && Number(timestamp) <= endTimestamp;

    if (activity.balanceEvents.some((e) => inPeriod(e.timestamp))) return true;
    if (activity.borrows.some((e) => inPeriod(e.timestamp))) return true;
    if (activity.repays.some((e) => inPeriod(e.timestamp))) return true;
    if (recordedBorrowBalanceAt(activity, startTimestamp) > 0n) return true;
    return (await scaledBalanceAt(activity, startTimestamp, series)) > 0n;
}

/** Balance events at or before `timestamp`, formatted for API responses */
export function formatBalanceEvents(activity: UserAssetActivity, timestamp: number): EventDetail[] {
    return activity.balanceEvents
        .filter((event) => Number(event.timestamp) <= timestamp)
        .map((event) => ({
            eventType: event.eventType as EventDetail['eventType'],
            timestamp: Number(event.timestamp),
            date: new Date(Number(event.timestamp) * 1000).toISOString(),
            amount: (event.transactionAmount ?? 0n).toString(),
            txHash: event.txHash as string,
            assetPrice: event.assetPrice != null ? event.assetPrice.toString() : undefined,
        }));
}

/** Borrow and repay events at or before `timestamp`, formatted for API responses */
export function formatBorrowEvents(activity: UserAssetActivity, timestamp: number): EventDetail[] {
    const events: EventDetail[] = [];
    for (const borrow of activity.borrows) {
        if (Number(borrow.timestamp) > timestamp) continue;
        events.push({
            eventType: 'borrow',
            timestamp: Number(borrow.timestamp),
            date: new Date(Number(borrow.timestamp) * 1000).toISOString(),
            amount: (borrow.amount ?? 0n).toString(),
            txHash: borrow.txHash as string,
            assetPrice: borrow.price != null ? borrow.price.toString() : undefined,
        });
    }
    for (const repay of activity.repays) {
        if (Number(repay.timestamp) > timestamp) continue;
        events.push({
            eventType: 'repay',
            timestamp: Number(repay.timestamp),
            date: new Date(Number(repay.timestamp) * 1000).toISOString(),
            amount: (repay.amount ?? 0n).toString(),
            txHash: repay.txHash as string,
            assetPrice: repay.price != null ? repay.price.toString() : undefined,
        });
    }
    return events.sort((a, b) => a.timestamp - b.timestamp);
}
