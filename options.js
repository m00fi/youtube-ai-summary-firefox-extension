const form = document.getElementById("options-form");
const statusEl = document.getElementById("status");
const fields = Object.keys(DEFAULT_SETTINGS);
const apiKeyInput = document.getElementById("apiKey");

function fillForm(settings) {
  for (const key of fields) {
    document.getElementById(key).value = settings[key];
  }
}

function showStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => { statusEl.textContent = ""; }, 1500);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(fields.map((key) => [key, document.getElementById(key).value]));
  const settings = sanitizeSettings(raw);
  const apiKey = apiKeyInput.value.trim();
  await chrome.storage.local.set({ ...settings, [API_KEY_STORAGE_KEY]: apiKey });
  fillForm(settings);
  apiKeyInput.value = apiKey;
  showStatus("Saved");
});

document.getElementById("reset-btn").addEventListener("click", async () => {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  fillForm(DEFAULT_SETTINGS);
  showStatus("Defaults restored");
});

loadSettings().then(fillForm);
loadApiKey().then((key) => { apiKeyInput.value = key; });
