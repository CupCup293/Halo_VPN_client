// Главный процесс Halo: окно, трей, подписки, ядро mihomo и связь с интерфейсом.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, session, shell, Notification, clipboard } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('./store.cjs');
const { Core } = require('./core.cjs');
const { buildConfig, toYaml, CATEGORIES, VPN, AUTO, IP_CHECK, TEST_URL } = require('./config.cjs');
const { fetchSubscription } = require('./subscription.cjs');
const { setSystemProxy, isAdmin, relaunchAsAdmin, runningProcesses, installedApps, detectConflicts, foreignProxy, physicalInterface } = require('./system.cjs');
const { ServiceClient } = require('./service.cjs');
const { circlePng } = require('./icon.cjs');

const isDev = !!process.env.VITE_DEV;
const APP_NAME = 'Halo VPN';
const DELAY_TIMEOUT = 5000;

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let tray = null;
let store;
let core;
let service;
let serviceInfo = { installed: false, running: false, outdated: false };
let connected = false;
let connectedAt = 0;
let proxySetByUs = false;
let quitting = false;
let conflicts = [];
let bindInterface = null;
let currentNode = null;
const notified = new Map();

const resource = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, '..', 'resources', ...p));
const coreBin = () => resource('core', 'mihomo.exe');

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function publicState() {
  const d = store.data;
  return {
    profiles: d.profiles.map(({ proxies, ...p }) => ({
      ...p,
      nodes: proxies.map((x) => ({ name: x.name, type: x.type, server: x.server, network: x.network, reality: !!x['reality-opts'] })),
    })),
    activeProfileId: d.activeProfileId,
    settings: d.settings,
    appRules: d.appRules,
    userSites: d.userSites,
    categories: Object.fromEntries(Object.entries(CATEGORIES).map(([id, c]) => [id, c.title])),
    connected,
    connectedAt,
    coreVersion: 'mihomo 1.19',
    service: serviceInfo,
    conflicts,
  };
}

function broadcast() {
  send('state', publicState());
  updateTray();
}

function currentConfigYaml() {
  const profile = store.activeProfile;
  return toYaml(
    buildConfig({
      proxies: profile ? profile.proxies : [],
      settings: store.data.settings,
      appRules: store.data.appRules,
      userSites: store.data.userSites,
      controller: core.controller,
      bindInterface,
    }),
  );
}

async function applyConfig() {
  core.writeConfig(currentConfigYaml());
  if (core.running) await core.reload();
}

// ---------- Подключение ----------

/** TUN доступен: есть служба Halo Service или приложение запущено от администратора. */
async function canTun() {
  return (await service.ready()) || (await isAdmin());
}

function needAdminError() {
  const err = new Error('Для TUN-режима установите службу Halo (Настройки → Сеть) или запустите Halo от администратора');
  err.code = 'NEED_ADMIN';
  return err;
}

async function refreshService() {
  serviceInfo = await service.info();
  broadcast();
  return serviceInfo;
}

async function connect() {
  if (connected) return;
  if (!store.activeProfile) throw new Error('Сначала добавьте подписку');
  const s = store.data.settings;
  if (s.tun && !(await canTun())) throw needAdminError();
  await refreshConflicts().catch(() => {});
  core.writeConfig(currentConfigYaml());
  await core.start();
  if (s.systemProxy) {
    await setSystemProxy(true, s.mixedPort);
    proxySetByUs = true;
  }
  connected = true;
  connectedAt = Date.now();
  broadcast();
}

async function disconnect() {
  if (proxySetByUs) {
    await setSystemProxy(false).catch(() => {});
    proxySetByUs = false;
  }
  await core.stop();
  connected = false;
  connectedAt = 0;
  broadcast();
}

async function toggle() {
  try {
    if (connected) await disconnect();
    else await connect();
  } catch (e) {
    notify(APP_NAME, e.message);
    send('error', { message: e.message, code: e.code });
  }
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

// ---------- Подписки ----------

function probeSession() {
  const ses = session.fromPartition('halo-probe');
  return ses;
}

async function subFetch(url) {
  if (connected && store.data.settings.updateViaProxy) {
    const ses = probeSession();
    await ses.setProxy({ proxyRules: `127.0.0.1:${store.data.settings.mixedPort}` });
    return fetchSubscription(url, (u, o) => ses.fetch(u, o));
  }
  return fetchSubscription(url);
}

async function addProfile(url, name) {
  const data = await subFetch(url);
  const profile = {
    id: crypto.randomUUID(),
    name: name || data.title || new URL(url).hostname.replace(/^(sub|www)\./, ''),
    url,
    format: data.format,
    proxies: data.proxies,
    usage: data.usage,
    supportUrl: data.supportUrl,
    updatedAt: Date.now(),
  };
  store.data.profiles.push(profile);
  if (!store.data.activeProfileId) store.data.activeProfileId = profile.id;
  store.save();
  if (store.data.activeProfileId === profile.id) await applyConfig().catch(() => {});
  broadcast();
  return profile.id;
}

async function updateProfile(id) {
  const p = store.data.profiles.find((x) => x.id === id);
  if (!p) return;
  const data = await subFetch(p.url);
  Object.assign(p, { proxies: data.proxies, usage: data.usage, format: data.format, supportUrl: data.supportUrl, updatedAt: Date.now() });
  store.save();
  if (store.data.activeProfileId === id) await applyConfig().catch(() => {});
  broadcast();
}

async function autoUpdateProfiles() {
  const hours = store.data.settings.updateSubsHours || 12;
  for (const p of store.data.profiles) {
    if (Date.now() - (p.updatedAt || 0) > hours * 3600e3) await updateProfile(p.id).catch(() => {});
  }
}

// ---------- Проверки ----------

const SERVICES = [
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/generate_204' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' },
  { id: 'discord', name: 'Discord', url: 'https://discord.com/api/v9/gateway' },
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/' },
  { id: 'telegram', name: 'Telegram', url: 'https://web.telegram.org/' },
  { id: 'gosuslugi', name: 'Госуслуги', url: 'https://www.gosuslugi.ru/' },
];

async function timedFetch(ses, url, timeout = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const res = await ses.fetch(url, { method: 'HEAD', signal: ctrl.signal, cache: 'no-store' });
    return { ok: res.status < 500, ms: Date.now() - t0 };
  } catch {
    return { ok: false, ms: null };
  } finally {
    clearTimeout(timer);
  }
}

async function checkServices() {
  const ses = probeSession();
  await ses.setProxy({ proxyRules: `127.0.0.1:${store.data.settings.mixedPort}` });
  const results = await Promise.all(SERVICES.map(async (s) => ({ ...s, ...(await timedFetch(ses, s.url)) })));
  // Маршрут берём из последних соединений ядра.
  try {
    const { connections = [] } = (await core.api('GET', '/connections')) || {};
    for (const r of results) {
      const host = new URL(r.url).hostname;
      const c = connections.find((x) => x.metadata?.host === host);
      if (c) r.route = c.chains?.includes('DIRECT') ? 'direct' : 'vpn';
    }
  } catch {
    /* не важно */
  }
  return results;
}

async function speedTest() {
  const ses = probeSession();
  await ses.setProxy({ proxyRules: `127.0.0.1:${store.data.settings.mixedPort}` });
  const t0 = Date.now();
  const res = await ses.fetch('https://speed.cloudflare.com/__down?bytes=20000000', { cache: 'no-store' });
  const buf = await res.arrayBuffer();
  const sec = (Date.now() - t0) / 1000;
  return { mbps: Math.round(((buf.byteLength * 8) / sec / 1e6) * 10) / 10 };
}

async function probe() {
  const ses = probeSession();
  await ses.setProxy({ proxyRules: `127.0.0.1:${store.data.settings.mixedPort}` });
  return ses;
}

async function ipInfo(ses, url, map) {
  try {
    const res = await ses.fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return map(await res.json());
  } catch {
    return null;
  }
}

/** Какой IP видят обычные сайты (напрямую) и какой — заблокированные (через VPN). */
async function checkIp() {
  const ses = await probe();
  const [direct, vpn] = await Promise.all([
    ipInfo(ses, `https://${IP_CHECK.direct}/?lang=ru`, (j) => ({ ip: j.ip, country: j.country, city: j.city, code: j.country_code })),
    ipInfo(ses, `https://${IP_CHECK.vpn}/json`, (j) => ({ ip: j.ip, country: j.country, city: j.city, code: j.country })),
  ]);
  return { direct, vpn };
}

/** Открывает сайт через ядро и смотрит, каким правилом и куда он пошёл. */
async function checkSite(input) {
  const host = String(input).trim().replace(/^\w+:\/\//, '').split(/[/?#]/)[0].toLowerCase();
  if (!host.includes('.')) throw new Error('Введите адрес сайта, например rutracker.org');
  if (!core.running) throw new Error('Подключитесь, чтобы проверить сайт');
  const ses = await probe();
  const r = await timedFetch(ses, `https://${host}/`, 8000);
  let match = null;
  for (let i = 0; i < 5 && !match; i++) {
    const { connections = [] } = (await core.api('GET', '/connections')) || {};
    match = connections.find((c) => c.metadata?.host === host) || connections.find((c) => c.metadata?.host?.endsWith(`.${host}`));
    if (!match) await new Promise((res) => setTimeout(res, 300));
  }
  return {
    host,
    ok: r.ok,
    ms: r.ms,
    rule: match ? `${match.rule}${match.rulePayload ? ' ' + match.rulePayload : ''}` : null,
    route: match ? (match.chains.includes('DIRECT') ? 'direct' : match.chains.includes('REJECT') ? 'block' : 'vpn') : null,
    node: match && !match.chains.includes('DIRECT') ? match.chains[0] : null,
  };
}

/**
 * Другой VPN-клиент рядом (например, Clash Verge) не должен уводить трафик мимо Halo:
 * - чужой TUN → привязываем исходящий трафик ядра к настоящей сетевой карте;
 * - чужой системный прокси → возвращаем прокси на Halo, пока Halo подключён.
 */
async function refreshConflicts() {
  const s = store.data.settings;
  conflicts = await detectConflicts(s.mixedPort);
  const nextBind = conflicts.some((c) => c.kind === 'tun') ? await physicalInterface() : null;
  if (nextBind !== bindInterface) {
    bindInterface = nextBind;
    await applyConfig().catch(() => {});
  }
  await guardProxy();
}

/** Пока Halo подключён с системным прокси, прокси должен указывать на Halo. */
async function guardProxy() {
  const s = store.data.settings;
  if (!connected || !s.systemProxy) return;
  if (await foreignProxy(s.mixedPort)) {
    await setSystemProxy(true, s.mixedPort).catch(() => {});
    proxySetByUs = true;
  }
}

/** Предупреждения о подписке: срок < 3 дней, трафика < 10%. Не чаще раза в сутки. */
function checkSubscriptionAlerts() {
  for (const p of store.data.profiles) {
    const u = p.usage;
    if (!u) continue;
    const alerts = [];
    if (u.expire && u.expire > Date.now() && u.expire - Date.now() < 3 * 864e5) alerts.push(`«${p.name}» закончится ${new Date(u.expire).toLocaleDateString('ru-RU')}`);
    if (u.total && u.total - u.upload - u.download < u.total * 0.1) alerts.push(`В «${p.name}» осталось меньше 10% трафика`);
    for (const a of alerts) {
      if (Date.now() - (notified.get(a) || 0) > 864e5) {
        notified.set(a, Date.now());
        notify('Подписка', a);
      }
    }
  }
}

// halo://install-config?url=<ссылка>&name=<имя> — кнопка «Добавить в Halo» у провайдера.
async function handleDeepLink(argv) {
  const link = argv.find((a) => /^halo:\/\//i.test(a));
  if (!link) return;
  try {
    const u = new URL(link);
    const sub = u.searchParams.get('url');
    if (!sub) return;
    if (store.data.profiles.some((p) => p.url === sub)) return showWindow();
    await addProfile(sub, u.searchParams.get('name') || undefined);
    showWindow();
    notify(APP_NAME, 'Подписка добавлена');
  } catch (e) {
    send('error', { message: e.message });
  }
}

// ---------- Окно и трей ----------

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1040,
    minHeight: 680,
    frame: false,
    title: APP_NAME,
    backgroundColor: '#15161b',
    icon: nativeImage.createFromBuffer(circlePng(64)),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  win.once('ready-to-show', () => {
    // «Запускать свёрнутым в трей»: окно не показываем, Halo работает из трея.
    // Без подписки окно всё же показываем — иначе новый пользователь не увидит программу.
    if (!store.data.settings.startHidden || !store.activeProfile || process.env.HALO_SNAP) win.show();
    if (process.env.HALO_SNAP) snapshots(process.env.HALO_SNAP);
  });
  // В Electron нет контекстного меню по умолчанию — без него «Вставить» мышкой не работает.
  win.webContents.on('context-menu', (_e, p) => {
    if (!p.isEditable && !p.selectionText) return;
    Menu.buildFromTemplate([
      { label: 'Вырезать', role: 'cut', enabled: p.isEditable && !!p.selectionText },
      { label: 'Копировать', role: 'copy', enabled: !!p.selectionText },
      { label: 'Вставить', role: 'paste', enabled: p.isEditable },
      { type: 'separator' },
      { label: 'Выделить всё', role: 'selectAll' },
    ]).popup({ window: win });
  });
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// Отладка: HALO_SNAP=<папка> — пройти по всем экранам и сохранить скриншоты окна (npm run snap).
async function snapshots(dir) {
  const fs = require('node:fs');
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(1500);
  const count = await win.webContents.executeJavaScript('document.querySelectorAll(".nav-item").length');
  for (let i = 0; i < count; i++) {
    await win.webContents.executeJavaScript(`document.querySelectorAll('.nav-item')[${i}].click()`);
    await wait(1200);
    const info = await win.webContents.executeJavaScript(
      `JSON.stringify({ h1: document.querySelector('.page h1')?.textContent, pageOpacity: getComputedStyle(document.querySelector('.page')).opacity, hidden: [...document.querySelectorAll('.page *')].filter((e) => getComputedStyle(e).opacity === '0').length })`,
    );
    fs.writeFileSync(path.join(dir, `${i}.png`), (await win.webContents.capturePage()).toPNG());
    console.log('snap', i, info);
  }
  quitting = true;
  app.quit();
}

function showWindow() {
  if (!win) createWindow();
  win.show();
  win.focus();
}

function updateTray() {
  if (!tray) return;
  tray.setImage(nativeImage.createFromBuffer(circlePng(32, connected)).resize({ width: 16, height: 16 }));
  tray.setToolTip(`${APP_NAME} — ${connected ? 'подключено' : 'отключено'}`);
  const s = store.data.settings;
  const setMode = (mode) => setSettings({ mode });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: connected ? 'Отключить' : 'Подключить', click: toggle },
      { type: 'separator' },
      { label: 'Только заблокированное', type: 'radio', checked: s.mode === 'blocked', click: () => setMode('blocked') },
      { label: 'Всё, кроме РФ', type: 'radio', checked: s.mode === 'except-ru', click: () => setMode('except-ru') },
      { label: 'Весь трафик', type: 'radio', checked: s.mode === 'global', click: () => setMode('global') },
      { type: 'separator' },
      {
        label: 'Сервер',
        enabled: connected && !!store.activeProfile,
        submenu: [AUTO, ...(store.activeProfile?.proxies || []).slice(0, 20).map((p) => p.name)].map((name) => ({
          label: name,
          type: 'radio',
          checked: name === (currentNode || AUTO),
          click: () =>
            core
              .api('PUT', `/proxies/${encodeURIComponent(VPN)}`, { name })
              .then(() => {
                currentNode = name;
                broadcast();
              })
              .catch(() => {}),
        })),
      },
      { type: 'separator' },
      { label: 'Системный прокси', type: 'checkbox', checked: s.systemProxy, click: (i) => setSettings({ systemProxy: i.checked }) },
      { label: 'TUN-режим', type: 'checkbox', checked: s.tun, click: (i) => setSettings({ tun: i.checked }) },
      { type: 'separator' },
      { label: 'Открыть Halo', click: showWindow },
      { label: 'Выход', click: () => app.quit() },
    ]),
  );
}

async function setSettings(partial) {
  const before = store.data.settings;
  const next = { ...before, ...partial, categories: { ...before.categories, ...(partial.categories || {}) } };
  if (partial.tun && !before.tun && connected && !core.viaService && !(await isAdmin())) {
    // Ядро запущено без прав: TUN поднимется только после переподключения через службу.
    if (await service.ready()) {
      store.data.settings = next;
      store.save();
      await disconnect();
      await connect().catch((e) => send('error', { message: e.message, code: e.code }));
      return publicState();
    }
    const err = needAdminError();
    send('error', { message: err.message, code: err.code });
    return publicState();
  }
  store.data.settings = next;
  store.save();
  if (connected) {
    if (partial.systemProxy !== undefined || partial.mixedPort !== undefined) {
      await setSystemProxy(next.systemProxy, next.mixedPort).catch(() => {});
      proxySetByUs = next.systemProxy;
    }
    await applyConfig().catch((e) => send('error', { message: e.message }));
  } else {
    core.writeConfig(currentConfigYaml());
  }
  if (partial.launchAtLogin !== undefined) syncLoginItem(next.launchAtLogin);
  broadcast();
  return publicState();
}

/** Автозапуск с Windows: в собранной версии запускаем сам Halo.exe, в разработке — electron с папкой проекта. */
function syncLoginItem(on) {
  if (process.env.HALO_SNAP) return;
  const args = app.isPackaged ? [] : [path.resolve(__dirname, '..')];
  app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args });
}

/**
 * «Подключаться при запуске». Сразу после входа в Windows сети может ещё не быть,
 * поэтому несколько попыток с паузой; о неудаче сообщаем один раз.
 */
async function autoConnect() {
  const s = store.data.settings;
  if (!s.autoConnect || !store.activeProfile || process.env.HALO_SNAP) return;
  for (let attempt = 1; attempt <= 6 && !connected; attempt++) {
    try {
      await connect();
      return;
    } catch (e) {
      if (e.code === 'NEED_ADMIN' || attempt === 6) {
        notify(APP_NAME, `Не удалось подключиться автоматически: ${e.message}`);
        send('error', { message: e.message, code: e.code });
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

/** Задержка одного узла в мс; 0 — узел не ответил за DELAY_TIMEOUT (таймаут, а не ошибка). */
async function nodeDelay(name) {
  try {
    const r = await core.api('GET', `/proxies/${encodeURIComponent(name)}/delay?url=${encodeURIComponent(TEST_URL)}&timeout=${DELAY_TIMEOUT}`);
    return r?.delay || 0;
  } catch {
    return 0;
  }
}

/**
 * Пинг всех узлов: { имя: мс }, у не ответивших — 0 (таймаут).
 * Меряем сами, по DELAY_PARALLEL узлов одновременно: запрос группы у ядра дёргает все узлы разом,
 * и на больших подписках (100+ узлов) они не успевают — ядро отвечает «all proxies timeout».
 * Каждый результат сразу уходит в интерфейс, чтобы цифры появлялись по мере проверки.
 */
const DELAY_PARALLEL = 16;
let delayRun = null;

function testAllDelays() {
  if (!core.running) throw new Error('Подключитесь, чтобы проверить задержку');
  if (delayRun) return delayRun; // повторное нажатие во время проверки — ждём ту же проверку
  delayRun = (async () => {
    const names = (store.activeProfile?.proxies || []).map((p) => p.name);
    const result = {};
    let next = 0;
    const worker = async () => {
      while (next < names.length && core.running) {
        const name = names[next++];
        result[name] = await nodeDelay(name);
        send('delay', { name, delay: result[name] });
      }
    };
    await Promise.all(Array.from({ length: Math.min(DELAY_PARALLEL, names.length) }, worker));
    return result;
  })().finally(() => (delayRun = null));
  return delayRun;
}

// ---------- IPC ----------

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code };
    }
  });
}

function registerIpc() {
  handle('state:get', () => publicState());
  handle('vpn:toggle', toggle);
  handle('vpn:connect', connect);
  handle('vpn:disconnect', disconnect);
  handle('settings:set', setSettings);
  handle('profile:add', (url, name) => addProfile(url, name));
  handle('profile:update', (id) => updateProfile(id));
  handle('profile:updateAll', async () => {
    for (const p of store.data.profiles) await updateProfile(p.id);
  });
  handle('profile:remove', async (id) => {
    store.data.profiles = store.data.profiles.filter((p) => p.id !== id);
    if (store.data.activeProfileId === id) store.data.activeProfileId = store.data.profiles[0]?.id || null;
    store.save();
    await applyConfig().catch(() => {});
    broadcast();
  });
  handle('profile:select', async (id) => {
    store.data.activeProfileId = id;
    store.save();
    await applyConfig().catch(() => {});
    broadcast();
  });
  handle('apps:set', async (rules) => {
    store.data.appRules = rules;
    store.save();
    await applyConfig().catch(() => {});
    broadcast();
  });
  handle('sites:set', async (sites) => {
    store.data.userSites = sites;
    store.save();
    await applyConfig().catch(() => {});
    broadcast();
  });
  handle('apps:running', async () => {
    const list = await runningProcesses();
    return Promise.all(
      list.map(async (p) => {
        try {
          return { ...p, icon: (await app.getFileIcon(p.path, { size: 'normal' })).toDataURL() };
        } catch {
          return p;
        }
      }),
    );
  });
  handle('apps:pickExe', async () => {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Программы', extensions: ['exe'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    let icon;
    try {
      icon = (await app.getFileIcon(p, { size: 'normal' })).toDataURL();
    } catch {
      /* без иконки */
    }
    return { process: path.basename(p), name: path.basename(p, '.exe'), path: p, icon };
  });
  handle('proxies:get', async () => {
    if (!core.running) return null;
    const { proxies } = await core.api('GET', '/proxies');
    currentNode = proxies[VPN]?.now || null;
    return { now: proxies[VPN]?.now, auto: proxies[AUTO]?.now, all: proxies };
  });
  handle('proxy:select', async (name) => {
    await core.api('PUT', `/proxies/${encodeURIComponent(VPN)}`, { name });
    currentNode = name;
    broadcast();
  });
  handle('proxy:testAll', testAllDelays);
  handle('proxy:test', async (name) => {
    if (!core.running) throw new Error('Подключитесь, чтобы проверить задержку');
    try {
      return await nodeDelay(name);
    } catch {
      return 0;
    }
  });
  handle('check:ip', checkIp);
  handle('check:site', checkSite);
  handle('conflicts:refresh', async () => {
    await refreshConflicts();
    return conflicts;
  });
  handle('apps:installed', async () => {
    const list = await installedApps();
    return Promise.all(
      list.map(async (p) => {
        try {
          return { ...p, icon: (await app.getFileIcon(p.path, { size: 'normal' })).toDataURL() };
        } catch {
          return p;
        }
      }),
    );
  });
  handle('profile:rename', (id, name) => {
    const p = store.data.profiles.find((x) => x.id === id);
    if (p && String(name).trim()) {
      p.name = String(name).trim().slice(0, 60);
      store.save();
      broadcast();
    }
  });
  handle('connections:get', async () => (core.running ? core.api('GET', '/connections') : { connections: [] }));
  handle('connections:close', async (id) => core.api('DELETE', id ? `/connections/${id}` : '/connections'));
  handle('check:services', checkServices);
  handle('check:speed', speedTest);
  handle('core:logs', () => core.logs);
  handle('core:api-rules', () => core.api('GET', '/rules'));
  handle('admin:relaunch', async () => {
    await relaunchAsAdmin(process.execPath, isDev ? [path.join(__dirname, '..')] : []);
    quitting = true;
    app.quit();
  });
  handle('service:info', refreshService);
  handle('service:install', async () => {
    const wasConnected = connected;
    if (wasConnected && core.viaService) await disconnect();
    try {
      await service.install();
    } finally {
      await refreshService();
    }
    if (wasConnected && !connected) await connect();
  });
  handle('service:uninstall', async () => {
    if (connected && core.viaService) await disconnect();
    try {
      await service.uninstall();
    } finally {
      await refreshService();
    }
  });
  handle('open:external', (url) => shell.openExternal(url));
  handle('clipboard:read', () => clipboard.readText());
  handle('clipboard:write', (text) => clipboard.writeText(String(text)));
  handle('win:minimize', () => win.minimize());
  handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('win:close', () => win.hide());
}

app.on('second-instance', (_e, argv) => {
  showWindow();
  handleDeepLink(argv);
});

// Имя в уведомлениях Windows берётся у ярлыка с этим AppUserModelId (appId из сборки).
app.setAppUserModelId('app.halo.vpn');

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  service = new ServiceClient({
    exePath: resource('service', 'halo-service.exe'),
    corePath: coreBin(),
    secretFile: path.join(app.getPath('userData'), 'service.key'),
  });
  core = new Core({ binPath: coreBin(), workDir: path.join(app.getPath('userData'), 'core'), service });
  core.on('traffic', (t) => send('traffic', t));
  core.on('log', (l) => send('log', l));
  core.on('exit', ({ reason }) => {
    if (connected) {
      connected = false;
      if (proxySetByUs) setSystemProxy(false).catch(() => {});
      proxySetByUs = false;
      send('error', { message: reason ? `Ядро остановилось: ${reason}` : 'Ядро остановилось' });
      broadcast();
    }
  });

  registerIpc();
  createWindow();
  tray = new Tray(nativeImage.createFromBuffer(circlePng(32, false)).resize({ width: 16, height: 16 }));
  tray.on('click', showWindow);
  updateTray();

  syncLoginItem(store.data.settings.launchAtLogin);
  refreshService()
    .catch(() => {})
    .then(autoConnect);
  autoUpdateProfiles().then(checkSubscriptionAlerts);
  setInterval(() => autoUpdateProfiles().then(checkSubscriptionAlerts), 3600e3);
  refreshConflicts();
  setInterval(() => refreshConflicts().catch(() => {}), 30000);
  // Другой клиент может перебить системный прокси — возвращаем его, пока подключены.
  setInterval(() => guardProxy().catch(() => {}), 4000);

  if (isDev) app.setAsDefaultProtocolClient('halo', process.execPath, [path.resolve(__dirname, '..')]);
  else app.setAsDefaultProtocolClient('halo');
  handleDeepLink(process.argv);
});

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  if (connected || proxySetByUs) {
    e.preventDefault();
    disconnect().finally(() => app.quit());
  }
});

app.on('window-all-closed', () => {
  /* живём в трее */
});
