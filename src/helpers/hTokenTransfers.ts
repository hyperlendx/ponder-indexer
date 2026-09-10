/**
 * Apply an hToken BalanceTransfer (an aToken moving between two holders; mints
 * and burns do not emit it) to both holders' positions.
 *
 * Aave v3 emits `BalanceTransfer(from, to, value, index)` with `value` already
 * in scaled units and `index` the liquidity index at transfer time, so the
 * position update needs no reserve lookup. Verified against HyperEVM: the
 * emitted `value` equals the change in scaledBalanceOf exactly.
 *
 * Transfers involving a withdraw adapter are skipped on purpose; see adapters.ts.
 */
import {updateUserPosition} from "./userPositionManager";
import {isWithdrawAdapter} from "./adapters";
import {USDC_ADDRESS} from "./usdc";

export interface BalanceTransferArgs {
    from: string;
    to: string;
    /** Scaled amount */
    value: bigint;
    /** Liquidity index at transfer time (ray) */
    index: bigint;
}

export interface BalanceTransferMeta {
    timestamp: number;
    txHash: string;
    blockNumber: bigint;
    logIndex: number;
}

export type BalanceTransferOutcome = 'applied' | 'skipped:zero' | 'skipped:self' | 'skipped:adapter';

export function classifyBalanceTransfer(args: BalanceTransferArgs): BalanceTransferOutcome {
    if (args.value === 0n) return 'skipped:zero';
    if (args.from.toLowerCase() === args.to.toLowerCase()) return 'skipped:self';
    if (isWithdrawAdapter(args.from) || isWithdrawAdapter(args.to)) return 'skipped:adapter';
    return 'applied';
}

export async function applyHTokenBalanceTransfer(
    context: any,
    args: BalanceTransferArgs,
    meta: BalanceTransferMeta
): Promise<BalanceTransferOutcome> {
    const outcome = classifyBalanceTransfer(args);
    if (outcome !== 'applied') return outcome;

    await updateUserPosition(
        context,
        args.from,
        USDC_ADDRESS,
        -args.value,
        'transfer_out',
        meta.timestamp,
        meta.txHash,
        meta.blockNumber,
        meta.logIndex,
        args.index
    );
    await updateUserPosition(
        context,
        args.to,
        USDC_ADDRESS,
        args.value,
        'transfer_in',
        meta.timestamp,
        meta.txHash,
        meta.blockNumber,
        meta.logIndex,
        args.index
    );
    return outcome;
}
