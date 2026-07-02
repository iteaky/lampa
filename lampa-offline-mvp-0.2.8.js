/* Lampa. Offline MVP compatibility marker for the built-in extension checker. */
(function () {
  'use strict';

  var VERSION = '0.2.8';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.7.js';

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline MVP]');
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

  function loadBase() {
    if (document.querySelector('script[data-offline-mvp-base="0.2.7"]')) return;

    var script = document.createElement('script');
    script.src = BASE_URL;
    script.async = false;
    script.setAttribute('data-offline-mvp-base', '0.2.7');
    script.onload = function () {
      log('initialized', VERSION);
    };
    script.onerror = function () {
      notify('Не удалось загрузить Offline MVP ' + VERSION);
    };
    document.head.appendChild(script);
  }

  function start() {
    if (!document.head) return false;
    loadBase();
    return true;
  }

  if (!start()) {
    var timer = setInterval(function () {
      if (start()) clearInterval(timer);
    }, 100);

    setTimeout(function () {
      clearInterval(timer);
    }, 30000);
  }
})();
