# <img src="ninja-3.svg" alt="" width="38" height="38" align="absmiddle" /> YouTube Samurai

&nbsp;

A Firefox extension that adds a button to video thumbnails on the YouTube homepage. Click it to get a short AI summary of the video, made from its captions. The full transcript is one click away in the same card.

## Setup

1. Install the extension (or run it locally with `npm start`).
2. Open `about:addons` → YouTube SamurAI → Preferences.
3. Pick an AI provider and paste its API key:
   - **Gemini**: free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   - **OpenAI**: [platform.openai.com/api-keys](https://platform.openai.com/api-keys) (paid)
   - **Anthropic**: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) (paid)

API keys stay in your browser. The transcript of the video you click is sent only to the provider you picked.
