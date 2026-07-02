(function () {
  'use strict';

  var VERSION = '0.2.6';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.5.js';
  var SELF_URL = document.currentScript && document.currentScript.src ? document.currentScript.src : '';
  var DB_NAME = 'lampa-offline-hls-v2';
  var ITEMS = 'items';
  var BLOBS = 'blobs';
  var UPDATE_EVENT = 'lampa-offline-hls:update';
  var SHELL_ID = 'offline-minimal-shell';
  var PLAYER_ID = 'offline-minimal-player';
  var activeUrls = [];
  var activeHls = null;
  var baseRequested = false;
  var shellVisible = false;

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline Shell]');
      console.log.apply(console, args);
    } catch (e) {}
  }

  function formatBytes(value) {
    var size = Number(value || 0);
    var units = ['Б', 'КБ', 'МБ', 'ГБ'];
    var index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    if (!size) return '—';
    return (size >= 100 ? size.toFixed(0) : size.toFixed(1)) + ' ' + units[index];
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
      request.onerror = function () { reject(request.error); };
    });
  }

  async function deleteKey(storeName, key) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = function () { reject(transaction.error); };
    });
  }

  async function deleteItem(item) {
    if (item && item.hls && Array.isArray(item.hls.ids)) {
      for (var index = 0; index < item.hls.ids.length; index += 1) {
        try { await deleteKey(BLOBS, item.hls.ids[index]); } catch (e) {}
      }
    }
    if (item) {
      try { await deleteKey(BLOBS, item.id); } catch (e) {}
      try { await deleteKey(ITEMS, item.id); } catch (e) {}
    }
    await renderList();
  }

  async function buildSource(item) {
    var urls = [];

    if (item.kind === 'hls') {
      if (!item.hls || !item.hls.template || !Array.isArray(item.hls.ids)) {
        throw new Error('Сохранённый HLS повреждён');
      }

      var playlist = item.hls.template;
      for (var index = 0; index < item.hls.ids.length; index += 1) {
        var fragment = await getValue(BLOBS, item.hls.ids[index]);
        if (!fragment || !fragment.blob) throw new Error('Не найден фрагмент ' + (index + 1));
        var fragmentUrl = URL.createObjectURL(fragment.blob);
        urls.push(fragmentUrl);
        playlist = playlist.split('__OFFLINE_' + index + '__').join(fragmentUrl);
      }

      var playlistUrl = URL.createObjectURL(new Blob([playlist], { type: 'application/vnd.apple.mpegurl' }));
      urls.push(playlistUrl);
      return { url: playlistUrl + '#offline.m3u8', urls: urls, hls: true };
    }

    var record = await getValue(BLOBS, item.id);
    if (!record || !record.blob) throw new Error('Сохранённый файл не найден');
    var fileUrl = URL.createObjectURL(record.blob);
    return { url: fileUrl, urls: [fileUrl], hls: false };
  }

  function cleanupPlayer() {
    try {
      if (activeHls) activeHls.destroy();
    } catch (e) {}
    activeHls = null;

    activeUrls.forEach(function (url) {
      try { URL.revokeObjectURL(url); } catch (e) {}
    });
    activeUrls = [];

    var player = document.getElementById(PLAYER_ID);
    if (player) player.remove();
  }

  async function playItem(item) {
    cleanupPlayer();
    var source = await buildSource(item);
    activeUrls = source.urls.slice();

    var viewer = document.createElement('div');
    viewer.id = PLAYER_ID;
    viewer.innerHTML = '<div class="offline-minimal-player__bar"><button type="button" class="offline-minimal-player__close">Закрыть</button><div class="offline-minimal-player__title"></div></div><video class="offline-minimal-player__video" controls autoplay playsinline></video>';
    viewer.querySelector('.offline-minimal-player__title').textContent = item.title || 'Офлайн-видео';
    viewer.querySelector('.offline-minimal-player__close').addEventListener('click', cleanupPlayer);
    document.body.appendChild(viewer);

    var video = viewer.querySelector('video');
    video.addEventListener('error', function () {
      var message = document.createElement('div');
      message.className = 'offline-minimal-player__error';
      message.textContent = 'Не удалось воспроизвести сохранённое видео на этом устройстве.';
      viewer.appendChild(message);
    }, { once: true });

    if (source.hls && window.Hls && typeof Hls.isSupported === 'function' && Hls.isSupported()) {
      activeHls = new Hls();
      activeHls.loadSource(source.url);
      activeHls.attachMedia(video);
      activeHls.on(Hls.Events.MANIFEST_PARSED, function () {
        var promise = video.play();
        if (promise && promise.catch) promise.catch(function () {});
      });
    } else {
      video.src = source.url;
      var promise = video.play();
      if (promise && promise.catch) promise.catch(function () {});
    }
  }

  function ensureStyles() {
    if (document.getElementById('offline-minimal-shell-style')) return;
    var style = document.createElement('style');
    style.id = 'offline-minimal-shell-style';
    style.textContent = '' +
      '#' + SHELL_ID + '{position:fixed;inset:0;z-index:2147483000;background:#111;color:#fff;overflow:auto;-webkit-overflow-scrolling:touch;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:calc(env(safe-area-inset-top) + 20px) 18px calc(env(safe-area-inset-bottom) + 28px)}' +
      '.offline-minimal__head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:22px}' +
      '.offline-minimal__title{font-size:30px;font-weight:750;line-height:1.1}' +
      '.offline-minimal__subtitle{opacity:.66;margin-top:7px;font-size:15px}' +
      '.offline-minimal__refresh,.offline-minimal__button,.offline-minimal-player__close{appearance:none;border:0;border-radius:12px;padding:11px 14px;background:#2a2a2a;color:#fff;font-size:15px;font-weight:650}' +
      '.offline-minimal__list{display:flex;flex-direction:column;gap:12px}' +
      '.offline-minimal__item{background:#1d1d1f;border:1px solid rgba(255,255,255,.08);border-radius:17px;padding:16px}' +
      '.offline-minimal__name{font-size:17px;font-weight:700;line-height:1.25;word-break:break-word}' +
      '.offline-minimal__status{font-size:14px;opacity:.62;margin-top:7px}' +
      '.offline-minimal__actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}' +
      '.offline-minimal__button--primary{background:#fff;color:#111}' +
      '.offline-minimal__button--danger{background:#3a1e1e;color:#ffb7b7}' +
      '.offline-minimal__empty{padding:28px 18px;border-radius:17px;background:#1d1d1f;opacity:.72;text-align:center;line-height:1.45}' +
      '#' + PLAYER_ID + '{position:fixed;inset:0;z-index:2147483600;background:#000;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top)}' +
      '.offline-minimal-player__bar{display:flex;align-items:center;gap:14px;padding:12px 14px;background:#111}' +
      '.offline-minimal-player__title{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.offline-minimal-player__video{width:100%;height:100%;min-height:0;background:#000}' +
      '.offline-minimal-player__error{position:absolute;left:18px;right:18px;bottom:calc(env(safe-area-inset-bottom) + 22px);padding:13px;border-radius:12px;background:rgba(120,0,0,.88);text-align:center}';
    document.head.appendChild(style);
  }

  function statusText(item) {
    if (item.status === 'ready') return 'Готово · ' + formatBytes(item.received);
    if (item.status === 'downloading') return 'Загрузка не завершена · ' + formatBytes(item.received);
    if (item.status === 'queued') return 'Ожидает загрузки';
    if (item.status === 'error') return 'Ошибка загрузки';
    if (item.status === 'cancelled') return 'Загрузка отменена';
    return item.status || 'Неизвестный статус';
  }

  async function renderList() {
    var shell = document.getElementById(SHELL_ID);
    if (!shell) return;
    var list = shell.querySelector('.offline-minimal__list');
    list.innerHTML = '';

    try {
      var items = await getAllItems();
      items.sort(function (left, right) {
        return String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
      });

      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'offline-minimal__empty';
        empty.textContent = 'Сохранённых видео пока нет. Подключитесь к интернету и добавьте видео через пункт «Сохранить офлайн».';
        list.appendChild(empty);
        return;
      }

      items.forEach(function (item) {
        var card = document.createElement('div');
        card.className = 'offline-minimal__item';

        var name = document.createElement('div');
        name.className = 'offline-minimal__name';
        name.textContent = item.title || 'Видео';

        var status = document.createElement('div');
        status.className = 'offline-minimal__status';
        status.textContent = statusText(item);

        var actions = document.createElement('div');
        actions.className = 'offline-minimal__actions';

        if (item.status === 'ready') {
          var play = document.createElement('button');
          play.type = 'button';
          play.className = 'offline-minimal__button offline-minimal__button--primary';
          play.textContent = 'Смотреть';
          play.addEventListener('click', function () {
            playItem(item).catch(function (error) {
              window.alert(error && error.message ? error.message : 'Не удалось открыть видео');
            });
          });
          actions.appendChild(play);
        }

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'offline-minimal__button offline-minimal__button--danger';
        remove.textContent = 'Удалить';
        remove.addEventListener('click', function () {
          if (window.confirm('Удалить «' + (item.title || 'Видео') + '»?')) {
            deleteItem(item).catch(function (error) {
              window.alert(error && error.message ? error.message : 'Не удалось удалить запись');
            });
          }
        });
        actions.appendChild(remove);

        card.appendChild(name);
        card.appendChild(status);
        card.appendChild(actions);
        list.appendChild(card);
      });
    } catch (error) {
      var failed = document.createElement('div');
      failed.className = 'offline-minimal__empty';
      failed.textContent = error && error.message ? error.message : 'Не удалось прочитать локальное хранилище.';
      list.appendChild(failed);
    }
  }

  function createShell() {
    ensureStyles();
    var shell = document.getElementById(SHELL_ID);
    if (shell) return shell;

    shell = document.createElement('div');
    shell.id = SHELL_ID;
    shell.innerHTML = '<div class="offline-minimal__head"><div><div class="offline-minimal__title">Офлайн</div><div class="offline-minimal__subtitle">Интернет недоступен. Показаны сохранённые видео.</div></div><button type="button" class="offline-minimal__refresh">Обновить</button></div><div class="offline-minimal__list"></div>';
    shell.querySelector('.offline-minimal__refresh').addEventListener('click', renderList);
    document.body.appendChild(shell);
    return shell;
  }

  function showShell() {
    shellVisible = true;
    var shell = createShell();
    shell.style.display = 'block';
    document.documentElement.style.background = '#111';
    document.body.style.overflow = 'hidden';
    renderList();
    log('minimal offline shell shown', VERSION);
  }

  function hideShell() {
    shellVisible = false;
    cleanupPlayer();
    var shell = document.getElementById(SHELL_ID);
    if (shell) shell.style.display = 'none';
    document.body.style.overflow = '';
    log('minimal offline shell hidden');
  }

  function warmCache() {
    if (!navigator.onLine || !window.caches) return;
    var urls = [SELF_URL, BASE_URL].filter(Boolean);
    caches.open('lampa-offline-bootstrap-v1').then(function (cache) {
      return Promise.all(urls.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () {
      log('plugin files stored in Cache API');
    }).catch(function () {});
  }

  function loadBasePlugin() {
    if (baseRequested || !navigator.onLine) return;
    baseRequested = true;
    if (document.querySelector('script[data-offline-hls-base="0.2.5"]')) return;

    var script = document.createElement('script');
    script.src = BASE_URL;
    script.async = false;
    script.setAttribute('data-offline-hls-base', '0.2.5');
    script.onload = function () { log('online plugin initialized', VERSION); };
    script.onerror = function () {
      baseRequested = false;
      log('online plugin unavailable');
    };
    document.head.appendChild(script);
  }

  function applyNetworkState() {
    if (navigator.onLine) {
      if (shellVisible) hideShell();
      loadBasePlugin();
      warmCache();
    } else {
      showShell();
    }
  }

  function start() {
    if (!document.body) return false;
    window.addEventListener('online', applyNetworkState);
    window.addEventListener('offline', applyNetworkState);
    window.addEventListener(UPDATE_EVENT, function () {
      if (shellVisible) renderList();
    });
    applyNetworkState();
    log('initialized', VERSION, 'online:', navigator.onLine);
    return true;
  }

  if (!start()) {
    var timer = setInterval(function () {
      if (start()) clearInterval(timer);
    }, 100);
    setTimeout(function () { clearInterval(timer); }, 30000);
  }
})();
