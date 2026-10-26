// Percentiles and the median of the bench harness.

/** The nearest-rank `q` quantile (0 < q <= 1) of values sorted ascending. */
export function percentile(sorted: ArrayLike<number>, q: number): number {
    if (0 === sorted.length) {
        return Number.NaN;
    }
    const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
    return sorted[rank - 1] as number;
}

/**
 * The median. For an even count it is the mean of the two middle values: the gate's verdict is on this median, and
 * the harness defines it so.
 */
export function median(values: readonly number[]): number {
    if (0 === values.length) {
        return Number.NaN;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return 1 === sorted.length % 2
        ? (sorted[mid] as number)
        : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}
