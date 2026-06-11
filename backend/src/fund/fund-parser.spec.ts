import { detectRatioIdx, parseHoldingPeriods } from './fund-parser';

describe('fund-parser.ts', () => {
  describe('detectRatioIdx', () => {
    it('returns the correct index of column containing 净值', () => {
      const block = `
        <table>
          <thead>
            <tr>
              <th>序号</th>
              <th>股票代码</th>
              <th>股票名称</th>
              <th>最新价</th>
              <th>占净值比例</th>
              <th>持股数</th>
            </tr>
          </thead>
        </table>
      `;
      expect(detectRatioIdx(block)).toBe(4);
    });

    it('returns -1 if no column header contains 净值', () => {
      const block = `
        <table>
          <thead>
            <tr>
              <th>序号</th>
              <th>股票代码</th>
              <th>股票名称</th>
              <th>最新价</th>
              <th>持股数</th>
            </tr>
          </thead>
        </table>
      `;
      expect(detectRatioIdx(block)).toBe(-1);
    });
  });

  describe('parseHoldingPeriods', () => {
    it('returns empty array when content format does not match', () => {
      const jsText = 'var someOtherJs = {};';
      expect(parseHoldingPeriods(jsText)).toEqual([]);
    });

    it('correctly parses periods and holdings from matching content', () => {
      const mockJs = `
        content:"<div class='boxitem w790'>
          <h3>2024年2季度</h3>
          <span>截止至：<font>2024-06-30</font></span>
          <table>
            <thead>
              <tr>
                <td>序号</td>
                <td>股票代码</td>
                <td>股票名称</td>
                <td>最新价</td>
                <td>占净值比例</td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td><td><a href='/stock/600519.html'>600519</a></td></td>
                <td><td><a href='/stock/600519.html'>贵州茅台</a></td></td>
                <td>1,500.50</td>
                <td>8.5%</td>
              </tr>
              <tr>
                <td>2</td>
                <td><td><a href='/stock/00700.html'>00700</a></td></td>
                <td><td><a href='/stock/00700.html'>腾讯控股</a></td></td>
                <td>380.00</td>
                <td>7.2%</td>
              </tr>
              <!-- Summary or invalid row -->
              <tr>
                <td>合计</td>
                <td>-</td>
                <td>-</td>
                <td>-</td>
                <td>15.7%</td>
              </tr>
            </tbody>
          </table>
        </div>", arryear:[2024]
      `;

      const result = parseHoldingPeriods(mockJs);
      expect(result).toHaveLength(1);
      expect(result[0].period).toBe('2024年2季度');
      expect(result[0].endDate).toBe('2024-06-30');
      expect(result[0].holdings).toHaveLength(2);

      // Check holding 1
      expect(result[0].holdings[0]).toEqual({
        rank: 1,
        code: '600519',
        name: '贵州茅台',
        latestPrice: 1500.5,
        marketValue: 8.5,
      });

      // Check holding 2
      expect(result[0].holdings[1]).toEqual({
        rank: 2,
        code: '00700',
        name: '腾讯控股',
        latestPrice: 380,
        marketValue: 7.2,
      });
    });

    it('supports dynamic index matching for 占净值比例', () => {
      const mockJs = `
        content:"<div class='boxitem w790'>
          <h3>2024年1季度</h3>
          <span>截止至：<font>2024-03-31</font></span>
          <table>
            <thead>
              <tr>
                <td>序号</td>
                <td>股票代码</td>
                <td>股票名称</td>
                <td>最新价</td>
                <td>持股数(万股)</td>
                <td>持股市值(万元)</td>
                <td>占净值比例</td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td><td><a href='/stock/600519.html'>600519</a></td></td>
                <td><td><a href='/stock/600519.html'>贵州茅台</a></td></td>
                <td>1,600.00</td>
                <td>100</td>
                <td>160,000</td>
                <td>9.10%</td>
              </tr>
            </tbody>
          </table>
        </div>", arryear:[2024]
      `;

      const result = parseHoldingPeriods(mockJs);
      expect(result).toHaveLength(1);
      expect(result[0].holdings).toHaveLength(1);
      expect(result[0].holdings[0]).toEqual({
        rank: 1,
        code: '600519',
        name: '贵州茅台',
        latestPrice: 1600,
        marketValue: 9.1,
      });
    });
  });
});
