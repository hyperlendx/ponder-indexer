/**
 * Periphery contracts that pull a user's hTokens with transferFrom and withdraw
 * them from the pool in the same transaction (collateral swaps, repay-with-
 * collateral, the wrapped-native gateway). On-chain this shows up as a
 * BalanceTransfer(user -> adapter) followed by a Withdraw whose `user` is the
 * adapter and whose `to` is the adapter.
 *
 * The Withdraw handler attributes such withdrawals to `transaction.from` (the
 * real user), so the BalanceTransfer handler must NOT also move the balance
 * from the user to the adapter, or the withdrawal would be counted twice.
 * Both handlers use this list so the two rules cannot drift apart.
 */
import {getAddress} from "viem";

export const WITHDRAW_ADAPTER_ADDRESSES: readonly `0x${string}`[] = [
    getAddress("0x49558c794ea2aC8974C9F27886DDfAa951E99171"), // WrappedTokenGateway
    getAddress("0x7469AA4124cc6ee078f98B581198eB39d2487E79"), // CollateralSwapper
    getAddress("0x6C674165E3AFaD857fab8CB0E91BCC057b813F03"), // LiquidSwapRepayAdapter
];

const adapterSet = new Set(WITHDRAW_ADAPTER_ADDRESSES.map((address) => address.toLowerCase()));

export function isWithdrawAdapter(address: string): boolean {
    return adapterSet.has(address.toLowerCase());
}
