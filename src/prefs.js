'use strict';
(() => {
  if (globalThis.__ttcLoaded) return;
  const TTC = globalThis.TTC;

  // Page-origin localStorage: survives reloads with zero extension permissions
  const POS_KEY = 'ttc-pos';
  const PREFS_KEY = 'ttc-prefs';
  const SEEN_KEY = 'ttc-seen';
  const DEFAULTS = { clearAfterCopy: false, collapseAfterCopy: false };

  const read = (key) => {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  };
  const remove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {}
  };

  TTC.prefs = {
    get: (name) => ({ ...DEFAULTS, ...(read(PREFS_KEY) || {}) })[name],
    set: (name, value) => write(PREFS_KEY, { ...DEFAULTS, ...(read(PREFS_KEY) || {}), [name]: value }),
    loadPos: () => {
      const p = read(POS_KEY);
      return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
    },
    savePos: (p) => write(POS_KEY, p),
    clearPos: () => remove(POS_KEY),
    firstRun: () => !read(SEEN_KEY),
    markSeen: () => write(SEEN_KEY, true),
  };
})();
