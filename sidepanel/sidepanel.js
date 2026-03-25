const ConfigLib = window.AutoRegisterConfig;
const PANEL_CONFIG_VERSION = ConfigLib.CONFIG_VERSION;
const SECTION_STATE_STORAGE_KEY = 'sidePanelCollapsedSections';
const DEFAULT_COLLAPSED_SECTIONS = {
  'site-permissions': false,
  'basic-settings': false,
  'chat-selectors': true,
  'auth-selectors': true,
  'pre-logout-steps': true,
  'post-registration': true,
  'post-auth-steps': true,
  'mail-providers': true,
  'oauth-config': true,
  'result-save': true,
  'recent-results': true
};

const panelState = {
  saveTimer: null,
  statusTimer: null,
  loadingConfig: false,
  config: ConfigLib.getDefaultConfig(),
  tabContext: null,
  captureTarget: null,
  initialized: false,
  collapsedSections: { ...DEFAULT_COLLAPSED_SECTIONS }
};

document.addEventListener('DOMContentLoaded', async () => {
  buildSelectorSections();
  bindPanelEvents();
  await loadSectionCollapseState();
  await loadConfigWithMigration();
  await refreshTabContext();
  setupRuntimeListeners();
  panelState.initialized = true;
});

function buildSelectorSections() {
  document.getElementById('chatSelectorGrid').innerHTML = ConfigLib.CHAT_SELECTOR_FIELDS
    .map(([id, label]) => buildSelectorField(id, label, 'chat'))
    .join('');

  document.getElementById('authSelectorGrid').innerHTML = ConfigLib.AUTH_SELECTOR_FIELDS
    .map(([id, label]) => buildSelectorField(id, label, 'auth'))
    .join('');
}

function buildSelectorField(id, label, host) {
  return `
    <div class="sidepanel-selector-item">
      <label for="${id}">${label}</label>
      <div class="sidepanel-selector-control">
        <input type="text" id="${id}">
        <div class="sidepanel-mini-actions">
          <button class="btn-capture" type="button" data-target="${id}" data-host="${host}" title="捕获">🎯</button>
          <button class="btn-test" type="button" data-target="${id}" data-host="${host}" title="测试">🧪</button>
        </div>
      </div>
    </div>
  `;
}

function bindPanelEvents() {
  document.getElementById('btnSave').addEventListener('click', async () => {
    await saveConfig();
    showStatus('✅ 配置已保存', 'success');
  });

  document.getElementById('btnReset').addEventListener('click', async () => {
    populateForm(ConfigLib.getDefaultConfig());
    await saveConfig();
    showStatus('🔄 已重置为默认值', 'info');
  });

  document.getElementById('btnStart').addEventListener('click', async () => {
    await saveConfig();
    showStatus('🚀 正在启动...', 'loading', 0);
    try {
      const config = collectForm();
      await chrome.runtime.sendMessage({ action: 'startRegistration', config });
      showStatus('✅ 任务已启动', 'success');
    } catch (error) {
      showStatus(`❌ 启动失败：${error.message}`, 'error', 5000);
    }
  });

  document.getElementById('btnExport').addEventListener('click', exportConfig);
  document.getElementById('btnImport').addEventListener('click', importConfig);
  document.getElementById('btnClearRecentResults').addEventListener('click', clearRecentResults);
  document.getElementById('btnAuthorizeCurrentHost').addEventListener('click', authorizeCurrentHost);
  document.getElementById('btnAddProvider').addEventListener('click', addProvider);
  document.getElementById('btnCloneProvider').addEventListener('click', cloneSelectedProvider);
  document.getElementById('btnDeleteProvider').addEventListener('click', deleteSelectedProvider);
  document.getElementById('btnAddPreLogoutStep').addEventListener('click', () => addUiStep('preLogoutCloseSteps'));
  document.getElementById('btnAddPostStep').addEventListener('click', () => addUiStep('postRegistrationSteps'));
  document.getElementById('btnAddPostAuthStep').addEventListener('click', () => addUiStep('postAuthSteps'));
  document.getElementById('selectedMailProviderId').addEventListener('change', () => {
    renderProviderSummary();
    renderMailProviders();
  });

  document.addEventListener('click', async (event) => {
    const sectionToggle = event.target.closest('[data-action="toggle-section"]');
    if (sectionToggle) {
      await toggleSection(sectionToggle.dataset.sectionId);
      return;
    }

    const captureButton = event.target.closest('.btn-capture');
    if (captureButton) {
      if (captureButton.dataset.targetProvider) {
        return;
      }
      await startSelectorCapture(captureButton.dataset.target, captureButton.dataset.host || 'chat');
      return;
    }

    const testButton = event.target.closest('.btn-test');
    if (testButton) {
      if (testButton.dataset.targetProvider) {
        return;
      }
      const input = document.getElementById(testButton.dataset.target);
      if (input) {
        await testSelector(input.value, testButton.dataset.host || 'chat');
      }
      return;
    }

    const deleteStepButton = event.target.closest('[data-action="delete-step"]');
    if (deleteStepButton) {
      removeUiStep(deleteStepButton.dataset.stepGroup, Number(deleteStepButton.dataset.index));
    }
  });

  document.addEventListener('input', (event) => {
    if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement)) {
      return;
    }
    clearTimeout(panelState.saveTimer);
    panelState.saveTimer = setTimeout(async () => {
      await saveConfig();
      showStatus('💾 自动保存', 'success', 1500);
    }, 800);
  });
}

async function loadSectionCollapseState() {
  const result = await chrome.storage.local.get(SECTION_STATE_STORAGE_KEY);
  panelState.collapsedSections = {
    ...DEFAULT_COLLAPSED_SECTIONS,
    ...(result?.[SECTION_STATE_STORAGE_KEY] || {})
  };
  applySectionCollapseState();
}

async function persistSectionCollapseState() {
  await chrome.storage.local.set({
    [SECTION_STATE_STORAGE_KEY]: panelState.collapsedSections
  });
}

function applySectionCollapseState() {
  document.querySelectorAll('.sidepanel-section[data-section-id]').forEach((section) => {
    const sectionId = section.dataset.sectionId;
    const collapsed = Boolean(panelState.collapsedSections[sectionId]);
    const toggle = section.querySelector('[data-action="toggle-section"]');
    section.classList.toggle('is-collapsed', collapsed);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('title', collapsed ? '展开此分组' : '收起此分组');
    }
  });
}

async function toggleSection(sectionId) {
  if (!sectionId) return;
  panelState.collapsedSections[sectionId] = !panelState.collapsedSections[sectionId];
  applySectionCollapseState();
  await persistSectionCollapseState();
}

function setupRuntimeListeners() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'captureResult') {
      applyCaptureResult(msg);
      return false;
    }

    if (msg.action === 'activeTabContextChanged') {
      panelState.tabContext = msg.context || null;
      renderHostSummary();
      return false;
    }

    if (msg.action === 'sidePanelUnsupported') {
      panelState.tabContext = msg.context || null;
      renderHostSummary();
      showStatus('⚠️ 当前页面不支持页面能力', 'warning', 3000);
      return false;
    }

    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.autoRegisterConfig?.newValue) {
      populateForm(changes.autoRegisterConfig.newValue);
      refreshTabContext().catch(() => null);
    } else if (changes.recentRunResults?.newValue) {
      panelState.config.recentResults = ConfigLib.truncateResults(changes.recentRunResults.newValue);
      renderRecentResults();
    }

    if (changes[SECTION_STATE_STORAGE_KEY]?.newValue) {
      panelState.collapsedSections = {
        ...DEFAULT_COLLAPSED_SECTIONS,
        ...changes[SECTION_STATE_STORAGE_KEY].newValue
      };
      applySectionCollapseState();
    }
  });
}

async function loadConfigWithMigration() {
  if (panelState.loadingConfig) return;
  panelState.loadingConfig = true;
  try {
    const result = await chrome.storage.local.get(['autoRegisterConfig', 'configVersion', 'recentRunResults']);
    const config = ConfigLib.migrateConfig(result.autoRegisterConfig, result.configVersion);
    if (Array.isArray(result.recentRunResults) && result.recentRunResults.length) {
      config.recentResults = ConfigLib.truncateResults(result.recentRunResults);
    }
    panelState.config = config;
    await chrome.storage.local.set({
      autoRegisterConfig: config,
      configVersion: PANEL_CONFIG_VERSION
    });
    populateForm(config);
  } finally {
    panelState.loadingConfig = false;
  }
}

function populateForm(config) {
  panelState.config = ConfigLib.ensureSelectedMailProvider(config);
  applySectionCollapseState();

  Object.entries(panelState.config.chatSelectors || {}).forEach(([key, value]) => {
    const input = document.getElementById(key);
    if (input) input.value = value;
  });

  Object.entries(panelState.config.authSelectors || {}).forEach(([key, value]) => {
    const input = document.getElementById(key);
    if (input) input.value = value;
  });

  document.getElementById('runCount').value = panelState.config.runCount || 1;
  document.getElementById('defaultTimeout').value = panelState.config.timeout || 30;
  document.getElementById('tokenUrl').value = panelState.config.oauth?.tokenUrl || '';
  document.getElementById('clientId').value = panelState.config.oauth?.clientId || '';
  document.getElementById('codeVerifier').value = panelState.config.oauth?.codeVerifier || '';
  document.getElementById('redirectUri').value = panelState.config.oauth?.redirectUri || '';
  document.getElementById('resultSaveFolder').value = panelState.config.resultSave?.folder || '';
  document.getElementById('resultUploadEnabled').checked = Boolean(panelState.config.resultSave?.upload?.enabled);
  document.getElementById('resultUploadUrl').value = panelState.config.resultSave?.upload?.url || '';
  document.getElementById('resultUploadToken').value = panelState.config.resultSave?.upload?.apiToken || '';
  document.getElementById('resultUploadTimeout').value = panelState.config.resultSave?.upload?.timeoutSeconds || 30;
  document.getElementById('versionDisplay').textContent = `v${panelState.config.version || PANEL_CONFIG_VERSION}`;
  document.getElementById('configVersion').textContent = `v${panelState.config.version || PANEL_CONFIG_VERSION}`;

  renderProviderSelect();
  renderProviderSummary();
  renderMailProviders();
  renderUiSteps('preLogoutCloseSteps', 'preLogoutCloseSteps');
  renderUiSteps('postRegistrationSteps', 'postRegistrationSteps');
  renderUiSteps('postAuthSteps', 'postAuthSteps');
  renderRecentResults();
  renderHostSummary();
}

function collectForm() {
  const config = ConfigLib.ensureSelectedMailProvider({
    ...panelState.config,
    runCount: parseInt(document.getElementById('runCount').value, 10) || 1,
    timeout: parseInt(document.getElementById('defaultTimeout').value, 10) || 30,
    chatSelectors: collectSelectorGroup(ConfigLib.CHAT_SELECTOR_FIELDS),
    authSelectors: collectSelectorGroup(ConfigLib.AUTH_SELECTOR_FIELDS),
    mailProviders: collectProviderEditors(),
    preLogoutCloseSteps: collectUiSteps('preLogoutCloseSteps'),
    postRegistrationSteps: collectUiSteps('postRegistrationSteps'),
    postAuthSteps: collectUiSteps('postAuthSteps'),
    oauth: {
      tokenUrl: document.getElementById('tokenUrl').value,
      clientId: document.getElementById('clientId').value,
      codeVerifier: document.getElementById('codeVerifier').value,
      redirectUri: document.getElementById('redirectUri').value
    },
    resultSave: {
      folder: normalizeDownloadFolder(document.getElementById('resultSaveFolder').value),
      conflictAction: panelState.config.resultSave?.conflictAction || 'uniquify',
      upload: {
        enabled: Boolean(document.getElementById('resultUploadEnabled').checked),
        url: document.getElementById('resultUploadUrl').value.trim(),
        apiToken: document.getElementById('resultUploadToken').value.trim(),
        timeoutSeconds: Math.max(parseInt(document.getElementById('resultUploadTimeout').value, 10) || 30, 1)
      }
    },
    recentResults: panelState.config.recentResults || [],
    version: PANEL_CONFIG_VERSION
  });

  config.selectedMailProviderId = document.getElementById('selectedMailProviderId').value || config.selectedMailProviderId;
  panelState.config = ConfigLib.ensureSelectedMailProvider(config);
  return panelState.config;
}

function collectSelectorGroup(fields) {
  return fields.reduce((acc, [id]) => {
    acc[id] = document.getElementById(id)?.value || '';
    return acc;
  }, {});
}

function collectProviderEditors() {
  const providerCards = Array.from(document.querySelectorAll('.sidepanel-provider-card'));
  return providerCards.map((card, index) => ConfigLib.createMailProvider({
    id: card.dataset.providerId || `mail-provider-${index + 1}`,
    name: card.querySelector('[data-field="name"]')?.value || `Provider ${index + 1}`,
    url: card.querySelector('[data-field="url"]')?.value || 'https://mail.chatgpt.org.uk/',
    selectors: ConfigLib.MAIL_SELECTOR_FIELDS.reduce((selectors, [field]) => {
      selectors[field] = card.querySelector(`[data-selector-field="${field}"]`)?.value || '';
      return selectors;
    }, {})
  }));
}

function collectUiSteps(containerId) {
  const stepRows = Array.from(document.querySelectorAll(`#${CSS.escape(containerId)} .sidepanel-step-row`));
  return stepRows.map((row) => ({
    selector: row.querySelector('[data-field="selector"]')?.value || '',
    delayBeforeClick: parseInt(row.querySelector('[data-field="delayBeforeClick"]')?.value, 10) || 0,
    waitForChange: Boolean(row.querySelector('[data-field="waitForChange"]')?.checked)
  })).filter((step) => step.selector);
}

async function saveConfig() {
  const config = collectForm();
  await chrome.storage.local.set({
    autoRegisterConfig: config,
    configVersion: PANEL_CONFIG_VERSION
  });
  document.getElementById('versionDisplay').textContent = `v${config.version}`;
  document.getElementById('configVersion').textContent = `v${config.version}`;
}

function renderProviderSelect() {
  const select = document.getElementById('selectedMailProviderId');
  select.innerHTML = '';
  panelState.config.mailProviders.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.name;
    select.appendChild(option);
  });
  select.value = panelState.config.selectedMailProviderId;
}

function renderProviderSummary() {
  const selected = ConfigLib.getSelectedMailProvider(panelState.config);
  document.getElementById('selectedProviderUrl').textContent = selected?.url || '-';
  document.getElementById('providerCount').textContent = String(panelState.config.mailProviders.length || 0);
}

function renderMailProviders() {
  const container = document.getElementById('mailProviders');
  const selectedId = panelState.config.selectedMailProviderId;
  container.innerHTML = panelState.config.mailProviders.map((provider) => `
    <div class="sidepanel-provider-card ${provider.id === selectedId ? 'is-selected' : ''}" data-provider-id="${provider.id}">
      <div class="sidepanel-field sidepanel-field--stacked">
        <label>名称</label>
        <input type="text" data-field="name" value="${escapeHtml(provider.name)}">
      </div>
      <div class="sidepanel-field sidepanel-field--stacked">
        <label>URL</label>
        <input type="text" data-field="url" value="${escapeHtml(provider.url)}">
      </div>
      <div class="sidepanel-selector-grid">
        ${ConfigLib.MAIL_SELECTOR_FIELDS.map(([field, label]) => `
          <div class="sidepanel-selector-item">
            <label>${label}</label>
            <div class="sidepanel-selector-control">
              <input type="text" data-selector-field="${field}" value="${escapeHtml(provider.selectors?.[field] || '')}">
              <div class="sidepanel-mini-actions">
                <button class="btn-capture" type="button" data-target-provider="${provider.id}" data-target="${field}" data-host="provider" title="捕获">🎯</button>
                <button class="btn-test" type="button" data-target-provider="${provider.id}" data-target="${field}" data-host="provider" title="测试">🧪</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-capture').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('.sidepanel-provider-card');
      const input = card?.querySelector(`[data-selector-field="${button.dataset.target}"]`);
      if (!input) return;
      const targetKey = `${button.dataset.target}__provider__${button.dataset.targetProvider}`;
      panelState.captureTarget = { mode: 'provider', providerId: button.dataset.targetProvider, field: button.dataset.target };
      input.dataset.captureKey = targetKey;
      await startSelectorCapture(targetKey, 'provider');
      await saveConfig();
      input.removeAttribute('data-capture-key');
    });
  });

  container.querySelectorAll('.btn-test').forEach((button) => {
    button.addEventListener('click', async () => {
      const card = button.closest('.sidepanel-provider-card');
      const input = card?.querySelector(`[data-selector-field="${button.dataset.target}"]`);
      if (input) {
        await testSelector(input.value, 'provider');
      }
    });
  });
}

function renderUiSteps(groupKey, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = (panelState.config[groupKey] || []).map((step, index) => `
    <div class="sidepanel-step-row" data-index="${index}" data-step-group="${groupKey}">
      <div class="sidepanel-field sidepanel-field--stacked sidepanel-step-selector">
        <label>Selector</label>
        <input type="text" data-field="selector" value="${escapeHtml(step.selector || '')}">
      </div>
      <div class="sidepanel-field sidepanel-field--stacked sidepanel-step-delay">
        <label>延迟(ms)</label>
        <input type="number" data-field="delayBeforeClick" value="${step.delayBeforeClick || 0}">
      </div>
      <label class="sidepanel-checkbox">
        <input type="checkbox" data-field="waitForChange" ${step.waitForChange ? 'checked' : ''}>
        等待变化/关闭
      </label>
      <button type="button" data-action="delete-step" data-step-group="${groupKey}" data-index="${index}">删除</button>
    </div>
  `).join('');
}

function renderRecentResults() {
  const container = document.getElementById('recentResults');
  const results = panelState.config.recentResults || [];

  if (!results.length) {
    container.innerHTML = '<div class="sidepanel-result-empty">暂无结果</div>';
    return;
  }

  container.innerHTML = results.map((result) => `
    <div class="sidepanel-result-item ${result.success ? 'is-success' : 'is-error'}">
      <div><strong>${result.success ? '成功' : '失败'}</strong> · ${escapeHtml(result.email || '-')}</div>
      <div>进度：${escapeHtml(result.phase || result.stage || 'unknown')}</div>
      ${!result.success && result.error ? `<div>错误：${escapeHtml(result.error)}</div>` : ''}
      <div>Provider：${escapeHtml(result.providerName || '-')}</div>
      <div>时间：${escapeHtml(result.createdAt || '-')}</div>
      ${result.savedFilePath ? `<div>已保存：${escapeHtml(result.savedFilePath)}</div>` : ''}
      ${result.saveWarning ? `<div>保存提示：${escapeHtml(result.saveWarning)}</div>` : ''}
      ${result.uploadSuccess ? `<div>已上传：${escapeHtml(result.uploadedFileName || '-')}</div>` : ''}
      ${!result.uploadSuccess && result.uploadWarning ? `<div>上传提示：${escapeHtml(result.uploadWarning)}</div>` : ''}
    </div>
  `).join('');
}

function getAllowedHostsFromConfig(config = panelState.config) {
  const providerHosts = (config.mailProviders || [])
    .map((provider) => safeHostname(provider.url))
    .filter(Boolean);
  return ['chatgpt.com', 'auth.openai.com', safeHostname(config.oauth?.redirectUri), ...providerHosts].filter(Boolean);
}

function getExpectedHostPattern(hostKey) {
  if (hostKey === 'chat') return 'chatgpt.com';
  if (hostKey === 'auth') return 'auth.openai.com';
  if (hostKey === 'provider') {
    return (panelState.config.mailProviders || []).map((provider) => safeHostname(provider.url)).filter(Boolean).join(' / ') || '已配置的 provider 域名';
  }
  return getAllowedHostsFromConfig().join(' / ');
}

function canUseHost(hostKey) {
  const context = panelState.tabContext;
  if (!context?.supported) return false;
  if (hostKey === 'chat') return context.kind === 'chat';
  if (hostKey === 'auth') return context.kind === 'auth';
  if (hostKey === 'provider') return context.kind === 'provider';
  return context.supported;
}

function renderHostSummary() {
  const allowedHosts = getAllowedHostsFromConfig();
  const context = panelState.tabContext;
  const currentUrl = context?.url || '未检测到活动标签页';
  const currentHost = context?.hostname || 'unknown';
  const statusText = context?.supported
    ? `已识别为 ${context.kind || 'supported'} 页面，可使用页面能力。`
    : '当前页面不受支持，无法进行 selector 测试与捕获。';

  document.getElementById('currentHostSummary').textContent = `${currentHost} · ${currentUrl}`;
  document.getElementById('currentHostStatus').textContent = statusText;
  document.getElementById('allowedHostList').innerHTML = allowedHosts
    .map((host) => `<span class="sidepanel-chip ${host === currentHost ? 'is-active' : ''}">${escapeHtml(host)}</span>`)
    .join('');

  const unsupported = !context?.supported;
  document.getElementById('unsupportedNotice').hidden = !unsupported;
  document.getElementById('panelContent').classList.toggle('is-disabled', unsupported);
}

async function authorizeCurrentHost() {
  try {
    const context = await refreshTabContext();
    if (!context?.url) {
      throw new Error('未找到当前页面');
    }
    const origin = new URL(context.url).origin;
    const response = await chrome.runtime.sendMessage({ action: 'requestHostPermission', origin });
    if (!response?.ok) {
      throw new Error(response?.error || '权限请求失败');
    }
    if (response.alreadyGranted) {
      showStatus('✅ 当前域名已授权', 'success');
      return;
    }
    if (!response.granted) {
      showStatus('⚠️ 用户取消了域名授权', 'warning', 4000);
      return;
    }
    showStatus('✅ 域名授权成功', 'success');
    await refreshTabContext();
  } catch (error) {
    showStatus(`❌ 授权失败：${error.message}`, 'error', 5000);
  }
}

async function startSelectorCapture(targetId, host) {
  const urlPattern = getExpectedHostPattern(host);
  const context = await refreshTabContext();
  if (!context?.supported || !canUseHost(host)) {
    showStatus(`⚠️ 请先打开 ${urlPattern} 页面`, 'error', 4000);
    return;
  }

  panelState.captureTarget = panelState.captureTarget || { mode: 'field', targetId };
  showStatus('🎯 请点击页面中的目标元素...', 'loading', 0);
  const response = await chrome.runtime.sendMessage({ action: 'panelStartCapture', targetId, host });
  if (!response?.ok) {
    panelState.captureTarget = null;
    showStatus(`❌ 捕获启动失败：${response?.error || '未知错误'}`, 'error', 4000);
  }
}

async function testSelector(selector, host) {
  const urlPattern = getExpectedHostPattern(host);
  const context = await refreshTabContext();
  if (!context?.supported || !canUseHost(host)) {
    showStatus(`⚠️ 请先打开 ${urlPattern} 页面`, 'error', 4000);
    return;
  }

  if (!selector) {
    showStatus('⚠️ 请选择要测试的 selector', 'warning', 3000);
    return;
  }

  showStatus(`🔍 测试：${selector}`, 'info', 3000);
  try {
    const response = await chrome.runtime.sendMessage({ action: 'panelTestSelector', selector, host, timeout: 5000 });
    if (!response?.ok) {
      throw new Error(response?.error || '测试失败');
    }

    if (response.found) {
      showStatus(`✅ 找到元素：<${response.tagName || 'unknown'}>`, 'success', 3000);
    } else {
      showStatus(`❌ 未找到元素${response.error ? `：${response.error}` : ''}`, 'error', 4000);
    }
  } catch (error) {
    showStatus(`❌ 测试失败：${error.message}`, 'error', 4000);
  }
}

function applyCaptureResult(msg) {
  const selector = msg.selector || '';
  if (!selector) {
    showStatus('❌ 未收到有效 selector', 'error', 4000);
    panelState.captureTarget = null;
    return;
  }

  if (panelState.captureTarget?.mode === 'provider') {
    const input = document.querySelector(`[data-capture-key="${CSS.escape(msg.targetId)}"]`);
    if (input) {
      input.value = selector;
    }
  } else {
    const fieldId = panelState.captureTarget?.targetId || msg.targetId;
    const input = document.getElementById(fieldId);
    if (input) {
      input.value = selector;
    }
  }

  panelState.captureTarget = null;
  saveConfig().catch(() => null);
  showStatus(`✅ 已捕获：${selector}`, 'success', 3000);
}

function addProvider() {
  const next = ConfigLib.createMailProvider({
    id: `mail-provider-${Date.now()}`,
    name: `Provider ${panelState.config.mailProviders.length + 1}`,
    url: 'https://'
  });
  panelState.config.mailProviders.push(next);
  panelState.config.selectedMailProviderId = next.id;
  populateForm(panelState.config);
}

function cloneSelectedProvider() {
  const current = ConfigLib.getSelectedMailProvider(collectForm());
  const clone = ConfigLib.createMailProvider({
    ...current,
    id: `${current.id}-${Date.now()}`,
    name: `${current.name} Copy`
  });
  panelState.config.mailProviders.push(clone);
  panelState.config.selectedMailProviderId = clone.id;
  populateForm(panelState.config);
}

function deleteSelectedProvider() {
  if ((panelState.config.mailProviders || []).length <= 1) {
    showStatus('⚠️ 至少保留一个 provider', 'warning', 3000);
    return;
  }
  panelState.config.mailProviders = panelState.config.mailProviders.filter((provider) => provider.id !== panelState.config.selectedMailProviderId);
  panelState.config.selectedMailProviderId = panelState.config.mailProviders[0]?.id;
  populateForm(panelState.config);
}

function addUiStep(groupKey) {
  panelState.config[groupKey] = panelState.config[groupKey] || [];
  panelState.config[groupKey].push({ selector: '', delayBeforeClick: 1000, waitForChange: false });
  renderUiSteps(groupKey, groupKey);
}

function removeUiStep(groupKey, index) {
  panelState.config[groupKey] = panelState.config[groupKey] || [];
  panelState.config[groupKey].splice(index, 1);
  renderUiSteps(groupKey, groupKey);
}

function exportConfig() {
  const config = collectForm();
  config.exportedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chatgpt-config-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showStatus('📤 配置已导出', 'success', 3000);
}

function importConfig() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (event) => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const imported = JSON.parse(text);
      const migrated = ConfigLib.migrateConfig(imported, imported.version);
      await chrome.storage.local.set({
        autoRegisterConfig: migrated,
        configVersion: PANEL_CONFIG_VERSION
      });
      populateForm(migrated);
      showStatus('📥 配置已导入', 'success', 3000);
    } catch (error) {
      showStatus(`❌ 导入失败：${error.message}`, 'error', 5000);
    }
  };
  input.click();
}

async function clearRecentResults() {
  panelState.config.recentResults = [];
  await chrome.storage.local.set({
    recentRunResults: [],
    autoRegisterConfig: {
      ...panelState.config,
      recentResults: []
    },
    configVersion: PANEL_CONFIG_VERSION
  });
  renderRecentResults();
  showStatus('🧹 最近运行结果已清空', 'success', 2000);
}

async function refreshTabContext() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getActiveTabContext', config: collectForm() });
    if (response?.ok) {
      panelState.tabContext = response.context || null;
      renderHostSummary();
      return panelState.tabContext;
    }
  } catch {}
  renderHostSummary();
  return panelState.tabContext;
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function normalizeDownloadFolder(value) {
  return String(value || '')
    .trim()
    .replace(/\\+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.\.(\/|$)/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showStatus(message, type = 'info', duration = 3000) {
  const status = document.getElementById('status');
  const icon = status.querySelector('.status-icon');
  const text = status.querySelector('.status-text');
  const icons = {
    success: '✅',
    error: '❌',
    info: 'ℹ️',
    warning: '⚠️',
    loading: '⏳'
  };

  clearTimeout(panelState.statusTimer);
  icon.textContent = icons[type] || icons.info;
  text.textContent = message;
  status.className = 'sidepanel-status';
  status.classList.add(`sidepanel-status--${type === 'loading' ? 'info' : type}`);
  if (type === 'loading') {
    status.classList.add('is-animating');
  }

  if (duration > 0 && type !== 'loading') {
    panelState.statusTimer = setTimeout(() => {
      hideStatus();
    }, duration);
  }
}

function hideStatus() {
  const status = document.getElementById('status');
  status.className = 'sidepanel-status sidepanel-status--info';
  status.querySelector('.status-icon').textContent = 'ℹ️';
  status.querySelector('.status-text').textContent = '就绪';
}
