console.log("[YT Summarizer] Skrypt załadowany pomyślnie.");

const RENDERER_SELECTORS = [
  "ytd-rich-item-renderer",
  "yt-lockup-view-model",
].join(", ");

const LANG_PRIORITY = ["en", "pl"];

let observer = null;
let injectScheduled = false;
let currentTranscriptText = "";
let activeSummaryVideoId = null;

function isHomepage() {
  const path = location.pathname;
  return path === "/" || path === "";
}

function removeUI() {
  document.querySelectorAll(".yt-ai-thumb-btn").forEach((el) => el.remove());
  document.getElementById("yt-ai-summary-box")?.remove();
  currentTranscriptText = "";
  activeSummaryVideoId = null;
}

function setSummaryContent(text, { loading = false, error = false } = {}) {
  const box = getOrCreateSummaryBox();
  const placeholder = box.querySelector(".yt-ai-placeholder");
  if (!placeholder) return;

  placeholder.textContent = text;
  placeholder.classList.toggle("yt-ai-loading", loading);
  placeholder.classList.toggle("yt-ai-error", error);
  placeholder.classList.toggle("yt-ai-summary-text", !loading && !error);
}

function getOrCreateSummaryBox() {
  let box = document.getElementById("yt-ai-summary-box");
  if (box) return box;

  box = document.createElement("div");
  box.id = "yt-ai-summary-box";
  box.className = "yt-ai-card hidden";

  box.innerHTML = `
    <div class="yt-ai-card-header">
      <div class="yt-ai-card-title">
        <img class="yt-ai-card-logo" src="${chrome.runtime.getURL("ninja-2.svg")}" alt="" draggable="false" />
        <span>YouTube Samurai</span>
      </div>
      <button class="yt-ai-close-btn" id="yt-ai-close-btn" title="Close">&times;</button>
    </div>
    <div class="yt-ai-card-body">
      <p class="yt-ai-placeholder">PLACE FOR AI SUMMARY</p>
    </div>
    <div class="yt-ai-card-footer">
      <button class="yt-ai-action-btn" id="yt-ai-copy-btn">Copy</button>
    </div>
  `;

  box.querySelector("#yt-ai-close-btn").addEventListener("click", () => {
    box.classList.add("hidden");
    activeSummaryVideoId = null;
  });

  box.querySelector("#yt-ai-copy-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const text = currentTranscriptText || box.querySelector(".yt-ai-placeholder")?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied!";
    } catch {
      btn.textContent = "Copy failed";
    }
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  });

  document.body.appendChild(box);
  return box;
}

function extractVideoIdFromUrl(href) {
  try {
    const url = new URL(href, location.origin);
    if (url.pathname.startsWith("/shorts/")) {
      return url.pathname.split("/")[2] || null;
    }
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

function getVideoIdFromRenderer(renderer) {
  const anchors = renderer.querySelectorAll("a[href]");
  for (const anchor of anchors) {
    const id = extractVideoIdFromUrl(anchor.href);
    if (id) return id;
  }

  const thumbModel = renderer.querySelector("yt-thumbnail-view-model");
  const parentLink = thumbModel?.closest("a[href]");
  if (parentLink) return extractVideoIdFromUrl(parentLink.href);

  return null;
}

function extractJsonObject(source, startIdx) {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
  }

  throw new Error("Could not parse ytInitialPlayerResponse");
}

function getCaptionTracks(player) {
  return player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

async function getPlayerViaInnertube(videoId) {
  const clients = [
    { clientName: "ANDROID", clientVersion: "20.10.38" },
    { clientName: "IOS", clientVersion: "19.45.4" },
    {
      clientName: "WEB",
      clientVersion: "2.20241126.01.00",
    },
  ];

  for (const client of clients) {
    try {
      const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          context: { client },
          videoId,
        }),
      });

      if (!res.ok) continue;
      const player = await res.json();
      if (getCaptionTracks(player).length) return player;
    } catch (err) {
      console.warn(`[YT Summarizer] Innertube ${client.clientName} failed:`, err);
    }
  }

  return null;
}

async function getPlayerFromWatchPage(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`Watch page HTTP ${res.status}`);

  const html = await res.text();
  const marker = "ytInitialPlayerResponse";
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error("Player response not found");

  const braceIdx = html.indexOf("{", markerIdx);
  if (braceIdx === -1) throw new Error("Player response JSON not found");

  return JSON.parse(extractJsonObject(html, braceIdx));
}

async function getPlayerResponse(videoId) {
  const innertubePlayer = await getPlayerViaInnertube(videoId);
  if (innertubePlayer) return innertubePlayer;
  return getPlayerFromWatchPage(videoId);
}

function pickCaptionTrack(tracks) {
  for (const lang of LANG_PRIORITY) {
    const exact = tracks.find((t) => t.languageCode === lang);
    if (exact) return exact;
  }

  for (const lang of LANG_PRIORITY) {
    const fuzzy = tracks.find((t) => t.languageCode?.toLowerCase().startsWith(lang));
    if (fuzzy) return fuzzy;
  }

  return null;
}

function normalizeTranscriptText(text) {
  return text
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transcriptFromJson3(data) {
  return normalizeTranscriptText(
    (data.events || [])
      .flatMap((event) => event.segs || [])
      .map((seg) => seg.utf8 || "")
      .join("")
  );
}

function transcriptFromXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");

  // srv1: <text>, srv3: <p> (sometimes with nested <s>)
  const nodes = [...doc.querySelectorAll("text, p")];
  return normalizeTranscriptText(
    nodes
      .map((node) => node.textContent || "")
      .filter(Boolean)
      .join(" ")
  );
}

function parseCaptionBody(body) {
  const trimmed = body?.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return transcriptFromJson3(JSON.parse(trimmed));
    } catch {
      // fall through to XML
    }
  }

  return transcriptFromXml(trimmed);
}

function withCaptionFormat(baseUrl, fmt) {
  // Zamiana fmt w miejscu — URLSearchParams przestawia kolejność i psuje signature.
  if (/[?&]fmt=/.test(baseUrl)) {
    return baseUrl.replace(/([?&])fmt=[^&]*/, `$1fmt=${fmt}`);
  }
  const joiner = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${joiner}fmt=${fmt}`;
}

async function fetchCaptionUrl(url) {
  const res = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "*/*" },
  });

  if (!res.ok) {
    console.warn(`[YT Summarizer] Caption HTTP ${res.status} for`, url.slice(0, 120));
    return "";
  }

  const body = await res.text();
  const text = parseCaptionBody(body);
  if (!text) {
    console.warn(
      "[YT Summarizer] Unparsed caption body:",
      body.slice(0, 180).replace(/\s+/g, " ")
    );
  }
  return text;
}

async function fetchTrackText(baseUrl) {
  const candidates = [
    withCaptionFormat(baseUrl, "json3"),
    withCaptionFormat(baseUrl, "srv1"),
    withCaptionFormat(baseUrl, "srv3"),
    baseUrl,
  ];

  for (const url of candidates) {
    const text = await fetchCaptionUrl(url);
    if (text) return text;
  }

  throw new Error("Could not parse caption track");
}

async function fetchTranscript(videoId) {
  const player = await getPlayerResponse(videoId);
  const tracks = getCaptionTracks(player);

  if (!tracks.length) {
    throw new Error("No captions available for this video");
  }

  const track = pickCaptionTrack(tracks);
  if (!track?.baseUrl) {
    throw new Error("No English or Polish captions found");
  }

  console.log(`[YT Summarizer] Using captions: ${track.languageCode} (${track.kind || "manual"})`);
  return fetchTrackText(track.baseUrl);
}

function findThumbnailContainer(renderer) {
  const thumbModel = renderer.querySelector("yt-thumbnail-view-model");
  if (thumbModel) return thumbModel;

  return (
    renderer.querySelector("ytd-thumbnail") ||
    renderer.querySelector("a#thumbnail") ||
    renderer.querySelector("a.ytd-thumbnail")
  );
}

async function onThumbButtonClick(event, videoId) {
  event.preventDefault();
  event.stopPropagation();

  const summaryBox = getOrCreateSummaryBox();
  const isOpen = !summaryBox.classList.contains("hidden");

  if (isOpen && videoId && videoId === activeSummaryVideoId) {
    summaryBox.classList.add("hidden");
    activeSummaryVideoId = null;
    return;
  }

  summaryBox.classList.remove("hidden");
  activeSummaryVideoId = videoId || null;

  if (!videoId) {
    currentTranscriptText = "";
    setSummaryContent("Could not resolve video id.", { error: true });
    return;
  }

  currentTranscriptText = "";
  setSummaryContent("Loading transcript…", { loading: true });

  try {
    const transcript = await fetchTranscript(videoId);
    if (!transcript) {
      throw new Error("Transcript is empty");
    }

    // Ignore late response if user toggled away / closed meanwhile
    if (activeSummaryVideoId !== videoId) return;

    const preview = transcript.slice(0, 1000);
    currentTranscriptText = preview;
    setSummaryContent(preview);
  } catch (err) {
    if (activeSummaryVideoId !== videoId) return;
    console.warn("[YT Summarizer] Transcript error:", err);
    currentTranscriptText = "";
    setSummaryContent(err?.message || "Failed to fetch transcript.", { error: true });
  }
}

function injectThumbButton(renderer) {
  const container = findThumbnailContainer(renderer);
  if (!container) return;
  if (container.querySelector(".yt-ai-thumb-btn")) return;

  const videoId = getVideoIdFromRenderer(renderer);
  if (!videoId) return;

  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "yt-ai-thumb-btn";
  btn.title = "YouTube SamurAI";
  btn.setAttribute("aria-label", "YouTube SamurAI");
  btn.dataset.videoId = videoId;

  const icon = document.createElement("img");
  icon.src = chrome.runtime.getURL("ninja-2.svg");
  icon.alt = "";
  icon.draggable = false;
  btn.appendChild(icon);

  btn.addEventListener("click", (e) => onThumbButtonClick(e, videoId));

  container.appendChild(btn);
}

function injectUI() {
  injectScheduled = false;

  if (!isHomepage()) {
    removeUI();
    return;
  }

  const renderers = document.querySelectorAll(RENDERER_SELECTORS);
  renderers.forEach(injectThumbButton);
  console.log(`[YT Summarizer] Inject: ${renderers.length} rendererów, przyciski: ${document.querySelectorAll(".yt-ai-thumb-btn").length}`);
}

function scheduleInject() {
  if (injectScheduled) return;
  injectScheduled = true;
  requestAnimationFrame(() => setTimeout(injectUI, 50));
}

function ensureObserver() {
  if (observer) return;

  observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

document.addEventListener("yt-navigate-finish", () => {
  removeUI();
  scheduleInject();
});

ensureObserver();
scheduleInject();
setTimeout(scheduleInject, 1000);
setTimeout(scheduleInject, 2500);
