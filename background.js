// File saver for the export flow. Fetch-first (not chrome.downloads on the AMS
// url) buys the real content-type for extensions and a clean auth failure;
// host permissions let the worker fetch cross-origin with cookies.
'use strict';

// data: urls hold the whole file in memory; oversized images degrade to url placeholders
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000; // String.fromCharCode arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function saveImage(url, folder, index) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  const ext = MIME_EXT[mime] || 'png';
  const filename = `img-${index + 1}.${ext}`;
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_IMAGE_BYTES) throw new Error(`image too large (${buffer.byteLength} bytes)`);
  await chrome.downloads.download({
    url: `data:${mime || 'image/png'};base64,${toBase64(buffer)}`,
    filename: `${folder}/${filename}`,
    conflictAction: 'uniquify',
  });
  return filename;
}

async function exportImages({ folder, urls }) {
  const saved = [];
  const failed = [];
  await Promise.all(
    urls.map((url, i) =>
      saveImage(url, folder, i).then(
        (filename) => saved.push([url, filename]),
        () => failed.push(url)
      )
    )
  );
  return { saved, failed };
}

async function saveText({ folder, filename, text }) {
  await chrome.downloads.download({
    url: `data:text/markdown;charset=utf-8;base64,${toBase64(new TextEncoder().encode(text).buffer)}`,
    filename: `${folder}/${filename}`,
    conflictAction: 'uniquify',
  });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = msg.type === 'ttc-export-images' ? exportImages : msg.type === 'ttc-save-text' ? saveText : null;
  if (!handler) return false;
  handler(msg).then(sendResponse, () => sendResponse(null));
  return true; // async response
});
