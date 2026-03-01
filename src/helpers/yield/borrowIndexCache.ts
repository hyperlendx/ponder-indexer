import { calculateVariableBorrowIndexAtTimestamp } from "../aave/borrowIndex";

/**
 * In-memory cache for variable borrow indices to avoid redundant database queries
 * 
 * This is the borrow-side equivalent of LiquidityIndexCache.
 * The same variable borrow index (asset + timestamp) is often queried multiple times
 * during yield calculations. This cache eliminates redundant queries.
 * 
 * Usage:
 * ```typescript
 * const cache = new BorrowIndexCache();
 * 
 * // Prefetch all indices you'll need
 * await cache.prefetch(context, [
 *   { asset: '0x123...', timestamp: 1640995200 },
 *   { asset: '0x123...', timestamp: 1643673600 },
 * ]);
 * 
 * // Get from cache (no DB query if cached)
 * const index = await cache.get(context, '0x123...', 1640995200);
 * ```
 */
export class BorrowIndexCache {
    private cache = new Map<string, bigint>();
    
    /**
     * Generate cache key from asset address and timestamp
     */
    private getCacheKey(asset: string, timestamp: number): string {
        return `${asset}-${timestamp}`;
    }
    
    /**
     * Get variable borrow index for an asset at a specific timestamp
     * Returns cached value if available, otherwise queries database and caches result
     */
    async get(
        context: any,
        asset: string,
        timestamp: number
    ): Promise<bigint> {
        const key = this.getCacheKey(asset, timestamp);
        
        // Return cached value if available
        if (this.cache.has(key)) {
            return this.cache.get(key)!;
        }
        
        // Query database and cache result
        const index = await calculateVariableBorrowIndexAtTimestamp(
            context,
            asset,
            timestamp
        );
        this.cache.set(key, index);
        return index;
    }
    
    /**
     * Batch prefetch variable borrow indices for known asset/timestamp pairs
     * This is more efficient than calling get() multiple times sequentially
     * 
     * @param context - Ponder context
     * @param assetTimestamps - Array of {asset, timestamp} pairs to prefetch
     */
    async prefetch(
        context: any,
        assetTimestamps: Array<{ asset: string; timestamp: number }>
    ): Promise<void> {
        // Filter out already cached entries
        const uncached = assetTimestamps.filter(({ asset, timestamp }) => {
            const key = this.getCacheKey(asset, timestamp);
            return !this.cache.has(key);
        });
        
        if (uncached.length === 0) {
            return; // All already cached
        }
        
        // Fetch all uncached indices in parallel
        const promises = uncached.map(async ({ asset, timestamp }) => {
            const key = this.getCacheKey(asset, timestamp);
            const index = await calculateVariableBorrowIndexAtTimestamp(
                context,
                asset,
                timestamp
            );
            this.cache.set(key, index);
        });
        
        await Promise.all(promises);
    }
    
    /**
     * Clear all cached indices
     */
    clear(): void {
        this.cache.clear();
    }
    
    /**
     * Get number of cached indices
     */
    size(): number {
        return this.cache.size;
    }
    
    /**
     * Check if a specific asset/timestamp is cached
     */
    has(asset: string, timestamp: number): boolean {
        const key = this.getCacheKey(asset, timestamp);
        return this.cache.has(key);
    }
    
    /**
     * Get cache statistics for monitoring
     */
    getStats(): { size: number; keys: string[] } {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

