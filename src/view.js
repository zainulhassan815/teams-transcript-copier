'use strict';
(() => {
  if (globalThis.__ttcLoaded) return;
  const TTC = globalThis.TTC;
  const { VERSION, MOD_KEY, ALT_KEY } = TTC.config;
  const { fmtTime, plural, clampPos } = TTC.util;
  const prefs = TTC.prefs;
  const state = TTC.state;

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
      .title { font-weight: 650; font-size: 14px; flex: 1; letter-spacing: 0.1px; }
      .hd button { color: #8a8a8e; padding: 3px; border-radius: 6px; line-height: 0; }
      .hd button:hover { background: #f0f0f2; color: #242424; }
      .hd button.active { background: #eeeffc; color: #5b5fc7; }

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

      #settings { padding: 2px 0 4px; }
      .opt { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 2px; font-size: 13px; cursor: pointer; }
      .opt + .opt { border-top: 1px solid #f0f0f4; }
      .opt input { display: none; }
      .opt i {
        width: 34px; height: 20px; border-radius: 999px; background: #d9d9de;
        position: relative; transition: background .15s; flex: none;
      }
      .opt i::after {
        content: ''; position: absolute; width: 16px; height: 16px; border-radius: 50%;
        background: #fff; top: 2px; left: 2px; transition: left .15s;
      }
      .opt input:checked + i { background: #5b5fc7; }
      .opt input:checked + i::after { left: 16px; }

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
        .hd button.active { background: #35365c; color: #aeb1ff; }
        .sub, #range, .foot { color: #9a9a9e; }
        #range b { color: #eee; }
        #empty .line { color: #9a9a9e; }
        kbd { background: #3a3a3a; border-color: #4a4a4a; color: #eee; }
        .opt + .opt { border-color: #3d3d3d; }
        .opt i { background: #55555c; }
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
        <button id="gear" title="Settings"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.02a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.02a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.02a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg></button>
        <button id="reset" title="Reset capture"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 1.5v3h-3"/></svg></button>
        <button id="min" title="Collapse"><svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 8H12.5"/></svg></button>
      </div>
      <div id="empty">
        <div class="line"><kbd>${MOD_KEY}</kbd><span>click a message to start</span></div>
        <div class="line"><kbd>⇧</kbd><span>click extends the range</span></div>
        <div class="line"><kbd>${ALT_KEY}C</kbd><span>copies the selection</span></div>
      </div>
      <div id="stats" class="hidden">
        <div class="hero">
          <span class="num" id="num">0</span>
          <span class="badge ok" id="badge">✓ Complete</span>
        </div>
        <div class="sub" id="sub"></div>
        <div id="range"></div>
      </div>
      <div id="settings" class="hidden">
        <label class="opt"><span>Clear selection after copy</span><input type="checkbox" id="optClear"><i></i></label>
        <label class="opt"><span>Collapse panel after copy</span><input type="checkbox" id="optCollapse"><i></i></label>
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
  for (const id of ['pill', 'pillLabel', 'card', 'empty', 'stats', 'num', 'badge', 'sub', 'range', 'settings', 'gear', 'optClear', 'optCollapse', 'warn', 'copy', 'json', 'export', 'reset', 'min', 'footLeft', 'toast']) {
    ui[id] = shadow.getElementById(id);
  }

  // ----- panel state machine: pill when idle, card while a selection lives -----
  let panelVisible = false;
  let expanded = false;
  let userCollapsed = false; // manual collapse wins over auto-expand until the selection empties
  let settingsOpen = false;
  let exporting = false;
  let prevCount = 0;

  function setExpanded(v) {
    expanded = v;
    if (!panelVisible) return;
    ui.card.classList.toggle('hidden', !expanded);
    ui.pill.classList.toggle('hidden', expanded);
  }

  function showPanel() {
    if (panelVisible) return;
    panelVisible = true;
    // first ever run shows the card so the gesture hints teach themselves
    setExpanded(prefs.firstRun());
    prefs.markSeen();
    restorePos();
  }

  // author names are message content: build the range line from text nodes,
  // never markup
  function renderRange(ids) {
    const part = (id) => {
      const rec = state.store.get(id);
      const b = document.createElement('b');
      b.textContent = fmtTime(new Date(Number(id)));
      return [b, document.createTextNode(' ' + ((rec && rec.author) || '…'))];
    };
    const nodes = part(ids[0]);
    if (ids.length > 1) nodes.push(document.createTextNode('  →  '), ...part(ids[ids.length - 1]));
    ui.range.replaceChildren(...nodes);
  }

  function render() {
    if (!panelVisible) return;
    const ids = state.sortedSelection();
    const count = ids.length;
    const active = count > 0;

    if (active && prevCount === 0 && !userCollapsed) setExpanded(true);
    if (!active && prevCount > 0) {
      userCollapsed = false;
      if (!settingsOpen) setExpanded(false);
    }
    prevCount = count;

    const runs = state.selectedRuns();
    const complete = active && runs.every(state.runComplete);
    ui.empty.classList.toggle('hidden', active || settingsOpen);
    ui.stats.classList.toggle('hidden', !active || settingsOpen);
    ui.settings.classList.toggle('hidden', !settingsOpen);
    ui.gear.classList.toggle('active', settingsOpen);
    if (active) {
      ui.num.textContent = String(count);
      ui.sub.textContent = `message${count === 1 ? '' : 's'}` + (runs.length > 1 ? ` · ${runs.length} ranges` : '');
      ui.badge.textContent = complete ? '✓ Complete' : 'Possible gap';
      ui.badge.className = 'badge ' + (complete ? 'ok' : 'warn');
      renderRange(ids);
    }
    ui.warn.classList.toggle('hidden', settingsOpen || !(active && !complete));
    ui.footLeft.textContent = active
      ? `${MOD_KEY} select · ⇧ range · ${ALT_KEY}C copy`
      : `${state.store.size} captured`;
    ui.pillLabel.textContent = active ? String(count) : 'Transcript';
    ui.copy.disabled = ui.json.disabled = !active;
    ui.export.disabled = !active || exporting;
  }

  // ----- page-side highlights -----
  let lastNodes = new Map(); // id -> currently mounted DOM node (refreshed each scan)
  let previewNodes = [];
  let hovered = null;

  function applyHighlights() {
    // sweep first: re-renders can leave marked nodes that dropped out of lastNodes
    document.querySelectorAll('.ttc-selected').forEach((n) => n.classList.remove('ttc-selected'));
    for (const [id, node] of lastNodes) {
      if (state.isSelected(id)) node.classList.add('ttc-selected');
    }
  }

  function setNodes(nodeById) {
    lastNodes = nodeById;
    applyHighlights();
  }

  function setPreview(ids) {
    for (const n of previewNodes) n.classList.remove('ttc-preview');
    previewNodes = ids.map((id) => lastNodes.get(id)).filter(Boolean);
    for (const n of previewNodes) n.classList.add('ttc-preview');
  }

  function setHover(node) {
    if (node === hovered) return;
    if (hovered) hovered.classList.remove('ttc-hover');
    if (node) node.classList.add('ttc-hover');
    hovered = node;
  }

  function clearPageArtifacts() {
    setPreview([]);
    applyHighlights();
  }

  // ----- drag: an overlay pays rent for covering Teams by being movable -----
  function applyPos(p) {
    host.style.left = p.x + 'px';
    host.style.top = p.y + 'px';
    host.style.right = 'auto';
    host.style.bottom = 'auto';
  }

  function restorePos() {
    const p = prefs.loadPos();
    if (!p) return;
    const r = host.getBoundingClientRect();
    applyPos(clampPos(p.x, p.y, r.width, r.height, innerWidth, innerHeight));
  }

  function resetPos() {
    prefs.clearPos();
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
        prefs.savePos({ x: r.left, y: r.top });
        dragJustEnded = true; // swallow the click that follows a pill drag
        setTimeout(() => (dragJustEnded = false), 0);
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
      e.preventDefault();
    });
  }

  window.addEventListener('resize', () => {
    if (prefs.loadPos()) restorePos();
  });

  // ----- toast -----
  let toastTimer = null;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), 2200);
  }

  // ----- wiring owned by the view (panel-internal interactions) -----
  makeDraggable(shadow.querySelector('.hd'));
  makeDraggable(ui.pill);
  shadow.querySelector('.title').addEventListener('dblclick', resetPos);
  ui.min.addEventListener('click', () => {
    userCollapsed = true;
    setExpanded(false);
  });
  ui.pill.addEventListener('click', () => {
    if (dragJustEnded) return;
    setExpanded(true);
    render();
  });
  let hadSelectionAtSettingsOpen = false;
  ui.gear.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    if (settingsOpen) {
      hadSelectionAtSettingsOpen = state.has();
      ui.optClear.checked = prefs.get('clearAfterCopy');
      ui.optCollapse.checked = prefs.get('collapseAfterCopy');
    } else if (hadSelectionAtSettingsOpen && !state.has()) {
      // the N->0 transition fired while settings hid the stats; settle to idle
      setExpanded(false);
    }
    render();
  });
  ui.optClear.addEventListener('change', () => prefs.set('clearAfterCopy', ui.optClear.checked));
  ui.optCollapse.addEventListener('change', () => prefs.set('collapseAfterCopy', ui.optCollapse.checked));

  TTC.view = {
    ui,
    showPanel,
    render,
    toast,
    setNodes,
    setPreview,
    setHover,
    clearPageArtifacts,
    collapse: () => setExpanded(false),
    isExpanded: () => expanded,
    setExporting: (v) => {
      exporting = v;
      render();
    },
  };
})();
