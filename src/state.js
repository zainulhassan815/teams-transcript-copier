'use strict';
(() => {
  if (globalThis.__ttcLoaded) return;
  const TTC = globalThis.TTC;

  const store = new Map(); // id -> {id, author, body, quotes, images, attachments, edited}
  const edges = new Set(); // "idA|idB" pairs proven adjacent in a single DOM paint
  let selection = new Set(); // explicitly selected message ids
  let anchor = null; // last non-shift-clicked id; shift ranges extend from here

  const sortedSelection = () => [...selection].sort();

  const rangeBetween = (a, b) => {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return [...store.keys()].filter((id) => id >= lo && id <= hi);
  };

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

  TTC.state = {
    store,
    edges,
    sortedSelection,
    rangeBetween,
    selectedRuns,
    runComplete,
    selectionRecords,
    has: () => selection.size > 0,
    isSelected: (id) => selection.has(id),
    getAnchor: () => anchor,

    upsert(rec) {
      const prev = store.get(rec.id);
      // a mid-render scan can catch a half-mounted node; keep the richer record
      if (!prev || (rec.body || '').length >= (prev.body || '').length) store.set(rec.id, rec);
    },
    recordAdjacency(sortedIds) {
      for (let i = 1; i < sortedIds.length; i++) edges.add(sortedIds[i - 1] + '|' + sortedIds[i]);
    },

    toggle(id) {
      selection.has(id) ? selection.delete(id) : selection.add(id);
      anchor = id;
    },
    // re-clicking re-extends from the same anchor, replacing the previous extension
    replaceRange(id) {
      if (!anchor) anchor = id;
      selection = new Set(rangeBetween(anchor, id));
    },
    addRange(id) {
      if (!anchor) anchor = id;
      for (const x of rangeBetween(anchor, id)) selection.add(x);
    },
    setSelection(ids) {
      selection = new Set(ids);
    },
    clearSelection() {
      selection.clear();
      anchor = null;
    },
    fullReset() {
      selection.clear();
      anchor = null;
      store.clear();
      edges.clear();
    },
  };
})();
