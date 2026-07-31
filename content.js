(() => {
  'use strict';
  if (window.__ttcLoaded) return;
  window.__ttcLoaded = true;

  const VERSION = '0.9.1';

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
    attachments: ['[data-tid="file-attachment-grid"]', '[id^="attachments-"]'],
    quoteText: ['[data-tid="quoted-reply-preview-content"]'],
    edited: ['[data-tid="message-edited"]', '[class*="editedIndicator" i]'],
  };
  const MSG_SEL = SEL.message.join(',');
  const MINE_SEL = '[class*="ChatMyMessage"]';
  const IS_MAC = /Mac/.test(navigator.platform);
  const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

  // Message ids are epoch milliseconds: 13 digits, leading 1 until 2033.
  const ID_RE = /\b(1\d{12})\b/;
  // Timestamp Teams stamps into quote cards: "7/30/2026 3:31 PM" or "30/07/2026 15:31"
  const QUOTE_TS_RE = /\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?:\s?[AP]M)?/i;
  const QUOTE_META_RE = new RegExp(`^(.*?)\\s*(${QUOTE_TS_RE.source})\\s*(.*)$`, 'i');
  // Fallback when no quote selector matches: a leading "<author><date time> …snippet…"
  // chunk before a blank line. Text-only, so it survives any DOM redesign.
  const QUOTE_SPLIT_RE = new RegExp(
    `^([^\\n]{0,60}?${QUOTE_TS_RE.source}[\\s\\S]{0,500}?(?:…|\\.\\.\\.))\\s*\\n+([\\s\\S]+)$`,
    'i'
  );

  const qs = (root, candidates) => {
    for (const s of candidates) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };
  const collapse = (s) => s.replace(/\s+/g, ' ').trim();
  const p2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const fmtTime = (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const plural = (n) => `${n} message${n === 1 ? '' : 's'}`;

  const store = new Map(); // id -> {id, author, body, quotes, images, attachments, edited}
  const edges = new Set(); // "idA|idB" pairs proven adjacent in a single DOM paint
  let selection = new Set();
  let anchor = null; // last non-shift-clicked id; shift ranges extend from here
  let lastNodes = new Map(); // id -> currently mounted DOM node (refreshed each scan)
  let expanded = true;
  let panelVisible = false;
  let exporting = false;

  // ----- extraction: DOM node in, plain record out -----

  function findMessageId(node) {
    const idEl =
      node.querySelector('[id^="message-body-"]') ||
      (node.id && node.id.startsWith('message-body-') ? node : null);
    const m = idEl && idEl.id.match(/\d{13}/);
    if (m) return m[0];
    let cur = node;
    for (let depth = 0; cur && cur.attributes && depth < 4; depth++, cur = cur.parentElement) {
      for (const attr of cur.attributes) {
        const hit = attr.value.match(ID_RE);
        if (hit) return hit[1];
      }
    }
    return null;
  }

  const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'TABLE', 'TR', 'BLOCKQUOTE', 'H1', 'H2', 'H3']);
  const isMention = (el) => /Mention/i.test(el.getAttribute('itemtype') || '');
  // a wrapper whose sole content is a mention must render inline, not as a block
  const isMentionWrapper = (el) =>
    el.childElementCount === 1 &&
    isMention(el.firstElementChild) &&
    el.textContent.trim() === el.firstElementChild.textContent.trim();

  // AMS urls are cookie-authenticated but durable; blob:/data: srcs die with
  // the session, so only http(s) urls are worth keeping
  const imageUrl = (imgEl) => {
    if (!imgEl) return null;
    for (const attr of ['data-orig-src', 'data-gallery-src', 'src']) {
      const u = imgEl.getAttribute(attr);
      if (u && /^https?:/i.test(u)) return u;
    }
    return null;
  };

  function serializeBody(root, images) {
    const imageToken = (imgEl, alt) => {
      images.push({ url: imageUrl(imgEl), alt: alt || '' });
      return `\n\u0000IMG${images.length - 1}\u0000\n`;
    };
    const parts = [];
    (function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      const tag = el.tagName;
      if (tag === 'STYLE' || tag === 'SCRIPT' || el.getAttribute('aria-hidden') === 'true') return;
      if (tag === 'BR') {
        parts.push('\n');
        return;
      }
      if (isMention(el) || isMentionWrapper(el)) {
        parts.push('@' + el.textContent.trim());
        return;
      }
      const itemtype = el.getAttribute('itemtype') || '';
      if (/AMSImage/i.test(itemtype)) {
        // image embed wrapper; skip children so loading placeholders add no text
        parts.push(imageToken(el.querySelector('img')));
        return;
      }
      if (tag === 'IMG') {
        // Teams renders emojis as <img>; innerText would silently drop them
        const alt = (el.getAttribute('alt') || '').trim();
        const isEmoji = /Emoji/i.test(itemtype) || (alt && /^\p{Extended_Pictographic}/u.test(alt));
        parts.push(isEmoji ? alt : imageToken(el, alt));
        return;
      }
      if (tag === 'A') {
        const text = el.textContent.trim();
        const href = el.getAttribute('href') || '';
        parts.push(text && href && text !== href && !href.startsWith('#') ? `${text} (${href})` : text || href);
        return;
      }
      if (tag === 'PRE' || tag === 'CODE') {
        const t = el.textContent;
        parts.push(t.includes('\n') ? `\n\`\`\`\n${t.replace(/\n$/, '')}\n\`\`\`\n` : '`' + t + '`');
        return;
      }
      if (tag === 'LI') {
        parts.push('\n- ');
        el.childNodes.forEach(walk);
        return;
      }
      const block = BLOCK_TAGS.has(tag);
      if (block) parts.push('\n');
      el.childNodes.forEach(walk);
      if (block) parts.push('\n');
    })(root);
    return parts
      .join('')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractMessage(node) {
    const id = findMessageId(node);
    if (!id) return null;
    const authorEl = qs(node, SEL.author);
    // follow-up messages from one sender have no author node; resolveAuthors fills them
    const author = node.closest(MINE_SEL) ? 'Me' : authorEl ? authorEl.textContent.trim() : null;

    const clone = (qs(node, SEL.body) || node).cloneNode(true);

    // quote cards can appear anywhere, repeatedly; placeholders keep their position
    const quotes = [];
    for (const card of findQuoteCards(clone)) {
      const q = parseQuoteCard(card);
      card.replaceWith(document.createTextNode(`\n\u0000Q${quotes.length}\u0000\n`));
      quotes.push(q);
    }

    const images = [];
    let body = serializeBody(clone, images);
    if (!quotes.length) {
      const split = body.match(QUOTE_SPLIT_RE);
      if (split && split[2].trim()) {
        quotes.push(parseQuoteText(collapse(split[1])));
        body = '\u0000Q0\u0000\n' + split[2].trim();
      }
    }
    body = body.replace(/\u0000Q(\d+)\u0000/g, (_, i) => formatQuoteLine(quotes[+i])).trim();

    return { id, author, body, quotes, images, attachments: extractAttachments(node), edited: !!qs(node, SEL.edited) };
  }

  // file cards live OUTSIDE the content div, as a sibling grid in the message
  // wrapper; the card title's aria-label carries "<filename>\n<sharepoint url>"
  function extractAttachments(node) {
    const grid = qs(node, SEL.attachments);
    if (!grid) return [];
    const titles = [...grid.querySelectorAll('[data-testid="content-card-custom-title"]')];
    if (titles.length) {
      return titles
        .map((el) => {
          const [name, ...rest] = (el.getAttribute('aria-label') || el.textContent).split('\n');
          const url = rest.map((l) => l.trim()).find((l) => /^https?:/i.test(l));
          return { name: collapse(name), url: url || null };
        })
        .filter((a) => a.name);
    }
    return [...grid.querySelectorAll('[role="group"][aria-label]')].map((g) => ({
      name: collapse(g.getAttribute('aria-label')),
      url: null,
    }));
  }

  // outermost matches only: a card's wrapper and its inner tid-bearing
  // spans all match SEL.quote candidates
  function findQuoteCards(clone) {
    const all = [...clone.querySelectorAll(SEL.quote.join(','))];
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
  }

  function parseQuoteCard(card) {
    const timeEl = qs(card, SEL.quoteTime);
    const textEl = qs(card, SEL.quoteText);
    if (!timeEl && !textEl) return parseQuoteText(collapse(card.textContent));
    const authorEl = card.querySelector('span');
    return {
      author: authorEl ? authorEl.textContent.trim() : null,
      time: timeEl ? timeEl.textContent.trim() : null,
      text: textEl ? collapse(textEl.textContent) : '',
    };
  }

  function parseQuoteText(raw) {
    if (!raw) return null;
    const m = raw.match(QUOTE_META_RE);
    return m && m[1] ? { author: m[1].trim(), time: m[2].trim(), text: m[3].trim() } : { text: raw };
  }

  function formatQuoteLine(q) {
    if (!q) return '';
    const who = q.author ? ` ${q.author}${q.time ? ` (${q.time})` : ''}` : '';
    return `> replying to${who}: "${truncate(q.text || '', 160)}"`;
  }

  // ----- scanner: drains the virtualized DOM into the store on every paint -----

  function scan() {
    const all = document.querySelectorAll(MSG_SEL);
    if (!all.length) {
      updatePanel();
      return;
    }
    // candidates can match nested wrappers of one message; keep outermost only
    const top = [...all].filter((n) => !n.parentElement || !n.parentElement.closest(MSG_SEL));
    const nodeById = new Map();
    for (const n of top) {
      const rec = extractMessage(n);
      if (!rec) continue;
      if (!nodeById.has(rec.id)) nodeById.set(rec.id, n);
      const prev = store.get(rec.id);
      // a mid-render scan can catch a half-mounted node; keep the richer record
      if (!prev || (rec.body || '').length >= (prev.body || '').length) store.set(rec.id, rec);
    }
    // 13-digit ids sort lexicographically == chronologically
    const seen = [...nodeById.keys()].sort();
    for (let i = 1; i < seen.length; i++) edges.add(seen[i - 1] + '|' + seen[i]);
    lastNodes = nodeById;
    applyHighlights();
    if (!panelVisible && store.size) showPanel();
    updatePanel();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 350);
  }

  // ----- selection: explicit set + anchor, standard file-manager semantics -----

  const sortedSelection = () => [...selection].sort();

  function rangeBetween(a, b) {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return [...store.keys()].filter((id) => id >= lo && id <= hi);
  }

  function toggleOne(id) {
    selection.has(id) ? selection.delete(id) : selection.add(id);
    anchor = id;
    refresh();
  }

  // re-clicking re-extends from the same anchor, replacing the previous extension
  function replaceRange(id) {
    if (!anchor) anchor = id;
    selection = new Set(rangeBetween(anchor, id));
    refresh();
  }

  function addRange(id) {
    if (!anchor) anchor = id;
    for (const x of rangeBetween(anchor, id)) selection.add(x);
    refresh();
  }

  function clearSelection() {
    selection.clear();
    anchor = null;
    refresh();
  }

  // a run breaks only on captured-but-unselected messages (a deliberate gap);
  // a never-captured hole stays in-run and its missing edge flags it instead
  function selectedRuns() {
    const storeIdx = new Map([...store.keys()].sort().map((id, i) => [id, i]));
    const runs = [];
    let run = [];
    for (const id of sortedSelection()) {
      if (run.length && storeIdx.get(id) - storeIdx.get(run[run.length - 1]) > 1) {
        runs.push(run);
        run = [];
      }
      run.push(id);
    }
    if (run.length) runs.push(run);
    return runs;
  }

  const runComplete = (run) => run.every((id, i) => i === 0 || edges.has(run[i - 1] + '|' + id));

  function refresh() {
    applyHighlights();
    updatePanel();
  }

  function applyHighlights() {
    // sweep first: re-renders can leave marked nodes that dropped out of lastNodes
    document.querySelectorAll('.ttc-selected').forEach((n) => n.classList.remove('ttc-selected'));
    for (const [id, node] of lastNodes) {
      if (selection.has(id)) node.classList.add('ttc-selected');
    }
  }

  let previewNodes = [];
  function setPreview(ids) {
    for (const n of previewNodes) n.classList.remove('ttc-preview');
    previewNodes = ids.map((id) => lastNodes.get(id)).filter(Boolean);
    for (const n of previewNodes) n.classList.add('ttc-preview');
  }

  function fullReset() {
    selection.clear();
    anchor = null;
    store.clear();
    edges.clear();
    setPreview([]);
    applyHighlights();
    scheduleScan();
    updatePanel();
  }

  // ----- output builders: records in, string out -----

  // carry-forward runs over the WHOLE store, not just the selection, so a
  // selection starting on a follow-up message still inherits the right author
  function resolveAuthors() {
    const resolved = new Map();
    let last = null;
    for (const id of [...store.keys()].sort()) {
      const r = { ...store.get(id) };
      r.author = r.author || last || 'Unknown';
      last = r.author;
      resolved.set(id, r);
    }
    return resolved;
  }

  function selectionRecords() {
    const resolved = resolveAuthors();
    const recs = [];
    selectedRuns().forEach((run, ri) => {
      run.forEach((id, i) => recs.push({ ...resolved.get(id), gapBefore: ri > 0 && i === 0 }));
    });
    return recs;
  }

  // labels strip brackets and urls encode parens so hostile filenames/alt text
  // cannot break out of markdown link syntax and forge their own targets
  const mdLabel = (s) => collapse(s || '').replace(/[[\]]/g, '');
  const mdUrl = (u) => u.replace(/\(/g, '%28').replace(/\)/g, '%29');

  const urlImageRef = (img) => (img.url ? `[image: ${img.url}]` : img.alt ? `[image: ${img.alt}]` : '[image]');
  // saved files use real markdown image syntax so viewers render them and AI
  // tools load them; url fallbacks stay bracketed text so they never look like
  // broken images
  const fileImageRef = (nameByUrl) => (img) => {
    const file = img.url && nameByUrl.get(img.url);
    return file ? `![${mdLabel(img.alt) || 'image'}](${file})` : urlImageRef(img);
  };

  const materializeImages = (r, imageRef) =>
    r.body.replace(/\u0000IMG(\d+)\u0000/g, (_, i) => imageRef(r.images[+i] || {}));

  // links render fine even when auth-gated, so attachments keep md link syntax everywhere
  const attachmentLine = (a) =>
    a.url ? `[attachment: ${mdLabel(a.name)}](${mdUrl(a.url)})` : `[attachment: ${mdLabel(a.name)}]`;

  function buildMarkdown(recs, imageRef = urlImageRef) {
    const out = [];
    let lastDay = '';
    for (const r of recs) {
      if (r.gapBefore) out.push('[...]', '');
      const d = new Date(Number(r.id));
      const day = fmtDate(d);
      if (day !== lastDay) {
        out.push(`--- ${day} ---`, '');
        lastDay = day;
      }
      const lines = [materializeImages(r, imageRef), ...r.attachments.map(attachmentLine)].filter(Boolean);
      out.push(`[${fmtTime(d)}] ${r.author}${r.edited ? ' (edited)' : ''}:`, lines.join('\n') || '[no text]', '');
    }
    return out.join('\n').trim() + '\n';
  }

  function buildJson(recs) {
    return JSON.stringify(
      recs.map((r) => ({
        id: r.id,
        time: new Date(Number(r.id)).toISOString(),
        author: r.author,
        edited: r.edited,
        afterGap: r.gapBefore || undefined,
        quotes: r.quotes || [],
        images: r.images.map((i) => i.url).filter(Boolean),
        attachments: r.attachments,
        body: materializeImages(r, urlImageRef),
      })),
      null,
      2
    );
  }

  const sendToWorker = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch {
        resolve(null);
      }
    });

  // the transcript is built only after the worker reports what actually saved,
  // so failed images degrade to url placeholders instead of dead filenames
  async function exportBundle() {
    if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
      showToast('Export needs the extension runtime');
      return;
    }
    const recs = selectionRecords();
    const d = new Date();
    const folder = `teams-transcript-${fmtDate(d)}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const urls = [...new Set(recs.flatMap((r) => r.images.map((i) => i.url).filter(Boolean)))];
    exporting = true;
    updatePanel();
    try {
      const res = (await sendToWorker({ type: 'ttc-export-images', folder, urls })) || { saved: [] };
      const markdown = buildMarkdown(recs, fileImageRef(new Map(res.saved)));
      const ok = await sendToWorker({ type: 'ttc-save-text', folder, filename: 'transcript.md', text: markdown });
      showToast(ok ? `Exported ${plural(recs.length)} · ${res.saved.length}/${urls.length} images to Downloads` : 'Export failed');
    } finally {
      exporting = false;
      updatePanel();
    }
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast(label);
  }

  // ----- panel UI (shadow DOM: Teams CSS cannot touch it, ours cannot leak out) -----

  const POINTER = (size, color) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 28 28"><path d="M4.5 4.5 L23.5 10.2 L14.4 14.4 L10.2 23.5 Z" fill="${color}" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/></svg>`;

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; font-family: -apple-system, "Segoe UI", system-ui, sans-serif; }
      button { cursor: pointer; border: none; background: none; font: inherit; }
      .hidden { display: none !important; }

      #pill {
        display: flex; align-items: center; gap: 7px;
        background: #5b5fc7; color: #fff;
        border-radius: 999px; padding: 10px 16px;
        font-size: 13px; font-weight: 600;
        box-shadow: 0 4px 14px rgba(0,0,0,.18);
      }
      #pill:hover { background: #4f52b2; }

      #card {
        width: 300px; background: #fff; color: #242424;
        border: 1px solid #e3e3e6; border-radius: 16px;
        box-shadow: 0 10px 30px rgba(0,0,0,.12);
        padding: 18px; font-size: 13px;
      }
      .hd { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; cursor: grab; -webkit-user-select: none; user-select: none; }
      .hd svg.logo { flex: none; }
      .title { font-weight: 650; font-size: 14px; flex: 1; letter-spacing: 0.1px; }
      .hd button { color: #8a8a8e; padding: 3px; border-radius: 6px; line-height: 0; }
      .hd button:hover { background: #f0f0f2; color: #242424; }

      .hero { display: flex; align-items: center; justify-content: space-between; }
      .num { font-size: 30px; font-weight: 700; letter-spacing: -0.5px; line-height: 1; }
      .badge { font-size: 11px; font-weight: 650; white-space: nowrap; padding: 4px 10px; border-radius: 999px; }
      .badge.ok { background: #e6f4e6; color: #0e7a0a; }
      .badge.warn { background: #fff4d5; color: #b25e00; }
      .sub { margin-top: 5px; font-size: 12.5px; color: #8a8a8e; }
      #range { margin-top: 12px; font-size: 12.5px; color: #8a8a8e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #range b { color: #242424; font-weight: 600; }

      #empty { padding: 8px 0 4px; text-align: center; }
      #empty .line { display: flex; align-items: center; justify-content: center; gap: 7px; color: #8a8a8e; font-size: 12.5px; margin: 7px 0; }
      kbd {
        font-family: inherit; background: #f0f0f2; border: 1px solid #e3e3e6;
        border-bottom-width: 2px; border-radius: 5px; padding: 2px 6px; font-size: 12px; color: #242424;
      }

      #warn {
        margin-top: 12px; padding: 9px 11px; border-radius: 9px;
        background: #fff4d5; color: #6d5900; font-size: 12px; line-height: 1.45;
      }
      .div { height: 1px; background: #e3e3e6; margin-top: 16px; }

      .btns { display: flex; gap: 8px; margin-top: 12px; }
      .btns button {
        flex: 1; padding: 9px 0; border-radius: 9px;
        font-size: 13px; font-weight: 600;
        background: #f0f0f2; color: #242424;
      }
      .btns button:hover { background: #e4e4e8; }
      .btns button:disabled { opacity: .4; cursor: default; }
      .btns .primary { background: #5b5fc7; color: #fff; flex: 1.5; }
      .btns .primary:hover:not(:disabled) { background: #4f52b2; }

      .foot { display: flex; margin-top: 14px; font-size: 11px; color: #8a8a8e; }
      .foot .v { margin-left: auto; opacity: .7; }

      #toast {
        position: absolute; bottom: calc(100% + 8px); right: 0;
        background: #242424; color: #fff; font-size: 12px;
        padding: 7px 12px; border-radius: 8px; white-space: nowrap;
        box-shadow: 0 4px 14px rgba(0,0,0,.2);
      }

      @media (prefers-color-scheme: dark) {
        #card { background: #292929; color: #eee; border-color: #3d3d3d; }
        .hd button { color: #9a9a9e; }
        .hd button:hover { background: #3a3a3a; color: #eee; }
        .sub, #range, .foot { color: #9a9a9e; }
        #range b { color: #eee; }
        #empty .line { color: #9a9a9e; }
        kbd { background: #3a3a3a; border-color: #4a4a4a; color: #eee; }
        .div { background: #3d3d3d; }
        .btns button { background: #3a3a3a; color: #eee; }
        .btns button:hover { background: #454545; }
        .btns .primary { background: #5b5fc7; color: #fff; }
        .badge.ok { background: #123c10; color: #7ed47a; }
        #warn { background: #4a3f14; color: #ffdf80; }
      }
    </style>
    <div id="toast" class="hidden"></div>
    <button id="pill" class="hidden">${POINTER(13, '#fff')}<span id="pillLabel">Transcript</span></button>
    <div id="card" class="hidden">
      <div class="hd">
        <span class="logo" style="line-height:0">${POINTER(15, '#5b5fc7')}</span>
        <span class="title">Transcript</span>
        <button id="reset" title="Reset capture"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 1.5v3h-3"/></svg></button>
        <button id="min" title="Collapse"><svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 8H12.5"/></svg></button>
      </div>
      <div id="empty">
        <div class="line"><kbd>${MOD_KEY}</kbd><span>click a message to start</span></div>
        <div class="line"><kbd>⇧</kbd><span>click extends the range</span></div>
      </div>
      <div id="stats" class="hidden">
        <div class="hero">
          <span class="num" id="num">0</span>
          <span class="badge ok" id="badge">✓ Complete</span>
        </div>
        <div class="sub" id="sub"></div>
        <div id="range"></div>
      </div>
      <div id="warn" class="hidden">Scroll through the conversation so every message gets captured, then copy.</div>
      <div class="div"></div>
      <div class="btns">
        <button id="copy" class="primary" disabled>Copy</button>
        <button id="json" disabled>JSON</button>
        <button id="export" disabled>Export</button>
      </div>
      <div class="foot"><span id="footLeft"></span><span class="v">v${VERSION}</span></div>
    </div>`;
  document.documentElement.appendChild(host);

  const ui = {};
  for (const id of ['pill', 'pillLabel', 'card', 'empty', 'stats', 'num', 'badge', 'sub', 'range', 'warn', 'copy', 'json', 'export', 'reset', 'min', 'footLeft', 'toast']) {
    ui[id] = shadow.getElementById(id);
  }

  // ----- drag: an overlay pays rent for covering Teams by being movable -----
  const POS_KEY = 'ttc-pos';

  const clampPos = (x, y, w, h, vw, vh) => ({
    x: Math.min(Math.max(x, 8), Math.max(8, vw - w - 8)),
    y: Math.min(Math.max(y, 8), Math.max(8, vh - h - 8)),
  });

  const loadPos = () => {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY));
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    } catch {
      return null;
    }
  };
  const savePos = (p) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(p));
    } catch {}
  };

  function applyPos(p) {
    host.style.left = p.x + 'px';
    host.style.top = p.y + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  }

  function restorePos() {
    const p = loadPos();
    if (!p) return;
    const r = host.getBoundingClientRect();
    applyPos(clampPos(p.x, p.y, r.width, r.height, innerWidth, innerHeight));
  }

  function resetPos() {
    try {
      localStorage.removeItem(POS_KEY);
    } catch {}
    host.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;';
  }

  let dragJustEnded = false;
  function makeDraggable(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (handle !== ui.pill && e.target.closest('button')) return; // header buttons still click
      const rect = host.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      let moved = false;
      const move = (ev) => {
        // 4px threshold so a sloppy click never turns into a micro-drag
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        moved = true;
        applyPos(clampPos(ev.clientX - offX, ev.clientY - offY, rect.width, rect.height, innerWidth, innerHeight));
      };
      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        if (!moved) return;
        const r = host.getBoundingClientRect();
        savePos({ x: r.left, y: r.top });
        dragJustEnded = true; // swallow the click that follows a pill drag
        setTimeout(() => (dragJustEnded = false), 0);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      e.preventDefault();
    });
  }

  window.addEventListener('resize', () => {
    if (loadPos()) restorePos();
  });

  function showPanel() {
    panelVisible = true;
    (expanded ? ui.card : ui.pill).classList.remove('hidden');
    restorePos();
  }

  // author names are message content: build the range line from text nodes,
  // never markup
  function renderRange(ids) {
    const part = (id) => {
      const rec = store.get(id);
      const b = document.createElement('b');
      b.textContent = fmtTime(new Date(Number(id)));
      return [b, document.createTextNode(' ' + ((rec && rec.author) || '…'))];
    };
    const nodes = part(ids[0]);
    if (ids.length > 1) nodes.push(document.createTextNode('  →  '), ...part(ids[ids.length - 1]));
    ui.range.replaceChildren(...nodes);
  }

  function updatePanel() {
    if (!panelVisible) return;
    const ids = sortedSelection();
    const runs = selectedRuns();
    const active = ids.length > 0;
    const complete = active && runs.every(runComplete);
    ui.empty.classList.toggle('hidden', active);
    ui.stats.classList.toggle('hidden', !active);
    if (active) {
      ui.num.textContent = String(ids.length);
      ui.sub.textContent =
        `message${ids.length === 1 ? '' : 's'}` + (runs.length > 1 ? ` · ${runs.length} ranges` : '');
      ui.badge.textContent = complete ? '✓ Complete' : 'Possible gap';
      ui.badge.className = 'badge ' + (complete ? 'ok' : 'warn');
      renderRange(ids);
    }
    ui.warn.classList.toggle('hidden', !(active && !complete));
    ui.footLeft.textContent = active ? `${MOD_KEY} select · ⇧ range · Esc clear` : `${store.size} captured`;
    ui.pillLabel.textContent = active ? String(ids.length) : 'Transcript';
    ui.copy.disabled = ui.json.disabled = !active;
    ui.export.disabled = !active || exporting;
  }

  let toastTimer = null;
  function showToast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), 2200);
  }

  const copyHandler = (build, suffix) => () => {
    const recs = selectionRecords();
    copyText(build(recs), `${plural(recs.length)} copied${suffix}`);
  };
  ui.copy.addEventListener('click', copyHandler(buildMarkdown, ''));
  ui.json.addEventListener('click', copyHandler(buildJson, ' as JSON'));
  ui.export.addEventListener('click', exportBundle);
  ui.min.addEventListener('click', () => {
    expanded = false;
    ui.card.classList.add('hidden');
    ui.pill.classList.remove('hidden');
  });
  makeDraggable(shadow.querySelector('.hd'));
  makeDraggable(ui.pill);
  shadow.querySelector('.title').addEventListener('dblclick', resetPos);
  ui.pill.addEventListener('click', () => {
    if (dragJustEnded) return;
    expanded = true;
    ui.pill.classList.add('hidden');
    ui.card.classList.remove('hidden');
    updatePanel();
  });
  ui.reset.addEventListener('click', () => {
    fullReset();
    showToast('Selection cleared');
  });

  // ----- page listeners -----

  // macOS ctrl+click is the system right-click, so the select-modifier is platform-gated
  const isSelectKey = (e) => (IS_MAC ? e.metaKey : e.ctrlKey);
  const messageAt = (e) => (e.target.closest ? e.target.closest(MSG_SEL) : null);

  // text selection starts on mousedown; stop it before it paints over the chat
  document.addEventListener(
    'mousedown',
    (e) => {
      if (e.shiftKey && messageAt(e)) e.preventDefault();
    },
    true
  );

  document.addEventListener(
    'click',
    (e) => {
      if (!e.shiftKey && !isSelectKey(e)) return;
      const node = messageAt(e);
      if (!node) return;
      const id = findMessageId(node);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      getSelection().removeAllRanges();
      scan(); // make sure the clicked message and its neighbours are captured
      // ctrl+shift adds on macOS too: bare ctrl+click belongs to the system
      // context menu there, but with shift held the click comes through
      if (e.shiftKey && (isSelectKey(e) || e.ctrlKey)) addRange(id);
      else if (e.shiftKey) replaceRange(id);
      else toggleOne(id);
    },
    true
  );

  let hovered = null;
  function setHover(node) {
    if (node === hovered) return;
    if (hovered) hovered.classList.remove('ttc-hover');
    if (node) node.classList.add('ttc-hover');
    hovered = node;
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      const node = e.shiftKey || isSelectKey(e) ? messageAt(e) : null;
      setHover(node);
      const id = e.shiftKey && anchor && node ? findMessageId(node) : null;
      setPreview(id ? rangeBetween(anchor, id) : []);
    },
    true
  );

  document.addEventListener('keyup', (e) => {
    if (!e.shiftKey) setPreview([]);
    if (!e.shiftKey && !isSelectKey(e)) setHover(null);
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !selection.size) return;
      const a = document.activeElement;
      if (a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
      clearSelection();
    },
    true
  );

  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
  setInterval(scheduleScan, 2000);
  scheduleScan();

  // mixing chats would corrupt the store and adjacency edges: reset on switch
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (store.size || selection.size) {
      fullReset();
      if (panelVisible) showToast('Chat changed, capture reset');
    }
  }, 1000);

  // console diagnosis + tests: __ttc.scan(); __ttc.toggle(id); __ttc.markdown()
  window.__ttc = {
    version: VERSION,
    store,
    scan,
    toggle: toggleOne,
    range: replaceRange,
    addRange,
    clear: clearSelection,
    select: (ids) => {
      selection = new Set(ids);
      refresh();
    },
    clampPos,
    markdown: () => buildMarkdown(selectionRecords()),
    json: () => buildJson(selectionRecords()),
    exportMarkdown: (savedPairs) => buildMarkdown(selectionRecords(), fileImageRef(new Map(savedPairs))),
  };
})();
