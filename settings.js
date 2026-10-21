// Wspólne ustawienia — ładowane przez content script, background i stronę Options.

const DEFAULT_SETTINGS = {
  cardWidth: 520, // px
  cardHeight: 680, // px (max wysokość karty)
  maxVideoMinutes: 45,
};

const SETTINGS_LIMITS = {
  cardWidth: [300, 1200],
  cardHeight: [200, 1200],
  maxVideoMinutes: [1, 600],
};

function sanitizeSettings(raw) {
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const [min, max] = SETTINGS_LIMITS[key];
    const value = Math.round(Number(raw?.[key]));
    result[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }
  return result;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return sanitizeSettings(stored);
}

// Providerzy AI. Szczegóły requestów (URL, body, parsowanie streamu) są w background.js.
const PROVIDERS = {
  gemini: {
    label: "Gemini",
    defaultModel: "gemini-3.8-flash",
    keyPlaceholder: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5-mini",
    keyPlaceholder: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-opus-5-5",
    keyPlaceholder: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
};

const DEFAULT_PROVIDER = "gemini";
const PROVIDER_STORAGE_KEY = "provider";

// "geminiApiKey" zostaje zgodne ze starszą wersją, gdzie był tylko Gemini
function providerStorageKeys(id) {
  return { apiKey: `${id}ApiKey`, model: `${id}Model` };
}

// Klucze API trzymane osobno — Reset ich nie kasuje, content script ich nie czyta.
async function loadProviderConfig() {
  const ids = Object.keys(PROVIDERS);
  const stored = await chrome.storage.local.get([
    PROVIDER_STORAGE_KEY,
    ...ids.flatMap((id) => Object.values(providerStorageKeys(id))),
  ]);

  const config = {
    provider: PROVIDERS[stored[PROVIDER_STORAGE_KEY]] ? stored[PROVIDER_STORAGE_KEY] : DEFAULT_PROVIDER,
    apiKeys: {},
    models: {},
  };
  for (const id of ids) {
    const keys = providerStorageKeys(id);
    config.apiKeys[id] = stored[keys.apiKey] || "";
    config.models[id] = stored[keys.model] || PROVIDERS[id].defaultModel;
  }
  return config;
}
