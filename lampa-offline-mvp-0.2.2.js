(function () {
  'use strict';

  var VERSION = '0.2.2';
  var CORE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.0.js';
  var CORE_FILE = 'lampa-offline-mvp-0.2.0.js';

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

  function installScopedFetchCompatibility() {
    if (window.__offlineHlsScopedFetchCompat || typeof window.fetch !== 'function') return;

    window.__offlineHlsScopedFetchCompat = VERSION;
    var nativeFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      var nextInit = init;

      try {
        var stack = String(new Error().stack || '');
        var fromOfflineCore = stack.indexOf(CORE_FILE) >= 0;
        var needsOmit = fromOfflineCore && init && init.credentials === 'include';

        if (needsOmit) {
          nextInit = Object.assign({}, init, { credentials: 'omit' });
        }
      } catch (e) {}

      return nativeFetch(input, nextInit);
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
        var isOfflineHls = url.indexOf('blob:') === 0 && url.indexOf('#offline.m3u8') >= 0;

        if (isOfflineHls) {
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

    if (document.querySelector('script[data-offline-hls-core="0.2.0"]')) return;

    var script = document.createElement('script');
    script.src = CORE_URL;
    script.async = false;
    script.setAttribute('data-offline-hls-core', '0.2.0');
    script.onload = function () {
      installControllerCompatibility();
      installOfflineHlsPlaybackCompatibility();
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
