# Full-Page

A Chrome extension for capturing full-page screenshots, extracting readable content from any webpage, and handing it off to your OnCue assistant. Built with Manifest V3 and vanilla JavaScript.

<p align="center">
  <img src="icons/icon128.png" alt="Full-Page icon" width="128" height="128" />
</p>

---

## Overview

Full-Page is a productivity tool for people who need to capture, save, and reuse content from the web. It combines three capabilities in one extension:

- **Full-page screenshots** of any scrollable page, not just the visible viewport
- **Content extraction** to pull readable text, headings, and structure
- **OnCue handoff** to send extracted content to your personal assistant for research and preparation

Everything is stored locally in your Chrome profile. No data leaves your browser except when you explicitly hand it off.

---

## Features

- **Full-page capture** — Renders the entire scrollable page using an offscreen document, then exports as PNG.
- **Content extraction** — Parses the DOM and extracts readable text with structure preserved (headings, paragraphs, lists).
- **Dashboard** — View, manage, and re-export your saved captures and extractions.
- **OnCue integration** — Send extracted content directly to your assistant via OAuth-authenticated handoff.
- **Welcome flow** — First-run onboarding explains permissions and features.
- **Themed UI** — Light and dark modes with a shared design token system.

---

## Installation (Development)

### Prerequisites

- Chrome 114 or later (Manifest V3, offscreen document API)
- Node.js 18+ (only needed for the `build/minify.js` script; the extension itself has no build step)

### Load the extension

1. Clone the repository:
   ```bash
   git clone https://github.com/muyaallan/full-page.git
   cd full-page
   ```

2. Open Chrome and navigate to `chrome://extensions/`.

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **Load unpacked** and select the `full-page` folder.

5. The extension icon appears in your toolbar. Pin it for quick access.

### Permissions

The extension requests:

| Permission | Why |
| --- | --- |
| `activeTab` | Capture the current page without a host permission prompt |
| `scripting` | Inject the content script to read page structure |
| `storage` | Save captures, extractions, and settings locally |
| `downloads` | Export captures as PNG files |
| `offscreen` | Run DOM work in a background document |

No host permissions are requested globally. The extension only touches the tab you explicitly activate it on.

---

## Usage

1. **Open the popup** — Click the extension icon on any page.
2. **Choose an action**:
   - **Screenshot** — Capture the full scrollable page as PNG.
   - **Extract** — Pull readable content with structure preserved.
3. **Manage your captures** — Click **Dashboard** in the popup to see all saved items.
4. **Hand off to OnCue** — From the extract view, choose **Send to OnCue** to hand off the content with explicit consent.

---

## Project Structure

```text
full-page/
├── manifest.json           # Extension manifest (MV3)
├── sw.js                   # Service worker (background logic, capture orchestration)
├── content.js              # Content script injected into the active page
├── content.css             # Styles injected alongside the content script
├── popup.html              # Toolbar popup (entry point)
├── popup.js                # Popup interactions (screenshot, extract, dashboard)
├── welcome.html            # First-run onboarding
├── welcome.js              # Welcome flow logic
├── dashboard.html          # Saved captures and extractions
├── dashboard.js            # Dashboard interactions
├── dashboard.css           # Dashboard styles
├── extract.html            # Content extraction view
├── extract.js              # Extraction logic and OnCue handoff
├── extract.css             # Extraction view styles
├── screenshot.html         # Screenshot capture view
├── screenshot.js           # Full-page capture logic
├── screenshot.css          # Screenshot view styles
├── auth.js                 # Magic-link authentication helper
├── auth-callback.html      # OAuth callback page
├── auth-callback.js        # Callback handler
├── offscreen.html          # Offscreen document (background DOM work)
├── offscreen.js            # Offscreen document logic
├── ads.js                  # Ad slot integration
├── ad-slot.html            # Ad slot markup
├── theme.css               # Shared design tokens and typography
├── netlify.toml            # Netlify config for the marketing site
├── build/
│   └── minify.js           # Optional minification script
└── icons/
    ├── icon16.png
    ├── icon48.png
    ├── icon128.png
    ├── apple-touch-icon.png
    ├── favicon.ico
    ├── favicon.svg
    └── site.webmanifest
```

---

## Architecture

Full-Page uses Chrome's offscreen document API to do DOM work in the background, so it can render full-page screenshots without freezing the popup or active tab.

**Capture flow**:
1. Popup → sends a `capture` message to the service worker.
2. Service worker → creates an offscreen document.
3. Offscreen document → scrolls the page, stitches the full-page image.
4. Offscreen document → returns the PNG to the service worker.
5. Service worker → saves the capture to `chrome.storage.local`, returns the ID to the popup.
6. Dashboard → reads saved captures from storage.

**Extract flow**:
1. Popup → injects `content.js` into the active tab.
2. Content script → walks the DOM, builds a structured tree of headings and paragraphs.
3. Content script → returns the tree to the popup.
4. Popup → opens the extract view with the structured content.
5. Extract view → allows copy, download, or OnCue handoff.

---

## OnCue Handoff

When you click **Send to OnCue** in the extract view:

1. The extension verifies you have an active OnCue session (via `auth.js`).
2. It opens a consent dialog explaining exactly what will be shared.
3. On confirmation, it POSTs the extracted content to the OnCue API with a per-task token.
4. The response confirms receipt and offers a link to the item in your OnCue workspace.

Nothing is sent without your explicit click. There is no background sync.

---

## Design System

The extension shares a single `theme.css` file that defines design tokens for light and dark modes:

```css
:root {
  --bg: #ffffff;
  --panel: #f8fafc;
  --text: #0f172a;
  --muted: #64748b;
  --accent: #1d6a75;
  --success: #15803d;
  --danger: #dc2626;
  --line: #e2e8f0;
  --r-md: 8px;
  --r-lg: 12px;
  --r-xl: 16px;
  --shadow-1: 0 1px 2px rgba(15, 23, 42, 0.05);
  --shadow-2: 0 4px 12px rgba(15, 23, 42, 0.08);
  --shadow-3: 0 12px 32px rgba(15, 23, 42, 0.12);
}
```

Dark mode is handled via `@media (prefers-color-scheme: dark)` in `theme.css`. Do not hardcode hex values in HTML or JS — use the tokens.

---

## Development

### Run the extension

There is no build step for local development:

1. Edit files in the `full-page` folder.
2. Go to `chrome://extensions/`.
3. Click the reload icon on the Full-Page card.
4. Reload the tab you're testing on (content scripts need a page refresh).

### Optional minification

```bash
node build/minify.js
```

This produces minified copies for distribution. The source files remain untouched.

### Linting

There is no linter configured. If you add one:

```bash
npm init -y
npm install --save-dev eslint
npx eslint .
```

---

## Testing Checklist

Before publishing an update to the Chrome Web Store:

- [ ] Load the unpacked extension in a fresh Chrome profile
- [ ] Capture a full-page screenshot on a long page (e.g. a Wikipedia article)
- [ ] Extract content from a page with complex DOM structure
- [ ] Verify the dashboard shows both new captures and extractions
- [ ] Test OnCue handoff with a real account (or mock the API)
- [ ] Test dark mode (system settings → Appearance → Dark)
- [ ] Test on a page with restrictive CSP (should fail gracefully, not crash)
- [ ] Test on a page that requires scrolling (lazy-loaded images)
- [ ] Test the welcome flow on a fresh install
- [ ] Verify no console errors in the service worker (`chrome://extensions` → Details → Service worker)
- [ ] Verify no console errors in the popup (right-click → Inspect)

---

## Publishing

1. Bump `version` in `manifest.json` (semantic versioning).
2. Run `node build/minify.js` if distributing minified.
3. Zip the `full-page` folder (exclude `.git`, `node_modules`, `.gitignore`, and any `.bak` files).
4. Upload to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
5. Update the listing screenshots and description if features changed.
6. Submit for review (typically 1-3 business days).

---

## Security Notes

- The extension does not make network requests except when you explicitly click **Send to OnCue**.
- Content extracted from pages is stored in `chrome.storage.local`, which is per-profile and not synced to Google.
- Captures are stored as base64 PNGs in the same store. Old captures can be cleared from the dashboard.
- OAuth tokens for OnCue are stored in `chrome.storage.local` and can be revoked from the dashboard.

---

## License

MIT License

Copyright (c) 2026 Full-Page Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
