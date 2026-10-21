// Background: wywołania API providerów AI. Klucze nie opuszczają tego kontekstu.

// Chrome (service worker) nie ładuje "scripts" z manifestu — dociągamy settings.js ręcznie.
if (typeof loadProviderConfig === "undefined" && typeof importScripts === "function") {
  importScripts("settings.js");
}

const IDLE_TIMEOUT_MS = 45_000; // brak żadnych danych od API przez 45 s → przerwij
const RETRY_DELAY_MS = 1500; // jeden retry przy 429/5xx/błędzie sieci

const SYSTEM_PROMPT = `You summarize YouTube video transcripts.

Rules:
- Write the summary in the same language as the transcript.
- Start with one sentence describing what the video is about.
- Then list the key points as short bullets, each starting with "• ".
- Use 3–8 bullets depending on how much substance the video has.
- Keep concrete facts, numbers, names and conclusions; skip filler, intros, sponsor segments and calls to subscribe.
- Plain text only: no Markdown, no headings, no bold.
- If the transcript has no real content, say so in one sentence.`;

class SummaryError extends Error {
  constructor(message, code = "API_ERROR", { retryable = false } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

// Modele Claude z serwerowym fallbackiem przy odmowie (Haiku go nie ma — parametr dałby 400)
const ANTHROPIC_FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

// Każdy provider: request (url/headers/body) + parseEvent → { text, finishReason }
const PROVIDER_APIS = {
  gemini: {
    url: (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    headers: (apiKey) => ({ "x-goog-api-key": apiKey }),
    body: (model, transcript) => ({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: `Transcript:\n\n${transcript}` }] }],
      // Domyślnie "medium" — "low" wyraźnie skraca czas odpowiedzi
      generationConfig: { temperature: 0.3, thinkingConfig: { thinkingLevel: "low" } },
    }),
    parseEvent(event, label) {
      if (event.error) {
        throw new SummaryError(`${label} error: ${event.error.message || "stream failed"}`);
      }
      const blockReason = event.promptFeedback?.blockReason;
      if (blockReason) {
        throw new SummaryError(`${label} blocked the request (${blockReason}).`, "BLOCKED");
      }
      const candidate = event.candidates?.[0];
      const text = (candidate?.content?.parts || [])
        .filter((part) => !part.thought)
        .map((part) => part.text || "")
        .join("");
      return { text, finishReason: candidate?.finishReason };
    },
  },

  openai: {
    url: () => "https://api.openai.com/v1/chat/completions",
    headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    body: (model, transcript) => {
      // Modele reasoning (gpt-5*, o*) nie przyjmują temperature, za to mają reasoning_effort
      const reasoning = /^(gpt-5|o\d)/.test(model);
      return {
        model,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Transcript:\n\n${transcript}` },
        ],
        ...(reasoning ? { reasoning_effort: "low" } : { temperature: 0.3 }),
      };
    },
    parseEvent(event, label) {
      if (event.error) {
        throw new SummaryError(`${label} error: ${event.error.message || "stream failed"}`);
      }
      const choice = event.choices?.[0];
      if (choice?.finish_reason === "content_filter") {
        throw new SummaryError(`${label} blocked the request (content filter).`, "BLOCKED");
      }
      return { text: choice?.delta?.content || "", finishReason: choice?.finish_reason };
    },
  },

  anthropic: {
    url: () => "https://api.anthropic.com/v1/messages",
    headers: (apiKey, model) => ({
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Firefox wysyła Origin moz-extension:// — bez tego nagłówka API odrzuca request
      "anthropic-dangerous-direct-browser-access": "true",
      ...(ANTHROPIC_FALLBACK_MODELS.includes(model) ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
    }),
    body: (model, transcript) => ({
      model,
      max_tokens: 16000,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Transcript:\n\n${transcript}` }],
      // Rodzina 5.x: thinking zawsze włączony, "low" skraca czas odpowiedzi; temperature dałoby 400
      ...(/^claude-[a-z]+-5/.test(model) ? { output_config: { effort: "low" } } : {}),
      ...(ANTHROPIC_FALLBACK_MODELS.includes(model) ? { fallbacks: "default" } : {}),
    }),
    parseEvent(event, label) {
      if (event.type === "error") {
        const overloaded = event.error?.type === "overloaded_error";
        throw new SummaryError(
          overloaded
            ? `${label} is overloaded right now. Try again in a moment.`
            : `${label} error: ${event.error?.message || "stream failed"}`,
          overloaded ? "OVERLOADED" : "API_ERROR",
          { retryable: overloaded }
        );
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        return { text: event.delta.text };
      }
      if (event.type === "message_delta") {
        const finishReason = event.delta?.stop_reason;
        if (finishReason === "refusal") {
          throw new SummaryError(`${label} declined to summarize this transcript.`, "BLOCKED");
        }
        return { text: "", finishReason };
      }
      return { text: "" };
    },
  },
};

function errorFromResponse(label, status, data) {
  const apiMessage = data?.error?.message || `HTTP ${status}`;
  // Zły klucz: 401/403, Gemini zwraca też 400 "API key not valid"
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(apiMessage))) {
    return new SummaryError(`${label} rejected the API key.`, "BAD_API_KEY");
  }
  if (status === 429) {
    return new SummaryError(`${label} rate limit or quota exceeded. Try again later.`, "RATE_LIMIT", { retryable: true });
  }
  if (status >= 500) {
    return new SummaryError(`${label} is overloaded right now. Try again in a moment.`, "OVERLOADED", { retryable: true });
  }
  return new SummaryError(`${label} error: ${apiMessage}`);
}

function cleanSummary(text) {
  return text.replace(/\*\*/g, "").trim();
}

// Server-sent events: bloki rozdzielone pustą linią, treść w liniach "data: {...}"
async function* readSseEvents(body, onActivity) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parse = (raw) => {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    // OpenAI kończy stream linią "data: [DONE]"
    return data && data !== "[DONE]" ? JSON.parse(data) : null;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    onActivity();
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop();
    for (const block of blocks) {
      const event = parse(block);
      if (event) yield event;
    }
  }

  const last = parse(buffer + decoder.decode());
  if (last) yield last;
}

async function streamOnce({ provider, apiKey, model }, transcript, { signal, onText, onActivity }) {
  const api = PROVIDER_APIS[provider];
  const { label } = PROVIDERS[provider];

  let res;
  try {
    res = await fetch(api.url(model), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...api.headers(apiKey, model) },
      body: JSON.stringify(api.body(model, transcript)),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new SummaryError(`Could not reach ${label} API. Check your connection.`, "NETWORK", { retryable: true });
  }

  if (!res.ok) {
    throw errorFromResponse(label, res.status, await res.json().catch(() => null));
  }

  let text = "";
  let finishReason = null;

  for await (const event of readSseEvents(res.body, onActivity)) {
    const parsed = api.parseEvent(event, label);
    finishReason = parsed.finishReason || finishReason;
    if (parsed.text) {
      text += parsed.text;
      onText(cleanSummary(text));
    }
  }

  const summary = cleanSummary(text);
  if (!summary) {
    throw new SummaryError(
      finishReason ? `${label} returned no summary (${finishReason}).` : `${label} returned an empty summary.`
    );
  }
  return summary;
}

async function streamSummary(transcript, { signal, onText, onActivity }) {
  const config = await loadProviderConfig();
  const target = {
    provider: config.provider,
    apiKey: config.apiKeys[config.provider],
    model: config.models[config.provider],
  };
  const { label } = PROVIDERS[target.provider];
  if (!target.apiKey) {
    throw new SummaryError(`No ${label} API key set.`, "NO_API_KEY");
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await streamOnce(target, transcript, { signal, onText, onActivity });
    } catch (err) {
      if (!err.retryable || attempt >= 1 || signal.aborted) throw err;
      console.warn(`[YT Summarizer] ${label} failed, retrying:`, err.message);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      onActivity();
    }
  }
}

// Port zamiast sendMessage: Firefox nie usypia tła, póki port jest otwarty,
// a summary leci do karty kawałkami. Zamknięcie portu przez kartę przerywa request.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "summarize") return;

  const controller = new AbortController();
  let idleTimer = null;

  const onActivity = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      controller.abort(new SummaryError("The AI provider took too long to respond. Try again.", "TIMEOUT"));
    }, IDLE_TIMEOUT_MS);
  };

  port.onDisconnect.addListener(() => {
    clearTimeout(idleTimer);
    controller.abort(new SummaryError("Cancelled.", "CANCELLED"));
  });

  port.onMessage.addListener(async ({ transcript }) => {
    onActivity();
    try {
      const summary = await streamSummary(transcript, {
        signal: controller.signal,
        onActivity,
        onText: (text) => port.postMessage({ type: "chunk", text }),
      });
      port.postMessage({ type: "done", summary });
    } catch (err) {
      const error = controller.signal.reason instanceof SummaryError ? controller.signal.reason : err;
      if (error.code === "CANCELLED") return;
      console.warn("[YT Summarizer] Summary error:", error);
      port.postMessage({ type: "error", error: error.message, code: error.code || "API_ERROR" });
    } finally {
      clearTimeout(idleTimer);
    }
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});
