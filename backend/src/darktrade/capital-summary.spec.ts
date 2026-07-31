import { formatCapitalSummaries, formatCapitalSummary } from './capital-summary';

describe('capital summary', () => {
  const result = {
    name: '中金科技',
    displayName: '中jkj',
    darkCapital: -6_150_000,
    lightCapital: 3_900_000,
  };

  it('formats the canonical single-item template', () => {
    expect(formatCapitalSummary(result)).toBe('中jkj，暗-615w，明+390w');
  });

  it('joins LLM results and appends the suffix', () => {
    expect(formatCapitalSummaries([result, result], ' ～')).toBe(
      '中jkj，暗-615w，明+390w；中jkj，暗-615w，明+390w ～',
    );
  });
});
