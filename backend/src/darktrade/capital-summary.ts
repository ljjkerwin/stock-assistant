interface CapitalSummaryData {
  name: string;
  displayName?: string;
  darkCapital: number | null;
  lightCapital: number | null;
}

function formatCapital(value: number | null) {
  if (value == null) return '--';
  const divisor = Math.abs(value) >= 10_000_000 ? 100_000_000 : 10_000;
  const suffix = divisor === 100_000_000 ? 'y' : 'w';
  const digits = suffix === 'y' ? 2 : 0;
  const formatted = Number((value / divisor).toFixed(digits));
  return `${value > 0 ? '+' : ''}${formatted}${suffix}`;
}

export function formatCapitalSummary(data: CapitalSummaryData) {
  return `${data.displayName ?? data.name}，暗${formatCapital(data.darkCapital)}，明${formatCapital(data.lightCapital)}`;
}

export function formatCapitalSummaries(results: CapitalSummaryData[], summarySuffix = '') {
  return `${results.map(formatCapitalSummary).join('；')}${summarySuffix}`;
}
