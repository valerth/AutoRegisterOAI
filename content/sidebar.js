const ConfigLib = window.AutoRegisterConfig;
const PANEL_CONFIG_VERSION = ConfigLib.CONFIG_VERSION;

async function loadConfigWithMigration() {
  const result = await chrome.storage.local.get(['autoRegisterConfig', 'configVersion', 'recentRunResults']);
  const config = ConfigLib.migrateConfig(result.autoRegisterConfig, result.configVersion);
  if (Array.isArray(result.recentRunResults) && result.recentRunResults.length) {
    config.recentResults = ConfigLib.truncateResults(result.recentRunResults);
  }
  await chrome.storage.local.set({
    autoRegisterConfig: config,
    configVersion: PANEL_CONFIG_VERSION
  });
  return config;
}

window.AutoRegisterSidebar = {
  loadConfigWithMigration
};
