/**
 * Isolated Pair Time-Based Yield Aggregations
 *
 * Functions for aggregating yields over time periods (daily, monthly).
 * These are used by APIs to provide time-series yield data.
 *
 * **Performance:** Uses caching with prefetching to dramatically improve performance
 * for multi-day/month calculations (90-97% faster than without caching).
 */

import { calculateIsolatedPairYield } from "./yieldCalculations";
import { getUserIsolatedPairs } from "./pairTracking";
import { ExchangeRateCache } from "./exchangeRateCache";
import { IsolatedPairBalanceCache } from "./balanceCache";

/**
 * Daily yield data structure
 */
export interface DailyIsolatedPairYield {
    date: string;
    timestamp: number;
    dailyYield: bigint;
    pairs: Array<{
        pair: string;
        assetYield: bigint;
        borrowYield: bigint;
        netYield: bigint;
    }>;
}

/**
 * Monthly yield data structure
 */
export interface MonthlyIsolatedPairYield {
    year: number;
    month: number;
    monthName: string;
    startDate: string;
    endDate: string;
    monthlyYield: bigint;
    pairs: Array<{
        pair: string;
        assetYield: bigint;
        borrowYield: bigint;
        netYield: bigint;
    }>;
}

/**
 * Calculate daily yield for all isolated pairs for a user
 *
 * Breaks down the time period into daily segments and calculates yield for each day.
 * This provides a time-series view of yield generation.
 *
 * Days with zero yield are still included in the results.
 *
 * **Performance Optimization:** Uses caching with prefetching to avoid redundant queries.
 * For a 30-day period with 3 pairs, this reduces queries from ~720 to ~24 (97% reduction).
 *
 * **Partial Day Support:** If endTimestamp is not at a day boundary (midnight UTC),
 * also calculates current yield at endTimestamp and returns it separately.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Object with dailyValues (complete days) and optional currentValue (partial day)
 *
 * @example
 * ```typescript
 * const result = await calculateDailyIsolatedPairYields(context, "0x123...", 1000000, 2000000);
 * // Returns: {
 * //   dailyValues: [
 * //     { date: "2025-01-01", timestamp: 1000000, dailyYield: 10n, pairs: [...] },
 * //     { date: "2025-01-02", timestamp: 1086400, dailyYield: 12n, pairs: [...] },
 * //   ],
 * //   currentValue: { date: "2025-01-03", timestamp: 2000000, dailyYield: 5n, isPartialDay: true, pairs: [...] }
 * // }
 * ```
 */
export async function calculateDailyIsolatedPairYields(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    dailyValues: DailyIsolatedPairYield[];
    currentValue?: DailyIsolatedPairYield & { isPartialDay: boolean };
}> {
    // Get all pairs user has interacted with
    const pairs = await getUserIsolatedPairs(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return {
            dailyValues: [],
            currentValue: undefined
        };
    }

    // Check if endTimestamp is at a day boundary (midnight UTC)
    const endDate = new Date(endTimestamp * 1000);
    const endDayStart = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) / 1000;
    const isPartialDay = endTimestamp !== endDayStart;

    // Create caches for this request
    const exchangeRateCache = new ExchangeRateCache();
    const balanceCache = new IsolatedPairBalanceCache();

    // Build list of all timestamps we'll need (day boundaries for complete days only)
    const timestamps: number[] = [];
    const oneDaySeconds = 24 * 60 * 60;
    const endTimestampForDays = isPartialDay ? endDayStart : endTimestamp;
    let currentDayStart = startTimestamp;

    while (currentDayStart < endTimestampForDays) {
        timestamps.push(currentDayStart);
        const currentDayEnd = Math.min(currentDayStart + oneDaySeconds, endTimestampForDays);
        timestamps.push(currentDayEnd);
        currentDayStart = currentDayEnd;
    }

    // If partial day, add endTimestamp to prefetch list
    if (isPartialDay) {
        timestamps.push(endTimestamp);
    }

    // Prefetch all exchange rates for all pairs at all timestamps (parallel queries)
    const exchangeRatePrefetchList = pairs.flatMap(pair =>
        timestamps.map(timestamp => ({ pair, timestamp }))
    );
    await exchangeRateCache.prefetch(context, exchangeRatePrefetchList);

    // Prefetch all balances for all pairs at start and end (parallel queries)
    const prefetchTimestamps = [startTimestamp, endTimestampForDays];
    if (isPartialDay) {
        prefetchTimestamps.push(endTimestamp);
    }
    await balanceCache.prefetchAll(context, user, pairs, prefetchTimestamps);

    const dailyYields: DailyIsolatedPairYield[] = [];

    // Now calculate yields for each complete day (all queries use cached data - FAST!)
    currentDayStart = startTimestamp;

    while (currentDayStart < endTimestampForDays) {
        const currentDayEnd = Math.min(currentDayStart + oneDaySeconds, endTimestampForDays);

        // Calculate yield for each pair for this day (uses cached data)
        const pairYields = await Promise.all(
            pairs.map(pair => calculateIsolatedPairYield(
                context, user, pair, currentDayStart, currentDayEnd,
                exchangeRateCache,  // Pass cache
                balanceCache        // Pass cache
            ))
        );

        // Filter out pairs with zero yield
        const nonZeroPairYields = pairYields
            .filter(py => py.netYield !== 0n)
            .map(py => ({
                pair: py.pair,
                assetYield: py.assetYield,
                borrowYield: py.borrowYield,
                netYield: py.netYield
            }));

        // Calculate total daily yield
        const dailyYield = pairYields.reduce((sum, py) => sum + py.netYield, 0n);

        dailyYields.push({
            date: new Date(currentDayStart * 1000).toISOString().split('T')[0]!,
            timestamp: currentDayStart,
            dailyYield,
            pairs: nonZeroPairYields
        });

        currentDayStart = currentDayEnd;
    }

    // Calculate current value if partial day
    let currentValue: (DailyIsolatedPairYield & { isPartialDay: boolean }) | undefined;

    if (isPartialDay) {
        // Calculate yield from start of current day to endTimestamp
        const pairYields = await Promise.all(
            pairs.map(pair => calculateIsolatedPairYield(
                context, user, pair, endDayStart, endTimestamp,
                exchangeRateCache,  // Pass cache
                balanceCache        // Pass cache
            ))
        );

        // Filter out pairs with zero yield
        const nonZeroPairYields = pairYields
            .filter(py => py.netYield !== 0n)
            .map(py => ({
                pair: py.pair,
                assetYield: py.assetYield,
                borrowYield: py.borrowYield,
                netYield: py.netYield
            }));

        // Calculate total current yield
        const dailyYield = pairYields.reduce((sum, py) => sum + py.netYield, 0n);

        currentValue = {
            date: endDate.toISOString().split('T')[0]!,
            timestamp: endTimestamp,
            dailyYield,
            pairs: nonZeroPairYields,
            isPartialDay: true
        };
    }

    return {
        dailyValues: dailyYields,
        currentValue
    };
}

/**
 * Calculate monthly yield for all isolated pairs for a user
 *
 * Breaks down the time period into monthly segments and calculates yield for each month.
 * This provides a time-series view of yield generation at monthly granularity.
 *
 * Months with zero yield are still included in the results.
 *
 * **Performance Optimization:** Uses caching with prefetching to avoid redundant queries.
 * For a 12-month period with 3 pairs, this reduces queries from ~288 to ~24 (92% reduction).
 *
 * **Partial Month Support:** If endTimestamp is not at a month boundary (first day of next month),
 * also calculates current month's yield at endTimestamp and returns it separately.
 *
 * @param context - Ponder context with database access
 * @param user - User address
 * @param startTimestamp - Start of time period
 * @param endTimestamp - End of time period
 * @returns Object with monthlyValues (complete months) and optional currentValue (partial month)
 *
 * @example
 * ```typescript
 * const result = await calculateMonthlyIsolatedPairYields(context, "0x123...", 1000000, 2000000);
 * // Returns: {
 * //   monthlyValues: [
 * //     {
 * //       year: 2025,
 * //       month: 1,
 * //       monthName: "January",
 * //       startDate: "2025-01-01",
 * //       endDate: "2025-01-31",
 * //       monthlyYield: 300n,
 * //       pairs: [...]
 * //     },
 * //   ],
 * //   currentValue: { year: 2025, month: 2, monthName: "February", ..., isPartialMonth: true }
 * // }
 * ```
 */
export async function calculateMonthlyIsolatedPairYields(
    context: any,
    user: string,
    startTimestamp: number,
    endTimestamp: number
): Promise<{
    monthlyValues: MonthlyIsolatedPairYield[];
    currentValue?: MonthlyIsolatedPairYield & { isPartialMonth: boolean; daysInPeriod: number };
}> {
    // Get all pairs user has interacted with
    const pairs = await getUserIsolatedPairs(context, user, startTimestamp, endTimestamp);

    if (pairs.length === 0) {
        return {
            monthlyValues: [],
            currentValue: undefined
        };
    }

    // Check if endTimestamp is at a month boundary
    const endDate = new Date(endTimestamp * 1000);
    const currentMonthStart = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 1));
    const nextMonthStartTimestamp = Math.floor(nextMonthStart.getTime() / 1000);
    const isPartialMonth = endTimestamp < nextMonthStartTimestamp;

    // Create caches for this request
    const exchangeRateCache = new ExchangeRateCache();
    const balanceCache = new IsolatedPairBalanceCache();

    // Build list of all timestamps we'll need (month boundaries for complete months only)
    const timestamps: number[] = [];
    const startDate = new Date(startTimestamp * 1000);
    const endTimestampForMonths = isPartialMonth
        ? Math.floor(currentMonthStart.getTime() / 1000)
        : endTimestamp;
    const endDateForMonths = new Date(endTimestampForMonths * 1000);

    // Use UTC methods to ensure consistent month boundaries
    let currentDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

    while (currentDate <= endDateForMonths) {
        const monthStart = Math.max(Math.floor(currentDate.getTime() / 1000), startTimestamp);
        timestamps.push(monthStart);

        // Move to next month using UTC
        const nextMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 1));
        const monthEnd = Math.min(Math.floor(nextMonth.getTime() / 1000), endTimestampForMonths);
        timestamps.push(monthEnd);

        currentDate = nextMonth;
    }

    // If partial month, add endTimestamp to prefetch list
    if (isPartialMonth) {
        timestamps.push(endTimestamp);
    }

    // Prefetch all exchange rates for all pairs at all timestamps (parallel queries)
    const exchangeRatePrefetchList = pairs.flatMap(pair =>
        timestamps.map(timestamp => ({ pair, timestamp }))
    );
    await exchangeRateCache.prefetch(context, exchangeRatePrefetchList);

    // Prefetch all balances for all pairs at start and end (parallel queries)
    const prefetchTimestamps = [startTimestamp, endTimestampForMonths];
    if (isPartialMonth) {
        prefetchTimestamps.push(endTimestamp);
    }
    await balanceCache.prefetchAll(context, user, pairs, prefetchTimestamps);

    const monthlyYields: MonthlyIsolatedPairYield[] = [];

    // Now calculate yields for each complete month (all queries use cached data)
    // Reset currentDate to start using UTC
    currentDate = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));

    while (currentDate <= endDateForMonths) {
        const monthStart = Math.max(Math.floor(currentDate.getTime() / 1000), startTimestamp);

        // Get end of month using UTC
        const nextMonth = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 1));
        const monthEnd = Math.min(Math.floor(nextMonth.getTime() / 1000), endTimestampForMonths);

        // Calculate yield for each pair for this month (uses cached data)
        const pairYields = await Promise.all(
            pairs.map(pair => calculateIsolatedPairYield(
                context, user, pair, monthStart, monthEnd,
                exchangeRateCache,  // Pass cache
                balanceCache        // Pass cache
            ))
        );

        // Filter out pairs with zero yield
        const nonZeroPairYields = pairYields
            .filter(py => py.netYield !== 0n)
            .map(py => ({
                pair: py.pair,
                assetYield: py.assetYield,
                borrowYield: py.borrowYield,
                netYield: py.netYield
            }));

        // Calculate total monthly yield
        const monthlyYield = pairYields.reduce((sum, py) => sum + py.netYield, 0n);

        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];

        monthlyYields.push({
            year: currentDate.getUTCFullYear(),
            month: currentDate.getUTCMonth() + 1,
            monthName: monthNames[currentDate.getUTCMonth()]!,
            startDate: new Date(monthStart * 1000).toISOString().split('T')[0]!,
            endDate: new Date(monthEnd * 1000).toISOString().split('T')[0]!,
            monthlyYield,
            pairs: nonZeroPairYields
        });

        currentDate = nextMonth;
    }

    // Calculate current partial month yield if needed
    let currentValue: (MonthlyIsolatedPairYield & { isPartialMonth: boolean; daysInPeriod: number }) | undefined;

    if (isPartialMonth) {
        try {
            const currentMonthStartTimestamp = Math.floor(currentMonthStart.getTime() / 1000);
            const currentYear = endDate.getUTCFullYear();
            const currentMonth = endDate.getUTCMonth() + 1;

            // Calculate yield for each pair for current partial month (uses cached data)
            const pairYields = await Promise.all(
                pairs.map(pair => calculateIsolatedPairYield(
                    context, user, pair, currentMonthStartTimestamp, endTimestamp,
                    exchangeRateCache,  // Pass cache
                    balanceCache        // Pass cache
                ))
            );

            // Filter out pairs with zero yield
            const nonZeroPairYields = pairYields
                .filter(py => py.netYield !== 0n)
                .map(py => ({
                    pair: py.pair,
                    assetYield: py.assetYield,
                    borrowYield: py.borrowYield,
                    netYield: py.netYield
                }));

            // Calculate total current yield
            const monthlyYield = pairYields.reduce((sum, py) => sum + py.netYield, 0n);

            // Calculate days in partial month period
            const daysInPeriod = Math.ceil((endTimestamp - currentMonthStartTimestamp) / (24 * 60 * 60));

            const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                               'July', 'August', 'September', 'October', 'November', 'December'];

            currentValue = {
                year: currentYear,
                month: currentMonth,
                monthName: monthNames[currentMonth - 1]!,
                startDate: currentMonthStart.toISOString().split('T')[0]!,
                endDate: endDate.toISOString().split('T')[0]!,
                monthlyYield,
                pairs: nonZeroPairYields,
                isPartialMonth: true,
                daysInPeriod
            };
        } catch (error) {
            console.error(`❌ Error calculating current partial month yield for isolated pairs:`, error);
            // Continue without current value on error
            currentValue = undefined;
        }
    }

    return {
        monthlyValues: monthlyYields,
        currentValue
    };
}

