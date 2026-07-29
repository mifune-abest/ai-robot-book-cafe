const KANJI_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆ヶ]/u;
const SKIP_SELECTOR = 'script, style, noscript, textarea, ruby, rt, [data-no-furigana]';
const MAX_BATCH_ITEMS = 80;
const MAX_BATCH_CHARACTERS = 8_000;

const cache = new Map();
const pending = new Map();
let observer = null;
let flushTimer = null;
let flushing = false;
let retryCount = 0;

function shouldSkip(node) {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP_SELECTOR)) return true;
  const option = parent.closest('option');
  return Boolean(option && option.dataset.furiganaDisplay === node.nodeValue);
}

function createRuby(segment) {
  const ruby = document.createElement('ruby');
  ruby.dataset.furigana = 'true';
  ruby.append(document.createTextNode(segment.text));

  const reading = document.createElement('rt');
  reading.dataset.reading = segment.reading;
  reading.setAttribute('aria-hidden', 'true');
  ruby.append(reading);
  return ruby;
}

function optionText(segments) {
  return segments.map(function (segment) {
    return segment.reading
      ? segment.text + '（' + segment.reading + '）'
      : segment.text;
  }).join('');
}

function applySegments(node, source, segments) {
  if (!node.isConnected || node.nodeValue !== source) return;
  const option = node.parentElement && node.parentElement.closest('option');
  if (option) {
    const display = optionText(segments);
    option.dataset.furiganaDisplay = display;
    option.textContent = display;
    return;
  }

  const fragment = document.createDocumentFragment();
  segments.forEach(function (segment) {
    if (!segment || typeof segment.text !== 'string' || !segment.text) return;
    if (typeof segment.reading === 'string' && segment.reading) {
      fragment.append(createRuby(segment));
    } else {
      fragment.append(document.createTextNode(segment.text));
    }
  });
  node.replaceWith(fragment);
}

function scheduleFlush(delay) {
  if (flushTimer || flushing || !pending.size) return;
  flushTimer = window.setTimeout(function () {
    flushTimer = null;
    flushPending();
  }, delay == null ? 12 : delay);
}

function queueTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE || shouldSkip(node)) return;
  const source = node.nodeValue || '';
  if (!KANJI_PATTERN.test(source)) return;

  const cached = cache.get(source);
  if (cached) {
    applySegments(node, source, cached);
    return;
  }

  if (!pending.has(source)) pending.set(source, new Set());
  pending.get(source).add(node);
  scheduleFlush();
}

function queueTree(root) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    queueTextNode(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE && root.matches(SKIP_SELECTOR)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node);
    node = walker.nextNode();
  }
  textNodes.forEach(queueTextNode);
}

function takeBatch() {
  const batch = [];
  let characters = 0;
  for (const [text, nodes] of pending) {
    if (batch.length >= MAX_BATCH_ITEMS) break;
    if (text.length > 500) {
      pending.delete(text);
      continue;
    }
    if (batch.length && characters + text.length > MAX_BATCH_CHARACTERS) break;
    pending.delete(text);
    batch.push({ text, nodes });
    characters += text.length;
  }
  return batch;
}

async function flushPending() {
  if (flushing || !pending.size) return;
  const batch = takeBatch();
  if (!batch.length) return;
  flushing = true;

  try {
    const response = await fetch('/api/furigana', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: batch.map((item) => item.text) }),
    });
    if (!response.ok) throw new Error('furigana request failed');
    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    const byText = new Map(items.map((item) => [item.text, item.segments]));

    batch.forEach(function (item) {
      const segments = byText.get(item.text);
      if (!Array.isArray(segments) || !segments.length) return;
      cache.set(item.text, segments);
      item.nodes.forEach((node) => applySegments(node, item.text, segments));
    });
    retryCount = 0;
  } catch {
    if (retryCount < 2) {
      retryCount += 1;
      batch.forEach(function (item) {
        if (!pending.has(item.text)) pending.set(item.text, new Set());
        item.nodes.forEach((node) => {
          if (node.isConnected && node.nodeValue === item.text) pending.get(item.text).add(node);
        });
      });
    }
  } finally {
    flushing = false;
    scheduleFlush(retryCount ? 500 : 12);
  }
}

export function startFurigana() {
  if (observer || !document.body) return;
  queueTree(document.body);
  observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type === 'characterData') {
        queueTextNode(mutation.target);
        return;
      }
      mutation.addedNodes.forEach(queueTree);
    });
  });
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

export function refreshFurigana(root) {
  queueTree(root || document.body);
}
