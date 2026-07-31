# Teams Transcript Copier

Chrome extension for Microsoft Teams **web** (teams.microsoft.com). Select messages like files in a file manager (Cmd/Ctrl-click, Shift-click), then copy or export them as a clean, AI-ready transcript with timestamps, authors, quoted replies, links, emojis, and images.

Works only in the browser. The Teams desktop app is Electron and unreachable by Chrome extensions.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** and select this folder
4. Open or reload teams.microsoft.com

## Usage

Standard file-manager selection, applied to messages:

- **Cmd-click** (Mac) / **Ctrl-click** (Windows): toggle a single message in or out of the selection. The clicked message becomes the *anchor*.
- **Shift-click**: select the range from the anchor to the clicked message. Shift-clicking again re-extends from the same anchor, replacing the previous extension. While Shift is held, hovering previews the range a click would select.
- **Cmd/Ctrl+Shift-click**: add a second range to the existing selection.
- **Esc**: clear the selection (ignored while typing in the compose box).

Workflow: open a chat (the **⧉ Transcript** panel appears bottom-right), select your messages, **scroll through any long range** so every message passes through the viewport (Teams unmounts off-screen messages; the extension captures them as they appear), then hit **Copy** (markdown), **JSON**, or **Export**. The ↺ header icon resets the capture.

**Export** saves a bundle to `Downloads/teams-transcript-<date>-<time>/`: `transcript.md` plus each image as `img-N.<ext>` (extension from the real content-type), referenced in place with markdown image syntax (`![image](img-1.jpg)`) so the transcript renders its images in any markdown viewer and AI tools load them as images. This is the format to feed an AI that should *see* the images: point it at the folder. Failed image downloads degrade to their URL placeholder, so the transcript is never broken.

The status dot is green when every selected range is provably complete, amber when a selected range may have an uncaptured hole (scroll back through it). Deliberately skipped messages are not warnings; they become `[...]` markers in the transcript. **Reset** clears everything; switching chats resets automatically.

## Output format

```
--- 2026-07-31 ---

[12:03] Ayesha:
Can we get the coupon window into this sprint?

[12:05] Bilal (edited):
> replying to Ayesha (7/31/2026 12:03 PM): "Can we get the coupon window into this sprint?"
Yes, depends on the fulfilment-date design sign-off.
[image: budget screenshot]
```

- Quoted replies become `> replying to Author (time): "snippet"` lines, kept at their true position in the message. A message can contain several quotes (even interleaved with text); each is extracted separately. JSON output carries them structured under `quotes`.
- Timestamps come from the message id (epoch milliseconds), so dates survive even though Teams only displays clock times.
- Consecutive messages from one sender (where Teams hides the name) get the author carried forward.
- Your own messages are labelled **Me** (Teams renders them without an author name). Find-and-replace after pasting if you want your real name.
- Emojis come through as characters, links as `text (url)`, code blocks fenced.
- Images: **Copy/JSON** render them as `[image: <url>]` using Teams' media URL. Those URLs are cookie-authenticated: they open for anyone signed into Teams but are not fetchable by an AI, which is what **Export** is for (local files, referenced by name).

## How it works (for maintenance)

- **Virtualization**: Teams only mounts a window of messages. A `MutationObserver` drains every paint into a `Map` keyed by message id; copy reads the map, never the DOM.
- **Completeness**: each scan records which ids were adjacent in the same paint. A range is "complete" only when its sorted ids form an unbroken chain of those confirmed edges. That is what drives the green/amber dot.
- **Selectors**: everything DOM-specific lives in the `SEL` object at the top of `content.js`. When a Teams redesign breaks capture (panel stuck at 0, missing authors), fix candidates there. Prefer `data-tid` attributes and Fluent slot classes (`fui-ChatMessage__body`) over hashed class names. Message ids are found generically (any 13-digit epoch in nearby attributes), so id extraction usually survives redesigns.

## Tests

`tests/test.js` runs `content.js` in jsdom against a real captured Teams message (`tests/fixture.html`) plus a synthetic double-quote message, and asserts extraction end-to-end. `npm install` once, then `npm test`. Run it after any selector change. In a live Teams tab, `window.__ttc` exposes `scan()`, `store`, and `markdown()` in the DevTools console for diagnosis.

## Store assets & publishing

- `store-assets/brand.html` is the design source of truth: palette, cursor, icon, widget states, and the store banners, all at exact pixel sizes. Iterate there in a browser.
- `tools/export-assets.sh` renders the finalized designs to PNGs via headless Chrome: `icons/icon{16,32,48,128}.png`, the 440×280 promo tile, and the 1400×560 marquee.
- `npm run pack` builds `dist/teams-transcript-copier.zip` containing runtime files only (manifest, scripts, CSS, icons); tests and fixtures never ship.
- Screenshots are the one manual asset: 1280×800, captured from a dummy chat (guidance at the bottom of brand.html).

## Known limitations

- Built for the chat pane. Channel posts/replies share most of the DOM structure but are untested.
- System messages ("X joined the chat") are skipped.
- Attachments become `[attachment: name](sharepoint-url)` links; file contents are not downloaded.
- If your tenant ever grants Microsoft Graph `Chat.Read`, `GET /chats/{id}/messages` beats DOM scraping outright and this extension becomes obsolete.
