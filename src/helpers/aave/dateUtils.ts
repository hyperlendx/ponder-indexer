/**
 * Get the start and end timestamps for a given month in UTC
 */
export function getMonthTimestamps(year: number, month: number): {
    startTimestamp: number;
    endTimestamp: number;
} {
    // Use Date.UTC to ensure consistent month boundaries in UTC timezone
    const startDate = Date.UTC(year, month - 1, 1, 0, 0, 0, 0); // First day of month at 00:00:00 UTC

    // Get last day of month by going to first day of next month and subtracting 1 second
    const endDate = Date.UTC(year, month, 1, 0, 0, 0, 0) - 1000; // Last millisecond of month

    return {
        startTimestamp: Math.floor(startDate / 1000),
        endTimestamp: Math.floor(endDate / 1000)
    };
}

/**
 * Get year and month from a timestamp
 */
export function getYearMonthFromTimestamp(timestamp: number): { year: number; month: number } {
    const date = new Date(timestamp * 1000);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1 // JavaScript months are 0-indexed
    };
}

