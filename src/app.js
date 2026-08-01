'use strict';
(() => {
  if (globalThis.__ttcLoaded) return;
  globalThis.__ttcLoaded = true;
  const TTC = globalThis.TTC;
  const { MSG_SEL, IS_MAC, VERSION } = TTC.config;
  const { plural, clampPos, isEditable, fmtDate, p2 } = TTC.util;
  const { state, view, output, extract, prefs } = TTC;

  // ----- scanner: drains the virtualized DOM into the store on every paint -----
  function scan() {
    const all = document.querySelectorAll(MSG_SEL);
    if (all.length) {
      // candidates can match nested wrappers of one message; keep outermost only
      const top = [...all].filter((n) => !n.parentElement || !n.parentElement.closest(MSG_SEL));
      const nodeById = new Map();
      for (const n of top) {
        const rec = extract.extractMessage(n);
        if (!rec) continue;
        if (!nodeById.has(rec.id)) nodeById.set(rec.id, n);
        state.upsert(rec);
      }
      // 13-digit ids sort lexicographically == chronologically
      state.recordAdjacency([...nodeById.keys()].sort());
      view.setNodes(nodeById);
      if (state.store.size) view.showPanel();
    }
    view.render();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 350);
  }

  // ----- actions (thin orchestrators: mutate state, then render) -----
  const act = (fn) => (...args) => {
    fn(...args);
    view.render();
  };
  const clearSelection = act(() => {
    state.clearSelection();
    view.clearPageArtifacts();
  });
  const resetAll = act(() => {
    state.fullReset();
    view.clearPageArtifacts();
    scheduleScan();
  });

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      } catch {}
    }
    view.toast(label);
  }

  async function copySelection(kind) {
    if (!state.has()) return;
    const recs = state.selectionRecords();
    const text = kind === 'json' ? output.buildJson(recs) : output.buildMarkdown(recs);
    await copyText(text, `${plural(recs.length)} copied${kind === 'json' ? ' as JSON' : ''}`);
    if (prefs.get('clearAfterCopy')) clearSelection();
    if (prefs.get('collapseAfterCopy')) view.collapse();
    view.render();
  }

  // ----- export -----
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
    if (!(globalThis.chrome && chrome.runtime && chrome.runtime.sendMessage)) {
      view.toast('Export needs the extension runtime');
      return;
    }
    const recs = state.selectionRecords();
    const d = new Date();
    const folder = `teams-transcript-${fmtDate(d)}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
    const urls = [...new Set(recs.flatMap((r) => r.images.map((i) => i.url).filter(Boolean)))];
    view.setExporting(true);
    try {
      const res = (await sendToWorker({ type: 'ttc-export-images', folder, urls })) || { saved: [] };
      const markdown = output.buildMarkdown(recs, output.fileImageRef(new Map(res.saved)));
      const ok = await sendToWorker({ type: 'ttc-save-text', folder, filename: 'transcript.md', text: markdown });
      view.toast(ok ? `Exported ${plural(recs.length)} · ${res.saved.length}/${urls.length} images to Downloads` : 'Export failed');
    } finally {
      view.setExporting(false);
    }
  }

  view.ui.copy.addEventListener('click', () => copySelection('md'));
  view.ui.json.addEventListener('click', () => copySelection('json'));
  view.ui.export.addEventListener('click', exportBundle);
  view.ui.reset.addEventListener('click', () => {
    resetAll();
    view.toast('Selection cleared');
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
      const id = extract.findMessageId(node);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      getSelection().removeAllRanges();
      scan(); // ensure the clicked message and its neighbours are captured
      // ctrl+shift adds on macOS too: bare ctrl+click belongs to the system
      // context menu there, but with shift held the click comes through
      if (e.shiftKey && (isSelectKey(e) || e.ctrlKey)) state.addRange(id);
      else if (e.shiftKey) state.replaceRange(id);
      else state.toggle(id);
      view.clearPageArtifacts();
      view.render();
    },
    true
  );

  document.addEventListener(
    'mousemove',
    (e) => {
      const node = e.shiftKey || isSelectKey(e) ? messageAt(e) : null;
      view.setHover(node);
      const id = e.shiftKey && state.getAnchor() && node ? extract.findMessageId(node) : null;
      view.setPreview(id ? state.rangeBetween(state.getAnchor(), id) : []);
    },
    true
  );

  document.addEventListener('keyup', (e) => {
    if (!e.shiftKey) view.setPreview([]);
    if (!e.shiftKey && !isSelectKey(e)) view.setHover(null);
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (isEditable(document.activeElement)) return;
      // match the physical key: on macOS option+c reports key "ç"
      if (e.code === 'KeyC' && e.altKey && !e.metaKey && !e.ctrlKey && state.has()) {
        e.preventDefault();
        e.stopPropagation();
        copySelection('md');
        return;
      }
      if (e.key === 'Escape' && state.has()) clearSelection();
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
    if (state.store.size || state.has()) {
      resetAll();
      view.toast('Chat changed, capture reset');
    }
  }, 1000);

  // console diagnosis + tests: __ttc.scan(); __ttc.toggle(id); __ttc.markdown()
  globalThis.__ttc = {
    version: VERSION,
    store: state.store,
    scan,
    toggle: act(state.toggle),
    range: act(state.replaceRange),
    addRange: act(state.addRange),
    clear: clearSelection,
    select: act(state.setSelection),
    copySelection,
    clampPos,
    prefs,
    isExpanded: view.isExpanded,
    markdown: () => output.buildMarkdown(state.selectionRecords()),
    json: () => output.buildJson(state.selectionRecords()),
    exportMarkdown: (savedPairs) => output.buildMarkdown(state.selectionRecords(), output.fileImageRef(new Map(savedPairs))),
  };
})();
