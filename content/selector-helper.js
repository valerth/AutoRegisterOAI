let captureMode = { active: false, targetId: null, host: null, ignoreElement: null, onResult: null };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startCapture') {
    startCaptureMode({
      targetId: msg.targetId,
      host: msg.host,
      onResult: (selector) => {
        chrome.runtime.sendMessage({
          action: 'captureResult',
          targetId: msg.targetId,
          selector
        });
      }
    });
    sendResponse({ status: 'started' });
    return false;
  }

  if (msg.action === 'testSelector') {
    (async () => {
      try {
        const { selector, timeout = 5000 } = msg;
        const cleanSelector = selector.replace(/:contains\([^)]+\)/g, '');
        const element = await waitForElement(cleanSelector, timeout).catch(() => null);

        if (element) {
          highlightElement(element);
          sendResponse({
            found: true,
            tagName: element.tagName.toLowerCase(),
            id: element.id || null,
            className: element.className || null
          });
        } else {
          sendResponse({ found: false, error: 'Element not found' });
        }
      } catch (error) {
        sendResponse({ found: false, error: error.message });
      }
    })();
    return true;
  }
});

function startCaptureMode({ targetId = null, host = null, ignoreElement = null, onResult = null } = {}) {
  if (captureMode.active) {
    stopCaptureMode();
  }

  captureMode = { active: true, targetId, host, ignoreElement, onResult };
  document.addEventListener('click', handleCaptureClick, { capture: true, once: true });
  document.body.style.cursor = 'crosshair';
}

function stopCaptureMode() {
  document.body.style.cursor = '';
  captureMode = { active: false, targetId: null, host: null, ignoreElement: null, onResult: null };
}

function shouldIgnoreCaptureTarget(target) {
  if (!captureMode.ignoreElement || !(captureMode.ignoreElement instanceof Element)) {
    return false;
  }

  return captureMode.ignoreElement === target || captureMode.ignoreElement.contains(target);
}

function handleCaptureClick(e) {
  if (!captureMode.active) return;

  if (shouldIgnoreCaptureTarget(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    document.addEventListener('click', handleCaptureClick, { capture: true, once: true });
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const selector = generateSmartSelector(e.target);

  if (typeof captureMode.onResult === 'function') {
    captureMode.onResult(selector, e.target);
  } else {
    chrome.runtime.sendMessage({
      action: 'captureResult',
      targetId: captureMode.targetId,
      selector
    });
  }

  stopCaptureMode();
}

function generateSmartSelector(el) {
  if (el.dataset?.testid) {
    return `${el.tagName.toLowerCase()}[data-testid="${el.dataset.testid}"]`;
  }
  if (el.id) {
    return `#${el.id}`;
  }
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter(c => c);
    if (classes.length === 1) {
      return `.${classes[0]}`;
    }
  }
  const attrs = ['name', 'type', 'title', 'role', 'aria-label'];
  for (const attr of attrs) {
    if (el.getAttribute(attr)) {
      return `${el.tagName.toLowerCase()}[${attr}="${el.getAttribute(attr)}"]`;
    }
  }
  const text = el.textContent?.trim();
  if (text && ['Log out', '退出', 'Sign out', 'Switch', 'Continue'].includes(text)) {
    return `${el.tagName.toLowerCase()}:contains("${text}")`;
  }
  return el.tagName.toLowerCase();
}

function highlightElement(el, duration = 2000) {
  const originalStyle = el.getAttribute('style') || '';
  const highlightStyle = `
    outline: 3px solid #00ff00 !important;
    outline-offset: 2px !important;
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.5) !important;
  `;
  el.setAttribute('style', originalStyle + highlightStyle);
  setTimeout(() => {
    if (el.getAttribute('style')?.includes('outline: 3px solid #00ff00')) {
      el.setAttribute('style', originalStyle || '');
    }
  }, duration);
}

window.SelectorHelper = { generateSmartSelector, highlightElement, startCaptureMode, stopCaptureMode };
