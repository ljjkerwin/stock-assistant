export const CAPITAL_SUMMARY_SUFFIXES = [
  '',
  ' ～',
  ' ～～',
  '[吧唧R][吧唧R]',
  '[吃瓜R]',
  '[黄金薯R][黄金薯R]',
  '[暗中观察R]',
] as const;

export function getRandomCapitalSummarySuffix(): string {
  return CAPITAL_SUMMARY_SUFFIXES[Math.floor(Math.random() * CAPITAL_SUMMARY_SUFFIXES.length)];
}
