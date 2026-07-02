/* Lampa. Offline MVP manifest-aware device download. */
(function () {
  'use strict';

  var VERSION = '0.3.1';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.9.js';
  var installed = false;
  var baseLoaded = false;
  var latestMedia = null;
  var originalSelectShow = null;
  var pendingAction = '';
  var pendingUrl = '';

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Offline Device]');
      console.log.apply(console, args);
    } catch (e) {}
  }

  function notify(message) {
    try {
      if (window.Lampa && Lampa.Noty && typeof Lampa.Noty.show === 'function') Lampa.Noty.show(message);
      else window.alert(message);
    } catch (e) { log(message); }
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
    var name = String(value || 'video').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return name.slice(0, 120) || 'video';
  }

  function isHls(url) {
    return /\.m3u8(?:$|[?#])/i.test(String(url || ''));
  }

  function isDirectVideo(url) {
    return /\.(mp4|webm|mkv|mov|m4v)(?:$|[?#])/i.test(String(url || ''));
  }

  function extensionFromUrl(url) {
    try {
      var match = new URL(url).pathname.match(/\.(mp4|webm|mkv|mov|m4v)$/i);
      return match ? '.' + match[1].toLowerCase() : '.mp4';
    } catch (e) { return '.mp4'; }
  }

  function normalizeUrl(value, base) {
    try { return new URL(String(value || ''), base).href; }
    catch (e) { return ''; }
  }

  function closeSelect() {
    try {
      if (window.Lampa && Lampa.Select && typeof Lampa.Select.hide === 'function') Lampa.Select.hide();
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
    text.textContent = 'Откройте видео, затем нажмите «Поделиться» → «Сохранить в Файлы».';

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
    panel.addEventListener('click', function (event) { if (event.target === panel) panel.remove(); });
    document.body.appendChild(panel);
  }

  async function fetchText(url) {
    var options = {
      method: 'GET',
      mode: 'cors',
      redirect: 'follow',
      credentials: 'omit',
      headers: {
        Accept: 'application/json, application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*',
        Range: 'bytes=0-524287'
      }
    };

    var response;
    try {
      response = await fetch(url, options);
    } catch (firstError) {
      delete options.headers.Range;
      response = await fetch(url, options);
    }

    if (!response.ok) throw new Error('HTTP ' + response.status + ' при чтении источника');
    var contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.indexOf('video/') >= 0 || contentType.indexOf('application/octet-stream') >= 0) {
      try { if (response.body && response.body.cancel) await response.body.cancel(); } catch (e) {}
      return { type: 'video', url: response.url || url, contentType: contentType };
    }

    var text = await response.text();
    return { type: 'text', url: response.url || url, contentType: contentType, text: text };
  }

  function collectManifestLinks(data, baseUrl) {
    var result = [];
    var seen = {};

    function add(url, quality, label) {
      var absolute = normalizeUrl(url, baseUrl);
      if (!absolute || (!isHls(absolute) && !isDirectVideo(absolute)) || seen[absolute]) return;
      seen[absolute] = true;
      result.push({
        url: absolute,
        quality: String(quality || '').replace(/p$/i, ''),
        label: String(label || '')
      });
    }

    if (data && Array.isArray(data.sources)) {
      data.sources.forEach(function (source) {
        var sourceLabel = source && (source.label || source.name || source.title);
        if (source && Array.isArray(source.links)) {
          source.links.forEach(function (link) {
            if (link) add(link.src || link.url || link.link, link.quality || link.label, sourceLabel);
          });
        }
        if (source) add(source.src || source.url || source.link, source.quality, sourceLabel);
      });
    }

    function walk(value, context) {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(function (item) { walk(item, context); });
        return;
      }
      if (typeof value !== 'object') return;

      var nextContext = {
        quality: value.quality || value.resolution || value.height || context.quality,
        label: value.label || value.name || value.title || context.label
      };

      ['src', 'url', 'link', 'file'].forEach(function (key) {
        if (typeof value[key] === 'string') add(value[key], nextContext.quality, nextContext.label);
      });

      Object.keys(value).forEach(function (key) {
        if (['src', 'url', 'link', 'file'].indexOf(key) < 0) walk(value[key], nextContext);
      });
    }

    walk(data, {});

    result.sort(function (left, right) {
      return Number(right.quality || 0) - Number(left.quality || 0);
    });
    return result;
  }

  async function resolveSource(url) {
    if (isDirectVideo(url)) return [{ url: url, quality: '', label: '' }];
    if (isHls(url)) return [{ url: url, quality: '', label: '' }];

    var loaded = await fetchText(url);
    if (loaded.type === 'video') return [{ url: loaded.url, quality: '', label: '' }];

    var trimmed = String(loaded.text || '').trim();
    if (trimmed.indexOf('#EXTM3U') === 0) return [{ url: loaded.url, quality: '', label: '' }];

    var json;
    try { json = JSON.parse(trimmed); }
    catch (error) { throw new Error('Источник вернул не видео, а неподдерживаемый служебный ответ.'); }

    var links = collectManifestLinks(json, loaded.url);
    if (!links.length) throw new Error('В ответе источника не найдены ссылки на видео.');
    return links;
  }

  function replayWithAction(data, url, action) {
    pendingAction = action;
    pendingUrl = url;
    var next = Object.assign({}, data || {}, { url: url });
    if (next.card) next.card = Object.assign({}, next.card);
    log('resolved source forwarded', action, url);
    Lampa.Player.play(next);
  }

  function showHlsActions(data, choice) {
    var suffix = choice.quality ? ' · ' + choice.quality + 'p' : '';
    Lampa.Select.show({
      title: 'HLS-поток' + suffix,
      items: [
        { title: 'Сохранить офлайн', action: 'save' },
        { title: 'Смотреть', action: 'play' }
      ],
      onSelect: function (selected) {
        replayWithAction(data, choice.url, selected.action);
      },
      onBack: function () {
        try { Lampa.Controller.toggle('content'); } catch (e) {}
      }
    });
  }

  function handleChoice(data, choice) {
    if (isDirectVideo(choice.url)) {
      showDirectLink(choice.url, mediaTitle(data));
      return;
    }
    if (isHls(choice.url)) {
      showHlsActions(data, choice);
      return;
    }
    notify('Выбранный источник не является видеофайлом.');
  }

  function showQualityChoice(data, choices) {
    if (choices.length === 1) {
      handleChoice(data, choices[0]);
      return;
    }

    Lampa.Select.show({
      title: 'Выберите качество',
      items: choices.map(function (choice, index) {
        var title = choice.quality ? choice.quality + 'p' : (choice.label || 'Источник ' + (index + 1));
        if (choice.label && choice.quality) title += ' · ' + choice.label;
        return { title: title, choice: choice };
      }),
      onSelect: function (selected) {
        handleChoice(data, selected.choice);
      },
      onBack: function () {
        try { Lampa.Controller.toggle('content'); } catch (e) {}
      }
    });
  }

  async function openOnDevice(data) {
    var url = mediaUrl(data);
    if (!/^https?:\/\//i.test(url)) {
      notify('Источник не передал HTTP/HTTPS-ссылку.');
      return;
    }

    closeSelect();
    notify('Определяем реальный видеоисточник…');

    try {
      var choices = await resolveSource(url);
      log('source resolved', choices.length, choices);
      showQualityChoice(data, choices);
    } catch (error) {
      log('source resolve failed', error && error.message);
      notify(error && error.message ? error.message : 'Не удалось определить видеоисточник.');
    }
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
          var currentUrl = mediaUrl(latestMedia);
          if (pendingAction && currentUrl === pendingUrl) {
            var action = pendingAction;
            pendingAction = '';
            pendingUrl = '';
            log('automatic resolved action', action, currentUrl);
            setTimeout(function () {
              if (typeof config.onSelect === 'function') config.onSelect({ action: action });
            }, 0);
            return;
          }

          var next = Object.assign({}, config);
          next.items = config.items.slice();
          var saveIndex = next.items.findIndex(function (item) { return item && item.action === 'save'; });
          var alreadyAdded = next.items.some(function (item) { return item && item.action === 'device'; });
          if (!alreadyAdded) {
            next.items.splice(saveIndex + 1, 0, { title: 'Скачать на устройство', action: 'device' });
          }

          var originalOnSelect = config.onSelect;
          next.onSelect = function (selected) {
            if (selected && selected.action === 'device') {
              openOnDevice(latestMedia);
              return;
            }
            if (typeof originalOnSelect === 'function') return originalOnSelect(selected);
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
    if (window.__offlineDeviceRecorder === VERSION) return true;

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
    script.onload = function () { log('initialized', VERSION); };
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
    var timer = setInterval(function () { if (start()) clearInterval(timer); }, 100);
    setTimeout(function () { clearInterval(timer); }, 30000);
  }
})();
