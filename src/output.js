'use strict';
(() => {
  if (globalThis.__ttcLoaded) return;
  const TTC = globalThis.TTC;
  const { collapse, fmtDate, fmtTime } = TTC.util;

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

  TTC.output = { urlImageRef, fileImageRef, buildMarkdown, buildJson };
})();
