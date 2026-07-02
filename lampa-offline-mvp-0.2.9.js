/* Lampa. Offline MVP export compatibility for iPhone. */
(function () {
  'use strict';

  var VERSION = '0.2.9';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.6.js';
  var SELF_URL = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
  var DB_NAME = 'lampa-offline-hls-v2';
  var ITEMS = 'items';
  var BLOBS = 'blobs';
  var PANEL_ID = 'offline-export-panel';
  var STYLE_ID = 'offline-export-style';
  var BUTTON_CLASS = 'offline-export-launcher';
  var baseRequested = false;
  var preparedFile = null;
  var preparedUrl = '';

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline Export]');
      console.log.apply(console, args);
    } catch (e) {}
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB недоступен'));
      var request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Ошибка IndexedDB')); };
    });
  }

  async function getAllItems() {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var store = db.transaction(ITEMS, 'readonly').objectStore(ITEMS);
      if (store.getAll) {
        var request = store.getAll();
        request.onsuccess = function () { resolve(request.result || []); };
        request.onerror = function () { reject(request.error); };
        return;
      }
      var result = [];
      var cursor = store.openCursor();
      cursor.onsuccess = function () {
        var current = cursor.result;
        if (current) {
          result.push(current.value);
          current.continue();
        } else resolve(result);
      };
      cursor.onerror = function () { reject(cursor.error); };
    });
  }

  async function getValue(storeName, key) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Ошибка чтения файла')); };
    });
  }

  function sanitizeName(value) {
    var name = String(value || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return name.slice(0, 120) || 'video';
  }

  function extensionFromMime(mime, fallback) {
    var type = String(mime || '').toLowerCase();
    if (type.indexOf('webm') >= 0) return '.webm';
    if (type.indexOf('matroska') >= 0 || type.indexOf('mkv') >= 0) return '.mkv';
    if (type.indexOf('mp2t') >= 0 || type.indexOf('mpegts') >= 0) return '.ts';
    if (type.indexOf('quicktime') >= 0) return '.mov';
    if (type.indexOf('mp4') >= 0) return '.mp4';
    return fallback || '.mp4';
  }

  function extensionFromUrl(url) {
    try {
      var path = new URL(url).pathname;
      var match = path.match(/\.(mp4|webm|mkv|mov|m4v|ts)$/i);
      return match ? '.' + match[1].toLowerCase() : '';
    } catch (e) { return ''; }
  }

  async function buildExportFile(item) {
    var parts = [];
    var mime = item.mime || 'video/mp4';
    var extension = extensionFromUrl(item.sourceUrl || '');

    if (item.kind === 'hls') {
      if (!item.hls || !Array.isArray(item.hls.ids) || !item.hls.ids.length) {
        throw new Error('У HLS нет сохранённых фрагментов');
      }
      for (var index = 0; index < item.hls.ids.length; index += 1) {
        var fragment = await getValue(BLOBS, item.hls.ids[index]);
        if (!fragment || !fragment.blob) throw new Error('Не найден фрагмент ' + (index + 1));
        if (index === 0 && fragment.blob.type) mime = fragment.blob.type;
        parts.push(fragment.blob);
      }
      var fragmentedMp4 = item.hls.template && item.hls.template.indexOf('#EXT-X-MAP') >= 0;
      if (fragmentedMp4) {
        mime = mime && mime.indexOf('mp4') >= 0 ? mime : 'video/mp4';
        extension = '.mp4';
      } else {
        mime = mime && mime.indexOf('mp2t') >= 0 ? mime : 'video/mp2t';
        extension = '.ts';
      }
    } else {
      var record = await getValue(BLOBS, item.id);
      if (!record || !record.blob) throw new Error('Сохранённый файл не найден');
      parts.push(record.blob);
      mime = record.blob.type || mime || 'application/octet-stream';
      extension = extension || extensionFromMime(mime, '.mp4');
    }

    extension = extension || extensionFromMime(mime, item.kind === 'hls' ? '.ts' : '.mp4');
    return new File(parts, sanitizeName(item.title) + extension, { type: mime || 'application/octet-stream' });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '' +
      '.' + BUTTON_CLASS + '{appearance:none;border:0;border-radius:12px;padding:10px 14px;background:#2a2a2a;color:#fff;font-size:14px;font-weight:700;white-space:nowrap}' +
      '.offline-hls>.offline-export-top{position:absolute;top:1.8em;right:3em;z-index:2}' +
      '#' + PANEL_ID + '{position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.82);display:flex;align-items:flex-end;justify-content:center;padding:18px;padding-bottom:calc(env(safe-area-inset-bottom) + 18px);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#fff}' +
      '.offline-export__sheet{width:min(680px,100%);max-height:82vh;overflow:auto;-webkit-overflow-scrolling:touch;background:#171719;border-radius:22px;padding:18px;box-shadow:0 18px 70px rgba(0,0,0,.5)}' +
      '.offline-export__head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}' +
      '.offline-export__title{font-size:22px;font-weight:800}' +
      '.offline-export__close,.offline-export__prepare,.offline-export__action{appearance:none;border:0;border-radius:12px;padding:11px 14px;background:#2b2b2e;color:#fff;font-size:15px;font-weight:700;text-decoration:none;text-align:center;display:block}' +
      '.offline-export__action{width:100%;box-sizing:border-box;margin-top:12px}' +
      '.offline-export__action--primary{background:#fff;color:#111}' +
      '.offline-export__action--secondary{background:#2b2b2e;color:#fff}' +
      '.offline-export__list{display:flex;flex-direction:column;gap:10px}' +
      '.offline-export__item{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#232326;border-radius:15px;padding:13px}' +
      '.offline-export__name{font-size:15px;font-weight:700;line-height:1.25;word-break:break-word}' +
      '.offline-export__meta{font-size:13px;opacity:.6;margin-top:4px}' +
      '.offline-export__empty,.offline-export__message{padding:20px;border-radius:15px;background:#232326;text-align:center;line-height:1.45}' +
      '.offline-export__status{margin-top:12px;padding:12px;border-radius:12px;background:#2b2b2e;font-size:14px;line-height:1.4;display:none}' +
      '.offline-export__hint{opacity:.7;margin-top:12px;text-align:center;font-size:14px;line-height:1.4}';
    document.head.appendChild(style);
  }

  function releasePreparedUrl() {
    if (preparedUrl) {
      try { URL.revokeObjectURL(preparedUrl); } catch (e) {}
      preparedUrl = '';
    }
    preparedFile = null;
  }

  function removePanel() {
    releasePreparedUrl();
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  function createPanel(title, keepPrepared) {
    if (!keepPrepared) releasePreparedUrl();
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    ensureStyles();
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = '<div class="offline-export__sheet"><div class="offline-export__head"><div class="offline-export__title"></div><button type="button" class="offline-export__close">Закрыть</button></div><div class="offline-export__body"></div></div>';
    panel.querySelector('.offline-export__title').textContent = title;
    panel.querySelector('.offline-export__close').addEventListener('click', removePanel);
    panel.addEventListener('click', function (event) { if (event.target === panel) removePanel(); });
    document.body.appendChild(panel);
    return panel;
  }

  function setStatus(panel, text) {
    var status = panel.querySelector('.offline-export__status');
    if (!status) return;
    status.style.display = 'block';
    status.textContent = text;
  }

  function canShareFile(file) {
    try {
      return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (e) { return false; }
  }

  async function shareFile(panel) {
    if (!preparedFile || !canShareFile(preparedFile)) {
      setStatus(panel, 'Системное меню не поддерживает этот файл. Используйте «Открыть файл», затем кнопку Поделиться в просмотрщике iPhone.');
      return;
    }
    try {
      await navigator.share({ files: [preparedFile], title: preparedFile.name });
      setStatus(panel, 'Системное меню закрыто. Если файл не сохранён, используйте «Открыть файл».');
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      setStatus(panel, 'Не удалось открыть системное меню: ' + ((error && error.message) || 'файл может быть слишком большим') + '. Используйте «Открыть файл».');
      log('share failed', error && error.name, error && error.message);
    }
  }

  function showPrepared(file) {
    releasePreparedUrl();
    preparedFile = file;
    preparedUrl = URL.createObjectURL(file);
    var panel = createPanel('Файл подготовлен', true);
    var body = panel.querySelector('.offline-export__body');

    var message = document.createElement('div');
    message.className = 'offline-export__message';
    message.textContent = file.name + ' · ' + Math.max(1, Math.round(file.size / 1024 / 1024)) + ' МБ';
    body.appendChild(message);

    if (canShareFile(file)) {
      var share = document.createElement('button');
      share.type = 'button';
      share.className = 'offline-export__action offline-export__action--primary';
      share.textContent = 'Поделиться / Сохранить в Файлы';
      share.addEventListener('click', function () { shareFile(panel); });
      body.appendChild(share);
    }

    var open = document.createElement('a');
    open.className = 'offline-export__action offline-export__action--primary';
    open.href = preparedUrl;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'Открыть файл';
    body.appendChild(open);

    var download = document.createElement('a');
    download.className = 'offline-export__action offline-export__action--secondary';
    download.href = preparedUrl;
    download.download = file.name;
    download.textContent = 'Скачать';
    body.appendChild(download);

    var status = document.createElement('div');
    status.className = 'offline-export__status';
    body.appendChild(status);

    var hint = document.createElement('div');
    hint.className = 'offline-export__hint';
    hint.textContent = 'На iPhone надёжнее нажать «Открыть файл», затем использовать кнопку Поделиться в системном просмотрщике и выбрать «Сохранить в Файлы».';
    body.appendChild(hint);
  }

  function prepareItem(item, button) {
    var originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Подготовка…';
    buildExportFile(item).then(function (file) {
      log('prepared', file.name, file.size);
      showPrepared(file);
    }).catch(function (error) {
      window.alert(error && error.message ? error.message : 'Не удалось подготовить файл');
    }).finally(function () {
      button.disabled = false;
      button.textContent = originalText;
    });
  }

  async function openExportList() {
    var panel = createPanel('Сохранить в Файлы', false);
    var body = panel.querySelector('.offline-export__body');
    var loading = document.createElement('div');
    loading.className = 'offline-export__message';
    loading.textContent = 'Читаем сохранённые видео…';
    body.appendChild(loading);

    try {
      var items = await getAllItems();
      items = items.filter(function (item) { return item.status === 'ready'; });
      items.sort(function (left, right) { return String(right.createdAt || '').localeCompare(String(left.createdAt || '')); });
      body.innerHTML = '';
      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'offline-export__empty';
        empty.textContent = 'Нет готовых видео для сохранения.';
        body.appendChild(empty);
        return;
      }

      var list = document.createElement('div');
      list.className = 'offline-export__list';
      items.forEach(function (item) {
        var row = document.createElement('div');
        row.className = 'offline-export__item';
        var info = document.createElement('div');
        var name = document.createElement('div');
        name.className = 'offline-export__name';
        name.textContent = item.title || 'Видео';
        var meta = document.createElement('div');
        meta.className = 'offline-export__meta';
        meta.textContent = item.kind === 'hls' ? 'HLS · будет собран в один файл' : 'Готовый видеофайл';
        info.appendChild(name);
        info.appendChild(meta);
        var prepare = document.createElement('button');
        prepare.type = 'button';
        prepare.className = 'offline-export__prepare';
        prepare.textContent = 'Выбрать';
        prepare.addEventListener('click', function () { prepareItem(item, prepare); });
        row.appendChild(info);
        row.appendChild(prepare);
        list.appendChild(row);
      });
      body.appendChild(list);
    } catch (error) {
      body.innerHTML = '';
      var failed = document.createElement('div');
      failed.className = 'offline-export__empty';
      failed.textContent = error && error.message ? error.message : 'Не удалось прочитать сохранённые файлы.';
      body.appendChild(failed);
    }
  }

  function makeLauncher(extraClass) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS + (extraClass ? ' ' + extraClass : '');
    button.textContent = 'В Файлы';
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      openExportList();
    });
    return button;
  }

  function injectLaunchers() {
    ensureStyles();
    var minimalHead = document.querySelector('#offline-minimal-shell .offline-minimal__head');
    if (minimalHead && !minimalHead.querySelector('.' + BUTTON_CLASS)) minimalHead.appendChild(makeLauncher('offline-export-minimal'));
    var regularPage = document.querySelector('.offline-hls');
    if (regularPage && !regularPage.querySelector('.offline-export-top')) {
      regularPage.style.position = 'relative';
      regularPage.appendChild(makeLauncher('offline-export-top'));
    }
  }

  function observePages() {
    injectLaunchers();
    var observer = new MutationObserver(function () { injectLaunchers(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }

  function warmCache() {
    if (!navigator.onLine || !window.caches) return;
    caches.open('lampa-offline-bootstrap-v1').then(function (cache) {
      return Promise.all([SELF_URL, BASE_URL].filter(Boolean).map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).catch(function () {});
  }

  function loadBase() {
    if (baseRequested) return;
    baseRequested = true;
    var script = document.createElement('script');
    script.src = BASE_URL;
    script.async = false;
    script.setAttribute('data-offline-export-base', '0.2.6');
    script.onload = function () { log('base initialized', VERSION); injectLaunchers(); };
    script.onerror = function () { baseRequested = false; log('base unavailable'); };
    document.head.appendChild(script);
  }

  function start() {
    if (!document.documentElement || !document.head) return false;
    observePages();
    loadBase();
    warmCache();
    log('initialized', VERSION);
    return true;
  }

  if (!start()) {
    var timer = setInterval(function () { if (start()) clearInterval(timer); }, 100);
    setTimeout(function () { clearInterval(timer); }, 30000);
  }
})();
