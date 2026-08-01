'use strict';
(() => {
  if (globalThis.__ttcLoaded) return;
  const TTC = globalThis.TTC;
  const { SEL, MINE_SEL, ID_RE, QUOTE_META_RE, QUOTE_SPLIT_RE } = TTC.config;
  const { collapse, truncate } = TTC.util;

  const qs = (root, candidates) => {
    for (const s of candidates) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };

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

  TTC.extract = { findMessageId, extractMessage };
})();
