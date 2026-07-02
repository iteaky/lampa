(function () {
  'use strict';

  var VERSION = '0.2.3';
  var CORE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.0.js';
  var CORE_FILE = 'lampa-offline-mvp-0.2.0.js';
  var DB_NAME = 'lampa-offline-hls-v2';
  var ITEMS = 'items';
  var BLOBS = 'blobs';
  var UPDATE_EVENT = 'lampa-offline-hls:update';
  var nativeControllerAdd = null;
  var activeOfflineAbort = null;

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline HLS compat]');
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
      var request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('Ошибка IndexedDB')); };
    });
  }

  async function getItem(id) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var request = db.transaction(ITEMS, 'readonly').objectStore(ITEMS).get(id);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function deleteKey(store, key) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function deleteItemData(item, delay) {
    if (!item) return;
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

  function focusedItemId() {
    var element = null;
    try {
      if (window.Navigator && Navigator._focus) element = Navigator._focus;
    } catch (e) {}
    if (!element) element = document.querySelector('.offline-hls__item.focus');
    if (!element) return '';
    return element.getAttribute('data-id') || '';
  }

  function showActions(originalEnter) {
    var id = focusedItemId();
    if (!id) return;

    getItem(id).then(function (item) {
      if (!item) {
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
          if (selected.action === 'open' || selected.action === 'retry') {
            originalEnter();
            return;
          }

          var downloading = item.status === 'downloading';
          if (downloading && activeOfflineAbort) {
            try { activeOfflineAbort.abort(); } catch (e) {}
          }

          deleteItemData(item, downloading ? 800 : 0).catch(function (error) {
            notify(error && error.message ? error.message : 'Не удалось удалить загрузку');
          });

          try { Lampa.Controller.toggle('content'); } catch (e) {}
        },
        onBack: function () {
          try { Lampa.Controller.toggle('content'); } catch (e) {}
        }
      });
    }).catch(function (error) {
      notify(error && error.message ? error.message : 'Не удалось открыть действия');
    });
  }

  function installControllerCompatibility() {
    if (!window.Lampa || !Lampa.Controller) return;

    if (typeof Lampa.Controller.active !== 'function') {
      Lampa.Controller.active = function () {
        var focused = null;
        try { if (window.Navigator && Navigator._focus) focused = Navigator._focus; } catch (e) {}
        if (!focused) focused = document.querySelector('.offline-hls__item.focus, .selector.focus');
        return { element: function () { return focused; } };
      };
      log('Controller.active compatibility installed');
    }

    if (nativeControllerAdd) return;
    nativeControllerAdd = Lampa.Controller.add.bind(Lampa.Controller);
    Lampa.Controller.add = function (name, calls) {
      try {
        if (name === 'content' && document.querySelector('.offline-hls') && calls && typeof calls.enter === 'function') {
          var originalEnter = calls.enter;
          calls.enter = function () { showActions(originalEnter); };
          calls.long = calls.enter;
          log('offline item actions installed');
        }
      } catch (e) { log('actions patch error', e); }
      return nativeControllerAdd(name, calls);
    };
  }

  function installScopedFetchCompatibility() {
    if (window.__offlineHlsScopedFetchCompat === VERSION || typeof window.fetch !== 'function') return;
    window.__offlineHlsScopedFetchCompat = VERSION;
    var nativeFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      var nextInit = init;
      var controller = null;
      try {
        var stack = String(new Error().stack || '');
        var fromOfflineCore = stack.indexOf(CORE_FILE) >= 0;
        if (fromOfflineCore) {
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
    log('scoped fetch compatibility installed');
  }

  function installOfflineHlsPlaybackCompatibility() {
    if (!window.Lampa || !Lampa.Player || typeof Lampa.Player.play !== 'function') return;
    if (window.__offlineHlsPlayCompat === VERSION) return;
    window.__offlineHlsPlayCompat = VERSION;
    var nativePlay = Lampa.Player.play.bind(Lampa.Player);

    Lampa.Player.play = function (data) {
      try {
        var url = data && typeof data.url === 'string' ? data.url : '';
        if (url.indexOf('blob:') === 0 && url.indexOf('#offline.m3u8') >= 0) {
          data = Object.assign({}, data, { hls_type: 'hlsjs' });
          log('local HLS forced to hls.js');
        }
      } catch (e) {}
      return nativePlay(data);
    };
    log('offline HLS playback compatibility installed');
  }

  function loadCore() {
    installControllerCompatibility();
    installScopedFetchCompatibility();
    installOfflineHlsPlaybackCompatibility();

    if (window.__offlineHlsV2) {
      log('core already initialized', VERSION);
      return;
    }

    var script = document.createElement('script');
    script.src = CORE_URL;
    script.async = false;
    script.setAttribute('data-offline-hls-core', '0.2.0');
    script.onload = function () { log('initialized', VERSION); };
    script.onerror = function () { notify('Не удалось загрузить Offline MVP ' + VERSION); };
    document.head.appendChild(script);
  }

  function start() {
    if (!window.Lampa) return false;
    loadCore();
    return true;
  }

  if (window.appready && start()) return;
  if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
    Lampa.Listener.follow('app', function (event) { if (event && event.type === 'ready') start(); });
  }
  var timer = setInterval(function () { if (start()) clearInterval(timer); }, 500);
  setTimeout(function () { clearInterval(timer); }, 30000);
})();
