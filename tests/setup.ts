/**
 * Test setup file for Vitest
 * This file runs before all tests and sets up mocks and global configurations
 */

import { vi } from 'vitest';

// Mock ponder:schema
vi.mock('ponder:schema', () => ({
  ReserveDataEvent: {
    reserve: 'reserve',
    timestamp: 'timestamp',
    liquidityIndex: 'liquidityIndex',
    liquidityRate: 'liquidityRate',
    blockNumber: 'blockNumber'
  },
  UserBalanceEvent: {
    user: 'user',
    asset: 'asset',
    scaledBalance: 'scaledBalance',
    eventType: 'eventType',
    timestamp: 'timestamp',
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
  },
  UserMonthlyInterest: {
    id: 'id',
    user: 'user',
    asset: 'asset',
    year: 'year',
    month: 'month',
    interestEarned: 'interestEarned',
    netDeposits: 'netDeposits'
  }
}));

// Mock ponder query functions
vi.mock('ponder', () => ({
  eq: vi.fn((field, value) => ({ field, operator: 'eq', value })),
  desc: vi.fn((field) => ({ field, order: 'desc' })),
  and: vi.fn((...conditions) => ({ operator: 'and', conditions })),
  lte: vi.fn((field, value) => ({ field, operator: 'lte', value })),
  gte: vi.fn((field, value) => ({ field, operator: 'gte', value })),
  graphql: vi.fn()
}));

// Mock database operations
const mockDb = {
  select: vi.fn(() => mockDb),
  from: vi.fn(() => mockDb),
  where: vi.fn(() => mockDb),
  orderBy: vi.fn(() => mockDb),
  limit: vi.fn(() => mockDb),
  offset: vi.fn(() => mockDb),
  find: vi.fn(),
  insert: vi.fn(() => ({ values: vi.fn() })),
  update: vi.fn(() => ({ set: vi.fn() })),
  delete: vi.fn()
};

// Mock context for helper functions
global.mockContext = {
  db: mockDb
};

// Global test utilities
global.createMockContext = () => ({
  db: mockDb
});

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});
