/* Lampa. Offline MVP direct download-to-device flow. */
(function () {
  'use strict';

  var VERSION = '0.3.2';
  var BASE_URL = 'https://cdn.jsdelivr.net/gh/iteaky/lampa@main/lampa-offline-mvp-0.2.9.js';
  var installed = false;
  var baseLoaded = false;
  var latestMedia = null;
  var originalSelectShow = null;
  var pendingAction = '';
  var pendingUrl = '';
  var activeDownload = null;
  var retainedUrls = [];

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

  function formatBytes(value) {
    var size = Number(value || 0);
    var units = ['Б', 'КБ', 'МБ', 'ГБ'];
    var index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    if (!size) return '0 Б';
    return (size >= 100 ? size.toFixed(0) : size.toFixed(1)) + ' ' + units[index];
  }

  function isHls(url) {
    return /\.m3u8(?:$|[?#])/i.test(String(url || ''));
  }

  function isDirectVideo(url) {
    return /\.(mp4|webm|mkv|mov|m4v)(?:$|[?#])/i.test(String(url || ''));
  }

  function extensionFromUrl(url) {
    try {
      var match = new URL(url).pathname.match(/\.(mp4|webm|mkv|mov|m4v|ts)$/i);
      return match ? '.' + match[1].toLowerCase() : '';
    } catch (e) { return ''; }
  }

  function extensionFromMime(mime) {
    var type = String(mime || '').toLowerCase();
    if (type.indexOf('webm') >= 0) return '.webm';
    if (type.indexOf('matroska') >= 0 || type.indexOf('mkv') >= 0) return '.mkv';
    if (type.indexOf('quicktime') >= 0) return '.mov';
    if (type.indexOf('mp2t') >= 0) return '.ts';
    return '.mp4';
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

  function parseAttributes(value) {
    var result = {};
    String(value || '').replace(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi, function (_, key, raw) {
      raw = String(raw || '').trim();
      if (raw.charAt(0) === '"') raw = raw.slice(1, -1);
      result[String(key).toUpperCase()] = raw;
      return _;
    });
    return result;
  }

  function ensureDownloadStyle() {
    if (document.getElementById('offline-device-download-style')) return;
    var style = document.createElement('style');
    style.id = 'offline-device-download-style';
    style.textContent = '' +
      '#offline-device-download{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.88);display:flex;align-items:flex-end;justify-content:center;padding:18px;padding-bottom:calc(env(safe-area-inset-bottom) + 18px);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#fff}' +
      '.offline-device-download__sheet{width:min(680px,100%);background:#171719;border-radius:22px;padding:18px;box-sizing:border-box}' +
      '.offline-device-download__title{font-size:22px;font-weight:800;line-height:1.2}' +
      '.offline-device-download__status{margin-top:10px;font-size:15px;line-height:1.45;opacity:.78;word-break:break-word}' +
      '.offline-device-download__progress{height:8px;border-radius:999px;background:#333;margin-top:15px;overflow:hidden}' +
      '.offline-device-download__bar{height:100%;width:0;background:#fff;transition:width .15s linear}' +
      '.offline-device-download__actions{display:flex;flex-direction:column;gap:10px;margin-top:16px}' +
      '.offline-device-download__button{appearance:none;border:0;border-radius:13px;padding:13px 15px;background:#2b2b2e;color:#fff;font-size:16px;font-weight:750;text-decoration:none;text-align:center;display:block;box-sizing:border-box;width:100%}' +
      '.offline-device-download__button--primary{background:#fff;color:#111}' +
      '.offline-device-download__hint{font-size:13px;line-height:1.4;opacity:.58;margin-top:12px;text-align:center}';
    document.head.appendChild(style);
  }

  function createDownloadPanel(title) {
    var old = document.getElementById('offline-device-download');
    if (old) old.remove();
    ensureDownloadStyle();

    var panel = document.createElement('div');
    panel.id = 'offline-device-download';
    panel.innerHTML = '<div class="offline-device-download__sheet"><div class="offline-device-download__title"></div><div class="offline-device-download__status">Подготовка…</div><div class="offline-device-download__progress"><div class="offline-device-download__bar"></div></div><div class="offline-device-download__actions"></div><div class="offline-device-download__hint">Файл пока находится в памяти приложения. Не закрывайте Lampa до появления кнопки сохранения.</div></div>';
    panel.querySelector('.offline-device-download__title').textContent = title || 'Скачать в Загрузки';
    document.body.appendChild(panel);
    return panel;
  }

  function updateDownloadPanel(panel, text, ratio) {
    if (!panel) return;
    var status = panel.querySelector('.offline-device-download__status');
    var bar = panel.querySelector('.offline-device-download__bar');
    if (status) status.textContent = text;
    if (bar && typeof ratio === 'number') {
      bar.style.width = Math.max(0, Math.min(100, ratio * 100)) + '%';
    }
  }

  function addCancelButton(panel, controller) {
    var actions = panel.querySelector('.offline-device-download__actions');
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'offline-device-download__button';
    cancel.textContent = 'Отмена';
    cancel.addEventListener('click', function () {
      try { controller.abort(); } catch (e) {}
      panel.remove();
    });
    actions.appendChild(cancel);
  }

  function retainObjectUrl(url) {
    retainedUrls.push(url);
    setTimeout(function () {
      var index = retainedUrls.indexOf(url);
      if (index >= 0) retainedUrls.splice(index, 1);
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 5 * 60 * 1000);
  }

  function showReadyDownload(panel, blob, filename) {
    var octetBlob = new Blob([blob], { type: 'application/octet-stream' });
    var objectUrl = URL.createObjectURL(octetBlob);
    retainObjectUrl(objectUrl);

    updateDownloadPanel(panel, filename + ' · ' + formatBytes(blob.size), 1);
    var progress = panel.querySelector('.offline-device-download__progress');
    if (progress) progress.style.display = 'none';

    var actions = panel.querySelector('.offline-device-download__actions');
    actions.innerHTML = '';

    var save = document.createElement('a');
    save.className = 'offline-device-download__button offline-device-download__button--primary';
    save.href = objectUrl;
    save.download = filename;
    save.textContent = 'Сохранить в Загрузки';
    save.addEventListener('click', function () {
      updateDownloadPanel(panel, 'Запрос на сохранение отправлен. Проверьте загрузки Safari или приложение «Файлы».', 1);
    });
    actions.appendChild(save);

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'offline-device-download__button';
    close.textContent = 'Закрыть';
    close.addEventListener('click', function () { panel.remove(); });
    actions.appendChild(close);

    var hint = panel.querySelector('.offline-device-download__hint');
    if (hint) hint.textContent = 'iPhone может показать системное подтверждение загрузки. Автоматически сохранить файл без нажатия нельзя.';
  }

  async function fetchText(url, signal) {
    var response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      redirect: 'follow',
      credentials: 'omit',
      signal: signal,
      headers: { Accept: 'application/json, application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' при чтении источника');
    var contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.indexOf('video/') >= 0 || contentType.indexOf('application/octet-stream') >= 0) {
      try { if (response.body && response.body.cancel) await response.body.cancel(); } catch (e) {}
      return { type: 'video', url: response.url || url, contentType: contentType };
    }
    return {
      type: 'text',
      url: response.url || url,
      contentType: contentType,
      text: await response.text()
    };
  }

  async function fetchBlob(url, signal, onProgress) {
    var response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      redirect: 'follow',
      credentials: 'omit',
      signal: signal
    });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' при загрузке файла');

    var total = Number(response.headers.get('content-length') || 0);
    var contentType = response.headers.get('content-type') || 'application/octet-stream';

    if (!response.body || typeof response.body.getReader !== 'function') {
      var fallbackBlob = await response.blob();
      if (onProgress) onProgress(fallbackBlob.size, total || fallbackBlob.size);
      return { blob: fallbackBlob, contentType: contentType, finalUrl: response.url || url };
    }

    var reader = response.body.getReader();
    var chunks = [];
    var received = 0;
    while (true) {
      var step = await reader.read();
      if (step.done) break;
      chunks.push(step.value);
      received += step.value.byteLength;
      if (onProgress) onProgress(received, total);
    }

    return {
      blob: new Blob(chunks, { type: contentType }),
      contentType: contentType,
      finalUrl: response.url || url
    };
  }

  function collectManifestLinks(data, baseUrl) {
    var result = [];
    var seen = {};

    function add(url, quality, label) {
      var absolute = normalizeUrl(url, baseUrl);
      if (!absolute || (!isHls(absolute) && !isDirectVideo(absolute)) || seen[absolute]) return;
      seen[absolute] = true;
      result.push({ url: absolute, quality: String(quality || '').replace(/p$/i, ''), label: String(label || '') });
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
    result.sort(function (left, right) { return Number(right.quality || 0) - Number(left.quality || 0); });
    return result;
  }

  async function resolveSource(url, signal) {
    if (isDirectVideo(url) || isHls(url)) return [{ url: url, quality: '', label: '' }];

    var loaded = await fetchText(url, signal);
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

  async function resolveHlsMedia(url, signal) {
    var response = await fetchText(url, signal);
    if (response.type !== 'text') throw new Error('HLS-ссылка вернула не плейлист.');
    var text = String(response.text || '').replace(/\r/g, '');
    if (text.indexOf('#EXTM3U') < 0) throw new Error('Некорректный HLS-плейлист.');

    var lines = text.split('\n');
    var variants = [];
    var hasExternalAudio = false;

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index].trim();
      if (line.indexOf('#EXT-X-MEDIA:') === 0) {
        var mediaAttributes = parseAttributes(line.slice(13));
        if (String(mediaAttributes.TYPE || '').toUpperCase() === 'AUDIO' && mediaAttributes.URI) hasExternalAudio = true;
      }
      if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
        var attributes = parseAttributes(line.slice(18));
        var cursor = index + 1;
        while (cursor < lines.length && (!lines[cursor].trim() || lines[cursor].trim().charAt(0) === '#')) cursor += 1;
        if (cursor < lines.length) {
          variants.push({
            url: normalizeUrl(lines[cursor].trim(), response.url),
            bandwidth: Number(attributes.BANDWIDTH || attributes['AVERAGE-BANDWIDTH'] || 0),
            audio: attributes.AUDIO || ''
          });
        }
      }
    }

    if (variants.length) {
      variants.sort(function (left, right) { return right.bandwidth - left.bandwidth; });
      if (hasExternalAudio && variants[0].audio) {
        throw new Error('Этот HLS использует отдельную аудиодорожку. Сборка одного файла пока не поддерживается.');
      }
      return resolveHlsMedia(variants[0].url, signal);
    }

    var resources = [];
    var hasMap = false;
    for (var lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      var raw = lines[lineIndex];
      var trimmed = raw.trim();
      if (!trimmed) continue;

      if (trimmed.indexOf('#EXT-X-KEY:') === 0) {
        var keyAttributes = parseAttributes(trimmed.slice(11));
        if (keyAttributes.METHOD && String(keyAttributes.METHOD).toUpperCase() !== 'NONE') {
          throw new Error('Зашифрованный HLS нельзя сохранить этим способом.');
        }
      }
      if (trimmed.indexOf('#EXT-X-BYTERANGE:') === 0) {
        throw new Error('HLS с EXT-X-BYTERANGE пока не поддерживается.');
      }
      if (trimmed.indexOf('#EXT-X-MAP:') === 0) {
        var mapAttributes = parseAttributes(trimmed.slice(11));
        if (!mapAttributes.URI) throw new Error('HLS init-сегмент не содержит URI.');
        hasMap = true;
        resources.push({ url: normalizeUrl(mapAttributes.URI, response.url), type: 'map' });
        continue;
      }
      if (trimmed.charAt(0) !== '#') {
        resources.push({ url: normalizeUrl(trimmed, response.url), type: 'segment' });
      }
    }

    if (!resources.length) throw new Error('В HLS не найдены видеофрагменты.');
    return { resources: resources, hasMap: hasMap };
  }

  async function prepareDirectFile(url, title, controller, panel) {
    var result = await fetchBlob(url, controller.signal, function (received, total) {
      var ratio = total ? received / total : 0;
      updateDownloadPanel(panel, 'Загружено ' + formatBytes(received) + (total ? ' из ' + formatBytes(total) : ''), ratio);
    });
    var extension = extensionFromUrl(result.finalUrl) || extensionFromMime(result.contentType);
    return { blob: result.blob, filename: sanitizeName(title) + extension };
  }

  async function prepareHlsFile(url, title, controller, panel) {
    updateDownloadPanel(panel, 'Читаем HLS-плейлист…', 0);
    var media = await resolveHlsMedia(url, controller.signal);
    var parts = [];
    var received = 0;

    for (var index = 0; index < media.resources.length; index += 1) {
      var resource = media.resources[index];
      var result = await fetchBlob(resource.url, controller.signal);
      parts.push(result.blob);
      received += result.blob.size;
      updateDownloadPanel(
        panel,
        'Фрагмент ' + (index + 1) + ' из ' + media.resources.length + ' · ' + formatBytes(received),
        (index + 1) / media.resources.length
      );
    }

    var mime = media.hasMap ? 'video/mp4' : 'video/mp2t';
    var extension = media.hasMap ? '.mp4' : '.ts';
    return {
      blob: new Blob(parts, { type: mime }),
      filename: sanitizeName(title) + extension
    };
  }

  async function prepareDeviceDownload(url, title) {
    if (activeDownload && activeDownload.controller) {
      try { activeDownload.controller.abort(); } catch (e) {}
    }

    closeSelect();
    var panel = createDownloadPanel('Скачать в Загрузки');
    var controller = new AbortController();
    activeDownload = { controller: controller, panel: panel };
    addCancelButton(panel, controller);

    try {
      var result = isHls(url)
        ? await prepareHlsFile(url, title, controller, panel)
        : await prepareDirectFile(url, title, controller, panel);
      showReadyDownload(panel, result.blob, result.filename);
      log('device file prepared', result.filename, result.blob.size);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      updateDownloadPanel(panel, error && error.message ? error.message : 'Не удалось подготовить файл.', 0);
      var actions = panel.querySelector('.offline-device-download__actions');
      actions.innerHTML = '';
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'offline-device-download__button';
      close.textContent = 'Закрыть';
      close.addEventListener('click', function () { panel.remove(); });
      actions.appendChild(close);
      log('device file failed', error && error.message);
    } finally {
      if (activeDownload && activeDownload.controller === controller) activeDownload = null;
    }
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
        { title: 'Скачать в Загрузки', action: 'download' },
        { title: 'Сохранить внутри Lampa', action: 'save' },
        { title: 'Смотреть', action: 'play' }
      ],
      onSelect: function (selected) {
        if (selected.action === 'download') {
          prepareDeviceDownload(choice.url, mediaTitle(data));
          return;
        }
        replayWithAction(data, choice.url, selected.action);
      },
      onBack: function () {
        try { Lampa.Controller.toggle('content'); } catch (e) {}
      }
    });
  }

  function handleChoice(data, choice) {
    if (isDirectVideo(choice.url)) {
      prepareDeviceDownload(choice.url, mediaTitle(data));
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
      onSelect: function (selected) { handleChoice(data, selected.choice); },
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
    var controller = new AbortController();

    try {
      var choices = await resolveSource(url, controller.signal);
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
            next.items.splice(saveIndex + 1, 0, { title: 'Скачать в Загрузки', action: 'device' });
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
