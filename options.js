const form = document.getElementById("options-form");
const statusEl = document.getElementById("status");
const fields = Object.keys(DEFAULT_SETTINGS);
const providerSelect = document.getElementById("provider");
const providerIds = Object.keys(PROVIDERS);

// Sekcja per provider: klucz API + model. Budowane z PROVIDERS, żeby nie dublować stałych w HTML.
function buildProviderSections() {
  const container = document.getElementById("provider-sections");

  for (const id of providerIds) {
    const provider = PROVIDERS[id];
    providerSelect.append(new Option(provider.label, id));

    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = `${provider.label} API`;

    const keyInput = makeInput(`${id}-apiKey`, "password", provider.keyPlaceholder);
    const modelInput = makeInput(`${id}-model`, "text", provider.defaultModel);

    const hint = document.createElement("p");
    hint.className = "hint";
    const link = document.createElement("a");
    link.href = provider.keyUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = provider.keyUrl.replace(/^https:\/\//, "");
    hint.append("Get a key at ", link, ". Leave model empty for the default.");

    section.append(heading, makeLabel("API key", keyInput), makeLabel("Model", modelInput), hint);
    container.append(section);
  }
}

function makeInput(id, type, placeholder) {
  const input = document.createElement("input");
  Object.assign(input, { id, type, placeholder, className: "wide", autocomplete: "off", spellcheck: false });
  return input;
}

function makeLabel(text, input) {
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span, input);
  return label;
}

function fillForm(settings) {
  for (const key of fields) {
    document.getElementById(key).value = settings[key];
  }
}

function fillProviderForm(config) {
  providerSelect.value = config.provider;
  for (const id of providerIds) {
    document.getElementById(`${id}-apiKey`).value = config.apiKeys[id];
    // Domyślny model pokazujemy jako placeholder, nie jako wartość
    const model = config.models[id];
    document.getElementById(`${id}-model`).value = model === PROVIDERS[id].defaultModel ? "" : model;
  }
}

function readProviderForm() {
  const values = { [PROVIDER_STORAGE_KEY]: providerSelect.value };
  for (const id of providerIds) {
    const keys = providerStorageKeys(id);
    values[keys.apiKey] = document.getElementById(`${id}-apiKey`).value.trim();
    values[keys.model] = document.getElementById(`${id}-model`).value.trim();
  }
  return values;
}

function showStatus(text) {
  statusEl.textContent = text;
  setTimeout(() => { statusEl.textContent = ""; }, 1500);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = Object.fromEntries(fields.map((key) => [key, document.getElementById(key).value]));
  const settings = sanitizeSettings(raw);
  await chrome.storage.local.set({ ...settings, ...readProviderForm() });
  fillForm(settings);
  fillProviderForm(await loadProviderConfig());
  showStatus("Saved");
});

document.getElementById("reset-btn").addEventListener("click", async () => {
  await chrome.storage.local.set(DEFAULT_SETTINGS);
  fillForm(DEFAULT_SETTINGS);
  showStatus("Defaults restored");
});

buildProviderSections();
loadSettings().then(fillForm);
loadProviderConfig().then(fillProviderForm);
