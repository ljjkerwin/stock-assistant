const DEFAULT_SETTINGS = {
  environment: 'production',
  token: '',
};

function normalizeApiBaseUrl(value) {
  return value.trim().replace(/\/+$/, '');
}

async function getSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    apiBaseUrl: normalizeApiBaseUrl(
      stored.environment === 'development'
        ? 'http://localhost:3100/api'
        : 'https://stock.vdata.top/api',
    ),
    token: stored.token?.trim() || '',
  };
}

function getErrorMessage(payload, fallback) {
  if (typeof payload?.message === 'string') return payload.message;
  if (Array.isArray(payload?.message)) return payload.message.join('；');
  return fallback;
}

async function queryDarkTrade({ text, date }) {
  const settings = await getSettings();
  if (!settings.token) {
    throw new Error('请先在股票助手管理中心创建并填写插件访问令牌');
  }

  let response;
  try {
    response = await fetch(`${settings.apiBaseUrl}/darktrade/daily-result-from-text`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, date }),
    });
  } catch {
    throw new Error('无法连接股票助手后端，请确认服务已启动且地址正确');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `查询失败（HTTP ${response.status}）`));
  }
  return payload;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'query-darktrade') return undefined;

  queryDarkTrade(message.payload)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || '查询失败' }));
  return true;
});
