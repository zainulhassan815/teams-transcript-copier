// Regression test: runs content.js in jsdom against real Teams DOM fixtures.
// npm install once, then npm test
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const loadExtension = (bodyHtml) => {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    url: 'https://teams.microsoft.com/v2/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8'));
  dom.window.__ttc.scan();
  return dom.window.__ttc;
};

// fixture.html: real outerHTML of a sent message with one quoted reply
// (captured from Teams web 2026-07-31, hashed utility classes stripped)
const rileyMsg = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');

// Synthetic reproduction of a received message with TWO quote cards then body
const quoteCard = (author, time, snippet) => `
  <div class="fui-Flex" data-track-module-name="messageQuotedReply">
    <div class="fui-Primitive"></div>
    <div class="fui-Primitive" data-tid="quoted-reply-card">
      <div class="fui-Flex"><div class="fui-Flex">
        <span dir="auto">${author}</span>
        <span dir="auto" data-tid="quoted-reply-timestamp">${time}</span>
      </div>
      <div class="fui-Primitive"><span data-tid="quoted-reply-preview-content">${snippet}</span></div>
      </div>
    </div>
  </div>`;

const jordanMsg = `
<div data-mid="1784898765432" data-tid="chat-pane-message" id="message-body-1784898765432" class="fui-ChatMessage__body">
  <div data-tid="message-author-name">Jordan Lee</div>
  <div dir="auto" id="content-1784898765432" data-message-content="">
    ${quoteCard('Jordan Lee', '7/8/2026 2:26 PM', 'Based on these logs, nothing seems to be missing…')}
    ${quoteCard('Jordan Lee', '7/15/2026 6:05 PM', 'Hi Riley just following up on this again…')}
    <p>Hi Riley, for reference here's the pending items where we left off.</p>
    <p>&nbsp;</p>
    <p>is there a way to accurately check in the admin dashboard.</p>
  </div>
</div>`;

// Adversarial content: literal placeholder-lookalike tokens and a hand-authored
// blockquote, neither of which may be mistaken for extension internals
const edgeMsg = `
<div data-mid="1785485270000" data-tid="chat-pane-message" id="message-body-1785485270000" class="fui-ChatMessage__body">
  <div data-tid="message-author-name">Jordan Lee</div>
  <div dir="auto" id="content-1785485270000" data-message-content="">
    <p>literal tokens @@TTCQ0@@ and @@TTCIMG0@@ stay intact</p>
    <blockquote>hand-authored quote</blockquote>
    <p>after the quote</p>
  </div>
</div>`;

// Real structure: the file card grid is a SIBLING of the content div, and the
// card title aria-label carries "<filename>\n<sharepoint url>"
const attachMsg = `
<div data-mid="1785492821720" data-tid="chat-pane-message" id="message-body-1785492821720" class="fui-ChatMessage__body">
  <div data-tid="message-author-name">Jordan Lee</div>
  <div dir="auto" id="content-1785492821720" data-message-content="">
    <p>kindly see the attachment below</p>
  </div>
  <div data-tid="file-attachment-grid" id="attachments-1785492821720" aria-label="The message has an attachment.">
    <div role="group" aria-label="Export_Contacts_Customer Data View_Jul_2026_4_34_PM.csv">
      <div data-testid="content-card-custom-title" aria-label="Export_Contacts_Customer Data View_Jul_2026_4_34_PM.csv
https://contoso-my.sharepoint.com/:x:/g/personal/jordan_contoso_onmicrosoft_com/EXAMPLE-SHARE-TOKEN"><span>Export_Contacts_Customer Data View_Jul_2026_4_34_PM.csv</span></div>
    </div>
    <div role="group" aria-label="notes.pdf">
      <div data-testid="content-card-custom-title" aria-label="notes.pdf"><span>notes.pdf</span></div>
    </div>
    <div role="group" aria-label="hostile">
      <div data-testid="content-card-custom-title" aria-label="report ](https://evil.example) [x.pdf
https://contoso-my.sharepoint.com/real(1).pdf"><span>hostile</span></div>
    </div>
  </div>
</div>`;

const ttc = loadExtension(rileyMsg + jordanMsg + edgeMsg + attachMsg);
ttc.select([...ttc.store.keys()]);
const md = ttc.markdown();
const json = JSON.parse(ttc.json());

const quoteChecks = {
  'captures all four messages': ttc.store.size === 4,
  'attachment renders as markdown link with filename and url':
    md.includes('[attachment: Export_Contacts_Customer Data View_Jul_2026_4_34_PM.csv](https://contoso-my.sharepoint.com/'),
  'attachment carried structured in JSON':
    json.some((m) => (m.attachments || []).some((a) => a.name.endsWith('.csv') && /^https:/.test(a.url))),
  'multiple attachments each get a line, url-less ones name-only':
    md.indexOf('[attachment: notes.pdf]\n') > md.indexOf('Data View_Jul_2026_4_34_PM.csv](https'),
  'hostile filename cannot forge a markdown link':
    !md.includes('](https://evil.example)') && md.includes('(https://contoso-my.sharepoint.com/real%281%29.pdf)'),
  'literal placeholder-lookalike text survives': md.includes('@@TTCQ0@@ and @@TTCIMG0@@ stay intact'),
  'hand-authored blockquote stays in the body':
    md.includes('hand-authored quote') && (md.match(/> replying to/g) || []).length === 3,
  'single quote extracted with author+time':
    md.includes('> replying to Riley Khan (7/30/2026 3:31 PM):'),
  'quote text not duplicated in body': md.split('need your call on one thing').length === 2,
  'both of the double quotes extracted':
    md.includes('(7/8/2026 2:26 PM)') && md.includes('(7/15/2026 6:05 PM)'),
  'quotes precede the reply body':
    md.indexOf('(7/15/2026 6:05 PM)') < md.indexOf('pending items where we left off'),
  'lists become bullets': md.includes('- Web sign-in ID\n- iOS sign-in ID'),
  'nbsp cleaned': !md.includes(' '),
  'JSON carries structured quotes': json.every((m) => Array.isArray(m.quotes)),
};

// ---- fixture 2: full real message pane (20 messages, 13 quotes, mentions,
// emojis, inline images, reactions, day dividers) captured 2026-07-31 ----
const pane = fs.readFileSync(path.join(__dirname, 'message-pane-list.html'), 'utf8');
const ttc2 = loadExtension(pane);
const ids = [...ttc2.store.keys()].sort();
ttc2.select(ids);
const md2 = ttc2.markdown();

const paneChecks = {
  'captures all 20 pane messages': ttc2.store.size === 20,
  'all 13 quotes extracted': (md2.match(/> replying to /g) || []).length === 13,
  'mentions inline as @Name': md2.includes('@Riley') && !/\nRiley\n/.test(md2),
  'emojis survive as characters': md2.includes('🙂'),
  'images carry their authenticated url': /\[image: https:\/\/[^\]]+\]/.test(md2),
  'no bare image placeholder text leaks': !/^image$/m.test(md2),
  'reaction summaries stay out of bodies': !/diverse-reaction|Add reaction/i.test(md2),
  'full selection has no gap markers': !md2.includes('[...]'),
};

// ---- selection semantics: toggle / shift-range / add-range / gaps ----
const count = () => JSON.parse(ttc2.json()).length;

ttc2.clear();
ttc2.toggle(ids[0]);
ttc2.range(ids[4]);
const extendedToFive = count() === 5;
ttc2.range(ids[2]); // same anchor: replaces, not extends
const shrunkToThree = count() === 3;
ttc2.toggle(ids[10]);
ttc2.addRange(ids[12]);
const mdGaps = ttc2.markdown();
const jsonGaps = JSON.parse(ttc2.json());
ttc2.toggle(ids[10]);

const selectionChecks = {
  'shift-range extends from anchor': extendedToFive,
  'shift-range replaces previous extension': shrunkToThree,
  'add-range unions with existing selection': count() === 5,
  'non-contiguous selection copies with [...] marker': mdGaps.split('[...]').length === 2,
  'JSON marks first message after a gap': jsonGaps.filter((m) => m.afterGap).length === 1,
  'gapped transcript has exactly the 6 selected messages':
    (mdGaps.match(/^\[\d{2}:\d{2}\]/gm) || []).length === 6,
};

// ---- image handling: url placeholders + export file references ----
ttc2.select(ids);
const allImages = JSON.parse(ttc2.json()).flatMap((m) => m.images);
const imgUrl = allImages[0];
const exportMd = imgUrl ? ttc2.exportMarkdown([[imgUrl, 'img-1.jpg']]) : '';

const imageChecks = {
  'pane messages expose image urls in JSON': allImages.length > 0 && allImages.every((u) => /^https:/.test(u)),
  'export uses markdown image syntax for saved files': /!\[[^\]]*\]\(img-1\.jpg\)/.test(exportMd),
  'export keeps url placeholders for unsaved images':
    allImages.length < 2 || /\[image: https:/.test(exportMd),
};

// ---- click gestures on macOS (platform-gated modifiers) ----
const macDom = new JSDOM(`<!doctype html><html><body>${rileyMsg + jordanMsg + edgeMsg + attachMsg}</body></html>`, {
  url: 'https://teams.microsoft.com/v2/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
Object.defineProperty(macDom.window.navigator, 'platform', { value: 'MacIntel' });
macDom.window.eval(fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8'));
const mac = macDom.window.__ttc;
mac.scan();
const macIds = [...mac.store.keys()].sort();
const macNode = (id) => macDom.window.document.getElementById(`message-body-${id}`);
const click = (id, mods) =>
  macNode(id).dispatchEvent(new macDom.window.MouseEvent('click', { bubbles: true, cancelable: true, ...mods }));
const macCount = () => JSON.parse(mac.json()).length;

click(macIds[0], { ctrlKey: true }); // bare ctrl+click is the Mac context menu
const bareCtrlIgnored = macCount() === 0;
click(macIds[0], { metaKey: true });
click(macIds[2], { metaKey: true }); // scattered selection, anchor moves here
click(macIds[3], { ctrlKey: true, shiftKey: true }); // windows-habit add-range
const gestureChecks = {
  'bare ctrl+click stays reserved for the context menu': bareCtrlIgnored,
  'cmd+click toggles': macCount() === 3,
  'ctrl+shift+click adds a range without forgetting cmd-clicked messages':
    JSON.parse(mac.json()).map((m) => m.id).join() === [macIds[0], macIds[2], macIds[3]].join(),
};

// ---- drag clamping (pure logic; pointer events live outside jsdom) ----
const dragChecks = {
  'clamp pins an off-screen panel to the viewport edge':
    JSON.stringify(ttc2.clampPos(-500, -500, 300, 400, 1280, 800)) === '{"x":8,"y":8}',
  'clamp keeps the panel fully visible at the far corner':
    JSON.stringify(ttc2.clampPos(5000, 5000, 300, 400, 1280, 800)) === '{"x":972,"y":392}',
};

let failed = 0;
const report = (checkSet, label) => {
  for (const [name, ok] of Object.entries(checkSet)) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${label}] ${name}`);
    if (!ok) failed++;
  }
};
report(quoteChecks, 'quotes');
report(paneChecks, 'pane');
report(selectionChecks, 'selection');
report(imageChecks, 'images');
report(gestureChecks, 'gestures');
report(dragChecks, 'drag');
if (failed) {
  console.log('\n--- pane markdown for debugging ---\n' + md2);
  process.exit(1);
}
const total =
  Object.keys(quoteChecks).length +
  Object.keys(paneChecks).length +
  Object.keys(selectionChecks).length +
  Object.keys(imageChecks).length +
  Object.keys(dragChecks).length +
  Object.keys(gestureChecks).length;
console.log(`\nall ${total} checks passed (v${ttc.version})`);
process.exit(0);
