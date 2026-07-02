(function () {
  'use strict';

  var VERSION = '0.2.7';
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
        } else {
          resolve(result);
        }
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
    var name = String(value || 'video')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return name.slice(0, 120) || 'video';
  }

  function extensionFromMime(mime, fallback) {
    var type = String(mime || '').toLowerCase();
    if (type.indexOf('webm') >= 0) return '.webm';
    if (type.indexOf('matroska') >= 0 || type.indexOf('mkv') >= 0) return '.mkv';
    if (type.indexOf('mp2t') >= 0 || type.indexOf('mpegts') >= 0) return '.ts';
    if (type.indexOf('mp4') >= 0) return '.mp4';
    return fallback || '.mp4';
  }

  function extensionFromUrl(url) {
    try {
      var path = new URL(url).pathname;
      var match = path.match(/\.(mp4|webm|mkv|mov|m4v|ts)$/i);
      return match ? '.' + match[1].toLowerCase() : '';
    } catch (e) {
      return '';
    }
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
    var fileName = sanitizeName(item.title) + extension;
    return new File(parts, fileName, { type: mime || 'application/octet-stream' });
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
      '.offline-export__close,.offline-export__save,.offline-export__prepare,.offline-export__download{appearance:none;border:0;border-radius:12px;padding:11px 14px;background:#2b2b2e;color:#fff;font-size:15px;font-weight:700}' +
      '.offline-export__save,.offline-export__download{background:#fff;color:#111;width:100%;margin-top:14px}' +
      '.offline-export__list{display:flex;flex-direction:column;gap:10px}' +
      '.offline-export__item{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#232326;border-radius:15px;padding:13px}' +
      '.offline-export__name{font-size:15px;font-weight:700;line-height:1.25;word-break:break-word}' +
      '.offline-export__meta{font-size:13px;opacity:.6;margin-top:4px}' +
      '.offline-export__empty,.offline-export__message{padding:20px;border-radius:15px;background:#232326;text-align:center;line-height:1.45}' +
      '.offline-export__progress{opacity:.7;margin-top:10px;text-align:center;font-size:14px}';
    document.head.appendChild(style);
  }

  function removePanel() {
    preparedFile = null;
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  function createPanel(title) {
    removePanel();
    ensureStyles();
    var panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = '<div class="offline-export__sheet"><div class="offline-export__head"><div class="offline-export__title"></div><button type="button" class="offline-export__close">Закрыть</button></div><div class="offline-export__body"></div></div>';
    panel.querySelector('.offline-export__title').textContent = title;
    panel.querySelector('.offline-export__close').addEventListener('click', removePanel);
    panel.addEventListener('click', function (event) {
      if (event.target === panel) removePanel();
    });
    document.body.appendChild(panel);
    return panel;
  }

  function downloadPreparedFile(file) {
    var url = URL.createObjectURL(file);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () {
      anchor.remove();
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 3000);
  }

  async function sharePreparedFile(file) {
    if (!file) return;
    var shareData = { files: [file], title: file.name };

    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share(shareData);
      return;
    }

    downloadPreparedFile(file);
  }

  function showPrepared(file) {
    preparedFile = file;
    var panel = createPanel('Файл подготовлен');
    var body = panel.querySelector('.offline-export__body');
    var message = document.createElement('div');
    message.className = 'offline-export__message';
    message.textContent = file.name + ' · ' + Math.round(file.size / 1024 / 1024) + ' МБ';
    body.appendChild(message);

    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'offline-export__save';
    save.textContent = 'Открыть меню сохранения';
    save.addEventListener('click', function () {
      sharePreparedFile(preparedFile).catch(function (error) {
        if (error && error.name === 'AbortError') return;
        downloadPreparedFile(preparedFile);
      });
    });
    body.appendChild(save);

    var hint = document.createElement('div');
    hint.className = 'offline-export__progress';
    hint.textContent = 'На iPhone выберите «Сохранить в Файлы» в системном меню.';
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
    var panel = createPanel('Сохранить в Файлы');
    var body = panel.querySelector('.offline-export__body');
    var loading = document.createElement('div');
    loading.className = 'offline-export__message';
    loading.textContent = 'Читаем сохранённые видео…';
    body.appendChild(loading);

    try {
      var items = await getAllItems();
      items = items.filter(function (item) { return item.status === 'ready'; });
      items.sort(function (left, right) {
        return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
      });
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
    if (minimalHead && !minimalHead.querySelector('.' + BUTTON_CLASS)) {
      minimalHead.appendChild(makeLauncher('offline-export-minimal'));
    }

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
    script.onload = function () {
      log('base initialized', VERSION);
      injectLaunchers();
    };
    script.onerror = function () {
      baseRequested = false;
      log('base unavailable');
    };
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
    var timer = setInterval(function () {
      if (start()) clearInterval(timer);
    }, 100);
    setTimeout(function () { clearInterval(timer); }, 30000);
  }
})();
