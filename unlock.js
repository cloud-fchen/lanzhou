import { decryptPayload } from './crypto-envelope.js';

const SESSION_KEY = 'private-trip-password-v1';
const GENERIC_ERROR = '密码不正确或数据已损坏';
const gate = document.querySelector('#auth-gate');
const tripApp = document.querySelector('#trip-app');
const form = document.querySelector('#unlock-form');
const passwordInput = document.querySelector('#trip-password');
const togglePassword = document.querySelector('#toggle-password');
const submitButton = form.querySelector('[type="submit"]');
const status = document.querySelector('#unlock-status');
const lockButton = document.querySelector('#lock-trip');
let appStarted = false;

const envelopeRequest = fetch('trip-data.enc.json', { cache: 'no-store' }).then((response) => {
  if (!response.ok) throw new Error(`Encrypted data request failed: ${response.status}`);
  return response.json();
});

function setBusy(busy) {
  form.setAttribute('aria-busy', String(busy));
  passwordInput.disabled = busy;
  submitButton.disabled = busy;
  togglePassword.disabled = busy;
  submitButton.innerHTML = busy ? '正在解锁…' : '解锁行程 <span aria-hidden="true">→</span>';
}

function setStatus(message, type = '') {
  status.textContent = message;
  status.dataset.state = type;
}

function readSessionPassword() {
  try {
    return sessionStorage.getItem(SESSION_KEY) || '';
  } catch {
    return '';
  }
}

function saveSessionPassword(password) {
  try {
    sessionStorage.setItem(SESSION_KEY, password);
  } catch {
    // The site still works when session storage is unavailable.
  }
}

function clearSessionPassword() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

function startApp(data) {
  if (appStarted) return Promise.resolve();
  window.TRIP_DATA = data;
  tripApp.hidden = false;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'app.js';
    script.onload = () => {
      appStarted = true;
      gate.hidden = true;
      document.body.dataset.auth = 'unlocked';
      resolve();
    };
    script.onerror = () => {
      tripApp.hidden = true;
      delete window.TRIP_DATA;
      script.remove();
      const error = new Error('Application script failed to load');
      error.name = 'AppResourceError';
      reject(error);
    };
    document.body.append(script);
  });
}

async function unlock(password, { automatic = false } = {}) {
  if (!globalThis.crypto?.subtle) {
    setStatus('当前浏览器不支持安全解锁，请使用最新版浏览器。', 'error');
    return;
  }

  setBusy(true);
  setStatus('正在验证旅程密码…', 'loading');
  try {
    const envelope = await envelopeRequest;
    const data = await decryptPayload(envelope, password);
    await startApp(data);
    saveSessionPassword(password);
    setStatus('');
  } catch (error) {
    if (automatic) clearSessionPassword();
    const resourceFailure = error?.name === 'AppResourceError';
    setStatus(resourceFailure ? '页面资源加载失败，请检查网络后重试。' : GENERIC_ERROR, 'error');
    if (!resourceFailure) passwordInput.value = '';
    passwordInput.focus();
  } finally {
    setBusy(false);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  unlock(passwordInput.value);
});

togglePassword.addEventListener('click', () => {
  const revealing = passwordInput.type === 'password';
  passwordInput.type = revealing ? 'text' : 'password';
  togglePassword.textContent = revealing ? '隐藏' : '显示';
  togglePassword.setAttribute('aria-label', revealing ? '隐藏密码' : '显示密码');
  togglePassword.setAttribute('aria-pressed', String(revealing));
  passwordInput.focus();
});

lockButton.addEventListener('click', () => {
  clearSessionPassword();
  window.location.reload();
});

const sessionPassword = readSessionPassword();
if (sessionPassword) {
  passwordInput.value = sessionPassword;
  unlock(sessionPassword, { automatic: true });
} else {
  passwordInput.focus();
}
