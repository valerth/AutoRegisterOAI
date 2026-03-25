function pageLog(step, detail) {
  if (detail === undefined) {
    console.log(`[AutoReg Page] ${step}`);
  } else {
    console.log(`[AutoReg Page] ${step}`, detail);
  }

  chrome.runtime.sendMessage({
    action: 'pageDebugLog',
    step,
    detail: detail === undefined ? null : detail
  }).catch(() => null);
}

function bindLifecycleDebugEvents() {
  const emit = (step, detail) => pageLog(step, detail);

  window.addEventListener('pagehide', (event) => {
    emit('lifecycle:pagehide', {
      persisted: event.persisted,
      href: location.href,
      visibilityState: document.visibilityState
    });
  });

  window.addEventListener('pageshow', (event) => {
    emit('lifecycle:pageshow', {
      persisted: event.persisted,
      href: location.href,
      visibilityState: document.visibilityState
    });
  });

  document.addEventListener('visibilitychange', () => {
    emit('lifecycle:visibilitychange', {
      href: location.href,
      visibilityState: document.visibilityState
    });
  });

  window.addEventListener('beforeunload', () => {
    emit('lifecycle:beforeunload', {
      href: location.href,
      visibilityState: document.visibilityState
    });
  });
}

bindLifecycleDebugEvents();

if (window.AutoRegisterSidebar) {
  window.AutoRegisterSidebar.loadConfigWithMigration?.().catch(() => null);
}

async function detectPageState(selectors, timeout) {
  const result = { isLoggedIn: false, modalType: 'none', elements: {} };

  try {
    const userMenu = await safeQuerySelector(selectors.selUserMenu, 2000);
    if (userMenu) {
      result.isLoggedIn = true;
    }

    const switchModal = await safeQuerySelector(selectors.selSwitchAccountModal, 1500);
    if (switchModal) {
      result.modalType = 'switch';
      return result;
    }

    const loginModal = await safeQuerySelector(selectors.selLoginModal, 1500);
    if (loginModal) {
      result.modalType = 'login';
      return result;
    }
  } catch (error) {
    console.warn('detectPageState failed:', error.message);
  }

  return result;
}

async function performLogout(selectors, timeout) {
  const userMenu = await waitForElement(selectors.selUserMenu, timeout);
  await safeClick(userMenu);
  await sleep(400);

  const logoutBtn = await safeQuerySelector(selectors.selLogoutBtn, 2000);
  if (logoutBtn) {
    await safeClick(logoutBtn);
    await sleep(800);
  }

  const logoutConfirmBtn = selectors.selLogoutConfirmBtn
    ? await safeQuerySelector(selectors.selLogoutConfirmBtn, 2000)
    : null;
  if (logoutConfirmBtn) {
    await safeClick(logoutConfirmBtn);
    await sleep(300);
    return { ok: true, triggered: true, confirmed: true };
  }

  return { ok: true, triggered: Boolean(logoutBtn), confirmed: false };
}

async function closeSwitchModal(selectors) {
  const closeBtn = await safeQuerySelector(selectors.selSwitchCloseBtn, 2000);
  if (closeBtn) {
    await safeClick(closeBtn);
    await sleep(400);
  }
  return { ok: true };
}

async function closeGenericModal(selectors) {
  const closeSelectors = [
    selectors.selGenericCloseBtn,
    'button[aria-label="Close"]',
    '.modal-close'
  ].filter(Boolean);

  for (const selector of closeSelectors) {
    const btn = await safeQuerySelector(selector, 1500);
    if (btn && btn.offsetParent !== null) {
      await safeClick(btn);
      await sleep(400);
      return { ok: true };
    }
  }

  return { ok: true };
}

async function typeLikeUser(el, value) {
  const stringValue = String(value ?? '');
  const prototype = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  el.focus();
  el.click();
  await sleep(150);

  try {
    el.select?.();
  } catch {}

  if (valueSetter) {
    valueSetter.call(el, '');
  } else {
    el.value = '';
  }
  el.dispatchEvent(new InputEvent('beforeinput', {
    bubbles: true,
    inputType: 'deleteContentBackward',
    data: null
  }));
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'deleteContentBackward',
    data: null
  }));
  await sleep(100);

  for (const char of stringValue) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: char
    }));

    const nextValue = `${el.value || ''}${char}`;
    if (valueSetter) {
      valueSetter.call(el, nextValue);
    } else {
      el.value = nextValue;
    }

    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: char
    }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await sleep(100);
  }

  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(200);
}

async function ensureInputValue(el, value, selector) {
  const stringValue = String(value ?? '');
  if (el.value !== stringValue) {
    pageLog('fillInput:retryNativeSetter', { selector, beforeRetry: el.value, expected: stringValue });
    const prototype = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(el, stringValue);
    } else {
      el.value = stringValue;
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: stringValue
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
  }

  await waitFor(() => el.value === stringValue, 5000);
  return el.value;
}

async function clickTryAgainIfPresent(timeout = 3000) {
  const selectors = [
    'button[name="Try again"]',
    'button[data-dd-action-name="Try again"]',
    'button[type="submit"][name="Try again"]'
  ];

  for (const selector of selectors) {
    const button = await safeQuerySelector(selector, timeout);
    if (!button) {
      continue;
    }

    pageLog('tryAgain:found', {
      selector,
      text: button.textContent?.trim() || '',
      name: button.getAttribute('name'),
      actionName: button.getAttribute('data-dd-action-name')
    });
    await safeClick(button);
    await sleep(1000);
    pageLog('tryAgain:clicked', { selector });
    return { clicked: true, selector };
  }

  pageLog('tryAgain:notFound', { timeout });
  return { clicked: false };
}

async function clickSelectorAction(selector, timeout, options = {}) {
  const { delayBeforeClick = 0 } = options;
  if (delayBeforeClick > 0) {
    pageLog('clickSelector:delayBeforeClick', { selector, delayBeforeClick });
    await sleep(delayBeforeClick);
  }
  await safeClickRetry(selector, { timeout });
  return { ok: true };
}

async function waitForSelectorAction(selector, timeout) {
  pageLog('waitForSelector:start', { selector, timeout });
  try {
    const el = await waitForInteractable(selector, timeout);
    pageLog('waitForSelector:done', {
      selector,
      tagName: el.tagName.toLowerCase(),
      value: 'value' in el ? el.value : undefined
    });
    return { ok: true, selectorFound: selector, tagName: el.tagName.toLowerCase() };
  } catch (error) {
    throw new Error(`Wait timeout for selector: ${selector}`);
  }
}

async function fillInputAction(selector, value, timeout) {
  pageLog('fillInput:start', { selector, valueLength: String(value ?? '').length, timeout });
  const el = await waitForInteractable(selector, timeout);

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(300);
  el.focus();
  pageLog('fillInput:focused', { selector, currentValue: el.value, tagName: el.tagName.toLowerCase() });

  await typeLikeUser(el, value);
  const finalValue = await ensureInputValue(el, value, selector);
  el.blur();
  pageLog('fillInput:done', { selector, finalValue, matches: finalValue === String(value ?? '') });
  return { ok: true, value: finalValue };
}

async function fillDateFieldAction(selector, value, timeout) {
  pageLog('fillDateField:start', { selector, value, timeout });
  const hiddenInput = await waitForElement(selector, timeout);
  const segments = {
    year: await waitForInteractable('form [data-type="year"]', timeout),
    month: await waitForInteractable('form [data-type="month"]', timeout),
    day: await waitForInteractable('form [data-type="day"]', timeout)
  };

  const [year, month, day] = String(value || '').split('-');
  if (!year || !month || !day) {
    throw new Error(`Invalid birthday value: ${value}`);
  }

  pageLog('fillDateField:segments', {
    selector,
    currentHiddenValue: hiddenInput.value,
    yearText: segments.year.textContent?.trim() || '',
    monthText: segments.month.textContent?.trim() || '',
    dayText: segments.day.textContent?.trim() || ''
  });

  await fillContentEditableSegment(segments.year, year, 'year');
  await sleep(300);
  await fillContentEditableSegment(segments.month, month, 'month');
  await sleep(300);
  await fillContentEditableSegment(segments.day, day, 'day');
  await sleep(500);

  const matches = hiddenInput.value === value;
  pageLog('fillDateField:done', {
    selector,
    hiddenValue: hiddenInput.value,
    expected: value,
    matches
  });

  if (!matches) {
    throw new Error(`Birthday hidden value mismatch: expected ${value}, got ${hiddenInput.value || '(empty)'}`);
  }

  return { ok: true, value: hiddenInput.value };
}

async function fillContentEditableSegment(segment, text, type) {
  const targetText = String(text ?? '');
  pageLog('fillDateField:segmentStart', { type, currentText: segment.textContent?.trim(), targetText });

  segment.scrollIntoView({ behavior: 'smooth', block: 'center' });
  segment.focus();
  segment.click();
  await sleep(150);

  for (const char of targetText) {
    segment.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    segment.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: char
    }));
    segment.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
    await sleep(160);
  }

  await sleep(250);
  segment.dispatchEvent(new Event('change', { bubbles: true }));
  segment.dispatchEvent(new Event('blur', { bubbles: true }));
  segment.blur?.();
  await sleep(250);

  pageLog('fillDateField:segmentDone', {
    type,
    finalText: segment.textContent?.trim(),
    ariaValueNow: segment.getAttribute('aria-valuenow'),
    ariaValueText: segment.getAttribute('aria-valuetext')
  });
}

async function waitForProfileFormAction(timeout) {
  pageLog('waitForProfileForm:start', { timeout });

  const nameInput = await waitForInteractable('form input[name="name"]', timeout);
  const yearSegment = await waitForInteractable('form [data-type="year"]', timeout);
  const monthSegment = await waitForInteractable('form [data-type="month"]', timeout);
  const daySegment = await waitForInteractable('form [data-type="day"]', timeout);
  const hiddenBirthday = await waitForElement('form input[type="hidden"][name="birthday"]', timeout);

  const result = {
    ok: true,
    nameSelector: 'form input[name="name"]',
    birthdaySelector: 'form input[type="hidden"][name="birthday"]',
    nameValue: nameInput.value,
    hiddenBirthdayValue: hiddenBirthday.value,
    segments: {
      year: yearSegment.textContent?.trim() || '',
      month: monthSegment.textContent?.trim() || '',
      day: daySegment.textContent?.trim() || ''
    }
  };

  pageLog('waitForProfileForm:done', result);
  return result;
}

async function completeProfileFormAction(name, birthday, timeout) {
  pageLog('completeProfileForm:start', { name, birthday, timeout });
  const profileState = await waitForProfileFormAction(timeout);
  const fillNameResult = await fillInputAction(profileState.nameSelector, name, timeout);
  const fillBirthdayResult = await fillDateFieldAction(profileState.birthdaySelector, birthday, timeout);
  pageLog('completeProfileForm:done', { fillNameResult, fillBirthdayResult });
  return {
    ok: true,
    name: fillNameResult.value,
    birthday: fillBirthdayResult.value,
    nameSelector: profileState.nameSelector,
    birthdaySelector: profileState.birthdaySelector
  };
}

async function waitForAuthLoginAction(timeout, selectors = {}) {
  const emailSelector = selectors.emailSelector || 'input#_r_1_-email';
  const continueSelector = selectors.continueSelector || 'button[data-dd-action-name="Continue"]';
  pageLog('waitForAuthLogin:start', { emailSelector, continueSelector, timeout, href: location.href });
  await waitForInteractable(emailSelector, timeout);
  await waitForInteractable(continueSelector, timeout);
  pageLog('waitForAuthLogin:done', { emailSelector, continueSelector, href: location.href });
  return { ok: true, emailSelector, continueSelector, href: location.href };
}

async function fillAuthEmailAction(email, timeout, selector = 'input#_r_1_-email') {
  pageLog('auth:fillEmail', { selector, email });
  return fillInputAction(selector, email, timeout);
}

async function fillAuthPasswordAction(password, timeout, selector = 'input#_r_e_-current-password') {
  pageLog('auth:fillPassword', { selector, passwordLength: String(password ?? '').length });
  return fillInputAction(selector, password, timeout);
}

async function fillAuthCodeAction(code, timeout, selector = 'input#_r_14_-code') {
  pageLog('auth:fillCode', { selector, codeLength: String(code ?? '').length });
  return fillInputAction(selector, code, timeout);
}

async function detectContinueButtonAction(timeout, selector = 'button[data-dd-action-name="Continue"]') {
  pageLog('auth:detectContinue:start', { selector, timeout, href: location.href });
  const button = await safeQuerySelector(selector, timeout);
  const result = {
    ok: true,
    exists: Boolean(button),
    href: location.href,
    selector,
    text: button?.textContent?.trim() || '',
    disabled: button ? Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true') : false,
    tagName: button?.tagName?.toLowerCase() || null
  };
  pageLog('auth:detectContinue:done', result);
  return result;
}

async function clickContinueAction(timeout, options = {}, selector = 'button[data-dd-action-name="Continue"]') {
  pageLog('auth:clickContinue', { selector, timeout, options });
  return clickSelectorAction(selector, timeout, options);
}

async function detectEmailVerificationStepAction(timeout, selectors = {}) {
  const codeSelector = selectors.codeSelector || 'input#_r_14_-code';
  const isVerificationUrl = location.href.startsWith('https://auth.openai.com/email-verification');
  const codeInput = await safeQuerySelector(codeSelector, Math.min(timeout, 2000));
  const result = {
    ok: true,
    isVerificationStep: Boolean(isVerificationUrl || codeInput),
    url: location.href,
    codeSelector,
    byUrl: isVerificationUrl,
    byInput: Boolean(codeInput)
  };
  pageLog('auth:detectVerificationStep', result);
  return result;
}

async function clickUiStepAction(selector, timeout, options = {}) {
  const { delayBeforeClick = 0, waitForChange = false } = options;
  pageLog('uiStep:start', { selector, timeout, delayBeforeClick, waitForChange });

  const before = await safeQuerySelector(selector, Math.min(timeout, 2500));
  if (!before) {
    pageLog('uiStep:skipped', { selector, reason: 'not-found' });
    return { ok: true, status: 'skipped', selector };
  }

  const beforeText = before.textContent?.trim() || '';
  await clickSelectorAction(selector, timeout, { delayBeforeClick });

  if (waitForChange) {
    await waitFor(() => {
      const current = document.querySelector(selector);
      if (!current) return true;
      const currentText = current.textContent?.trim() || '';
      return current !== before || currentText !== beforeText;
    }, timeout);
  }

  pageLog('uiStep:done', { selector, beforeText, waitForChange });
  return { ok: true, status: 'handled', selector, beforeText, waitForChange };
}

async function clickSequenceStepAction(selector, timeout, options = {}) {
  const result = await clickUiStepAction(selector, timeout, options);
  if (result.status === 'skipped') {
    throw new Error(`Sequence step selector not found: ${selector}`);
  }
  return result;
}

async function clickGhostContinueAction(timeout, selector = '.btn-ghost.btn-large.w-full') {
  pageLog('auth:clickGhostContinue:start', { selector, timeout });
  const first = await clickSequenceStepAction(selector, timeout, { delayBeforeClick: 1000, waitForChange: true });
  const second = await clickSequenceStepAction(selector, timeout, { delayBeforeClick: 1000, waitForChange: false });
  pageLog('auth:clickGhostContinue:done', { selector, clicks: 2 });
  return { ok: true, selector, clicks: 2, firstText: first.beforeText, secondText: second.beforeText };
}

async function generateEmail(selectors, timeout) {
  pageLog('generateEmail:start', { button: selectors.selGenEmailBtn, display: selectors.selEmailDisplay, timeout });
  await retryWithBackoff(async () => {
    pageLog('generateEmail:clickGenerate');
    await clickAndWaitForResult(
      selectors.selGenEmailBtn,
      () => {
        const emailEl = document.querySelector(selectors.selEmailDisplay);
        const text = emailEl?.textContent?.trim();
        return Boolean(text && text.includes('@'));
      },
      { timeout, afterClickDelay: 500 }
    );

    const emailText = await waitForNonEmptyText(selectors.selEmailDisplay, timeout);
    pageLog('generateEmail:candidate', { emailText });
    if (!emailText.includes('@')) {
      throw new Error('Generated email is invalid');
    }
  }, { maxRetries: 3, baseDelay: 1500 });

  const email = await waitForNonEmptyText(selectors.selEmailDisplay, timeout);
  pageLog('generateEmail:done', { email });
  return { ok: true, email };
}

async function readVerificationCode(selectors, timeout) {
  pageLog('readVerificationCode:start', { list: selectors.selEmailList, subject: selectors.selEmailSubject, timeout });

  const startedAt = Date.now();
  let lastSubject = '';

  while (Date.now() - startedAt < timeout) {
    pageLog('readVerificationCode:refreshInbox', {
      action: selectors.selInboxAction,
      elapsedMs: Date.now() - startedAt
    });

    await safeClickRetry(selectors.selInboxAction, { timeout: Math.min(timeout, 10000) });
    const emailList = await waitForElement(selectors.selEmailList, timeout);
    await sleep(1200);

    const firstMail = emailList.querySelector('li');
    const subject = firstMail?.querySelector(selectors.selEmailSubject)?.textContent?.trim() || '';
    const code = extractVerificationCode(subject);

    if (subject && subject !== lastSubject) {
      lastSubject = subject;
      pageLog('readVerificationCode:latestSubject', { subject, code });
    } else {
      pageLog('readVerificationCode:poll', { subject, code, elapsedMs: Date.now() - startedAt });
    }

    if (code) {
      pageLog('readVerificationCode:done', { code, subject });
      return { ok: true, code };
    }

    await sleep(2000);
  }

  throw new Error(`Wait timeout while polling inbox. Last subject: ${lastSubject || '(empty)'}`);
}

async function removeInsElementsAction() {
  const elements = Array.from(document.querySelectorAll('ins'));
  const count = elements.length;
  for (const element of elements) {
    element.remove();
  }
  pageLog('removeInsElements:done', { count });
  return { ok: true, removedCount: count };
}

async function removeOnboardingModalAction() {
  const modal = document.getElementById('modal-onboarding');
  const existed = Boolean(modal);
  if (modal) {
    modal.remove();
  }
  pageLog('removeOnboardingModal:done', { existed });
  return { ok: true, removed: existed };
}

async function safeQuerySelector(selector, timeout = 3000, root = document) {
  try {
    const cleanSelector = selector.replace(/:contains\([^)]+\)/g, '');
    return await waitForElement(cleanSelector, timeout, root);
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'pageAction' && msg.type === '__ping') {
    sendResponse({ ok: true, ready: true });
    return false;
  }

  if (msg.action === 'pageAction') {
    (async () => {
      try {
        pageLog('pageAction:start', { type: msg.type, href: location.href });
        let result;

        if (msg.type === 'detectPageState') {
          result = await detectPageState(msg.selectors || {}, msg.timeout || 15000);
        } else if (msg.type === 'performLogout') {
          result = await performLogout(msg.selectors || {}, msg.timeout || 15000);
        } else if (msg.type === 'closeSwitchModal') {
          result = await closeSwitchModal(msg.selectors || {});
        } else if (msg.type === 'closeGenericModal') {
          result = await closeGenericModal(msg.selectors || {});
        } else if (msg.type === 'clickSelector') {
          result = await clickSelectorAction(msg.selector, msg.timeout || 15000, msg.options || {});
        } else if (msg.type === 'waitForSelector') {
          result = await waitForSelectorAction(msg.selector, msg.timeout || 15000);
        } else if (msg.type === 'waitForProfileForm') {
          result = await waitForProfileFormAction(msg.timeout || 15000);
        } else if (msg.type === 'completeProfileForm') {
          result = await completeProfileFormAction(msg.name, msg.birthday, msg.timeout || 15000);
        } else if (msg.type === 'waitForAuthLogin') {
          result = await waitForAuthLoginAction(msg.timeout || 15000, msg.selectors || {});
        } else if (msg.type === 'fillAuthEmail') {
          result = await fillAuthEmailAction(msg.email, msg.timeout || 15000, msg.selector);
        } else if (msg.type === 'fillAuthPassword') {
          result = await fillAuthPasswordAction(msg.password, msg.timeout || 15000, msg.selector);
        } else if (msg.type === 'fillAuthCode') {
          result = await fillAuthCodeAction(msg.code, msg.timeout || 15000, msg.selector);
        } else if (msg.type === 'clickContinue') {
          result = await clickContinueAction(msg.timeout || 15000, msg.options || {}, msg.selector);
        } else if (msg.type === 'detectContinueButton') {
          result = await detectContinueButtonAction(msg.timeout || 15000, msg.selector);
        } else if (msg.type === 'detectEmailVerificationStep') {
          result = await detectEmailVerificationStepAction(msg.timeout || 15000, msg.selectors || {});
        } else if (msg.type === 'clickGhostContinue') {
          result = await clickGhostContinueAction(msg.timeout || 15000, msg.selector);
        } else if (msg.type === 'clickSequenceStep') {
          result = await clickSequenceStepAction(msg.selector, msg.timeout || 15000, msg.options || {});
        } else if (msg.type === 'clickUiStep') {
          result = await clickUiStepAction(msg.selector, msg.timeout || 15000, msg.options || {});
        } else if (msg.type === 'fillInput') {
          result = await fillInputAction(msg.selector, msg.value, msg.timeout || 15000);
        } else if (msg.type === 'fillDateField') {
          result = await fillDateFieldAction(msg.selector, msg.value, msg.timeout || 15000);
        } else if (msg.type === 'clickTryAgainIfPresent') {
          result = await clickTryAgainIfPresent(msg.timeout || 3000);
        } else if (msg.type === 'removeInsElements') {
          result = await removeInsElementsAction();
        } else if (msg.type === 'removeOnboardingModal') {
          result = await removeOnboardingModalAction();
        } else if (msg.type === 'generateEmail') {
          result = await generateEmail(msg.selectors || {}, msg.timeout || 15000);
        } else if (msg.type === 'readVerificationCode') {
          result = await readVerificationCode(msg.selectors || {}, msg.timeout || 15000);
        } else {
          throw new Error(`Unsupported pageAction: ${msg.type}`);
        }

        pageLog('pageAction:done', { type: msg.type, result });
        sendResponse({ ok: true, ...(result || {}) });
      } catch (error) {
        console.error('❌ 页面动作异常:', error);
        pageLog('pageAction:error', { type: msg.type, error: error.message });
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }
});
