// Wspólne ustawienia — ładowane przez content script i stronę Options.

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

// Klucz API trzymany osobno — Reset go nie kasuje, content script go nie czyta.
const API_KEY_STORAGE_KEY = "geminiApiKey";

async function loadApiKey() {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  return stored[API_KEY_STORAGE_KEY] || "";
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return sanitizeSettings(stored);
}
