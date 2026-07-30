const TOOLBAR_ATTRIBUTE = 'data-darktrade-reply-toolbar';
const REPLY_INPUT_CONFIGS = [
  { selector: 'textarea.comment-input', toolbarZIndex: 1, toolbarPosition: 'below' },
  {
    selector: '#content-textarea.content-input[contenteditable="true"]',
    toolbarZIndex: 21,
    toolbarPosition: 'left',
    commentTextSelector: '.engage-bar .reply-content .content',
    toolbarContainerSelector: '.engage-bar.active',
  },
];
const REPLY_INPUT_SELECTOR = REPLY_INPUT_CONFIGS.map(({ selector }) => selector).join(', ');

function isSupportedPage() {
  return (
    location.pathname === '/notification' ||
    location.pathname === '/notification/' ||
    location.pathname === '/explore' ||
    location.pathname.startsWith('/explore/')
  );
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

function formatReply(results, summarySuffix = '') {
  return (
    results
    .map(
      (result) =>
        `${result.displayName || result.name}，暗${formatCapital(result.darkCapital)}，明${formatCapital(result.lightCapital)}`,
    )
    .join('；') + summarySuffix
  );
}

function normalizeText(node) {
  return (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function getCommentText(input) {
  const config = REPLY_INPUT_CONFIGS.find(({ selector }) => input.matches(selector));
  if (config?.commentTextSelector) {
    return normalizeText(document.querySelector(config.commentTextSelector));
  }

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

function createToolbar(input, config) {
  const host = document.createElement('div');
  host.setAttribute(TOOLBAR_ATTRIBUTE, '');
  host.darkTradeReplyInput = input;
  host.darkTradeReplyToolbarPosition = config.toolbarPosition;
  host.style.zIndex = String(config.toolbarZIndex);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { display: block; position: fixed; z-index: 1; }
      .bar { display: flex; align-items: flex-start; gap: 8px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
      .query-control { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; }
      button { border: 0; border-radius: 16px; background: #ff2442; color: #fff; cursor: pointer; font: inherit; font-weight: 600; padding: 7px 12px; white-space: nowrap; }
      button:hover { background: #e51f3b; }
      button:disabled { cursor: wait; opacity: .65; }
      input { box-sizing: border-box; border: 1px solid #e5e5e5; border-radius: 7px; color: #555; font-size: 12px; padding: 4px 6px; width: 106px; }
    </style>
    <div class="bar">
      <div class="query-control">
        <button type="button">查询明暗盘数据</button>
        <input aria-label="收盘日期" type="date" value="${getDateValue()}">
      </div>
    </div>
  `;

  const button = shadow.querySelector('button');
  const dateInput = shadow.querySelector('input');
  const stopToolbarEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  button.addEventListener('pointerdown', stopToolbarEvent);
  button.addEventListener('mousedown', stopToolbarEvent);
  button.addEventListener('click', (event) => {
    stopToolbarEvent(event);
    const text = getCommentText(input);
    if (!text) {
      return;
    }
    button.disabled = true;
    chrome.runtime.sendMessage(
      { type: 'query-darktrade', payload: { text, date: dateInput.value.replaceAll('-', '') } },
      (response) => {
        button.disabled = false;
        if (chrome.runtime.lastError) {
          return;
        }
        if (!response?.ok) {
          return;
        }
        const results = response.data.results || [];
        if (results.length === 0) {
          return;
        }
        const reply = formatReply(results, response.data.summarySuffix || '');
        replaceInputText(input, reply);
      },
    );
  });
  return host;
}

function positionToolbar(host, input) {
  const rect = input.getBoundingClientRect();
  if (host.darkTradeReplyToolbarPosition === 'left') {
    // 帖子弹窗工具栏挂在 .engage-bar.active 内，使用其包含块向左展开，
    // 避免用 left 计算后与回复输入框重叠。
    host.style.position = 'absolute';
    host.style.right = '100%';
    host.style.left = '';
    host.style.top = '0';
    return;
  }
  host.style.position = 'fixed';
  host.style.right = '';
  host.style.left = `${Math.max(8, rect.left)}px`;
  host.style.top = `${rect.bottom + 6}px`;
}

function injectToolbar(input) {
  if (!(input instanceof HTMLElement)) return;
  const config = REPLY_INPUT_CONFIGS.find(({ selector }) => input.matches(selector));
  if (!config) return;
  const existingToolbar = input.darkTradeReplyToolbar;
  if (existingToolbar?.isConnected) {
    positionToolbar(existingToolbar, input);
    return;
  }
  const toolbarContainer = config.toolbarContainerSelector
    ? input.closest(config.toolbarContainerSelector)
    : document.body;
  if (!toolbarContainer) return;
  const toolbar = createToolbar(input, config);
  input.darkTradeReplyToolbar = toolbar;
  toolbarContainer.append(toolbar);
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

if (isSupportedPage()) {
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
