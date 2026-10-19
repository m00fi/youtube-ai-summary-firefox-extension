// Background: wywołania Gemini API. Klucz nie opuszcza tego kontekstu.

// Chrome (service worker) nie ładuje "scripts" z manifestu — dociągamy settings.js ręcznie.
if (typeof loadApiKey === "undefined" && typeof importScripts === "function") {
  importScripts("settings.js");
}

const GEMINI_MODEL = "gemini-3.8-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;

const IDLE_TIMEOUT_MS = 45_000; // brak żadnych danych od Gemini przez 45 s → przerwij
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

function errorFromResponse(status, data) {
  const apiMessage = data?.error?.message || `HTTP ${status}`;
  // Zły klucz: Gemini zwraca 400 "API key not valid", czasem 401/403
  if (status === 401 || status === 403 || (status === 400 && /api key/i.test(apiMessage))) {
    return new SummaryError("Gemini rejected the API key.", "BAD_API_KEY");
  }
  if (status === 429) {
    return new SummaryError("Gemini rate limit or quota exceeded. Try again later.", "RATE_LIMIT", { retryable: true });
  }
  if (status >= 500) {
    return new SummaryError("Gemini is overloaded right now. Try again in a moment.", "OVERLOADED", { retryable: true });
  }
  return new SummaryError(`Gemini error: ${apiMessage}`);
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
    return data ? JSON.parse(data) : null;
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

async function streamOnce(apiKey, transcript, { signal, onText, onActivity }) {
  let res;
  try {
    res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Transcript:\n\n${transcript}` }] }],
        // Domyślnie "medium" — "low" wyraźnie skraca czas odpowiedzi
        generationConfig: { temperature: 0.3, thinkingConfig: { thinkingLevel: "low" } },
      }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new SummaryError("Could not reach Gemini API. Check your connection.", "NETWORK", { retryable: true });
  }

  if (!res.ok) {
    throw errorFromResponse(res.status, await res.json().catch(() => null));
  }

  let text = "";
  let finishReason = null;

  for await (const event of readSseEvents(res.body, onActivity)) {
    if (event.error) {
      throw new SummaryError(`Gemini error: ${event.error.message || "stream failed"}`);
    }

    const blockReason = event.promptFeedback?.blockReason;
    if (blockReason) {
      throw new SummaryError(`Gemini blocked the request (${blockReason}).`, "BLOCKED");
    }

    const candidate = event.candidates?.[0];
    finishReason = candidate?.finishReason || finishReason;

    const chunk = (candidate?.content?.parts || [])
      .filter((part) => !part.thought)
      .map((part) => part.text || "")
      .join("");

    if (chunk) {
      text += chunk;
      onText(cleanSummary(text));
    }
  }

  const summary = cleanSummary(text);
  if (!summary) {
    throw new SummaryError(
      finishReason ? `Gemini returned no summary (${finishReason}).` : "Gemini returned an empty summary."
    );
  }
  return summary;
}

async function streamSummary(transcript, { signal, onText, onActivity }) {
  const apiKey = await loadApiKey();
  if (!apiKey) {
    throw new SummaryError("No Gemini API key set.", "NO_API_KEY");
  }

  for (let attempt = 0; ; attempt++) {
    try {
      return await streamOnce(apiKey, transcript, { signal, onText, onActivity });
    } catch (err) {
      if (!err.retryable || attempt >= 1 || signal.aborted) throw err;
      console.warn("[YT Summarizer] Gemini failed, retrying:", err.message);
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
      controller.abort(new SummaryError("Gemini took too long to respond. Try again.", "TIMEOUT"));
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
