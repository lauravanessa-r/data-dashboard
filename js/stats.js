/**
 * stats.js
 * Small statistics helpers used by the dashboard.
 * All functions receive an array of numbers (missing values already removed).
 */

const Stats = {
  sum(values) {
    return values.reduce((total, v) => total + v, 0);
  },

  mean(values) {
    return values.length ? Stats.sum(values) / values.length : NaN;
  },

  /**
   * Quantile with linear interpolation (same method as Excel's PERCENTILE.INC
   * and R's default type 7). p goes from 0 to 1, e.g. 0.25 for Q1.
   */
  quantile(values, p) {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
  },

  median(values) {
    return Stats.quantile(values, 0.5);
  },

  /** Sample standard deviation (divides by n - 1). */
  std(values) {
    if (values.length < 2) return NaN;
    const avg = Stats.mean(values);
    const squaredDiffs = values.map((v) => (v - avg) ** 2);
    return Math.sqrt(Stats.sum(squaredDiffs) / (values.length - 1));
  },

  min(values) {
    return values.length ? Math.min(...values) : NaN;
  },

  max(values) {
    return values.length ? Math.max(...values) : NaN;
  },

  /**
   * Builds histogram bins using Sturges' rule: k = ceil(log2(n) + 1).
   * Returns labels like "10.0 – 20.0" and the count in each bin.
   */
  histogram(values) {
    if (!values.length) return { labels: [], counts: [] };
    const min = Stats.min(values);
    const max = Stats.max(values);
    const binCount = Math.max(1, Math.ceil(Math.log2(values.length) + 1));
    const width = (max - min) / binCount || 1;
    const counts = new Array(binCount).fill(0);

    values.forEach((v) => {
      // The maximum value goes into the last bin instead of overflowing.
      const index = Math.min(Math.floor((v - min) / width), binCount - 1);
      counts[index] += 1;
    });

    const labels = counts.map((_, i) => {
      const start = min + i * width;
      return `${formatNumber(start)} – ${formatNumber(start + width)}`;
    });

    return { labels, counts };
  },
};

/** Formats numbers for display: thousands separators and up to 2 decimals. */
function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
