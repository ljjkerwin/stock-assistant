#!/usr/bin/env node
// 手动触发暗盘资金索引刷新
// 用法: node scripts/refresh-darktrade-index.mjs [YYYYMMDD]
// 不传日期则默认今日

const date = process.argv[2] ?? undefined;
const body = date ? { date } : {};

console.log(`刷新暗盘索引${date ? `（${date}）` : '（今日）'}...`);

const res = await fetch('http://localhost:3000/api/darktrade/refresh-index', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`请求失败 ${res.status}:`, text);
  process.exit(1);
}

const data = await res.json();
console.log(`完成：${data.indexed} 只股票，共 ${data.pages} 页，日期 ${data.date}`);
