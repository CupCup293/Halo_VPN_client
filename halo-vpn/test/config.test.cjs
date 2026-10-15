const test = require('node:test');
const assert = require('node:assert');
const { buildRules, buildConfig, VPN } = require('../electron/config.cjs');

const base = { mode: 'blocked', categories: { rkn: true, youtube: true, meta: false, twitter: false, ai: false, discord: false, telegram: false } };

test('режим «Обход блокировок»: списки в VPN, остальное напрямую', () => {
  const rules = buildRules({ settings: base });
  assert.ok(rules.includes(`GEOSITE,ru-blocked,${VPN}`));
  assert.ok(rules.includes(`GEOIP,ru-blocked,${VPN},no-resolve`));
  assert.ok(rules.includes(`GEOSITE,youtube,${VPN}`));
  assert.ok(!rules.some((r) => r.startsWith('GEOSITE,instagram')));
  assert.equal(rules.at(-1), 'MATCH,DIRECT');
  assert.ok(rules.indexOf('GEOSITE,ru-available-only-inside,DIRECT') < rules.indexOf(`GEOSITE,ru-blocked,${VPN}`));
});

test('правила приложений идут раньше списков', () => {
  const rules = buildRules({
    settings: base,
    appRules: [
      { process: 'Discord.exe', action: 'vpn' },
      { process: 'steam.exe', action: 'direct' },
      { process: 'chrome.exe', action: 'rules' },
    ],
  });
  const iDiscord = rules.indexOf(`PROCESS-NAME,Discord.exe,${VPN}`);
  assert.ok(iDiscord > 0 && iDiscord < rules.indexOf(`GEOSITE,ru-blocked,${VPN}`));
  assert.ok(rules.includes('PROCESS-NAME,steam.exe,DIRECT'));
  assert.ok(!rules.some((r) => r.includes('chrome.exe')));
});

test('«Остальные приложения: напрямую» — списки только для выбранных', () => {
  const rules = buildRules({ settings: { ...base, otherApps: 'direct' }, appRules: [{ process: 'chrome.exe', action: 'rules' }] });
  assert.ok(rules.includes(`AND,((PROCESS-NAME,chrome.exe),(GEOSITE,ru-blocked)),${VPN}`));
  assert.ok(rules.includes(`AND,((PROCESS-NAME,chrome.exe),(GEOIP,ru-blocked)),${VPN}`));
  assert.ok(!rules.includes(`GEOSITE,ru-blocked,${VPN}`));
});

test('режимы «Кроме РФ» и «Весь трафик»', () => {
  const ex = buildRules({ settings: { ...base, mode: 'except-ru' } });
  assert.ok(ex.includes('GEOIP,RU,DIRECT'));
  assert.equal(ex.at(-1), `MATCH,${VPN}`);
  assert.equal(buildRules({ settings: { ...base, mode: 'global' } }).at(-1), `MATCH,${VPN}`);
});

test('конфиг: группы, одинаковые имена, TUN', () => {
  const cfg = buildConfig({
    proxies: [
      { name: 'A', type: 'ss', server: 's', port: 1, cipher: 'aes-128-gcm', password: 'p' },
      { name: 'A', type: 'ss', server: 's2', port: 1, cipher: 'aes-128-gcm', password: 'p' },
    ],
    settings: { ...base, tun: true },
    controller: { port: 9097, secret: 'x' },
  });
  assert.deepEqual(cfg.proxies.map((p) => p.name), ['A', 'A (2)']);
  assert.equal(cfg['proxy-groups'][0].name, VPN);
  assert.equal(cfg.tun.enable, true);
  assert.ok(Object.keys(cfg.dns['nameserver-policy'])[0].includes('geosite:ru-blocked'));
});

test('геоблок по умолчанию и проверочные домены IP', () => {
  const rules = buildRules({ settings: { mode: 'blocked' } });
  assert.ok(rules.includes(`GEOSITE,netflix,${VPN}`));
  assert.ok(rules.includes(`GEOSITE,spotify,${VPN}`));
  assert.ok(rules.includes('DOMAIN,ipwho.is,DIRECT'));
  assert.ok(rules.includes(`DOMAIN,ipinfo.io,${VPN}`));
  assert.ok(rules.includes('DOMAIN-SUFFIX,2ip.io,DIRECT'));
});

test('«Всё, кроме РФ»: заблокированное на русских доменах всё равно в VPN', () => {
  const rules = buildRules({ settings: { mode: 'except-ru' } });
  assert.ok(rules.indexOf(`GEOSITE,ru-blocked,${VPN}`) < rules.indexOf('DOMAIN-SUFFIX,ru,DIRECT'));
  assert.equal(rules.at(-1), `MATCH,${VPN}`);
});

test('привязка к сетевой карте, когда рядом чужой TUN', () => {
  const cfg = buildConfig({ proxies: [], settings: {}, controller: { port: 1, secret: 'x' }, bindInterface: 'Wi-Fi' });
  assert.equal(cfg['interface-name'], 'Wi-Fi');
  assert.equal(buildConfig({ proxies: [], settings: {}, controller: { port: 1, secret: 'x' } })['interface-name'], undefined);
});

test('«Авто · лучший» перепроверяет задержку каждые 2 минуты', () => {
  const cfg = buildConfig({ proxies: [{ name: 'A', type: 'ss', server: 's', port: 1, cipher: 'aes-128-gcm', password: 'p' }], settings: {}, controller: { port: 1, secret: 'x' } });
  assert.equal(cfg['proxy-groups'][1].interval, 120);
});

test('адреса серверов резолвятся только через DoH', () => {
  const cfg = buildConfig({ proxies: [], settings: {}, controller: { port: 1, secret: 'x' } });
  assert.ok(cfg.dns['proxy-server-nameserver'].every((s) => s.startsWith('https://')));
});

test('автовыбор не берёт узлы с выходом в России', () => {
  const mk = (name) => ({ name, type: 'ss', server: 's', port: 1, cipher: 'aes-128-gcm', password: 'p' });
  const cfg = buildConfig({
    proxies: [mk('🇷🇺 Москва, Россия'), mk('Дарвин ВПН | Через РФ'), mk('🇩🇪 Берлин'), mk('FastCom VPN | Казахстан')],
    settings: {},
    controller: { port: 1, secret: 'x' },
  });
  assert.deepEqual(cfg['proxy-groups'][1].proxies, ['🇩🇪 Берлин', 'FastCom VPN | Казахстан']);
  assert.equal(cfg['proxy-groups'][0].proxies.length, 5); // в ручном выборе — все узлы + «Авто»
});
