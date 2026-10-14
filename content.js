console.log("[YT Summarizer] Skrypt załadowany pomyślnie.");

const RENDERER_SELECTORS = [
  "ytd-rich-item-renderer",
  "yt-lockup-view-model",
].join(", ");

let observer = null;
let injectScheduled = false;

function isHomepage() {
  const path = location.pathname;
  return path === "/" || path === "";
}

function removeUI() {
  document.querySelectorAll(".yt-ai-thumb-btn").forEach((el) => el.remove());
  document.getElementById("yt-ai-summary-box")?.remove();
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
        <span>SamurAI</span>
      </div>
      <button class="yt-ai-close-btn" id="yt-ai-close-btn" title="Close">&times;</button>
    </div>
    <div class="yt-ai-card-body">
      <p class="yt-ai-placeholder">
        // PLACE FOR AI SUMMARY
      </p>
    </div>
    <div class="yt-ai-card-footer">
      <button class="yt-ai-action-btn" id="yt-ai-copy-btn">Copy</button>
    </div>
  `;

  box.querySelector("#yt-ai-close-btn").addEventListener("click", () => {
    box.classList.add("hidden");
  });

  box.querySelector("#yt-ai-copy-btn").addEventListener("click", (e) => {
    e.target.textContent = "Skopiowano!";
    setTimeout(() => { e.target.textContent = "Kopiuj tekst"; }, 1500);
  });

  document.body.appendChild(box);
  return box;
}

function findThumbnailContainer(renderer) {
  // Nowy layout YouTube
  const thumbModel = renderer.querySelector("yt-thumbnail-view-model");
  if (thumbModel) return thumbModel;

  // Legacy
  return (
    renderer.querySelector("ytd-thumbnail") ||
    renderer.querySelector("a#thumbnail") ||
    renderer.querySelector("a.ytd-thumbnail")
  );
}

function injectThumbButton(renderer) {
  // Unikaj podwójnego injectu na parent + child renderer
  const container = findThumbnailContainer(renderer);
  if (!container) return;
  if (container.querySelector(".yt-ai-thumb-btn")) return;

  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "yt-ai-thumb-btn";
  btn.title = "YouTube SamurAI";
  btn.setAttribute("aria-label", "YouTube SamurAI");

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const summaryBox = getOrCreateSummaryBox();
    summaryBox.classList.toggle("hidden");
  });

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
// Retry po wolniejszym ładowaniu feedu
setTimeout(scheduleInject, 1000);
setTimeout(scheduleInject, 2500);
