// 触发更接近真实用户的鼠标点击事件链
function dispatchRealLikeClick(el) {
  if (!(el instanceof Element)) {
    throw new Error('Invalid click target');
  }

  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];

  for (const type of eventTypes) {
    const EventCtor = type.startsWith('pointer') && typeof PointerEvent === 'function'
      ? PointerEvent
      : MouseEvent;

    const eventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === 'pointerup' || type === 'mouseup' || type === 'click' ? 0 : 1,
      view: window
    };

    if (EventCtor === PointerEvent) {
      Object.assign(eventInit, {
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true
      });
    }

    el.dispatchEvent(new EventCtor(type, eventInit));
  }

  return el;
}

// 等待元素出现
async function waitForElement(selector, timeout = 30000, root = document) {
  return new Promise((resolve, reject) => {
    const el = root.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(root, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout: ${selector}`));
    }, timeout);
  });
}

// 安全点击
async function safeClick(target, timeout = 10000) {
  const el = typeof target === 'string'
    ? await waitForElement(target, timeout)
    : target;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  await waitFor(() => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           el.offsetParent !== null &&
           !el.hasAttribute('disabled');
  }, 3000);

  dispatchRealLikeClick(el);
  return el;
}

// 安全点击（带重试）
async function safeClickRetry(target, options = {}) {
  const { timeout = 10000, maxRetries = 2, baseDelay = 500 } = options;
  return retryWithBackoff(
    () => safeClick(target, timeout),
    {
      maxRetries,
      baseDelay,
      retryableErrors: ['Timeout', 'Wait timeout', 'ElementNotFound', 'NotFound']
    }
  );
}

async function waitForInteractable(selector, timeout = 15000, root = document) {
  const el = typeof selector === 'string'
    ? await waitForElement(selector, timeout, root)
    : selector;

  await waitFor(() => {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' &&
      el.offsetParent !== null &&
      !el.hasAttribute('disabled') &&
      !el.disabled &&
      rect.width > 0 &&
      rect.height > 0;
  }, timeout);

  return el;
}

async function waitForNonEmptyText(selector, timeout = 15000, root = document) {
  const el = await waitForElement(selector, timeout, root);
  await waitFor(() => !!el.textContent?.trim(), timeout);
  return el.textContent.trim();
}

async function clickAndWaitForResult(selector, resultFn, options = {}) {
  const { timeout = 15000, afterClickDelay = 300 } = options;
  const el = await waitForInteractable(selector, timeout);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  dispatchRealLikeClick(el);

  if (afterClickDelay > 0) {
    await sleep(afterClickDelay);
  }

  await waitFor(resultFn, timeout);
  return el;
}

// 等待条件
async function waitFor(conditionFn, timeout = 5000, interval = 100) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      if (conditionFn()) return resolve();
      if (Date.now() - start > timeout) {
        return reject(new Error('Wait timeout'));
      }
      setTimeout(check, interval);
    }
    check();
  });
}

// 睡眠
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// 随机字符串
function randomString(length, options = {}) {
  const { uppercaseFirst = false, charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' } = options;
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  if (uppercaseFirst && result) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }
  return result;
}

// 生成生日
function generateValidBirthday() {
  const maxDate = new Date('2008-03-01');
  const minDate = new Date('1970-01-01');
  const randomTime = minDate.getTime() + Math.random() * (maxDate.getTime() - minDate.getTime());
  return new Date(randomTime).toISOString().split('T')[0];
}

// 提取验证码
function extractVerificationCode(text) {
  const match = text.match(/(\d{6})(?!\d)/);
  return match ? match[1] : null;
}

// 解析 URL 参数
function parseCallbackUrl(url) {
  try {
    const urlObj = new URL(url);
    const params = {};
    for (const [k, v] of urlObj.searchParams) {
      params[k] = v;
    }
    return params;
  } catch {
    return null;
  }
}

// JWT 解析
function parseJwtClaims(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(payload).split('').map(c => 
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// 带重试的执行
async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    retryableErrors = ['NetworkError', 'TimeoutError', 'ElementNotFound'],
    onRetry = null
  } = options;
  
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const errorName = error.name || error.constructor.name || String(error);
      const isRetryable = retryableErrors.some(re => 
        errorName.includes(re) || error.message?.includes(re)
      );
      
      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }
      
      const exponentialDelay = baseDelay * Math.pow(backoffFactor, attempt);
      const jitter = Math.random() * 0.3 * exponentialDelay;
      const delay = Math.min(exponentialDelay + jitter, maxDelay);
      
      console.warn(`⚠️ 重试 ${attempt + 1}/${maxRetries} | 延迟 ${Math.round(delay)}ms`);
      
      if (onRetry) {
        await onRetry(attempt + 1, error, delay);
      }
      
      await sleep(delay);
    }
  }
  
  throw lastError;
}

// 导出
window.AutoRegUtils = {
  waitForElement, safeClick, safeClickRetry, waitForInteractable, waitForNonEmptyText, clickAndWaitForResult, waitFor, sleep,
  randomString, generateValidBirthday, extractVerificationCode,
  parseCallbackUrl, parseJwtClaims, retryWithBackoff
};
