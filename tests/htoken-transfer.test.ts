/**
 * hUSDC BalanceTransfer handling against an in-memory stand-in for Ponder's
 * store API (find / insert / update / delete), which is all the position
 * manager uses.
 */
import {describe, expect, it} from "vitest";
import {UserPosition, UserBalanceEvent} from "ponder:schema";
import {applyHTokenBalanceTransfer, classifyBalanceTransfer} from "../src/helpers/hTokenTransfers";
import {updateUserPosition} from "../src/helpers/userPositionManager";
import {WITHDRAW_ADAPTER_ADDRESSES} from "../src/helpers/adapters";
import {USDC_ADDRESS} from "../src/helpers/usdc";

const RAY = 10n ** 27n;
const ALICE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function makeStore() {
    const positions = new Map<string, any>();
    const events: any[] = [];
    const db = {
        find: async (table: any, {id}: {id: string}) => (table === UserPosition ? positions.get(id) : undefined),
        insert: (table: any) => ({
            values: async (row: any) => {
                if (table === UserPosition) positions.set(row.id, row);
                else if (table === UserBalanceEvent) events.push(row);
                else throw new Error("unexpected table");
            },
        }),
        update: (table: any, {id}: {id: string}) => ({
            set: async (row: any) => {
                if (table !== UserPosition) throw new Error("unexpected table");
                positions.set(id, {...positions.get(id), ...row});
            },
        }),
        delete: async (table: any, {id}: {id: string}) => {
            if (table !== UserPosition) throw new Error("unexpected table");
            positions.delete(id);
        },
    };
    return {context: {db}, positions, events};
}

const meta = {timestamp: 1_700_000_000, txHash: "0x01", blockNumber: 10n, logIndex: 3};
const positionId = (user: string, asset: string = USDC_ADDRESS) => `${user.toLowerCase()}_${asset.toLowerCase()}`;

describe("hUSDC BalanceTransfer", () => {
    it("moves scaled balance from sender to recipient and records both events at the transfer index", async () => {
        const {context, positions, events} = makeStore();
        await updateUserPosition(context, ALICE, USDC_ADDRESS, 1_000n, 'deposit', 1_600_000_000, "0x00", 1n, 0, RAY);

        const index = RAY + RAY / 20n; // 1.05
        const outcome = await applyHTokenBalanceTransfer(context, {from: ALICE, to: BOB, value: 400n, index}, meta);

        expect(outcome).toBe('applied');
        expect(positions.get(positionId(ALICE)).scaledBalance).toBe(600n);
        expect(positions.get(positionId(BOB)).scaledBalance).toBe(400n);
        const transferEvents = events.filter((e) => e.txHash === "0x01");
        expect(transferEvents.map((e) => [e.user, e.eventType, e.transactionAmount, e.scaledBalance, e.liquidityIndex])).toEqual([
            [ALICE, 'transfer_out', -400n, 600n, index],
            [BOB, 'transfer_in', 400n, 400n, index],
        ]);
        // distinct ids for the two sides of the same log
        expect(new Set(transferEvents.map((e) => e.id)).size).toBe(2);
    });

    it("transferring the whole balance closes the sender's position", async () => {
        const {context, positions} = makeStore();
        await updateUserPosition(context, ALICE, USDC_ADDRESS, 1_000n, 'deposit', 1_600_000_000, "0x00", 1n, 0, RAY);
        await applyHTokenBalanceTransfer(context, {from: ALICE, to: BOB, value: 1_000n, index: RAY}, meta);
        expect(positions.has(positionId(ALICE))).toBe(false);
        expect(positions.get(positionId(BOB)).scaledBalance).toBe(1_000n);
    });

    it("skips transfers to or from a withdraw adapter, which the Withdraw handler already attributes", async () => {
        const {context, positions, events} = makeStore();
        await updateUserPosition(context, ALICE, USDC_ADDRESS, 1_000n, 'deposit', 1_600_000_000, "0x00", 1n, 0, RAY);
        for (const adapter of WITHDRAW_ADAPTER_ADDRESSES) {
            expect(await applyHTokenBalanceTransfer(context, {from: ALICE, to: adapter, value: 100n, index: RAY}, meta)).toBe('skipped:adapter');
            expect(await applyHTokenBalanceTransfer(context, {from: adapter.toLowerCase(), to: ALICE, value: 100n, index: RAY}, meta)).toBe('skipped:adapter');
        }
        expect(positions.get(positionId(ALICE)).scaledBalance).toBe(1_000n);
        expect(events.filter((e) => e.txHash === "0x01")).toHaveLength(0);
    });

    it("keys the position identically whether addresses arrive lowercased (event args) or checksummed (constants)", async () => {
        const {context, positions, events} = makeStore();
        // Supply handler: Ponder passes event.args.onBehalfOf / event.args.reserve lowercased.
        await updateUserPosition(context, ALICE.toLowerCase(), USDC_ADDRESS.toLowerCase(), 1_000n, 'deposit', 1_600_000_000, "0x00", 1n, 0, RAY);
        // Transfer handler: checksummed `from` and the checksummed USDC_ADDRESS constant.
        const checksummedAlice = "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa";
        await applyHTokenBalanceTransfer(context, {from: checksummedAlice, to: BOB, value: 400n, index: RAY}, meta);

        expect(positions.size).toBe(2);
        expect(positions.get(positionId(ALICE)).scaledBalance).toBe(600n);
        expect(positions.get(positionId(BOB)).scaledBalance).toBe(400n);
        const out = events.find((e) => e.eventType === 'transfer_out');
        expect(out.scaledBalance).toBe(600n);
        expect(out.id).toBe(`0x01_3_${ALICE}_${USDC_ADDRESS.toLowerCase()}`);
    });

    it("skips zero-value and self transfers", () => {
        expect(classifyBalanceTransfer({from: ALICE, to: BOB, value: 0n, index: RAY})).toBe('skipped:zero');
        expect(classifyBalanceTransfer({from: ALICE, to: ALICE.toUpperCase().replace("0X", "0x"), value: 5n, index: RAY})).toBe('skipped:self');
    });
});
