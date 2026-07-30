const DEFAULT_SETTINGS = { environment: 'production', token: '' };
const API_BASE_URLS = {
  production: 'https://stock.vdata.top/api',
  development: 'http://localhost:3100/api',
};

const environment = document.querySelector('#environment');
const apiBaseUrl = document.querySelector('#apiBaseUrl');
const token = document.querySelector('#token');
const status = document.querySelector('#status');

chrome.storage.local.get(DEFAULT_SETTINGS).then((settings) => {
  environment.value = settings.environment;
  apiBaseUrl.textContent = API_BASE_URLS[settings.environment] || API_BASE_URLS.production;
  token.value = settings.token;
});

document.querySelector('#save').addEventListener('click', async () => {
  await chrome.storage.local.set({
    environment: environment.value,
    token: token.value.trim(),
  });
  status.textContent = '已保存';
  window.setTimeout(() => {
    status.textContent = '';
  }, 1800);
});
environment.addEventListener('change', () => {
  apiBaseUrl.textContent = API_BASE_URLS[environment.value] || API_BASE_URLS.production;
});
