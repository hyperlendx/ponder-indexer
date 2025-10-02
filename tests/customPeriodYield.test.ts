import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateUserCustomPeriodYield } from '../src/helpers/yield/yieldReports';

// Mock the ponder imports
vi.mock('ponder', () => ({
    eq: vi.fn((field, value) => ({ field, operator: 'eq', value })),
    and: vi.fn((...conditions) => ({ operator: 'and', conditions })),
    lte: vi.fn((field, value) => ({ field, operator: 'lte', value })),
    gte: vi.fn((field, value) => ({ field, operator: 'gte', value })),
    desc: vi.fn((field) => ({ field, order: 'desc' }))
}));

vi.mock('ponder:schema', () => ({
    UserBalanceEvent: {
        user: 'user',
        asset: 'asset',
        timestamp: 'timestamp',
        scaledBalance: 'scaledBalance',
        transactionAmount: 'transactionAmount',
        eventType: 'eventType',
        liquidityIndex: 'liquidityIndex'
    },
    UserPosition: {
        id: 'id',
        user: 'user',
        asset: 'asset',
        scaledBalance: 'scaledBalance',
        actualBalance: 'actualBalance',
        totalDeposits: 'totalDeposits',
        totalWithdrawals: 'totalWithdrawals',
        lastUpdated: 'lastUpdated'
    }
}));

// Mock the helper functions
vi.mock('../src/helpers/interestCalculations', () => ({
    calculateLiquidityIndexAtTimestamp: vi.fn().mockResolvedValue(1050000000000000000000000000n), // 1.05 RAY (5% growth)
    calculateActualBalance: vi.fn((scaled: bigint, index: bigint) => scaled * index / 1000000000000000000000000000n)
}));

vi.mock('../src/helpers/userPositionManager', () => ({
    calculateNetDeposits: vi.fn().mockResolvedValue(1000000000000000000000000000000n) // 1000 tokens
}));

describe('calculateUserCustomPeriodYield', () => {
    let mockContext: any;
    let mockDb: any;

    beforeEach(() => {
        mockDb = {
            sql: {
                select: vi.fn().mockReturnThis(),
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                orderBy: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue([])
            }
        };

        mockContext = {
            db: mockDb
        };

        vi.clearAllMocks();
    });

    it('should return empty array when user has no positions during period', async () => {
        // Mock no assets found
        mockDb.sql.limit.mockResolvedValue([]);

        const result = await calculateUserCustomPeriodYield(
            mockContext,
            '0x123',
            1640995200, // Jan 1, 2022
            1643673600  // Feb 1, 2022
        );

        expect(result).toEqual([]);
    });

    it('should calculate yield for user with positions during custom period', async () => {
        const mockAsset = '0xA0b86a33E6Ba3E5E2B9b2B8b5B6B7B8B9B0B1B2B3';
        const mockUser = '0x123';
        
        // Mock finding assets with positions
        mockDb.sql.limit
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // getScaledBalanceAtTimestamp start
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // getScaledBalanceAtTimestamp end
            .mockResolvedValueOnce([]) // period events query
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // max balance query
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // segments query start balance
            .mockResolvedValueOnce([]) // segments query events
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]); // assets with balance query

        // Mock events during period
        mockDb.sql.where.mockReturnThis();
        
        const result = await calculateUserCustomPeriodYield(
            mockContext,
            mockUser,
            1640995200, // Jan 1, 2022
            1643673600  // Feb 1, 2022
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            user: mockUser,
            asset: mockAsset,
            startTimestamp: 1640995200,
            endTimestamp: 1643673600,
            hadPositionDuringPeriod: false,
            transactionCount: 0
        });
    });

    it('should handle positions opened and closed within same period', async () => {
        const mockAsset = '0xA0b86a33E6Ba3E5E2B9b2B8b5B6B7B8B9B0B1B2B3';
        const mockUser = '0x123';
        
        // Mock scenario: position opened and closed within period
        const mockEvents = [
            {
                timestamp: 1641081600, // Jan 2, 2022 - deposit
                scaledBalance: 1000000000000000000000000000000n,
                eventType: 'deposit'
            },
            {
                timestamp: 1642291200, // Jan 16, 2022 - withdraw
                scaledBalance: 0n,
                eventType: 'withdraw'
            }
        ];

        mockDb.sql.limit
            .mockResolvedValueOnce([{ scaledBalance: 0n }]) // start balance (no position)
            .mockResolvedValueOnce([{ scaledBalance: 0n }]) // end balance (no position)
            .mockResolvedValueOnce(mockEvents) // period events
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // max balance
            .mockResolvedValueOnce([{ scaledBalance: 0n }]) // segments start balance
            .mockResolvedValueOnce(mockEvents) // segments events
            .mockResolvedValueOnce([]); // assets with balance (none at start)

        // Mock events during period query
        mockDb.sql.where.mockReturnThis();
        
        const result = await calculateUserCustomPeriodYield(
            mockContext,
            mockUser,
            1640995200, // Jan 1, 2022
            1643673600  // Feb 1, 2022
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            user: mockUser,
            asset: mockAsset,
            startScaledBalance: 0n,
            endScaledBalance: 0n,
            hadPositionDuringPeriod: true, // Had activity during period
            transactionCount: 2 // Two transactions
        });
    });

    it('should validate timestamp parameters', async () => {
        const mockUser = '0x123';
        
        // Test with invalid timestamps (end before start)
        await expect(
            calculateUserCustomPeriodYield(
                mockContext,
                mockUser,
                1643673600, // Feb 1, 2022
                1640995200  // Jan 1, 2022 (earlier)
            )
        ).rejects.toThrow();
    });

    it('should filter out zero yield segments', async () => {
        const mockAsset = '0xA0b86a33E6Ba3E5E2B9b2B8b5B6B7B8B9B0B1B2B3';
        const mockUser = '0x123';
        
        // Mock position with some yield
        mockDb.sql.limit
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // start balance
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // end balance
            .mockResolvedValueOnce([]) // period events
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // max balance
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]) // segments start balance
            .mockResolvedValueOnce([]) // segments events
            .mockResolvedValueOnce([{ scaledBalance: 1000000000000000000000000000000n }]); // assets with balance

        const result = await calculateUserCustomPeriodYield(
            mockContext,
            mockUser,
            1640995200, // Jan 1, 2022
            1643673600  // Feb 1, 2022
        );

        expect(result).toHaveLength(1);
        
        // Check that segments with zero yield would be filtered out
        if (result?.length > 0 && result[0]?.segments) {
            const zeroYieldSegments = result[0].segments.filter(segment => segment.segmentYield === 0n);
            expect(zeroYieldSegments).toHaveLength(0);
        }
    });
});
