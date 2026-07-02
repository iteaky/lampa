(function () {
  'use strict';

  var VERSION = '0.2.1';
  var CORE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.0.js';

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline HLS compat]');
      console.log.apply(console, args);
    } catch (e) {}
  }

  function notify(message) {
    try {
      if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
        Lampa.Noty.show(message);
      } else {
        log(message);
      }
    } catch (e) {
      log(message);
    }
  }

  function installControllerCompatibility() {
    if (!window.Lampa || !Lampa.Controller) return;
    if (typeof Lampa.Controller.active === 'function') return;

    Lampa.Controller.active = function () {
      var focused = null;

      try {
        if (window.Navigator && Navigator._focus) focused = Navigator._focus;
      } catch (e) {}

      if (!focused) {
        try {
          focused = document.querySelector('.offline-hls__item.focus, .selector.focus');
        } catch (e) {}
      }

      return {
        element: function () {
          return focused;
        }
      };
    };

    log('Controller.active compatibility installed');
  }

  function installFetchCompatibility() {
    if (window.__offlineHlsFetchCompat || typeof window.fetch !== 'function') return;

    window.__offlineHlsFetchCompat = true;
    var nativeFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      var nextInit = init;

      try {
        var isOfflineMediaRequest = init &&
          init.method === 'GET' &&
          init.mode === 'cors' &&
          init.redirect === 'follow' &&
          init.credentials === 'include';

        if (isOfflineMediaRequest) {
          nextInit = Object.assign({}, init, { credentials: 'omit' });
          log('cross-origin media request switched to credentials: omit');
        }
      } catch (e) {}

      return nativeFetch(input, nextInit);
    };

    log('fetch compatibility installed');
  }

  function loadCore() {
    installControllerCompatibility();
    installFetchCompatibility();

    if (window.__offlineHlsV2) {
      log('core already initialized', VERSION);
      return;
    }

    if (document.querySelector('script[data-offline-hls-core="0.2.0"]')) return;

    var script = document.createElement('script');
    script.src = CORE_URL;
    script.async = false;
    script.setAttribute('data-offline-hls-core', '0.2.0');
    script.onload = function () {
      installControllerCompatibility();
      log('initialized', VERSION);
    };
    script.onerror = function () {
      notify('Не удалось загрузить Offline MVP ' + VERSION);
    };
    document.head.appendChild(script);
  }

  function start() {
    if (!window.Lampa) return false;
    loadCore();
    return true;
  }

  if (window.appready && start()) return;

  if (window.Lampa && Lampa.Listener && typeof Lampa.Listener.follow === 'function') {
    Lampa.Listener.follow('app', function (event) {
      if (event && event.type === 'ready') start();
    });
  }

  var timer = setInterval(function () {
    if (start()) clearInterval(timer);
  }, 500);

  setTimeout(function () {
    clearInterval(timer);
  }, 30000);
})();
