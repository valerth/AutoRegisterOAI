importScripts('../lib/config.js');

if (!self.AutoRegisterConfig && globalThis.AutoRegisterConfig) {
  self.AutoRegisterConfig = globalThis.AutoRegisterConfig;
}

const ConfigLib = self.AutoRegisterConfig || globalThis.AutoRegisterConfig;

if (!ConfigLib) {
  throw new Error('AutoRegisterConfig failed to load in background service worker');
}

const taskQueue = [];
let isRunning = false;
let batchSequence = 0;
const DEBUG_LOGOUT_TRACE = true;

function debugLog(step, detail = {}) {
  if (!DEBUG_LOGOUT_TRACE) return;
  console.log('[AutoReg BG]', step, {
    at: new Date().toISOString(),
    ...detail
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startRegistration') {
    const config = ConfigLib.migrateConfig(msg.config, msg.config?.version);
    taskQueue.push({
      id: `batch-${Date.now()}-${++batchSequence}`,
      sender,
      config,
      remainingRuns: Math.max(parseInt(config.runCount, 10) || 1, 1),
      initialRuns: Math.max(parseInt(config.runCount, 10) || 1, 1),
      results: []
    });
    processQueue();
    sendResponse({ queued: true });
    return true;
  }

  if (msg.action === 'requestHostPermission') {
    (async () => {
      try {
        const result = await requestHostPermission(msg.origin);
        await updateSidePanelForActiveTab();
        sendResponse({ ok: true, ...result });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'tabsApi') {
    (async () => {
      try {
        let result;

        if (msg.method === 'create') {
          result = await chrome.tabs.create(msg.args || {});
        } else if (msg.method === 'update') {
          result = await chrome.tabs.update(msg.tabId, msg.args || {});
        } else if (msg.method === 'reload') {
          result = await chrome.tabs.reload(msg.tabId, msg.args || {});
        } else if (msg.method === 'query') {
          result = await chrome.tabs.query(msg.args || {});
        } else if (msg.method === 'removeCookie') {
          result = await chrome.cookies.remove(msg.args || {});
        } else {
          throw new Error(`Unsupported tabsApi method: ${msg.method}`);
        }

        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'pageDebugLog') {
    debugLog(`page:${msg.step || 'event'}`, {
      tabId: sender?.tab?.id || null,
      url: sender?.tab?.url || sender?.url || null,
      frameId: sender?.frameId,
      detail: msg.detail || null
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'getActiveTabContext') {
    (async () => {
      try {
        const config = ConfigLib.migrateConfig(msg.config, msg.config?.version);
        const context = await getActiveTabContext(config);
        sendResponse({ ok: true, context });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'openSidePanel') {
    (async () => {
      try {
        const config = await loadStoredConfig();
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const context = classifyTab(tab, config);
        await openSidePanelForTab(tab, config);
        sendResponse({ ok: true, context });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'panelStartCapture') {
    (async () => {
      try {
        const config = await loadStoredConfig();
        const target = await getActiveTabContext(config);
        ensureHostMatches(target, msg.host);
        await ensureContentScriptsInjected(target.tabId);
        await chrome.tabs.sendMessage(target.tabId, {
          action: 'startCapture',
          targetId: msg.targetId,
          host: msg.host
        });
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'panelTestSelector') {
    (async () => {
      try {
        const config = await loadStoredConfig();
        const target = await getActiveTabContext(config);
        ensureHostMatches(target, msg.host);
        await ensureContentScriptsInjected(target.tabId);
        const result = await chrome.tabs.sendMessage(target.tabId, {
          action: 'testSelector',
          selector: msg.selector,
          timeout: msg.timeout || 5000
        });
        sendResponse({ ok: true, ...(result || {}) });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (msg.action === 'captureResult') {
    chrome.runtime.sendMessage({
      action: 'captureResult',
      targetId: msg.targetId,
      selector: msg.selector
    }).catch(() => null);
    sendResponse({ ok: true });
    return false;
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  chrome.sidePanel?.open?.({ tabId: tab.id }).catch((error) => {
    console.warn('[AutoReg BG] sidePanel.open:error', error?.message || error);
  });

  (async () => {
    const config = await loadStoredConfig();
    await applySidePanelState(tab, config);
  })().catch((error) => {
    console.warn('[AutoReg BG] applySidePanelState:error', error?.message || error);
  });
});

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  debugLog('tab:activated', { tabId, windowId });
  await updateSidePanelForActiveTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status || changeInfo.url) {
    debugLog('tab:updated', {
      tabId,
      changeStatus: changeInfo.status || null,
      changeUrl: changeInfo.url || null,
      tabStatus: tab?.status || null,
      tabUrl: tab?.url || null
    });
  }
  if (changeInfo.status === 'complete' || changeInfo.url) {
    await updateSidePanelForActiveTab(tab?.windowId);
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.autoRegisterConfig || changes.configVersion) {
    await updateSidePanelForActiveTab();
  }
});

async function loadStoredConfig() {
  const stored = await chrome.storage.local.get(['autoRegisterConfig', 'configVersion']);
  return ConfigLib.migrateConfig(stored.autoRegisterConfig, stored.configVersion);
}

function getAllowedHostsFromConfig(config) {
  const providerHosts = (config.mailProviders || [])
    .map((provider) => safeHostname(provider.url))
    .filter(Boolean);
  return ['chatgpt.com', 'auth.openai.com', safeHostname(config.oauth?.redirectUri), ...providerHosts].filter(Boolean);
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function classifyTab(tab, config) {
  const url = tab?.url || '';
  const hostname = safeHostname(url);
  const providerHosts = (config.mailProviders || []).map((provider) => safeHostname(provider.url)).filter(Boolean);
  const callbackHost = safeHostname(config.oauth?.redirectUri);
  let kind = 'unsupported';

  if (hostname === 'chatgpt.com') {
    kind = 'chat';
  } else if (hostname === 'auth.openai.com') {
    kind = 'auth';
  } else if (hostname && providerHosts.includes(hostname)) {
    kind = 'provider';
  } else if (hostname && callbackHost && hostname === callbackHost) {
    kind = 'callback';
  }

  return {
    tabId: tab?.id || null,
    windowId: tab?.windowId || null,
    url,
    hostname,
    kind,
    supported: kind !== 'unsupported',
    allowedHosts: getAllowedHostsFromConfig(config)
  };
}

function ensureHostMatches(context, hostKey) {
  if (!context?.supported) {
    throw new Error('当前页面不受支持');
  }
  if (hostKey === 'chat' && context.kind !== 'chat') {
    throw new Error('当前不是 chatgpt.com 页面');
  }
  if (hostKey === 'auth' && context.kind !== 'auth') {
    throw new Error('当前不是 auth.openai.com 页面');
  }
  if (hostKey === 'provider' && context.kind !== 'provider') {
    throw new Error('当前不是已配置 provider 页面');
  }
}

async function getActiveTabContext(config) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return classifyTab(tab, config);
}

async function applySidePanelState(tab, config) {
  if (!tab?.id || !chrome.sidePanel?.setOptions) {
    return classifyTab(tab, config);
  }

  const context = classifyTab(tab, config);
  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: 'sidepanel/sidepanel.html',
    enabled: true
  });

  chrome.runtime.sendMessage({ action: 'activeTabContextChanged', context }).catch(() => null);
  return context;
}

async function openSidePanelForTab(tab, config) {
  const context = await applySidePanelState(tab, config);
  return context;
}

async function updateSidePanelForActiveTab(windowId) {
  const config = await loadStoredConfig();
  const query = { active: true, currentWindow: true };
  if (windowId) {
    query.windowId = windowId;
  }
  const [tab] = await chrome.tabs.query(query);
  if (!tab?.id) return;
  const context = await applySidePanelState(tab, config);
  if (!context.supported) {
    chrome.runtime.sendMessage({ action: 'sidePanelUnsupported', context }).catch(() => null);
  }
}

async function processQueue() {
  if (isRunning || taskQueue.length === 0) return;

  isRunning = true;
  const task = taskQueue.shift();
  console.log('[AutoReg BG] processQueue:start', { remaining: taskQueue.length, remainingRuns: task?.remainingRuns, taskId: task?.id });

  try {
    const config = ConfigLib.ensureSelectedMailProvider(task.config);
    const result = await runRegistrationFlow(config, task);
    const normalizedResult = finalizeRunResult(result, config, task);
    task.results.push(normalizedResult);
    task.remainingRuns -= 1;
    await persistRunResult(normalizedResult, config);
    await showResultNotification(normalizedResult);

    if (task.remainingRuns > 0) {
      taskQueue.push(task);
      console.log('[AutoReg BG] processQueue:requeue', { taskId: task.id, remainingRuns: task.remainingRuns, queueSize: taskQueue.length });
    }
  } catch (error) {
    const config = ConfigLib.ensureSelectedMailProvider(task.config);
    const failure = finalizeRunResult({ success: false, stage: 'system', error: error.message }, config, task);
    task.results.push(failure);
    task.remainingRuns -= 1;
    await persistRunResult(failure, config);
    await showResultNotification(failure);
    if (task.remainingRuns > 0) {
      taskQueue.push(task);
    }
    console.error('[AutoReg BG] processQueue:error', error);
  } finally {
    isRunning = false;
    console.log('[AutoReg BG] processQueue:finish', { queueSize: taskQueue.length });
    if (taskQueue.length > 0) {
      setTimeout(processQueue, 1500);
    }
  }
}

function mapStageToPhase(stage, result = {}) {
  if (result?.uploadWarning || stage === 'upload-file') {
    return '上传文件';
  }
  if (result?.saveWarning || stage === 'save-file') {
    return '保存文件';
  }

  const authStages = new Set([
    'oauth',
    'oauth-fill-email',
    'oauth-fill-password',
    'oauth-submit-password',
    'oauth-read-code',
    'oauth-submit-code',
    'post-auth-steps'
  ]);

  if (authStages.has(stage)) {
    return '授权';
  }

  if (stage === 'completed') {
    return '已完成';
  }

  return '注册';
}

function finalizeRunResult(result, config, task) {
  const selectedProvider = ConfigLib.getSelectedMailProvider(config);
  const stage = result?.stage || (result?.success ? 'completed' : 'unknown');
  return {
    success: Boolean(result?.success),
    email: result?.email || '',
    username: result?.username || '',
    birthday: result?.birthday || '',
    stage,
    phase: mapStageToPhase(stage, result),
    error: result?.error || '',
    callback: result?.callback,
    tokenResult: result?.tokenResult,
    savedFilePath: result?.savedFilePath || '',
    saveWarning: result?.saveWarning || '',
    uploadSuccess: Boolean(result?.uploadSuccess),
    uploadedFileName: result?.uploadedFileName || '',
    uploadWarning: result?.uploadWarning || '',
    providerId: selectedProvider?.id || '',
    providerName: selectedProvider?.name || '',
    batchId: task.id,
    runIndex: task.initialRuns - task.remainingRuns,
    createdAt: new Date().toISOString()
  };
}

async function persistRunResult(result, config) {
  const existing = await chrome.storage.local.get(['recentRunResults', 'autoRegisterConfig']);
  const recentRunResults = ConfigLib.truncateResults([result, ...(existing.recentRunResults || [])]);
  const nextConfig = ConfigLib.migrateConfig(existing.autoRegisterConfig || config, existing.autoRegisterConfig?.version || config.version);
  nextConfig.recentResults = recentRunResults;

  await chrome.storage.local.set({
    recentRunResults,
    autoRegisterConfig: nextConfig,
    configVersion: ConfigLib.CONFIG_VERSION
  });
}

async function showResultNotification(result) {
  if (!chrome.notifications?.create) {
    return;
  }

  try {
    const phase = result?.phase || mapStageToPhase(result?.stage, result);
    const detail = result?.error || result?.uploadWarning || result?.saveWarning || result?.email || '未知结果';
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: result?.success ? `✅ ${phase}` : `❌ ${phase}失败`,
      message: detail
    });
  } catch (error) {
    console.warn('[AutoReg BG] notification:error', error?.message || error);
  }
}

async function ensureChatPageReady(tabId, timeout) {
  await waitForTabComplete(tabId, timeout);
  await ensureContentScriptsInjected(tabId);
  await sendPageAction(tabId, 'removeOnboardingModal', { timeout: Math.min(timeout, 5000) }).catch(() => null);
  await delay(300);
}

async function ensureProviderPageReady(tabId, timeout) {
  await waitForTabComplete(tabId, timeout);
  await ensureContentScriptsInjected(tabId);
  await sendPageAction(tabId, 'removeInsElements', { timeout: Math.min(timeout, 5000) });
  await delay(300);
}

async function ensureContentScriptsInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'pageAction', type: '__ping' });
    return;
  } catch {}

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['lib/config.js', 'content/utils.js', 'content/selector-helper.js', 'content/sidebar.js', 'content/content.js']
  });
}

async function getOrCreateChatTab(timeout) {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && safeHostname(activeTab.url) === 'chatgpt.com') {
    await chrome.tabs.update(activeTab.id, { active: true });
    await ensureChatPageReady(activeTab.id, timeout);
    return activeTab;
  }

  const chatTab = await chrome.tabs.create({ url: 'https://chatgpt.com', active: true });
  await ensureChatPageReady(chatTab.id, timeout);
  return chatTab;
}

async function getOrCreateMailTab(task, selectedMailProvider, timeout) {
  const expectedHost = safeHostname(selectedMailProvider?.url || '');
  const existingTabId = task?.mailTabId;

  if (existingTabId) {
    const existingTab = await chrome.tabs.get(existingTabId).catch(() => null);
    if (existingTab?.id && safeHostname(existingTab.url) === expectedHost) {
      await chrome.tabs.update(existingTab.id, { active: true });
      await ensureProviderPageReady(existingTab.id, timeout);
      return existingTab;
    }
  }

  const mailTab = await chrome.tabs.create({ url: selectedMailProvider.url, active: true });
  await ensureProviderPageReady(mailTab.id, timeout);
  if (task) {
    task.mailTabId = mailTab.id;
  }
  return mailTab;
}

async function runRegistrationFlow(config, task) {
  const timeout = Math.max((config.timeout || 30) * 1000, 15000);
  const password = ConfigLib.DEFAULT_PASSWORD;
  const selectedMailProvider = ConfigLib.getSelectedMailProvider(config);
  let currentStage = 'precheck';
  console.log('[AutoReg BG] flow:start', { timeout, provider: selectedMailProvider?.name, taskId: task.id });

  try {
    await ensureProviderPermission(selectedMailProvider.url);
    await resetChatSessionTabs(config).catch((error) => {
      console.warn('[AutoReg BG] resetChatSessionTabs:before-run:error', error?.message || error);
    });

    const chatTab = await getOrCreateChatTab(timeout);
    await sendPageAction(chatTab.id, 'removeOnboardingModal', { timeout: Math.min(timeout, 5000) }).catch(() => null);

    let pageStateBeforeLogout = await sendPageAction(chatTab.id, 'detectPageState', {
      selectors: config.chatSelectors,
      timeout
    });
    let pageStateAfterLogout = pageStateBeforeLogout;

    if (pageStateBeforeLogout?.isLoggedIn) {
      currentStage = 'pre-logout-close-steps';
      const preLogoutStepsResult = await runRequiredUiSteps(chatTab.id, config.preLogoutCloseSteps || [], Math.min(timeout, 15000), {
        stage: 'pre-logout-close-steps',
        label: '退出登录前弹窗关闭'
      });
      if (!preLogoutStepsResult.ok) {
        return {
          success: false,
          stage: 'pre-logout-close-steps',
          error: preLogoutStepsResult.error
        };
      }

      currentStage = 'logout';
      debugLog('logout:start', {
        tabId: chatTab.id,
        tabUrl: chatTab.url,
        tabStatus: chatTab.status,
        selectors: {
          userMenu: config.chatSelectors.selUserMenu,
          logout: config.chatSelectors.selLogoutBtn,
          logoutConfirm: config.chatSelectors.selLogoutConfirmBtn,
          signup: config.chatSelectors.selSignupBtn
        }
      });
      await sendPageAction(chatTab.id, 'performLogout', {
        selectors: config.chatSelectors,
        timeout
      });
      debugLog('logout:performLogout:sent', { tabId: chatTab.id });
      await waitForTabComplete(chatTab.id, timeout).catch((error) => {
        debugLog('logout:waitForTabComplete:error', {
          tabId: chatTab.id,
          message: error?.message || String(error)
        });
        return null;
      });
      const tabAfterLogout = await chrome.tabs.get(chatTab.id).catch(() => null);
      debugLog('logout:afterWait', {
        tabId: chatTab.id,
        tabUrl: tabAfterLogout?.url || null,
        tabStatus: tabAfterLogout?.status || null
      });
      await ensureContentScriptsInjected(chatTab.id).catch((error) => {
        debugLog('logout:ensureContentScriptsInjected:error', {
          tabId: chatTab.id,
          message: error?.message || String(error)
        });
        return null;
      });
      debugLog('logout:waitForSignup:start', {
        tabId: chatTab.id,
        selector: config.chatSelectors.selSignupBtn,
        timeout
      });
      await waitForPageAction(chatTab.id, 'waitForSelector', {
        selector: config.chatSelectors.selSignupBtn
      }, timeout);
      debugLog('logout:waitForSignup:done', {
        tabId: chatTab.id,
        selector: config.chatSelectors.selSignupBtn
      });

      pageStateAfterLogout = await sendPageAction(chatTab.id, 'detectPageState', {
        selectors: config.chatSelectors,
        timeout
      });
      debugLog('logout:pageStateAfterLogout', {
        tabId: chatTab.id,
        pageStateAfterLogout
      });
    }

    const pageState = pageStateAfterLogout;

    if (pageState?.modalType === 'switch') {
      currentStage = 'close-switch-modal';
      await tryPageAction(chatTab.id, 'closeSwitchModal', {
        selectors: config.chatSelectors,
        timeout
      }, { label: 'post-logout-close-switch-modal' });
    } else if (pageState?.modalType === 'login') {
      return {
        success: false,
        stage: 'precheck',
        error: '暂不支持从登录弹窗路径继续执行，请先确保进入标准注册流程。'
      };
    } else if (!pageStateBeforeLogout?.isLoggedIn) {
      currentStage = 'close-generic-modal';
      await tryPageAction(chatTab.id, 'closeGenericModal', {
        selectors: config.chatSelectors,
        timeout
      }, { label: 'pre-signup-close-generic-modal' });
    }

    currentStage = 'click-signup';
    await sendPageAction(chatTab.id, 'clickSelector', {
      selector: config.chatSelectors.selSignupBtn,
      timeout
    });

    const mailTab = await getOrCreateMailTab(task, selectedMailProvider, timeout);

    currentStage = 'generate-email';
    const emailResult = await sendPageAction(mailTab.id, 'generateEmail', {
      selectors: selectedMailProvider.selectors,
      timeout
    });
    const generatedEmail = emailResult?.email;
    if (!generatedEmail) {
      return { success: false, stage: 'generate-email', error: 'Failed to generate email' };
    }

    await chrome.tabs.update(chatTab.id, { active: true });
    await waitForTabComplete(chatTab.id, timeout);

    currentStage = 'fill-email';
    const fillEmailResult = await sendPageAction(chatTab.id, 'fillInput', {
      selector: config.authSelectors.selEmailInput,
      value: generatedEmail,
      timeout
    });
    if (fillEmailResult?.value !== generatedEmail) {
      return { success: false, stage: 'fill-email', email: generatedEmail, error: 'Email input did not retain the expected value' };
    }

    currentStage = 'submit-email';
    await sendPageAction(chatTab.id, 'clickSelector', {
      selector: config.authSelectors.selEmailSubmit,
      timeout,
      options: { delayBeforeClick: 1000 }
    });

    const retryAfterEmail = await sendPageAction(chatTab.id, 'clickTryAgainIfPresent', { timeout: 2000 });
    if (retryAfterEmail?.clicked) {
      currentStage = 'fill-email';
      await sendPageAction(chatTab.id, 'fillInput', {
        selector: config.authSelectors.selEmailInput,
        value: generatedEmail,
        timeout
      });
      currentStage = 'submit-email';
      await sendPageAction(chatTab.id, 'clickSelector', {
        selector: config.authSelectors.selEmailSubmit,
        timeout,
        options: { delayBeforeClick: 1000 }
      });
    }

    currentStage = 'fill-password';
    const fillPasswordResult = await sendPageAction(chatTab.id, 'fillInput', {
      selector: config.authSelectors.selPasswordInput,
      value: password,
      timeout
    });
    if (fillPasswordResult?.value !== password) {
      return { success: false, stage: 'fill-password', email: generatedEmail, error: 'Password input did not retain the expected value' };
    }

    currentStage = 'submit-password';
    await sendPageAction(chatTab.id, 'clickSelector', {
      selector: config.authSelectors.selContinueBtn,
      timeout,
      options: { delayBeforeClick: 1000 }
    });

    const retryAfterPassword = await sendPageAction(chatTab.id, 'clickTryAgainIfPresent', { timeout: 2500 });
    if (retryAfterPassword?.clicked) {
      currentStage = 'fill-password';
      await sendPageAction(chatTab.id, 'fillInput', {
        selector: config.authSelectors.selPasswordInput,
        value: password,
        timeout
      });
      currentStage = 'submit-password';
      await sendPageAction(chatTab.id, 'clickSelector', {
        selector: config.authSelectors.selContinueBtn,
        timeout,
        options: { delayBeforeClick: 1000 }
      });
    }

    await delay(2000);
    await chrome.tabs.update(mailTab.id, { active: true });
    await ensureProviderPageReady(mailTab.id, timeout);

    currentStage = 'read-code';
    const codeResult = await sendPageAction(mailTab.id, 'readVerificationCode', {
      selectors: selectedMailProvider.selectors,
      timeout
    });
    const verificationCode = codeResult?.code;
    if (!verificationCode) {
      return { success: false, stage: 'read-code', email: generatedEmail, error: 'Failed to read verification code' };
    }

    await chrome.tabs.update(chatTab.id, { active: true });
    await waitForTabComplete(chatTab.id, timeout);

    currentStage = 'fill-code';
    await sendPageAction(chatTab.id, 'fillInput', {
      selector: config.authSelectors.selCodeInput,
      value: verificationCode,
      timeout
    });

    currentStage = 'submit-code';
    await sendPageAction(chatTab.id, 'clickSelector', {
      selector: config.authSelectors.selContinueBtn,
      timeout,
      options: { delayBeforeClick: 1000 }
    });

    const retryAfterCode = await sendPageAction(chatTab.id, 'clickTryAgainIfPresent', { timeout: 4000 });
    if (retryAfterCode?.clicked) {
      currentStage = 'fill-code';
      await sendPageAction(chatTab.id, 'fillInput', {
        selector: config.authSelectors.selCodeInput,
        value: verificationCode,
        timeout
      });
      currentStage = 'submit-code';
      await sendPageAction(chatTab.id, 'clickSelector', {
        selector: config.authSelectors.selContinueBtn,
        timeout,
        options: { delayBeforeClick: 1000 }
      });

      const retryAfterCodeSecond = await sendPageAction(chatTab.id, 'clickTryAgainIfPresent', { timeout: 4000 });
      if (retryAfterCodeSecond?.clicked) {
        return {
          success: false,
          stage: 'submit-code',
          email: generatedEmail,
          error: 'Verification code step still shows Try again after retry'
        };
      }
    }

    const username = generateUsername();
    const birthday = generateBirthday();

    currentStage = 'profile';
    await sendPageAction(chatTab.id, 'completeProfileForm', {
      name: username,
      birthday,
      timeout
    });

    currentStage = 'submit-profile';
    await sendPageAction(chatTab.id, 'clickSelector', {
      selector: config.authSelectors.selContinueBtn,
      timeout,
      options: { delayBeforeClick: 1000 }
    });

    const postProfileContinueResult = await advanceThroughContinueSteps(chatTab.id, {
      stage: 'post-registration-continue',
      selector: config.authSelectors.selContinueBtn,
      timeout: Math.min(timeout, 20000),
      clickOptions: { delayBeforeClick: 1000 },
      tryAgainTimeout: 2500,
      maxRounds: 6,
      allowMissingContinue: true
    }).catch((error) => ({ status: 'ignored', error: error?.message || String(error) }));

    if (postProfileContinueResult?.status === 'error') {
      console.warn('[AutoReg BG] post-registration-continue:non-fatal', {
        tabId: chatTab.id,
        email: generatedEmail,
        message: postProfileContinueResult.error || 'unknown error'
      });
    }

    currentStage = 'oauth';
    const authResult = await runPostRegistrationAuthFlow({
      chatTabId: chatTab.id,
      mailTabId: mailTab.id,
      generatedEmail,
      password,
      config,
      timeout,
      selectedMailProvider,
      username,
      birthday
    });

    if (!authResult.success) {
      return {
        success: false,
        stage: authResult.stage,
        email: generatedEmail,
        username,
        birthday,
        error: authResult.error
      };
    }

    return {
      success: true,
      stage: authResult.stage || 'completed',
      email: generatedEmail,
      username,
      birthday,
      callback: authResult.callback,
      tokenResult: authResult.tokenResult,
      savedFilePath: authResult.savedFilePath,
      saveWarning: authResult.saveWarning,
      uploadSuccess: authResult.uploadSuccess,
      uploadedFileName: authResult.uploadedFileName,
      uploadWarning: authResult.uploadWarning
    };
  } catch (error) {
    return {
      success: false,
      stage: currentStage || 'exception',
      error: error.message
    };
  }
}

async function resetChatSessionTabs(config) {
  const redirectHost = safeHostname(config?.oauth?.redirectUri);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const closableTabIds = tabs
    .filter((tab) => {
      const hostname = safeHostname(tab?.url || '');
      return hostname === 'chatgpt.com' || hostname === 'auth.openai.com' || hostname === redirectHost;
    })
    .map((tab) => tab.id)
    .filter(Boolean);

  if (closableTabIds.length) {
    await chrome.tabs.remove(closableTabIds).catch(() => null);
  }

  const freshTab = await chrome.tabs.create({ url: 'https://chatgpt.com', active: true });
  await ensureChatPageReady(freshTab.id, Math.max((config?.timeout || 30) * 1000, 15000)).catch(() => null);
  return freshTab;
}

async function sendPageAction(tabId, type, payload = {}) {
  const timeout = payload.timeout || 15000;
  const maxAttempts = 4;
  debugLog('sendPageAction:start', { tabId, type, timeout, payloadKeys: Object.keys(payload || {}) });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      debugLog('sendPageAction:attempt', {
        tabId,
        type,
        attempt,
        tabStatus: tab?.status || null,
        tabUrl: tab?.url || null
      });
      const result = await chrome.tabs.sendMessage(tabId, {
        action: 'pageAction',
        type,
        ...payload
      });

      if (!result?.ok) {
        throw new Error(result?.error || `Page action failed: ${type}`);
      }

      debugLog('sendPageAction:success', { tabId, type, attempt, resultKeys: Object.keys(result || {}) });
      return result;
    } catch (error) {
      const message = error?.message || String(error);
      const retryable = isRetryableMessagingError(message);
      console.warn('[AutoReg BG] sendPageAction:error', { tabId, type, attempt, retryable, message });
      debugLog('sendPageAction:error', { tabId, type, attempt, retryable, message });

      if (!retryable || attempt === maxAttempts) {
        throw error;
      }

      await recoverTabMessaging(tabId, timeout);
      await delay(500 * attempt);
    }
  }
}

async function recoverTabMessaging(tabId, timeout) {
  await waitForTabComplete(tabId, timeout).catch(() => null);
  await ensureContentScriptsInjected(tabId).catch(() => null);
}

async function runPostRegistrationAuthFlow({ chatTabId, mailTabId, generatedEmail, password, config, timeout, selectedMailProvider, username, birthday }) {
  try {
    const state = generateRandomState();
    const authorizationUrl = await buildAuthorizationUrl({
      clientId: config.oauth.clientId,
      redirectUri: config.oauth.redirectUri,
      codeVerifier: config.oauth.codeVerifier,
      state
    });

    await delay(1500);
    await runPostRegistrationSteps(chatTabId, config.postRegistrationSteps || [], timeout);
    await chrome.tabs.update(chatTabId, { url: authorizationUrl, active: true });
    await waitForTabComplete(chatTabId, timeout);

    await sendPageAction(chatTabId, 'waitForAuthLogin', {
      timeout,
      selectors: {
        emailSelector: config.authSelectors.authEmailInputSelector,
        continueSelector: config.authSelectors.authContinueButtonSelector
      }
    });

    const emailFillResult = await sendPageAction(chatTabId, 'fillAuthEmail', {
      email: generatedEmail,
      selector: config.authSelectors.authEmailInputSelector,
      timeout
    });
    if (emailFillResult?.value !== generatedEmail) {
      return { success: false, stage: 'oauth-fill-email', error: 'Auth email input did not retain the expected value' };
    }

    await sendPageAction(chatTabId, 'clickContinue', {
      selector: config.authSelectors.authContinueButtonSelector,
      timeout,
      options: { delayBeforeClick: 1000 }
    });
    await sendPageAction(chatTabId, 'clickTryAgainIfPresent', { timeout: 2500 });

    const passwordFillResult = await sendPageAction(chatTabId, 'fillAuthPassword', {
      password,
      selector: config.authSelectors.authPasswordInputSelector,
      timeout
    });
    if (passwordFillResult?.value !== password) {
      return { success: false, stage: 'oauth-fill-password', error: 'Auth password input did not retain the expected value' };
    }

    const passwordAdvanceResult = await advanceThroughContinueSteps(chatTabId, {
      stage: 'oauth-submit-password',
      selector: config.authSelectors.authContinueButtonSelector,
      redirectUri: config.oauth.redirectUri,
      timeout,
      clickOptions: { delayBeforeClick: 1000 },
      tryAgainTimeout: 2500,
      maxRounds: 8,
      stopWhen: async () => {
        const verificationStep = await sendPageAction(chatTabId, 'detectEmailVerificationStep', {
          timeout: Math.min(timeout, 2500),
          selectors: { codeSelector: config.authSelectors.authCodeInputSelector }
        });
        return Boolean(verificationStep?.isVerificationStep);
      }
    });

    let callback;

    if (passwordAdvanceResult.status === 'verification') {
      const verificationResult = await handleAuthEmailVerification({
        chatTabId,
        mailTabId,
        config,
        timeout,
        selectedMailProvider
      });
      if (!verificationResult.success) {
        return verificationResult;
      }
      const callbackUrl = await waitForCallbackUrl(chatTabId, config.oauth.redirectUri, timeout);
      callback = await handleAuthCallback(callbackUrl, config, state);
    } else if (passwordAdvanceResult.status === 'callback') {
      callback = await handleAuthCallback(passwordAdvanceResult.callbackUrl, config, state);
    } else if (passwordAdvanceResult.status === 'continue-missing') {
      const callbackUrl = await waitForCallbackUrl(chatTabId, config.oauth.redirectUri, timeout);
      callback = await handleAuthCallback(callbackUrl, config, state);
    } else {
      return {
        success: false,
        stage: 'oauth-submit-password',
        error: passwordAdvanceResult.error || `Unexpected continue advance status: ${passwordAdvanceResult.status}`
      };
    }

    await chrome.storage.local.set({
      lastAuthCallback: callback.callback,
      lastTokenResult: callback.tokenResult
    });

    const postAuthStepsResult = await runRequiredUiSteps(chatTabId, config.postAuthSteps || [], timeout, {
      stage: 'post-auth-steps',
      label: '授权后动作'
    });
    if (!postAuthStepsResult.ok) {
      return {
        success: false,
        stage: 'post-auth-steps',
        error: postAuthStepsResult.error
      };
    }

    const exportResult = await exportAuthResult({
      email: generatedEmail,
      username,
      birthday,
      callback: callback.callback,
      tokenResult: callback.tokenResult,
      providerId: selectedMailProvider?.id,
      providerName: selectedMailProvider?.name,
      config
    });

    return {
      success: true,
      stage: exportResult.stage,
      ...callback,
      ...exportResult
    };
  } catch (error) {
    return { success: false, stage: 'oauth', error: error.message };
  }
}

async function runUiSteps(tabId, steps, timeout, options = {}) {
  const {
    fatal = false,
    stage = 'ui-step',
    label = stage
  } = options;

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (!step?.selector) continue;

    try {
      const result = await sendPageAction(tabId, 'clickUiStep', {
        selector: step.selector,
        timeout,
        options: {
          delayBeforeClick: step.delayBeforeClick || 0,
          waitForChange: Boolean(step.waitForChange)
        }
      });

      if (result?.status === 'skipped') {
        console.log('[AutoReg BG] ui-step:skipped', { label, stage, index, selector: step.selector });
        continue;
      }

      console.log('[AutoReg BG] ui-step:handled', { label, stage, index, selector: step.selector, waitForChange: Boolean(step.waitForChange) });
    } catch (error) {
      const message = error?.message || String(error);
      console.warn('[AutoReg BG] ui-step:error', { label, stage, index, selector: step.selector, fatal, message });
      if (fatal) {
        return {
          ok: false,
          stage,
          error: `${label} 第 ${index + 1} 步失败: ${message}`
        };
      }
    }
  }

  return { ok: true, stage };
}

async function runRequiredUiSteps(tabId, steps, timeout, options = {}) {
  return runUiSteps(tabId, steps, timeout, { ...options, fatal: true });
}

async function runOptionalUiSteps(tabId, steps, timeout, options = {}) {
  return runUiSteps(tabId, steps, timeout, { ...options, fatal: false });
}

async function runPostRegistrationSteps(chatTabId, steps, timeout) {
  return runOptionalUiSteps(chatTabId, steps, timeout, {
    stage: 'post-registration-steps',
    label: '注册成功后动作'
  });
}

function isTransitionMessagingError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('receiving end does not exist') || text.includes('message channel is closed') || text.includes('back/forward cache');
}

async function waitForCallbackUrlAfterContinue(tabId, redirectUri, waitMs = 2500) {
  if (!redirectUri) {
    return '';
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < waitMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const tabUrl = tab?.url || '';
    if (isCallbackUrl(tabUrl, redirectUri)) {
      return tabUrl;
    }
    await delay(150);
  }

  return '';
}

async function advanceThroughContinueSteps(tabId, options = {}) {
  const {
    selector = 'button[data-dd-action-name="Continue"]',
    redirectUri = '',
    timeout = 15000,
    stage = 'continue',
    clickOptions = { delayBeforeClick: 1000 },
    tryAgainTimeout = 2500,
    maxRounds = 8,
    stopWhen = null,
    allowMissingContinue = true
  } = options;
  const startedAt = Date.now();
  let rounds = 0;

  while (Date.now() - startedAt < timeout) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const tabUrl = tab?.url || '';

    if (redirectUri && isCallbackUrl(tabUrl, redirectUri)) {
      return { status: 'callback', callbackUrl: tabUrl, rounds };
    }

    if (typeof stopWhen === 'function') {
      const shouldStop = await stopWhen({ rounds, tabUrl, elapsedMs: Date.now() - startedAt });
      if (shouldStop) {
        return { status: 'verification', rounds, tabUrl };
      }
    }

    const detection = await sendPageAction(tabId, 'detectContinueButton', {
      selector,
      timeout: Math.min(timeout, 2500)
    });

    if (!detection?.exists) {
      if (allowMissingContinue) {
        return { status: 'continue-missing', rounds, tabUrl: detection?.href || tabUrl };
      }
      return {
        status: 'error',
        rounds,
        tabUrl: detection?.href || tabUrl,
        error: `${stage}: Continue button is missing before flow completed`
      };
    }

    rounds += 1;
    if (rounds > maxRounds) {
      return {
        status: 'error',
        rounds,
        tabUrl: detection?.href || tabUrl,
        error: `${stage}: exceeded max continue rounds (${maxRounds})`
      };
    }

    debugLog('continue:advance', {
      stage,
      tabId,
      rounds,
      tabUrl,
      selector,
      buttonText: detection?.text || '',
      buttonDisabled: detection?.disabled || false
    });

    await sendPageAction(tabId, 'clickContinue', {
      selector,
      timeout,
      options: clickOptions
    });

    const callbackUrlAfterContinue = await waitForCallbackUrlAfterContinue(tabId, redirectUri, 2500);
    if (callbackUrlAfterContinue) {
      return { status: 'callback', callbackUrl: callbackUrlAfterContinue, rounds };
    }

    const tabAfterClick = await chrome.tabs.get(tabId).catch(() => null);
    const tabUrlAfterClick = tabAfterClick?.url || '';

    if (typeof stopWhen === 'function') {
      const shouldStopAfterClick = await stopWhen({
        rounds,
        tabUrl: tabUrlAfterClick,
        elapsedMs: Date.now() - startedAt
      });
      if (shouldStopAfterClick) {
        return { status: 'verification', rounds, tabUrl: tabUrlAfterClick };
      }
    }

    await recoverTabMessaging(tabId, timeout).catch(() => null);
    try {
      await sendPageAction(tabId, 'clickTryAgainIfPresent', { timeout: tryAgainTimeout });
    } catch (error) {
      const message = error?.message || String(error);
      if (isTransitionMessagingError(message)) {
        const callbackUrlAfterError = await waitForCallbackUrlAfterContinue(tabId, redirectUri, 2500);
        if (callbackUrlAfterError) {
          return { status: 'callback', callbackUrl: callbackUrlAfterError, rounds };
        }
      }
    }
    await delay(500);
  }

  return {
    status: 'error',
    rounds,
    error: `${stage}: timeout waiting for continue flow to finish`
  };
}

async function handleAuthEmailVerification({ chatTabId, mailTabId, config, timeout, selectedMailProvider }) {
  await chrome.tabs.update(mailTabId, { active: true });
  await ensureProviderPageReady(mailTabId, timeout);
  const codeResult = await sendPageAction(mailTabId, 'readVerificationCode', {
    selectors: selectedMailProvider.selectors,
    timeout
  });
  const verificationCode = codeResult?.code;
  if (!verificationCode) {
    return { success: false, stage: 'oauth-read-code', error: 'Failed to read auth verification code' };
  }

  await chrome.tabs.update(chatTabId, { active: true });
  await waitForTabComplete(chatTabId, timeout);
  await sendPageAction(chatTabId, 'fillAuthCode', {
    code: verificationCode,
    selector: config.authSelectors.authCodeInputSelector,
    timeout
  });

  const continueResult = await advanceThroughContinueSteps(chatTabId, {
    stage: 'oauth-submit-code',
    selector: config.authSelectors.authContinueButtonSelector,
    redirectUri: config.oauth.redirectUri,
    timeout,
    clickOptions: { delayBeforeClick: 1000 },
    tryAgainTimeout: 3000,
    maxRounds: 8
  });

  if (continueResult.status === 'callback' || continueResult.status === 'continue-missing') {
    return { success: true };
  }

  return {
    success: false,
    stage: 'oauth-submit-code',
    error: continueResult.error || `Unexpected continue advance status: ${continueResult.status}`
  };
}

async function requestHostPermission(origin) {
  if (!origin) {
    throw new Error('Missing origin');
  }

  const origins = [`${origin}/*`];
  const permissionsApi = chrome.permissions;
  if (!permissionsApi || typeof permissionsApi.contains !== 'function' || typeof permissionsApi.request !== 'function') {
    throw new Error('permissions API unavailable');
  }

  const alreadyGranted = await permissionsApi.contains({ origins });
  if (alreadyGranted) {
    return { granted: true, alreadyGranted: true, origin };
  }

  const granted = await permissionsApi.request({ origins });
  return { granted, alreadyGranted: false, origin };
}

async function ensureProviderPermission(url) {
  const origin = new URL(url).origin;
  const permissionResult = await requestHostPermission(origin);
  if (!permissionResult.granted) {
    throw new Error(`Provider host permission denied: ${origin}`);
  }
  return true;
}

function generateRandomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(String(input || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function buildAuthorizationUrl({ clientId, redirectUri, codeVerifier, state }) {
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const url = new URL('https://auth.openai.com/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'openid profile email offline_access');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  return url.toString();
}

async function waitForCallbackUrl(tabId, redirectBase, timeout) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (isCallbackUrl(tab?.url, redirectBase)) {
      return tab.url;
    }
    await delay(500);
  }
  throw new Error(`Timeout waiting for callback URL: ${redirectBase}`);
}

function isCallbackUrl(url, redirectBase) {
  return Boolean(url && redirectBase && String(url).startsWith(redirectBase));
}

async function handleAuthCallback(callbackUrl, config, expectedState) {
  const callback = parseCallbackUrl(callbackUrl);
  if (!callback) {
    throw new Error('Failed to parse callback URL');
  }
  if (callback.error) {
    const description = callback.error_description || '';
    throw new Error(`oauth error: ${callback.error}${description ? `: ${description}` : ''}`);
  }
  if (!callback.code) {
    throw new Error('Callback URL does not contain authorization code');
  }
  if (!callback.state) {
    throw new Error('Callback URL does not contain state');
  }
  if (callback.state !== expectedState) {
    throw new Error('Callback state mismatch');
  }

  const tokenResult = await exchangeToken({
    tokenUrl: config.oauth.tokenUrl,
    clientId: config.oauth.clientId,
    code: callback.code,
    redirectUri: config.oauth.redirectUri,
    codeVerifier: config.oauth.codeVerifier
  });

  return { callback, tokenResult };
}

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

function normalizeDownloadFolder(folder) {
  return String(folder || '')
    .trim()
    .replace(/\\+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.\.(\/|$)/g, '');
}

function sanitizeEmailFilename(email) {
  const normalized = String(email || '')
    .replace(/@/g, '_')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'auth_result';
}

function buildAuthResultFilename(email) {
  return `${sanitizeEmailFilename(email)}.json`;
}

async function exportAuthResult({ email, username, birthday, callback, tokenResult, providerId, providerName, config }) {
  const exportFile = buildAuthResultExportFile({
    email,
    username,
    birthday,
    callback,
    tokenResult,
    providerId,
    providerName
  });

  const saveResult = await saveAuthResultFile({ exportFile, config });
  const uploadResult = await uploadAuthResultFile({ exportFile, config });
  const exportError = saveResult.saveWarning || uploadResult.uploadWarning || '';

  return {
    stage: uploadResult.uploadWarning ? 'upload-file' : (saveResult.saveWarning ? 'save-file' : 'completed'),
    error: exportError,
    ...saveResult,
    ...uploadResult
  };
}

function formatUtcRfc3339(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function buildAuthResultExportPayload({ tokenResult }) {
  const accessToken = String(tokenResult?.access_token || '').trim();
  const refreshToken = String(tokenResult?.refresh_token || '').trim();
  const idToken = String(tokenResult?.id_token || '').trim();
  const expiresIn = Math.max(parseInt(tokenResult?.expires_in, 10) || 0, 0);
  const claims = idToken ? parseJwtClaims(idToken) : {};
  const authClaims = claims?.['https://api.openai.com/auth'] || {};
  const email = String(claims?.email || '').trim();
  const accountId = String(authClaims?.chatgpt_account_id || '').trim();
  const now = new Date();
  const expiredAt = new Date(now.getTime() + expiresIn * 1000);

  return {
    id_token: idToken,
    access_token: accessToken,
    refresh_token: refreshToken,
    account_id: accountId,
    last_refresh: formatUtcRfc3339(now),
    email,
    type: 'codex',
    expired: formatUtcRfc3339(expiredAt)
  };
}

function buildAuthResultExportFile({ email, username, birthday, callback, tokenResult, providerId, providerName }) {
  const payload = buildAuthResultExportPayload({ tokenResult });
  const fileName = buildAuthResultFilename(payload.email || email);
  const jsonText = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonText], { type: 'application/json' });
  return { payload, fileName, jsonText, blob };
}

async function saveAuthResultFile({ exportFile, config }) {
  if (!chrome.downloads?.download) {
    return { savedFilePath: '', saveWarning: 'downloads API unavailable' };
  }

  const resultSave = config?.resultSave || {};
  const folder = normalizeDownloadFolder(resultSave.folder || '');
  const relativePath = folder ? `${folder}/${exportFile.fileName}` : exportFile.fileName;
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(exportFile.jsonText)}`;

  try {
    await chrome.downloads.download({
      url,
      filename: relativePath,
      conflictAction: resultSave.conflictAction || 'uniquify',
      saveAs: false
    });
    return { savedFilePath: relativePath, saveWarning: '' };
  } catch (error) {
    console.warn('[AutoReg BG] saveAuthResultFile:error', {
      email: exportFile.payload.email,
      relativePath,
      message: error?.message || String(error)
    });
    return {
      savedFilePath: '',
      saveWarning: error?.message || 'Failed to save auth result file'
    };
  }
}

async function uploadAuthResultFile({ exportFile, config }) {
  const uploadConfig = config?.resultSave?.upload || {};
  if (!uploadConfig.enabled) {
    return { uploadSuccess: false, uploadedFileName: '', uploadWarning: '' };
  }

  if (!uploadConfig.url || !uploadConfig.apiToken) {
    return {
      uploadSuccess: false,
      uploadedFileName: '',
      uploadWarning: '上传已开启，但管理地址或 Token 未填写完整'
    };
  }

  const timeoutSeconds = Math.max(parseInt(uploadConfig.timeoutSeconds, 10) || 30, 1);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const formData = new FormData();
  const uploadFile = new File([exportFile.blob], exportFile.fileName, { type: 'application/json' });
  formData.append('file', uploadFile);

  try {
    const response = await fetch(uploadConfig.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${uploadConfig.apiToken}`
      },
      body: formData,
      signal: controller.signal
    });

    if (response.status === 200 || response.status === 201) {
      return {
        uploadSuccess: true,
        uploadedFileName: exportFile.fileName,
        uploadWarning: ''
      };
    }

    const uploadWarning = await readUploadErrorMessage(response);
    console.warn('[AutoReg BG] uploadAuthResultFile:failed', {
      fileName: exportFile.fileName,
      status: response.status,
      warning: uploadWarning
    });
    return {
      uploadSuccess: false,
      uploadedFileName: '',
      uploadWarning
    };
  } catch (error) {
    const uploadWarning = error?.name === 'AbortError'
      ? `上传超时（${timeoutSeconds} 秒）`
      : (error?.message || 'Failed to upload auth result file');
    console.warn('[AutoReg BG] uploadAuthResultFile:error', {
      fileName: exportFile.fileName,
      message: uploadWarning
    });
    return {
      uploadSuccess: false,
      uploadedFileName: '',
      uploadWarning
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readUploadErrorMessage(response) {
  try {
    const data = await response.clone().json();
    if (typeof data === 'string') {
      return `上传失败 (${response.status}): ${data}`;
    }
    return `上传失败 (${response.status}): ${JSON.stringify(data)}`;
  } catch {}

  try {
    const text = await response.text();
    return text ? `上传失败 (${response.status}): ${text}` : `上传失败 (${response.status})`;
  } catch {
    return `上传失败 (${response.status})`;
  }
}

function parseJwtClaims(token) {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(atob(payload).split('').map((c) =>
      '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    ).join(''));
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function exchangeToken({ tokenUrl, clientId, code, redirectUri, codeVerifier }) {
  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier
    })
  });

  if (!resp.ok) {
    const errorDetail = await readTokenExchangeError(resp);
    throw new Error(errorDetail);
  }

  const data = await resp.json();
  return {
    ...data,
    id_token_claims: data.id_token ? parseJwtClaims(data.id_token) : null,
    access_token_claims: data.access_token ? parseJwtClaims(data.access_token) : null
  };
}

async function readTokenExchangeError(resp) {
  try {
    const data = await resp.clone().json();
    if (typeof data === 'string') {
      return `Token exchange failed: ${resp.status} - ${data}`;
    }
    return `Token exchange failed: ${resp.status} - ${JSON.stringify(data)}`;
  } catch {}

  try {
    const text = await resp.text();
    return text ? `Token exchange failed: ${resp.status} - ${text}` : `Token exchange failed: ${resp.status}`;
  } catch {
    return `Token exchange failed: ${resp.status}`;
  }
}

async function waitForTabComplete(tabId, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.status === 'complete') {
      return tab;
    }
    await delay(300);
  }
  throw new Error(`Timeout waiting for tab complete: ${tabId}`);
}

async function tryPageAction(tabId, type, payload = {}, options = {}) {
  const { suppressError = true, label = type } = options;
  try {
    const result = await sendPageAction(tabId, type, payload);
    debugLog('tryPageAction:success', { tabId, type, label });
    return result;
  } catch (error) {
    debugLog('tryPageAction:error', {
      tabId,
      type,
      label,
      suppressError,
      message: error?.message || String(error)
    });
    if (!suppressError) {
      throw error;
    }
    return null;
  }
}

async function waitForPageAction(tabId, type, payload = {}, timeout = 15000) {
  const startedAt = Date.now();
  let lastError = null;
  debugLog('waitForPageAction:start', { tabId, type, timeout, payload });

  while (Date.now() - startedAt < timeout) {
    try {
      const result = await sendPageAction(tabId, type, {
        ...payload,
        timeout: Math.min(payload.timeout || timeout, 4000)
      });
      debugLog('waitForPageAction:success', { tabId, type });
      return result;
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      debugLog('waitForPageAction:error', { tabId, type, message });
      if (!isRetryableMessagingError(message) && !message.toLowerCase().includes('wait timeout for selector')) {
        throw error;
      }
      await waitForTabComplete(tabId, 4000).catch(() => null);
      await ensureContentScriptsInjected(tabId).catch(() => null);
      await delay(500);
    }
  }

  debugLog('waitForPageAction:timeout', {
    tabId,
    type,
    lastError: lastError?.message || null
  });
  throw lastError || new Error(`Timeout waiting for page action: ${type}`);
}

function isRetryableMessagingError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('receiving end does not exist')
    || normalized.includes('could not establish connection')
    || normalized.includes('frame with id 0 was removed')
    || normalized.includes('tab was closed')
    || normalized.includes('message channel is closed')
    || normalized.includes('extension port is moved into back/forward cache')
    || normalized.includes('back/forward cache')
    || normalized.includes('message channel closed before a response was received')
    || normalized.includes('listener indicated an asynchronous response');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateUsername() {
  const firstNames = [
    'James', 'William', 'Henry', 'Lucas', 'Ethan', 'Noah', 'Oliver', 'Jack', 'Daniel', 'Samuel',
    'Benjamin', 'Leo', 'Nathan', 'Owen', 'Julian', 'Caleb', 'Adrian', 'Isaac', 'Miles', 'Thomas',
    'Emma', 'Olivia', 'Sophia', 'Ava', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn', 'Abigail',
    'Ella', 'Grace', 'Lily', 'Hannah', 'Nora', 'Zoe', 'Lucy', 'Alice', 'Clara', 'Ruby'
  ];
  const lastNames = [
    'Smith', 'Johnson', 'Brown', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin',
    'Thompson', 'Garcia', 'Martinez', 'Robinson', 'Clark', 'Lewis', 'Walker', 'Hall', 'Allen', 'Young',
    'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson', 'Carter', 'Mitchell', 'Perez'
  ];

  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const useLastName = Math.random() < 0.7;

  if (!useLastName) {
    return firstName;
  }

  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  return `${firstName} ${lastName}`;
}

function generateBirthday() {
  const year = 1990 + Math.floor(Math.random() * 10);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
