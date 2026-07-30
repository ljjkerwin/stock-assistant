const TOOLBAR_ATTRIBUTE = 'data-darktrade-reply-toolbar';
const REPLY_INPUT_SELECTOR = '[contenteditable="true"], textarea';

function isNotificationPage() {
  return location.pathname === '/notification' || location.pathname === '/notification/';
}

function getDateValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCapital(value) {
  if (value == null) return '--';
  const divisor = Math.abs(value) >= 10000000 ? 100000000 : 10000;
  const suffix = divisor === 100000000 ? 'y' : 'w';
  const digits = suffix === 'y' ? 2 : 0;
  const formatted = Number((value / divisor).toFixed(digits));
  return `${value > 0 ? '+' : ''}${formatted}${suffix}`;
}

function formatReply(results) {
  return results
    .map(
      (result) =>
        `${result.displayName || result.name}，暗${formatCapital(result.darkCapital)}，明${formatCapital(result.lightCapital)}`,
    )
    .join('；');
}

function normalizeText(node) {
  return (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function getCommentText(input) {
  const boundary =
    // 小红书通知项当前以 .container 作为整条消息的根节点；回复框在其中的 .actions 内。
    input.closest('.container') ||
    input.closest('article, li, [role="listitem"]') ||
    input.parentElement?.parentElement ||
    input.parentElement;
  if (!boundary) return '';

  // 小红书将用户留言正文放在 .interaction-content。优先使用它，避免把昵称、按钮或其他通知文本交给 LLM。
  const interactionContent = boundary.querySelector('.interaction-content');
  const interactionText = normalizeText(interactionContent);
  if (interactionText) return interactionText;

  const copy = boundary.cloneNode(true);
  copy
    .querySelectorAll(`${REPLY_INPUT_SELECTOR}, [${TOOLBAR_ATTRIBUTE}]`)
    .forEach((node) => node.remove());
  return normalizeText(copy);
}

function replaceInputText(input, text) {
  input.focus();
  if (input instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, text);
  } else {
    input.textContent = text;
  }
  input.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
  );
}

function createToolbar(input) {
  const host = document.createElement('div');
  host.setAttribute(TOOLBAR_ATTRIBUTE, '');
  host.darkTradeReplyInput = input;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { display: block; position: fixed; z-index: 1; }
      .bar { display: flex; align-items: center; gap: 8px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
      button { border: 0; border-radius: 16px; background: #ff2442; color: #fff; cursor: pointer; font: inherit; font-weight: 600; padding: 7px 12px; }
      button:hover { background: #e51f3b; }
      button:disabled { cursor: wait; opacity: .65; }
      input { box-sizing: border-box; border: 1px solid #e5e5e5; border-radius: 8px; color: #555; font: inherit; padding: 6px 8px; width: 120px; }
      .status { color: #999; min-height: 18px; }
      .error { color: #d93025; }
    </style>
    <div class="bar">
      <button type="button">✨ 查找明暗盘数据</button>
      <input aria-label="收盘日期" type="date" value="${getDateValue()}">
      <span class="status"></span>
    </div>
  `;

  const button = shadow.querySelector('button');
  const dateInput = shadow.querySelector('input');
  const status = shadow.querySelector('.status');
  button.addEventListener('click', () => {
    const text = getCommentText(input);
    if (!text) {
      status.textContent = '未读取到该条评论';
      status.className = 'status error';
      return;
    }
    button.disabled = true;
    status.textContent = '正在识别并查询…';
    status.className = 'status';
    chrome.runtime.sendMessage(
      { type: 'query-darktrade', payload: { text, date: dateInput.value.replaceAll('-', '') } },
      (response) => {
        button.disabled = false;
        if (chrome.runtime.lastError) {
          status.textContent = '插件通信失败，请刷新页面重试';
          status.className = 'status error';
          return;
        }
        if (!response?.ok) {
          status.textContent = response?.error || '查询失败';
          status.className = 'status error';
          return;
        }
        const reply = formatReply(response.data.results || []);
        if (!reply) {
          const missing = response.data.notFoundNames?.length
            ? `未找到：${response.data.notFoundNames.join('、')}`
            : '未识别到可查询的股票或 ETF';
          status.textContent = missing;
          status.className = 'status error';
          return;
        }
        replaceInputText(input, reply);
        status.textContent = '已填入草稿，请确认后手动发送';
        status.className = 'status';
      },
    );
  });
  return host;
}

function positionToolbar(host, input) {
  const rect = input.getBoundingClientRect();
  host.style.left = `${Math.max(8, rect.left)}px`;
  host.style.top = `${rect.bottom + 6}px`;
}

function injectToolbar(input) {
  if (!(input instanceof HTMLElement) || !input.matches(REPLY_INPUT_SELECTOR)) return;
  const existingToolbar = input.darkTradeReplyToolbar;
  if (existingToolbar?.isConnected) {
    positionToolbar(existingToolbar, input);
    return;
  }
  const toolbar = createToolbar(input);
  input.darkTradeReplyToolbar = toolbar;
  document.body.append(toolbar);
  positionToolbar(toolbar, input);
}

function scanForReplyInputs(root = document) {
  root.querySelectorAll?.(REPLY_INPUT_SELECTOR).forEach(injectToolbar);
}

function repositionToolbars() {
  document.querySelectorAll(`[${TOOLBAR_ATTRIBUTE}]`).forEach((toolbar) => {
    const input = toolbar.darkTradeReplyInput;
    if (!input?.isConnected) {
      toolbar.remove();
      return;
    }
    positionToolbar(toolbar, input);
  });
}

if (isNotificationPage()) {
  document.addEventListener('focusin', (event) => injectToolbar(event.target), true);
  window.addEventListener('scroll', repositionToolbars, true);
  window.addEventListener('resize', repositionToolbars);
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) {
          injectToolbar(node);
          scanForReplyInputs(node);
        }
      });
    }
    repositionToolbars();
  }).observe(document.documentElement, { childList: true, subtree: true });
  scanForReplyInputs();
}
