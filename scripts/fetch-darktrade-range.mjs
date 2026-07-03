#!/usr/bin/env node
/**
 * 批量抓取指定日期范围内所有交易日的全市场明暗盘收盘快照
 * 用法: node scripts/fetch-darktrade-range.mjs [startDate] [endDate]
 * 示例: node scripts/fetch-darktrade-range.mjs 20260608 20260618
 */

const BASE_URL = 'http://localhost:3100';
const USERNAME = 'ljj';
const PASSWORD = 'asdfasdf';

// 生成日期范围内的所有交易日（跳过周六/周日）
function getTradingDays(start, end) {
  const days = [];
  const cur = new Date(`${start.slice(0,4)}-${start.slice(4,6)}-${start.slice(6,8)}T00:00:00+08:00`);
  const endD = new Date(`${end.slice(0,4)}-${end.slice(4,6)}-${end.slice(6,8)}T00:00:00+08:00`);
  while (cur <= endD) {
    const day = cur.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, '0');
      const d = String(cur.getDate()).padStart(2, '0');
      days.push(`${y}${m}${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`登录失败: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function fetchSnapshot(token, date) {
  const res = await fetch(`${BASE_URL}/api/darktrade/fetch-all-daily-snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return await res.json();
}

async function main() {
  const [,, startArg, endArg] = process.argv;
  const start = startArg ?? '20260608';
  const end = endArg ?? '20260618';

  const days = getTradingDays(start, end);
  console.log(`📅 将抓取以下 ${days.length} 个交易日: ${days.join(', ')}\n`);

  console.log('🔐 登录中...');
  const token = await login();
  console.log('✅ 登录成功\n');

  for (const date of days) {
    const label = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
    process.stdout.write(`⏳ [${label}] 抓取中（约5-10秒）...`);
    try {
      const result = await fetchSnapshot(token, date);
      console.log(` ✅ 索引=${result.total}, 写入=${result.written}`);
    } catch (e) {
      console.log(` ❌ ${e.message}`);
    }
  }

  console.log('\n🎉 批量抓取完成！');
}

main().catch((e) => {
  console.error('脚本运行失败:', e.message);
  process.exit(1);
});
