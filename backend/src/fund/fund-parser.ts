import { FundHolding, FundHoldingPeriod } from './fund.service';

export function detectRatioIdx(block: string): number {
  // 从表头行（含"净值"文本的 <tr>）里找出占净值比例所在的列索引
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(block)) !== null) {
    if (!rowMatch[1].includes('净值')) continue;
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
    let cellMatch: RegExpExecArray | null;
    let idx = 0;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      if (cellMatch[1].replace(/<[^>]+>/g, '').includes('净值')) return idx;
      idx++;
    }
  }
  return -1;
}

export function parseHoldingPeriods(jsText: string): FundHoldingPeriod[] {
  const contentMatch = /content:"([\s\S]*?)",\s*arryear:/.exec(jsText);
  if (!contentMatch) return [];
  const html = contentMatch[1];

  const blocks = html.split("<div class='boxitem w790'>").slice(1);
  const periods: FundHoldingPeriod[] = [];

  for (const block of blocks) {
    const periodMatch = /(\d{4}年\d+季度)/.exec(block);
    const period = periodMatch?.[1] ?? '';

    const dateMatch = /截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/.exec(block);
    const endDate = dateMatch?.[1] ?? '';

    // 从表头检测占净值比例所在列，不同季报格式各异
    const ratioIdx = detectRatioIdx(block);
    if (ratioIdx < 0) continue;

    const holdings: FundHolding[] = [];
    const rowRegex = /<tr>([\s\S]*?)<\/tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(block)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(cellMatch[1]);
      }
      if (cells.length <= ratioIdx) continue;

      const rank = parseInt(cells[0].replace(/<[^>]+>/g, '').trim(), 10);
      if (isNaN(rank) || rank < 1) continue;

      const codeMatch = /<a[^>]*>([^<]+)<\/a>/.exec(cells[1]);
      const stockCode = codeMatch?.[1]?.trim() ?? '';

      const nameMatch = /<a[^>]*>([^<]+)<\/a>/.exec(cells[2]);
      const name = nameMatch?.[1]?.trim() ?? '';

      const latestPriceStr = cells[3]?.replace(/<[^>]+>/g, '').trim() ?? '';
      const latestPrice = latestPriceStr
        ? parseFloat(latestPriceStr.replace(/,/g, '')) || null
        : null;

      const marketValueStr = cells[ratioIdx]
        .replace(/<[^>]+>/g, '')
        .trim()
        .replace('%', '')
        .replace(/,/g, '');
      const marketValue = marketValueStr ? parseFloat(marketValueStr) || null : null;

      if (stockCode && name) {
        holdings.push({ rank, code: stockCode, name, latestPrice, marketValue });
      }
    }

    if (period && holdings.length > 0) {
      periods.push({ period, endDate, holdings });
    }
  }

  return periods;
}
