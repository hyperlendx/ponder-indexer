/**
 * UserAssetActivity - everything the yield endpoints need to know about one
 * (user, asset) pair. It loads only the requested interval, one pre-period
 * balance checkpoint, and compact aggregate starting values. Report helpers
 * then evaluate the bounded rows in memory.
 */
import {UserBalanceEvent, Borrow, Repay, LiquidationCall, Supply, Withdraw} from "ponder:schema";
import {eq, and, or, lt, lte, gte, asc, desc, sql} from "ponder";
import type {PriceSeries} from "./priceSeries";

export type BalanceEventRow = Pick<typeof UserBalanceEvent.$inferSelect,
    'txHash' | 'scaledBalance' | 'transactionAmount' | 'eventType' | 'timestamp' |
    'blockNumber' | 'logIndex' | 'liquidityIndex'>;
export type BorrowRow = Pick<typeof Borrow.$inferSelect,
    'id' | 'txHash' | 'amount' | 'scaledAmount' | 'timestamp'>;
export type RepayRow = Pick<typeof Repay.$inferSelect,
    'id' | 'txHash' | 'amount' | 'scaledAmount' | 'timestamp'>;
export type LiquidationRow = Pick<typeof LiquidationCall.$inferSelect,
    'id' | 'txHash' | 'collateralAsset' | 'debtAsset' | 'debtToCover' |
    'liquidatedCollateralAmount' | 'scaledDebtToCover' | 'scaledCollateralAmount' | 'timestamp'>;
export type SupplyRow = Pick<typeof Supply.$inferSelect, 'id' | 'txHash' | 'amount' | 'timestamp'>;
export type WithdrawRow = Pick<typeof Withdraw.$inferSelect, 'id' | 'txHash' | 'amount' | 'timestamp'>;

const balanceEventColumns = {
    txHash: UserBalanceEvent.txHash,
    scaledBalance: UserBalanceEvent.scaledBalance,
    transactionAmount: UserBalanceEvent.transactionAmount,
    eventType: UserBalanceEvent.eventType,
    timestamp: UserBalanceEvent.timestamp,
    blockNumber: UserBalanceEvent.blockNumber,
    logIndex: UserBalanceEvent.logIndex,
    liquidityIndex: UserBalanceEvent.liquidityIndex,
};
const borrowColumns = {
    id: Borrow.id,
    txHash: Borrow.txHash,
    amount: Borrow.amount,
    scaledAmount: Borrow.scaledAmount,
    timestamp: Borrow.timestamp,
};
const repayColumns = {
    id: Repay.id,
    txHash: Repay.txHash,
    amount: Repay.amount,
    scaledAmount: Repay.scaledAmount,
    timestamp: Repay.timestamp,
};
const liquidationColumns = {
    id: LiquidationCall.id,
    txHash: LiquidationCall.txHash,
    collateralAsset: LiquidationCall.collateralAsset,
    debtAsset: LiquidationCall.debtAsset,
    debtToCover: LiquidationCall.debtToCover,
    liquidatedCollateralAmount: LiquidationCall.liquidatedCollateralAmount,
    scaledDebtToCover: LiquidationCall.scaledDebtToCover,
    scaledCollateralAmount: LiquidationCall.scaledCollateralAmount,
    timestamp: LiquidationCall.timestamp,
};
const supplyColumns = {id: Supply.id, txHash: Supply.txHash, amount: Supply.amount, timestamp: Supply.timestamp};
const withdrawColumns = {id: Withdraw.id, txHash: Withdraw.txHash, amount: Withdraw.amount, timestamp: Withdraw.timestamp};

/**
 * Event detail for transparency and verification
 */
export interface EventDetail {
    eventType:
        | 'deposit'
        | 'withdraw'
        | 'transfer_in'
        | 'transfer_out'
        | 'borrow'
        | 'repay'
        | 'liquidation_collateral'
        | 'liquidation_debt';
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
    /** Rows strictly before this timestamp are represented by the starting aggregates below. */
    startTimestamp: number;
    startingScaledBorrowBalance: bigint;
    startingRawBorrowBalance: bigint;
    startingRawSupplyBalance: bigint;
    startingScaledCollateralLiquidated: bigint;
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
 * Load the user's activity in one asset up to `endTimestamp` (inclusive).
 */
export async function loadUserAssetActivity(
    context: any,
    user: string,
    asset: string,
    endTimestamp: number,
    options: {includeRawActivity?: boolean; startTimestamp?: number} = {}
): Promise<UserAssetActivity> {
    const db = context.db.sql || context.db;
    const userHex = user as `0x${string}`;
    const assetHex = asset as `0x${string}`;
    // Ponder's hex columns lowercase values on write. The query builder applies that
    // encoder automatically (eq(column, value)), but a raw sql`` template binds values
    // verbatim, so addresses interpolated below must go through the column encoder too.
    const userParam = sql.param(userHex, UserBalanceEvent.user);
    const assetParam = sql.param(assetHex, UserBalanceEvent.asset);
    const startTimestamp = options.startTimestamp ?? 0;
    const includeRawActivity = options.includeRawActivity !== false;

    const balanceEventsPromise = Promise.all([
        db
            .select(balanceEventColumns)
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, userHex),
                    eq(UserBalanceEvent.asset, assetHex),
                    lt(UserBalanceEvent.timestamp, startTimestamp)
                )
            )
            .orderBy(
                desc(UserBalanceEvent.timestamp),
                desc(UserBalanceEvent.blockNumber),
                desc(UserBalanceEvent.logIndex)
            )
            .limit(1),
        db
            .select(balanceEventColumns)
            .from(UserBalanceEvent)
            .where(
                and(
                    eq(UserBalanceEvent.user, userHex),
                    eq(UserBalanceEvent.asset, assetHex),
                    gte(UserBalanceEvent.timestamp, startTimestamp),
                    lte(UserBalanceEvent.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(UserBalanceEvent.timestamp), asc(UserBalanceEvent.blockNumber), asc(UserBalanceEvent.logIndex)),
    ]).then(([before, during]) => [...before.reverse(), ...during]);

    const rawActivityTotals = includeRawActivity
        ? sql`
            select
                coalesce((select sum(${Supply.amount}) from ${Supply} where ${Supply.onBehalfOf} = ${userParam} and ${Supply.reserve} = ${assetParam} and ${Supply.timestamp} < ${startTimestamp}), 0) as raw_supplied,
                coalesce((select sum(${Withdraw.amount}) from ${Withdraw} where ${Withdraw.onBehalfOf} = ${userParam} and ${Withdraw.reserve} = ${assetParam} and ${Withdraw.timestamp} < ${startTimestamp}), 0) as raw_withdrawn
        `
        : sql`select 0::numeric as raw_supplied, 0::numeric as raw_withdrawn`;
    const startingResultPromise = db.execute(sql`
        with borrow_totals as (
            select
                coalesce(sum(${Borrow.scaledAmount}), 0) as scaled_borrowed,
                coalesce(sum(${Borrow.amount}), 0) as raw_borrowed
            from ${Borrow}
            where ${Borrow.onBehalfOf} = ${userParam}
              and ${Borrow.reserve} = ${assetParam}
              and ${Borrow.timestamp} < ${startTimestamp}
        ), repay_totals as (
            select
                coalesce(sum(${Repay.scaledAmount}), 0) as scaled_repaid,
                coalesce(sum(${Repay.amount}), 0) as raw_repaid
            from ${Repay}
            where ${Repay.user} = ${userParam}
              and ${Repay.reserve} = ${assetParam}
              and ${Repay.timestamp} < ${startTimestamp}
        ), liquidation_totals as (
            select
                coalesce(sum(${LiquidationCall.scaledDebtToCover}) filter (where ${LiquidationCall.debtAsset} = ${assetParam}), 0) as scaled_debt_liquidated,
                coalesce(sum(${LiquidationCall.debtToCover}) filter (where ${LiquidationCall.debtAsset} = ${assetParam}), 0) as raw_debt_liquidated,
                coalesce(sum(${LiquidationCall.scaledCollateralAmount}) filter (where ${LiquidationCall.collateralAsset} = ${assetParam}), 0) as scaled_collateral_liquidated,
                coalesce(sum(${LiquidationCall.liquidatedCollateralAmount}) filter (where ${LiquidationCall.collateralAsset} = ${assetParam}), 0) as raw_collateral_liquidated
            from ${LiquidationCall}
            where ${LiquidationCall.user} = ${userParam}
              and (${LiquidationCall.debtAsset} = ${assetParam} or ${LiquidationCall.collateralAsset} = ${assetParam})
              and ${LiquidationCall.timestamp} < ${startTimestamp}
        ), raw_activity_totals as (
            ${rawActivityTotals}
        )
        select
            borrow_totals.*,
            repay_totals.*,
            liquidation_totals.*,
            raw_activity_totals.*
        from borrow_totals
        cross join repay_totals
        cross join liquidation_totals
        cross join raw_activity_totals
    `);

    const [balanceEvents, borrows, repays, liquidations, supplies, withdraws, startingResult] = await Promise.all([
        balanceEventsPromise,
        db
            .select(borrowColumns)
            .from(Borrow)
            .where(and(eq(Borrow.onBehalfOf, userHex), eq(Borrow.reserve, assetHex), gte(Borrow.timestamp, startTimestamp), lte(Borrow.timestamp, endTimestamp)))
            .orderBy(asc(Borrow.timestamp), asc(Borrow.id)),
        db
            .select(repayColumns)
            .from(Repay)
            .where(and(eq(Repay.user, userHex), eq(Repay.reserve, assetHex), gte(Repay.timestamp, startTimestamp), lte(Repay.timestamp, endTimestamp)))
            .orderBy(asc(Repay.timestamp), asc(Repay.id)),
        db
            .select(liquidationColumns)
            .from(LiquidationCall)
            .where(
                and(
                    eq(LiquidationCall.user, userHex),
                    or(eq(LiquidationCall.collateralAsset, assetHex), eq(LiquidationCall.debtAsset, assetHex)),
                    gte(LiquidationCall.timestamp, startTimestamp),
                    lte(LiquidationCall.timestamp, endTimestamp)
                )
            )
            .orderBy(asc(LiquidationCall.timestamp), asc(LiquidationCall.id)),
        !includeRawActivity
            ? Promise.resolve([] as SupplyRow[])
            : db
                .select(supplyColumns)
                .from(Supply)
                .where(and(eq(Supply.onBehalfOf, userHex), eq(Supply.reserve, assetHex), gte(Supply.timestamp, startTimestamp), lte(Supply.timestamp, endTimestamp)))
                .orderBy(asc(Supply.timestamp), asc(Supply.id)),
        !includeRawActivity
            ? Promise.resolve([] as WithdrawRow[])
            : db
                .select(withdrawColumns)
                .from(Withdraw)
                .where(and(eq(Withdraw.onBehalfOf, userHex), eq(Withdraw.reserve, assetHex), gte(Withdraw.timestamp, startTimestamp), lte(Withdraw.timestamp, endTimestamp)))
                .orderBy(asc(Withdraw.timestamp), asc(Withdraw.id)),
        startingResultPromise,
    ]);

    const startingRows = Array.isArray(startingResult) ? startingResult : startingResult?.rows ?? [];
    const starting = startingRows[0] ?? {};
    return {
        user: userHex,
        asset: assetHex,
        startTimestamp,
        endTimestamp,
        startingScaledBorrowBalance:
            BigInt(starting.scaled_borrowed ?? 0) -
            BigInt(starting.scaled_repaid ?? 0) -
            BigInt(starting.scaled_debt_liquidated ?? 0),
        startingRawBorrowBalance:
            BigInt(starting.raw_borrowed ?? 0) -
            BigInt(starting.raw_repaid ?? 0) -
            BigInt(starting.raw_debt_liquidated ?? 0),
        startingRawSupplyBalance:
            BigInt(starting.raw_supplied ?? 0) -
            BigInt(starting.raw_withdrawn ?? 0) -
            BigInt(starting.raw_collateral_liquidated ?? 0),
        startingScaledCollateralLiquidated: BigInt(starting.scaled_collateral_liquidated ?? 0),
        balanceEvents,
        borrows,
        repays,
        liquidations,
        supplies,
        withdraws,
    };
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
export function scaledBalanceAt(activity: UserAssetActivity, timestamp: number): bigint {
    const last = lastBalanceEventAt(activity, timestamp);
    if (!last) return 0n;

    let scaledBalance = BigInt(last.scaledBalance ?? 0n) - activity.startingScaledCollateralLiquidated;

    const liquidations = activity.liquidations.filter(
        (l) => sameAddress(l.collateralAsset, activity.asset) && Number(l.timestamp) <= timestamp
    );
    if (liquidations.length > 0) {
        for (const liquidation of liquidations) {
            scaledBalance -= BigInt(liquidation.scaledCollateralAmount ?? 0n);
        }
    }

    return scaledBalance > 0n ? scaledBalance : 0n;
}

/**
 * Borrow balance at `timestamp` as the sum of borrows minus repays, without
 * accounting for liquidations.
 */
export function recordedBorrowBalanceAt(activity: UserAssetActivity, timestamp: number): bigint {
    let balance = activity.startingScaledBorrowBalance;
    for (const borrow of activity.borrows) {
        if (Number(borrow.timestamp) <= timestamp) balance += BigInt(borrow.scaledAmount ?? 0n);
    }
    for (const repay of activity.repays) {
        if (Number(repay.timestamp) <= timestamp) balance -= BigInt(repay.scaledAmount ?? 0n);
    }
    for (const liquidation of activity.liquidations) {
        if (sameAddress(liquidation.debtAsset, activity.asset) && Number(liquidation.timestamp) <= timestamp) {
            balance -= BigInt(liquidation.scaledDebtToCover ?? 0n);
        }
    }
    return balance;
}

/**
 * Whether the user had a position or any activity in this asset during the period:
 * a supply or borrow balance at the start, or a balance/borrow/repay event inside it.
 */
export function isActiveInPeriod(
    activity: UserAssetActivity,
    startTimestamp: number,
    endTimestamp: number
): boolean {
    const inPeriod = (timestamp: number | null) =>
        Number(timestamp) >= startTimestamp && Number(timestamp) <= endTimestamp;

    if (activity.balanceEvents.some((e) => inPeriod(e.timestamp))) return true;
    if (activity.borrows.some((e) => inPeriod(e.timestamp))) return true;
    if (activity.repays.some((e) => inPeriod(e.timestamp))) return true;
    if (activity.liquidations.some((e) => inPeriod(e.timestamp))) return true;
    if (recordedBorrowBalanceAt(activity, startTimestamp) > 0n) return true;
    return scaledBalanceAt(activity, startTimestamp) > 0n;
}

/** Balance events at or before `timestamp`, formatted for API responses */
export function formatBalanceEvents(activity: UserAssetActivity, timestamp: number, prices: PriceSeries): EventDetail[] {
    return activity.balanceEvents
        .filter((event) => Number(event.timestamp) <= timestamp)
        .map((event) => {
            const eventTimestamp = Number(event.timestamp);
            const price = prices.priceAt(eventTimestamp).price;
            return {
                eventType: event.eventType as EventDetail['eventType'],
                timestamp: eventTimestamp,
                date: new Date(eventTimestamp * 1000).toISOString(),
                amount: (event.transactionAmount ?? 0n).toString(),
                txHash: event.txHash as string,
                assetPrice: price > 0n ? price.toString() : undefined,
            };
        });
}

/** Borrow and repay events at or before `timestamp`, formatted for API responses */
export function formatBorrowEvents(activity: UserAssetActivity, timestamp: number, prices: PriceSeries): EventDetail[] {
    const events: EventDetail[] = [];
    for (const borrow of activity.borrows) {
        if (Number(borrow.timestamp) > timestamp) continue;
        const eventTimestamp = Number(borrow.timestamp);
        const price = prices.priceAt(eventTimestamp).price;
        events.push({
            eventType: 'borrow',
            timestamp: eventTimestamp,
            date: new Date(eventTimestamp * 1000).toISOString(),
            amount: (borrow.amount ?? 0n).toString(),
            txHash: borrow.txHash as string,
            assetPrice: price > 0n ? price.toString() : undefined,
        });
    }
    for (const repay of activity.repays) {
        if (Number(repay.timestamp) > timestamp) continue;
        const eventTimestamp = Number(repay.timestamp);
        const price = prices.priceAt(eventTimestamp).price;
        events.push({
            eventType: 'repay',
            timestamp: eventTimestamp,
            date: new Date(eventTimestamp * 1000).toISOString(),
            amount: (repay.amount ?? 0n).toString(),
            txHash: repay.txHash as string,
            assetPrice: price > 0n ? price.toString() : undefined,
        });
    }
    return events.sort((a, b) => a.timestamp - b.timestamp);
}
