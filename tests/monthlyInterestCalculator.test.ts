import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getScaledBalanceAtTimestamp, calculateUserMonthlyYield } from '../src/helpers/monthlyInterestCalculator';

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
        scaledBalance: 'scaledBalance'
    }
}));

// Mock the helper functions
vi.mock('../src/helpers/interestCalculations', () => ({
    getMonthTimestamps: vi.fn((year: number, month: number) => ({
        startTimestamp: Math.floor(new Date(year, month - 1, 1).getTime() / 1000),
        endTimestamp: Math.floor(new Date(year, month, 0, 23, 59, 59, 999).getTime() / 1000)
    })),
    calculateLiquidityIndexAtTimestamp: vi.fn().mockResolvedValue(1000000000000000000000000000n), // 1 RAY
    calculateActualBalance: vi.fn((scaled: bigint, index: bigint) => scaled * index / 1000000000000000000000000000n)
}));

vi.mock('../src/helpers/userPositionManager', () => ({
    calculateNetDeposits: vi.fn().mockResolvedValue(0n)
}));

describe('getScaledBalanceAtTimestamp', () => {
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
        mockContext = { db: mockDb };
    });

    it('should return 0n when no balance events are found', async () => {
        // Mock empty result
        mockDb.sql.limit.mockResolvedValue([]);

        const result = await getScaledBalanceAtTimestamp(
            mockContext,
            '0x1234567890123456789012345678901234567890',
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            1640995200 // Jan 1, 2022
        );

        expect(result).toBe(0n);
    });

    it('should return scaled balance from most recent event', async () => {
        const mockEvent = {
            timestamp: 1640995200,
            scaledBalance: 1000000000000000000n, // 1 token in scaled format
            user: '0x1234567890123456789012345678901234567890',
            asset: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
        };

        // Mock successful result
        mockDb.sql.limit.mockResolvedValue([mockEvent]);

        const result = await getScaledBalanceAtTimestamp(
            mockContext,
            '0x1234567890123456789012345678901234567890',
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            1640995200
        );

        expect(result).toBe(1000000000000000000n);
    });

    it('should handle database errors gracefully', async () => {
        // Mock database error
        mockDb.sql.limit.mockRejectedValue(new Error('Database connection failed'));

        const result = await getScaledBalanceAtTimestamp(
            mockContext,
            '0x1234567890123456789012345678901234567890',
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            1640995200
        );

        expect(result).toBe(0n);
    });

    it('should query with correct parameters', async () => {
        const user = '0x1234567890123456789012345678901234567890';
        const asset = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
        const timestamp = 1640995200;

        mockDb.sql.limit.mockResolvedValue([]);

        await getScaledBalanceAtTimestamp(mockContext, user, asset, timestamp);

        // Verify the query chain was called correctly
        expect(mockDb.sql.select).toHaveBeenCalled();
        expect(mockDb.sql.from).toHaveBeenCalled();
        expect(mockDb.sql.where).toHaveBeenCalled();
        expect(mockDb.sql.orderBy).toHaveBeenCalled();
        expect(mockDb.sql.limit).toHaveBeenCalledWith(1);
    });

    it('should handle BigInt conversion correctly', async () => {
        const mockEvent = {
            timestamp: 1640995200,
            scaledBalance: '2500000000000000000', // String representation
            user: '0x1234567890123456789012345678901234567890',
            asset: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
        };

        mockDb.sql.limit.mockResolvedValue([mockEvent]);

        const result = await getScaledBalanceAtTimestamp(
            mockContext,
            '0x1234567890123456789012345678901234567890',
            '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
            1640995200
        );

        expect(result).toBe(2500000000000000000n);
    });
});

describe('calculateUserMonthlyYield', () => {
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
        mockContext = { db: mockDb };

        // Reset all mocks
        vi.clearAllMocks();
    });

    it('should return empty array when user has no positions', async () => {
        // Mock no balance events found
        mockDb.sql.limit.mockResolvedValue([]);

        const result = await calculateUserMonthlyYield(
            mockContext,
            '0x1234567890123456789012345678901234567890',
            2024,
            1
        );

        expect(result).toEqual([]);
    });

    it('should calculate monthly yield correctly', async () => {
        const mockAsset = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

        // Create a mock query builder that resolves to different values based on call order
        let callCount = 0;
        const mockQueryBuilder = {
            select: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // getScaledBalanceAtTimestamp - start balance
                    return Promise.resolve([{
                        scaledBalance: 1000000000000000000n,
                        timestamp: 1640991600
                    }]);
                } else if (callCount === 2) {
                    // getScaledBalanceAtTimestamp - end balance
                    return Promise.resolve([{
                        scaledBalance: 1100000000000000000n,
                        timestamp: 1643669999
                    }]);
                }
                return Promise.resolve([]);
            }),
            // Handle direct promise resolution for getUserAssetsForMonth queries
            then: vi.fn().mockImplementation((resolve) => {
                callCount++;
                if (callCount === 1) {
                    // Events during month
                    return resolve([{
                        asset: mockAsset,
                        scaledBalance: 1000000000000000000n,
                        timestamp: 1640995200
                    }]);
                } else if (callCount === 2) {
                    // Events before month
                    return resolve([{
                        asset: mockAsset,
                        scaledBalance: 1000000000000000000n,
                        timestamp: 1640908800
                    }]);
                }
                return resolve([]);
            })
        };

        mockDb.sql = mockQueryBuilder;

        const result = await calculateUserMonthlyYield(
            mockContext,
            '0x1234567890123456789012345678901234567890',
            2022,
            1
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            user: '0x1234567890123456789012345678901234567890',
            asset: mockAsset,
            year: 2022,
            month: 1
        });

        expect(typeof result[0]?.monthlyYield).toBe('bigint');
        expect(typeof result[0]?.startTimestamp).toBe('number');
        expect(typeof result[0]?.endTimestamp).toBe('number');
    });
});
