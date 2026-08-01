'use strict';
(() => {
  if (globalThis.__ttcLoaded) return;
  const TTC = globalThis.TTC;

  const p2 = (n) => String(n).padStart(2, '0');

  TTC.util = {
    collapse: (s) => s.replace(/\s+/g, ' ').trim(),
    p2,
    fmtDate: (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    fmtTime: (d) => `${p2(d.getHours())}:${p2(d.getMinutes())}`,
    truncate: (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s),
    plural: (n) => `${n} message${n === 1 ? '' : 's'}`,
    clampPos: (x, y, w, h, vw, vh) => ({
      x: Math.min(Math.max(x, 8), Math.max(8, vw - w - 8)),
      y: Math.min(Math.max(y, 8), Math.max(8, vh - h - 8)),
    }),
    isEditable: (el) => !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'),
  };
})();
