(function () {
  'use strict';

  var VERSION = '0.2.5';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.3.js';
  var CORE_FILE = 'lampa-offline-mvp-0.2.0.js';
  var DB_NAME = 'lampa-offline-hls-v2';
  var ITEMS = 'items';
  var BLOBS = 'blobs';
  var UPDATE_EVENT = 'lampa-offline-hls:update';
  var touchState = null;
  var lastTouchAt = 0;
  var menuOpen = false;
  var activeOfflineAbort = null;
  var controllerPatched = false;
  var inputPatched = false;
  var fetchPatched = false;

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline HLS direct]');
      console.log.apply(console, args);
    } catch (e) {}
  }

  function notify(message) {
    try {
      if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') Lampa.Noty.show(message);
      else log(message);
    } catch (e) { log(message); }
  }

  function emitUpdate() {
    try { window.dispatchEvent(new CustomEvent(UPDATE_EVENT)); } catch (e) {}
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB недоступен'));
      var request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Ошибка IndexedDB')); };
    });
  }

  async function getValue(storeName, key) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Ошибка чтения хранилища')); };
    });
  }

  async function putValue(storeName, value) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = function () { resolve(value); };
      tx.onerror = function () { reject(tx.error || new Error('Ошибка записи хранилища')); };
    });
  }

  async function deleteKey(storeName, key) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error || new Error('Ошибка удаления')); };
    });
  }

  function closeSelect() {
    try {
      if (window.Lampa && Lampa.Select && typeof Lampa.Select.hide === 'function') Lampa.Select.hide();
    } catch (e) {}
  }

  async function deleteItemData(item, delay) {
    if (!item) return;
    if (item.status === 'downloading' && activeOfflineAbort) {
      try { activeOfflineAbort.abort(); } catch (e) {}
    }

    if (delay) await new Promise(function (resolve) { setTimeout(resolve, delay); });

    if (item.hls && Array.isArray(item.hls.ids)) {
      for (var index = 0; index < item.hls.ids.length; index += 1) {
        try { await deleteKey(BLOBS, item.hls.ids[index]); } catch (e) {}
      }
    }

    try { await deleteKey(BLOBS, item.id); } catch (e) {}
    try { await deleteKey(ITEMS, item.id); } catch (e) {}
    emitUpdate();
    notify('Загрузка удалена');
  }

  async function buildOfflineSource(item) {
    var urls = [];

    if (item.kind === 'hls') {
      if (!item.hls || !Array.isArray(item.hls.ids) || !item.hls.template) {
        throw new Error('Локальный HLS повреждён');
      }

      var playlist = item.hls.template;
      for (var index = 0; index < item.hls.ids.length; index += 1) {
        var record = await getValue(BLOBS, item.hls.ids[index]);
        if (!record || !record.blob) throw new Error('Не найден фрагмент ' + (index + 1));
        var segmentUrl = URL.createObjectURL(record.blob);
        urls.push(segmentUrl);
        playlist = playlist.split('__OFFLINE_' + index + '__').join(segmentUrl);
      }

      var playlistUrl = URL.createObjectURL(new Blob([playlist], { type: 'application/vnd.apple.mpegurl' }));
      urls.push(playlistUrl);
      return { url: playlistUrl + '#offline.m3u8', urls: urls, hls: true };
    }

    var fileRecord = await getValue(BLOBS, item.id);
    if (!fileRecord || !fileRecord.blob) throw new Error('Сохранённый файл не найден');
    var fileUrl = URL.createObjectURL(fileRecord.blob);
    return { url: fileUrl, urls: [fileUrl], hls: false };
  }

  async function playOffline(item) {
    closeSelect();
    var source = await buildOfflineSource(item);
    var playData = {
      url: source.url,
      title: item.title || 'Офлайн-видео',
      card: item.card || {}
    };
    if (source.hls) playData.hls_type = 'hlsjs';

    log('playing item directly', item.id, item.kind);
    Lampa.Player.play(playData);

    var cleanup = function () {
      setTimeout(function () {
        source.urls.forEach(function (url) {
          try { URL.revokeObjectURL(url); } catch (e) {}
        });
      }, 1500);
      try {
        if (Lampa.Player.listener && typeof Lampa.Player.listener.remove === 'function') {
          Lampa.Player.listener.remove('destroy', cleanup);
        }
      } catch (e) {}
    };

    try { Lampa.Player.listener.follow('destroy', cleanup); } catch (e) {}
  }

  async function retryItem(item) {
    closeSelect();
    item.status = 'queued';
    item.error = '';
    item.received = 0;
    item.done = 0;
    item.updatedAt = new Date().toISOString();
    await putValue(ITEMS, item);
    emitUpdate();
    notify('Загрузка будет повторена после перезапуска Lampa');
    setTimeout(function () {
      try { window.location.reload(); } catch (e) {}
    }, 300);
  }

  function showActionsById(id) {
    if (!id || menuOpen) return;
    menuOpen = true;

    getValue(ITEMS, id).then(function (item) {
      if (!item) {
        menuOpen = false;
        emitUpdate();
        return;
      }

      var actions = [];
      if (item.status === 'ready') actions.push({ title: 'Смотреть офлайн', action: 'open' });
      if (item.status === 'error' || item.status === 'cancelled') actions.push({ title: 'Повторить загрузку', action: 'retry' });
      if (item.status === 'queued' || item.status === 'downloading') actions.push({ title: 'Отменить и удалить', action: 'cancel-delete' });
      actions.push({ title: 'Удалить', action: 'delete' });

      Lampa.Select.show({
        title: item.title || 'Офлайн-видео',
        items: actions,
        onSelect: function (selected) {
          menuOpen = false;

          if (selected.action === 'open') {
            playOffline(item).catch(function (error) {
              notify(error && error.message ? error.message : 'Не удалось открыть видео');
            });
            return;
          }

          if (selected.action === 'retry') {
            retryItem(item).catch(function (error) {
              notify(error && error.message ? error.message : 'Не удалось повторить загрузку');
            });
            return;
          }

          deleteItemData(item, item.status === 'downloading' ? 1000 : 0).catch(function (error) {
            notify(error && error.message ? error.message : 'Не удалось удалить загрузку');
          });
        },
        onBack: function () {
          menuOpen = false;
          try { Lampa.Controller.toggle('content'); } catch (e) {}
        }
      });
    }).catch(function (error) {
      menuOpen = false;
      notify(error && error.message ? error.message : 'Не удалось открыть действия');
    });
  }

  function focusedItemId() {
    var element = null;
    try { if (window.Navigator && Navigator._focus) element = Navigator._focus; } catch (e) {}
    if (!element || !element.classList || !element.classList.contains('offline-hls__item')) {
      try { element = document.querySelector('.offline-hls__item.focus'); } catch (e) {}
    }
    return element ? (element.getAttribute('data-id') || '') : '';
  }

  function findItem(target) {
    if (!target) return null;
    if (typeof target.closest === 'function') return target.closest('.offline-hls__item');
    var element = target;
    while (element && element !== document.body) {
      if (element.classList && element.classList.contains('offline-hls__item')) return element;
      element = element.parentNode;
    }
    return null;
  }

  function focusItem(item) {
    try {
      var focused = document.querySelectorAll('.offline-hls__item.focus');
      for (var index = 0; index < focused.length; index += 1) {
        if (focused[index] !== item) focused[index].classList.remove('focus');
      }
      item.classList.add('focus');
      if (window.Navigator && typeof Navigator.focus === 'function') Navigator.focus(item);
    } catch (e) {}
  }

  function activateItem(event, source) {
    var item = findItem(event.target);
    if (!item) return;
    if (source === 'click' && Date.now() - lastTouchAt < 900) return;
    if (source === 'touch') lastTouchAt = Date.now();

    try { event.preventDefault(); } catch (e) {}
    try { event.stopPropagation(); } catch (e) {}
    try { event.stopImmediatePropagation(); } catch (e) {}

    focusItem(item);
    showActionsById(item.getAttribute('data-id') || '');
    log('item selected directly by ' + source, item.getAttribute('data-id'));
  }

  function readTouch(event) {
    var list = event.changedTouches && event.changedTouches.length ? event.changedTouches : event.touches;
    return list && list.length ? list[0] : null;
  }

  function installInputCompatibility() {
    if (inputPatched) return;
    inputPatched = true;

    document.addEventListener('touchstart', function (event) {
      var item = findItem(event.target);
      var touch = readTouch(event);
      touchState = item && touch ? { item: item, x: touch.clientX, y: touch.clientY, moved: false } : null;
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', function (event) {
      if (!touchState) return;
      var touch = readTouch(event);
      if (!touch) return;
      if (Math.abs(touch.clientX - touchState.x) > 12 || Math.abs(touch.clientY - touchState.y) > 12) touchState.moved = true;
    }, { capture: true, passive: true });

    document.addEventListener('touchend', function (event) {
      var item = findItem(event.target);
      var isTap = touchState && !touchState.moved && item && item === touchState.item;
      touchState = null;
      if (isTap) activateItem(event, 'touch');
    }, { capture: true, passive: false });

    document.addEventListener('touchcancel', function () { touchState = null; }, { capture: true, passive: true });
    document.addEventListener('click', function (event) { activateItem(event, 'click'); }, true);
    log('direct touch and click actions installed', VERSION);
  }

  function installControllerCompatibility() {
    if (controllerPatched || !window.Lampa || !Lampa.Controller || typeof Lampa.Controller.add !== 'function') return;
    controllerPatched = true;
    var nativeAdd = Lampa.Controller.add.bind(Lampa.Controller);

    Lampa.Controller.add = function (name, calls) {
      try {
        if (name === 'content' && document.querySelector('.offline-hls') && calls) {
          calls.enter = function () { showActionsById(focusedItemId()); };
          calls.long = calls.enter;
          log('direct controller actions installed');
        }
      } catch (e) { log('controller patch failed', e); }
      return nativeAdd(name, calls);
    };
  }

  function installFetchCompatibility() {
    if (fetchPatched || typeof window.fetch !== 'function') return;
    fetchPatched = true;
    var nativeFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      var nextInit = init;
      var controller = null;
      try {
        var stack = String(new Error().stack || '');
        if (stack.indexOf(CORE_FILE) >= 0) {
          controller = new AbortController();
          activeOfflineAbort = controller;
          nextInit = Object.assign({}, init || {}, {
            credentials: init && init.credentials === 'include' ? 'omit' : (init && init.credentials),
            signal: controller.signal
          });
        }
      } catch (e) {}

      return nativeFetch(input, nextInit).finally(function () {
        if (controller && activeOfflineAbort === controller) activeOfflineAbort = null;
      });
    };
    log('direct fetch compatibility installed');
  }

  function loadBase() {
    installInputCompatibility();
    installControllerCompatibility();
    installFetchCompatibility();

    if (document.querySelector('script[data-offline-hls-base="0.2.3"]')) return;
    var script = document.createElement('script');
    script.src = BASE_URL;
    script.async = false;
    script.setAttribute('data-offline-hls-base', '0.2.3');
    script.onload = function () {
      log('initialized', VERSION);
    };
    script.onerror = function () {
      notify('Не удалось загрузить Offline MVP ' + VERSION);
    };
    document.head.appendChild(script);
  }

  function start() {
    if (!window.Lampa) return false;
    loadBase();
    return true;
  }

  if (window.appready && start()) return;
  if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
    Lampa.Listener.follow('app', function (event) { if (event && event.type === 'ready') start(); });
  }
  var timer = setInterval(function () { if (start()) clearInterval(timer); }, 500);
  setTimeout(function () { clearInterval(timer); }, 30000);
})();
