'use strict';
(() => {
  if (globalThis.__ttcLoaded) return;
  const TTC = (globalThis.TTC = globalThis.TTC || {});

  // Selectors: the only place to touch when Teams ships a DOM change.
  // data-tid attributes and schema.skype.com itemtypes outlive the hashed
  // utility classes Teams regenerates every build.
  const SEL = {
    message: ['[data-tid="chat-pane-message"]', '.fui-ChatMessage', '.fui-ChatMyMessage'],
    author: ['[data-tid="message-author-name"]', '.fui-ChatMessage__author'],
    // id="message-body-<id>" is the whole message wrapper, NOT the body;
    // real content is [data-message-content] / id="content-<id>"
    body: ['[data-message-content]', '[id^="content-"]', '.fui-ChatMessage__body', '.fui-ChatMyMessage__body'],
    quote: [
      '[data-track-module-name="messageQuotedReply"]',
      '[data-tid="quoted-reply-card"]',
      '[data-tid*="quoted" i]',
      '[itemtype*="Reply"]',
      '[class*="quotedReply" i]',
    ],
    quoteTime: ['[data-tid="quoted-reply-timestamp"]'],
    quoteText: ['[data-tid="quoted-reply-preview-content"]'],
    attachments: ['[data-tid="file-attachment-grid"]', '[id^="attachments-"]'],
    edited: ['[data-tid="message-edited"]', '[class*="editedIndicator" i]'],
  };

  const IS_MAC = /Mac/.test(navigator.platform);
  // Message ids are epoch milliseconds: 13 digits, leading 1 until 2033.
  const ID_RE = /\b(1\d{12})\b/;
  // Timestamp Teams stamps into quote cards: "7/30/2026 3:31 PM" or "30/07/2026 15:31"
  const QUOTE_TS_RE = /\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?:\s?[AP]M)?/i;

  TTC.config = {
    VERSION: '0.10.1',
    SEL,
    MSG_SEL: SEL.message.join(','),
    MINE_SEL: '[class*="ChatMyMessage"]',
    IS_MAC,
    MOD_KEY: IS_MAC ? '⌘' : 'Ctrl',
    ALT_KEY: IS_MAC ? '⌥' : 'Alt+',
    ID_RE,
    QUOTE_TS_RE,
    QUOTE_META_RE: new RegExp(`^(.*?)\\s*(${QUOTE_TS_RE.source})\\s*(.*)$`, 'i'),
    // Fallback when no quote selector matches: a leading "<author><date time> …snippet…"
    // chunk before a blank line. Text-only, so it survives any DOM redesign.
    QUOTE_SPLIT_RE: new RegExp(
      `^([^\\n]{0,60}?${QUOTE_TS_RE.source}[\\s\\S]{0,500}?(?:…|\\.\\.\\.))\\s*\\n+([\\s\\S]+)$`,
      'i'
    ),
  };
})();
