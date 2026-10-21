# <img src="ninja-3.svg" alt="" width="38" height="38" align="absmiddle" /> YouTube Samurai

&nbsp;

> **Project status: completed and no longer maintained.**
>
> YouTube Samurai reached its intended scope and development has now ended. The market for AI-powered video summarization has matured quickly, and many well-established tools now offer similar functionality. Further work would add little beyond what those tools already provide, so I have decided to conclude the project here. The repository remains public as a reference and as a record of the work.

## About

YouTube Samurai is a Firefox extension (Manifest V3) that summarizes YouTube videos without opening them. It adds a small button to each video thumbnail on the YouTube homepage. Clicking it fetches the video's captions and sends them to an AI model of your choice, which returns a concise summary: a one-sentence overview followed by the key points.

The summary appears in a floating card next to the page and streams in as it is generated. The full transcript is one click away in the same card, and either can be copied to the clipboard.

## Features

- **Thumbnail button** on every video on the YouTube homepage, re-injected as you scroll and navigate
- **Transcript retrieval** directly from YouTube captions, preferring English and Polish tracks
- **AI summaries** from Google Gemini, OpenAI or Anthropic, streamed in real time
- **Transcript view** with word count and copy-to-clipboard
- **Options page** for card size, maximum video length, AI provider, API keys and models
- **Privacy by design**: API keys are stored locally and used only by the extension's background script; no data is sent anywhere except to the provider you select

## How it works

1. The content script reads the video's player data through YouTube's internal API and selects the best available caption track.
2. The transcript is passed to the extension's background script, the only component with access to your API key.
3. The background script streams a summary from the selected provider back to the card.

There is no build step and there are no runtime dependencies: the extension is plain JavaScript loaded directly by the browser.

## Setup

1. Install the extension, or run it locally with `npm start` (uses [`web-ext`](https://github.com/mozilla/web-ext)).
2. Open `about:addons` → YouTube SamurAI → Preferences.
3. Pick an AI provider and paste its API key:
   - **Gemini**: free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   - **OpenAI**: [platform.openai.com/api-keys](https://platform.openai.com/api-keys) (paid)
   - **Anthropic**: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) (paid)

API keys stay in your browser. The transcript of the video you click is sent only to the provider you picked.

## Limitations

- Works on the YouTube homepage only (not on search results, Shorts or the watch page).
- Requires the video to have captions, either manual or auto-generated.
- Relies on YouTube's undocumented internal API, which may change without notice.
