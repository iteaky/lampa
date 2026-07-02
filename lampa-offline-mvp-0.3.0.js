/* Lampa. Offline MVP direct device download option. */
(function () {
  'use strict';

  var VERSION = '0.3.0';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.9.js';
  var installed = false;
  var baseLoaded = false;
  var latestMedia = null;
  var originalSelectShow = null;

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline Device]');
      console.log.apply(console, args);
    } catch (e) {}
  }

  function notify(message) {
    try {
      if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') {
        Lampa.Noty.show(message);
      } else {
        window.alert(message);
      }
    } catch (e) {
      log(message);
    }
  }

  function mediaUrl(data) {
    if (!data) return '';
    if (typeof data.url === 'string') return data.url;
    if (data.url && typeof data.url.url === 'string') return data.url.url;
    return '';
  }

  function mediaTitle(data) {
    var card = data && data.card ? data.card : {};
    return String((data && data.title) || card.title || card.name || 'video');
  }

  function sanitizeName(value) {
    var name = String(value || 'video')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return name.slice(0, 120) || 'video';
  }

  function extensionFromUrl(url) {
    try {
      var pathname = new URL(url).pathname;
      var match = pathname.match(/\.(mp4|webm|mkv|mov|m4v)$/i);
      return match ? '.' + match[1].toLowerCase() : '.mp4';
    } catch (e) {
      return '.mp4';
    }
  }

  function isHls(url) {
    return /\.m3u8(?:$|[?#])/i.test(String(url || ''));
  }

  function closeSelect() {
    try {
      if (window.Lampa && Lampa.Select && typeof Lampa.Select.hide === 'function') {
        Lampa.Select.hide();
      }
    } catch (e) {}
  }

  function showDirectLink(url, title) {
    var old = document.getElementById('offline-device-panel');
    if (old) old.remove();

    var panel = document.createElement('div');
    panel.id = 'offline-device-panel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:rgba(0,0,0,.86);display:flex;align-items:flex-end;justify-content:center;padding:18px;padding-bottom:calc(env(safe-area-inset-bottom) + 18px);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#fff';

    var sheet = document.createElement('div');
    sheet.style.cssText = 'width:min(680px,100%);background:#171719;border-radius:22px;padding:18px;box-sizing:border-box';

    var heading = document.createElement('div');
    heading.style.cssText = 'font-size:22px;font-weight:800;margin-bottom:10px';
    heading.textContent = 'Скачать на устройство';

    var text = document.createElement('div');
    text.style.cssText = 'font-size:15px;line-height:1.45;opacity:.78;margin-bottom:16px';
    text.textContent = 'Откройте видео, затем в системном просмотрщике iPhone нажмите «Поделиться» → «Сохранить в Файлы».';

    var open = document.createElement('a');
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.download = sanitizeName(title) + extensionFromUrl(url);
    open.textContent = 'Открыть видео для сохранения';
    open.style.cssText = 'display:block;width:100%;box-sizing:border-box;padding:13px 15px;border-radius:13px;background:#fff;color:#111;text-decoration:none;text-align:center;font-size:16px;font-weight:750';

    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Отмена';
    close.style.cssText = 'display:block;width:100%;margin-top:10px;padding:12px 15px;border:0;border-radius:13px;background:#2b2b2e;color:#fff;font-size:15px;font-weight:700';
    close.addEventListener('click', function () { panel.remove(); });

    sheet.appendChild(heading);
    sheet.appendChild(text);
    sheet.appendChild(open);
    sheet.appendChild(close);
    panel.appendChild(sheet);
    panel.addEventListener('click', function (event) {
      if (event.target === panel) panel.remove();
    });
    document.body.appendChild(panel);
  }

  function openOnDevice(data) {
    var url = mediaUrl(data);
    if (!/^https?:\/\//i.test(url)) {
      notify('Источник не передал прямую HTTP/HTTPS-ссылку.');
      return;
    }

    closeSelect();

    if (isHls(url)) {
      notify('Этот источник использует HLS. Его нельзя скачать на устройство одной прямой ссылкой. Сохраните видео офлайн, затем используйте кнопку «В Файлы».');
      return;
    }

    log('direct device option', url);

    var opened = null;
    try {
      opened = window.open(url, '_blank');
      if (opened) {
        try { opened.opener = null; } catch (e) {}
      }
    } catch (e) {}

    if (!opened) {
      showDirectLink(url, mediaTitle(data));
      return;
    }

    setTimeout(function () {
      notify('В открывшемся просмотрщике нажмите «Поделиться» → «Сохранить в Файлы».');
    }, 250);
  }

  function isOfflineChoice(config) {
    if (!config || !Array.isArray(config.items)) return false;
    var hasPlay = false;
    var hasSave = false;
    for (var index = 0; index < config.items.length; index += 1) {
      if (config.items[index] && config.items[index].action === 'play') hasPlay = true;
      if (config.items[index] && config.items[index].action === 'save') hasSave = true;
    }
    return hasPlay && hasSave;
  }

  function installSelectPatch() {
    if (!window.Lampa || !Lampa.Select || typeof Lampa.Select.show !== 'function') return false;
    if (originalSelectShow) return true;

    originalSelectShow = Lampa.Select.show.bind(Lampa.Select);

    Lampa.Select.show = function (config) {
      try {
        if (isOfflineChoice(config)) {
          var next = Object.assign({}, config);
          next.items = config.items.slice();

          var saveIndex = next.items.findIndex(function (item) {
            return item && item.action === 'save';
          });

          var alreadyAdded = next.items.some(function (item) {
            return item && item.action === 'device';
          });

          if (!alreadyAdded) {
            next.items.splice(saveIndex + 1, 0, {
              title: 'Скачать на устройство',
              action: 'device'
            });
          }

          var originalOnSelect = config.onSelect;
          next.onSelect = function (selected) {
            if (selected && selected.action === 'device') {
              openOnDevice(latestMedia);
              return;
            }
            if (typeof originalOnSelect === 'function') {
              return originalOnSelect(selected);
            }
          };

          config = next;
          log('device option added to player menu');
        }
      } catch (error) {
        log('select patch failed', error && error.message);
      }

      return originalSelectShow(config);
    };

    return true;
  }

  function installPlayerRecorder() {
    if (!window.Lampa || !Lampa.Player || !Lampa.Player.listener || typeof Lampa.Player.listener.follow !== 'function') return false;
    if (window.__offlineDeviceRecorder) return true;

    window.__offlineDeviceRecorder = VERSION;
    Lampa.Player.listener.follow('create', function (event) {
      if (event && event.data) latestMedia = event.data;
    });
    log('player source recorder installed');
    return true;
  }

  function loadBase() {
    if (baseLoaded) return;
    baseLoaded = true;

    var script = document.createElement('script');
    script.src = BASE_URL;
    script.async = false;
    script.setAttribute('data-offline-device-base', '0.2.9');
    script.onload = function () {
      log('initialized', VERSION);
    };
    script.onerror = function () {
      baseLoaded = false;
      notify('Не удалось загрузить Offline MVP ' + VERSION);
    };
    document.head.appendChild(script);
  }

  function start() {
    if (installed) return true;
    if (!window.Lampa || !document.head) return false;
    if (!installSelectPatch()) return false;
    if (!installPlayerRecorder()) return false;

    installed = true;
    loadBase();
    return true;
  }

  if (!start()) {
    var timer = setInterval(function () {
      if (start()) clearInterval(timer);
    }, 100);
    setTimeout(function () { clearInterval(timer); }, 30000);
  }
})();
