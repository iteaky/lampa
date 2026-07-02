(function () {
  'use strict';

  var VERSION = '0.2.4';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.3.js';
  var installed = false;
  var lastTouchAt = 0;
  var touchState = null;

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline HLS touch]');
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
    } catch (e) {}

    try {
      if (window.Lampa && Lampa.Controller && typeof Lampa.Controller.focus === 'function') {
        Lampa.Controller.focus(item);
      } else if (window.Navigator && typeof Navigator.focus === 'function') {
        Navigator.focus(item);
      } else {
        item.classList.add('focus');
      }
    } catch (e) {
      try { item.classList.add('focus'); } catch (ignore) {}
    }
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

    setTimeout(function () {
      try {
        if (window.Lampa && Lampa.Controller && typeof Lampa.Controller.enter === 'function') {
          Lampa.Controller.enter();
          log('offline item activated by ' + source);
        } else {
          notify('Не удалось открыть действия для загрузки');
        }
      } catch (error) {
        notify(error && error.message ? error.message : 'Не удалось открыть действия');
      }
    }, 0);
  }

  function readTouch(event) {
    var list = event.changedTouches && event.changedTouches.length ? event.changedTouches : event.touches;
    return list && list.length ? list[0] : null;
  }

  function installTouchCompatibility() {
    if (installed) return;
    installed = true;

    document.addEventListener('touchstart', function (event) {
      var item = findItem(event.target);
      var touch = readTouch(event);
      touchState = item && touch ? {
        item: item,
        x: touch.clientX,
        y: touch.clientY,
        moved: false
      } : null;
    }, { capture: true, passive: true });

    document.addEventListener('touchmove', function (event) {
      if (!touchState) return;
      var touch = readTouch(event);
      if (!touch) return;
      if (Math.abs(touch.clientX - touchState.x) > 12 || Math.abs(touch.clientY - touchState.y) > 12) {
        touchState.moved = true;
      }
    }, { capture: true, passive: true });

    document.addEventListener('touchend', function (event) {
      var item = findItem(event.target);
      var isTap = touchState && !touchState.moved && item && item === touchState.item;
      touchState = null;
      if (isTap) activateItem(event, 'touch');
    }, { capture: true, passive: false });

    document.addEventListener('touchcancel', function () {
      touchState = null;
    }, { capture: true, passive: true });

    document.addEventListener('click', function (event) {
      activateItem(event, 'click');
    }, true);

    log('touch and click actions installed', VERSION);
  }

  function loadBase() {
    installTouchCompatibility();

    if (document.querySelector('script[data-offline-hls-base="0.2.3"]')) return;

    var script = document.createElement('script');
    script.src = BASE_URL;
    script.async = false;
    script.setAttribute('data-offline-hls-base', '0.2.3');
    script.onload = function () {
      installTouchCompatibility();
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
