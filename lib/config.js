const CONFIG_VERSION = '3.2.0';
const DEFAULT_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const DEFAULT_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEFAULT_CODE_VERIFIER = 'KCg1VCgoDnTQGGq1eUAh9QTrFP11uBEpX_oTiVgKBzQ';
const DEFAULT_PASSWORD = 'Chatgpt@2026!';
const DEFAULT_HISTORY_LIMIT = 20;

const CHAT_SELECTOR_FIELDS = [
  ['selSignupBtn', '注册按钮'],
  ['selUserMenu', '用户头像/菜单'],
  ['selLogoutBtn', '退出登录按钮'],
  ['selLogoutConfirmBtn', '退出登录确认按钮'],
  ['selSwitchAccountModal', '切换账号弹窗'],
  ['selSwitchCloseBtn', '切换账号 - 关闭'],
  ['selLoginModal', '登录弹窗容器'],
  ['selLoginEmailInput', '登录邮箱输入']
];

const AUTH_SELECTOR_FIELDS = [
  ['selEmailInput', '邮箱输入框'],
  ['selEmailSubmit', '邮箱提交按钮'],
  ['selPasswordInput', '密码输入框'],
  ['selCodeInput', '验证码输入框'],
  ['selNameInput', '用户名输入框'],
  ['selBirthdayInput', '生日输入框'],
  ['selContinueBtn', 'Continue 按钮'],
  ['ghostContinueSelector', '注册后确认按钮'],
  ['authEmailInputSelector', 'OAuth 邮箱输入框'],
  ['authPasswordInputSelector', 'OAuth 密码输入框'],
  ['authCodeInputSelector', 'OAuth 验证码输入框'],
  ['authContinueButtonSelector', 'OAuth Continue 按钮'],
  ['authVerificationWaitSelector', 'OAuth 验证等待元素'],
  ['callbackWaitSelector', 'Callback 等待元素']
];

const MAIL_SELECTOR_FIELDS = [
  ['selGenEmailBtn', '生成随机邮箱'],
  ['selEmailDisplay', '邮箱显示元素'],
  ['selInboxAction', '收件箱操作'],
  ['selEmailList', '邮件列表容器'],
  ['selEmailSubject', '邮件主题']
];

function getDefaultChatSelectors() {
  return {
    selSignupBtn: 'button[data-testid="signup-button"]',
    selUserMenu: '.relative > div[data-testid="accounts-profile-button"]',
    selLogoutBtn: 'div[data-testid="log-out-menu-item"]',
    selLogoutConfirmBtn: 'button[data-testid="logout-confirm-button"]',
    selSwitchAccountModal: 'div[role="dialog"]',
    selSwitchCloseBtn: 'button[aria-label="Close"]',
    selLoginModal: 'div#modal-no-auth-login',
    selLoginEmailInput: 'div#modal-no-auth-login input#email'
  };
}

function getDefaultAuthSelectors() {
  return {
    selEmailInput: 'div#modal-no-auth-login input#email',
    selEmailSubmit: 'div#modal-no-auth-login button[type="submit"]',
    selPasswordInput: 'input[name="new-password"]',
    selCodeInput: 'form input[name="code"]',
    selNameInput: 'form input[name="name"]',
    selBirthdayInput: 'input[type="hidden"][name="birthday"]',
    selContinueBtn: 'button[data-dd-action-name="Continue"]',
    ghostContinueSelector: '.btn-ghost.btn-large.w-full',
    authEmailInputSelector: 'input#_r_1_-email',
    authPasswordInputSelector: 'input#_r_e_-current-password',
    authCodeInputSelector: 'input#_r_14_-code',
    authContinueButtonSelector: 'button[data-dd-action-name="Continue"]',
    authVerificationWaitSelector: 'input#_r_14_-code',
    callbackWaitSelector: 'main, body'
  };
}

function getDefaultMailSelectors() {
  return {
    selGenEmailBtn: 'button[title="Generate Random"]',
    selEmailDisplay: '#emailDisplay',
    selInboxAction: '.inbox-controls .inbox-actions > :first-child',
    selEmailList: '#emailList',
    selEmailSubject: 'div.subject'
  };
}

function createDefaultMailProvider() {
  return {
    id: 'mail-chatgpt-org-uk',
    name: 'mail.chatgpt.org.uk',
    url: 'https://mail.chatgpt.org.uk/',
    selectors: getDefaultMailSelectors()
  };
}

function getDefaultUiStep(selector = '', overrides = {}) {
  return {
    selector,
    delayBeforeClick: 1000,
    waitForChange: false,
    ...overrides
  };
}

function getDefaultPreLogoutCloseSteps() {
  return [
    getDefaultUiStep('button[data-testid="getting-started-button"]', { waitForChange: true })
  ];
}

function getDefaultPostRegistrationSteps(authSelectors = getDefaultAuthSelectors()) {
  return [
    getDefaultUiStep(authSelectors.ghostContinueSelector, { waitForChange: true }),
    getDefaultUiStep(authSelectors.ghostContinueSelector, { waitForChange: false })
  ];
}

function getDefaultPostAuthSteps() {
  return [];
}

function getDefaultConfig() {
  const defaultProvider = createDefaultMailProvider();
  return {
    runCount: 1,
    timeout: 30,
    selectedMailProviderId: defaultProvider.id,
    chatSelectors: getDefaultChatSelectors(),
    authSelectors: getDefaultAuthSelectors(),
    mailProviders: [defaultProvider],
    oauth: {
      tokenUrl: DEFAULT_TOKEN_URL,
      clientId: DEFAULT_CLIENT_ID,
      codeVerifier: DEFAULT_CODE_VERIFIER,
      redirectUri: DEFAULT_REDIRECT_URI
    },
    resultSave: {
      folder: 'auth-results',
      conflictAction: 'uniquify',
      upload: {
        enabled: false,
        url: '',
        apiToken: '',
        timeoutSeconds: 30
      }
    },
    preLogoutCloseSteps: getDefaultPreLogoutCloseSteps(),
    postRegistrationSteps: getDefaultPostRegistrationSteps(getDefaultAuthSelectors()),
    postAuthSteps: getDefaultPostAuthSteps(),
    recentResults: [],
    version: CONFIG_VERSION
  };
}

function compareVersions(v1, v2) {
  const a = String(v1 || '0.0.0').split('.').map(Number);
  const b = String(v2 || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return 1;
    if ((a[i] || 0) < (b[i] || 0)) return -1;
  }
  return 0;
}

function normalizeMailProviders(providers) {
  const defaults = getDefaultConfig().mailProviders;
  const fallback = defaults[0];
  const list = Array.isArray(providers) && providers.length ? providers : defaults;

  return list.map((provider, index) => {
    const safeId = provider?.id || `mail-provider-${index + 1}`;
    return {
      id: safeId,
      name: provider?.name || `Provider ${index + 1}`,
      url: provider?.url || fallback.url,
      selectors: {
        ...getDefaultMailSelectors(),
        ...(provider?.selectors || {})
      }
    };
  });
}

function legacySelectorsToNewSelectors(legacySelectors = {}) {
  return {
    chatSelectors: {
      ...getDefaultChatSelectors(),
      selSignupBtn: legacySelectors.selSignupBtn || getDefaultChatSelectors().selSignupBtn,
      selUserMenu: legacySelectors.selUserMenu || getDefaultChatSelectors().selUserMenu,
      selLogoutBtn: legacySelectors.selLogoutBtn || getDefaultChatSelectors().selLogoutBtn,
      selLogoutConfirmBtn: legacySelectors.selLogoutConfirmBtn || getDefaultChatSelectors().selLogoutConfirmBtn,
      selSwitchAccountModal: legacySelectors.selSwitchAccountModal || getDefaultChatSelectors().selSwitchAccountModal,
      selSwitchCloseBtn: legacySelectors.selSwitchCloseBtn || getDefaultChatSelectors().selSwitchCloseBtn,
      selLoginModal: legacySelectors.selLoginModal || getDefaultChatSelectors().selLoginModal,
      selLoginEmailInput: legacySelectors.selLoginEmailInput || getDefaultChatSelectors().selLoginEmailInput
    },
    authSelectors: {
      ...getDefaultAuthSelectors(),
      selEmailInput: legacySelectors.selEmailInput || getDefaultAuthSelectors().selEmailInput,
      selEmailSubmit: legacySelectors.selEmailSubmit || getDefaultAuthSelectors().selEmailSubmit,
      selPasswordInput: legacySelectors.selPasswordInput || getDefaultAuthSelectors().selPasswordInput,
      selCodeInput: legacySelectors.selCodeInput || getDefaultAuthSelectors().selCodeInput,
      selNameInput: legacySelectors.selNameInput || getDefaultAuthSelectors().selNameInput,
      selBirthdayInput: legacySelectors.selBirthdayInput || getDefaultAuthSelectors().selBirthdayInput,
      selContinueBtn: legacySelectors.selContinueBtn || getDefaultAuthSelectors().selContinueBtn,
      ghostContinueSelector: legacySelectors.ghostContinueSelector || getDefaultAuthSelectors().ghostContinueSelector,
      authEmailInputSelector: legacySelectors.authEmailInputSelector || getDefaultAuthSelectors().authEmailInputSelector,
      authPasswordInputSelector: legacySelectors.authPasswordInputSelector || getDefaultAuthSelectors().authPasswordInputSelector,
      authCodeInputSelector: legacySelectors.authCodeInputSelector || getDefaultAuthSelectors().authCodeInputSelector,
      authContinueButtonSelector: legacySelectors.authContinueButtonSelector || getDefaultAuthSelectors().authContinueButtonSelector,
      authVerificationWaitSelector: legacySelectors.authVerificationWaitSelector || legacySelectors.authCodeInputSelector || getDefaultAuthSelectors().authVerificationWaitSelector,
      callbackWaitSelector: legacySelectors.callbackWaitSelector || getDefaultAuthSelectors().callbackWaitSelector
    },
    mailSelectors: {
      ...getDefaultMailSelectors(),
      selGenEmailBtn: legacySelectors.selGenEmailBtn || getDefaultMailSelectors().selGenEmailBtn,
      selEmailDisplay: legacySelectors.selEmailDisplay || getDefaultMailSelectors().selEmailDisplay,
      selInboxAction: legacySelectors.selInboxAction || getDefaultMailSelectors().selInboxAction,
      selEmailList: legacySelectors.selEmailList || getDefaultMailSelectors().selEmailList,
      selEmailSubject: legacySelectors.selEmailSubject || getDefaultMailSelectors().selEmailSubject
    }
  };
}

function migrateConfig(oldConfig, oldVersion) {
  const base = getDefaultConfig();
  if (!oldConfig) {
    return base;
  }

  const legacy = legacySelectorsToNewSelectors(oldConfig.selectors || {});
  const mailProviders = normalizeMailProviders(
    oldConfig.mailProviders ||
    (oldConfig.mailProvider ? [{
      id: sanitizeProviderId(oldConfig.mailProvider),
      name: oldConfig.mailProvider,
      url: oldConfig.mailProvider.startsWith('http') ? oldConfig.mailProvider : `https://${oldConfig.mailProvider.replace(/\/$/, '')}/`,
      selectors: legacy.mailSelectors
    }] : null)
  );

  const selectedMailProviderId = oldConfig.selectedMailProviderId || oldConfig.mailProviderId || mailProviders[0]?.id || base.selectedMailProviderId;
  const oauth = {
    tokenUrl: oldConfig.oauth?.tokenUrl || oldConfig.tokenUrl || base.oauth.tokenUrl,
    clientId: oldConfig.oauth?.clientId || oldConfig.clientId || base.oauth.clientId,
    codeVerifier: oldConfig.oauth?.codeVerifier || oldConfig.codeVerifier || base.oauth.codeVerifier,
    redirectUri: oldConfig.oauth?.redirectUri || oldConfig.redirectUri || base.oauth.redirectUri
  };

  const authSelectors = {
    ...base.authSelectors,
    ...legacy.authSelectors,
    ...(oldConfig.authSelectors || {})
  };

  const resultSave = {
    folder: oldConfig.resultSave?.folder || base.resultSave.folder,
    conflictAction: oldConfig.resultSave?.conflictAction || base.resultSave.conflictAction,
    upload: {
      ...base.resultSave.upload,
      ...(oldConfig.resultSave?.upload || {})
    }
  };

  const config = {
    ...base,
    ...oldConfig,
    runCount: parseInt(oldConfig.runCount, 10) || base.runCount,
    timeout: parseInt(oldConfig.timeout, 10) || base.timeout,
    selectedMailProviderId,
    chatSelectors: {
      ...base.chatSelectors,
      ...legacy.chatSelectors,
      ...(oldConfig.chatSelectors || {})
    },
    authSelectors,
    mailProviders,
    oauth,
    resultSave,
    preLogoutCloseSteps: normalizeUiSteps(oldConfig.preLogoutCloseSteps, {
      defaults: getDefaultPreLogoutCloseSteps(),
      fallbackSelector: 'button[data-testid="getting-started-button"]'
    }),
    postRegistrationSteps: normalizePostRegistrationSteps(oldConfig.postRegistrationSteps, authSelectors),
    postAuthSteps: normalizeUiSteps(oldConfig.postAuthSteps, {
      defaults: getDefaultPostAuthSteps(),
      fallbackSelector: ''
    }),
    recentResults: Array.isArray(oldConfig.recentResults) ? oldConfig.recentResults.slice(0, DEFAULT_HISTORY_LIMIT) : [],
    version: CONFIG_VERSION
  };

  return ensureSelectedMailProvider(config);
}

function normalizeUiSteps(steps, options = {}) {
  const {
    defaults = [],
    fallbackSelector = ''
  } = options;

  if (!Array.isArray(steps) || !steps.length) {
    return defaults.map((step) => ({ ...step }));
  }

  return steps
    .map((step) => ({
      selector: step?.selector || fallbackSelector,
      delayBeforeClick: Number.isFinite(step?.delayBeforeClick) ? step.delayBeforeClick : 1000,
      waitForChange: Boolean(step?.waitForChange)
    }))
    .filter((step) => step.selector);
}

function normalizePostRegistrationSteps(steps, authSelectors = getDefaultAuthSelectors()) {
  return normalizeUiSteps(steps, {
    defaults: getDefaultPostRegistrationSteps(authSelectors),
    fallbackSelector: authSelectors.ghostContinueSelector
  });
}

function ensureSelectedMailProvider(config) {
  const mailProviders = normalizeMailProviders(config.mailProviders);
  const selectedId = mailProviders.some((provider) => provider.id === config.selectedMailProviderId)
    ? config.selectedMailProviderId
    : mailProviders[0]?.id;

  return {
    ...config,
    mailProviders,
    selectedMailProviderId: selectedId,
    version: CONFIG_VERSION
  };
}

function sanitizeProviderId(value) {
  return String(value || 'mail-provider')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'mail-provider';
}

function createMailProvider(overrides = {}) {
  const provider = {
    ...createDefaultMailProvider(),
    ...overrides
  };

  provider.id = sanitizeProviderId(provider.id || provider.name || provider.url || `mail-provider-${Date.now()}`);
  provider.selectors = {
    ...getDefaultMailSelectors(),
    ...(overrides.selectors || {})
  };
  return provider;
}

function getSelectedMailProvider(config) {
  const safeConfig = ensureSelectedMailProvider(config || getDefaultConfig());
  return safeConfig.mailProviders.find((provider) => provider.id === safeConfig.selectedMailProviderId) || safeConfig.mailProviders[0];
}

function buildFlatSelectorMap(config) {
  const selectedProvider = getSelectedMailProvider(config);
  return {
    ...config.chatSelectors,
    ...config.authSelectors,
    ...(selectedProvider?.selectors || {})
  };
}

function truncateResults(results, limit = DEFAULT_HISTORY_LIMIT) {
  return (Array.isArray(results) ? results : []).slice(0, limit);
}

globalThis.AutoRegisterConfig = {
  CONFIG_VERSION,
  DEFAULT_REDIRECT_URI,
  DEFAULT_TOKEN_URL,
  DEFAULT_CLIENT_ID,
  DEFAULT_CODE_VERIFIER,
  DEFAULT_PASSWORD,
  DEFAULT_HISTORY_LIMIT,
  CHAT_SELECTOR_FIELDS,
  AUTH_SELECTOR_FIELDS,
  MAIL_SELECTOR_FIELDS,
  getDefaultConfig,
  getDefaultChatSelectors,
  getDefaultAuthSelectors,
  getDefaultMailSelectors,
  createDefaultMailProvider,
  createMailProvider,
  compareVersions,
  migrateConfig,
  normalizeMailProviders,
  normalizeUiSteps,
  normalizePostRegistrationSteps,
  ensureSelectedMailProvider,
  getSelectedMailProvider,
  buildFlatSelectorMap,
  truncateResults,
  sanitizeProviderId
};
