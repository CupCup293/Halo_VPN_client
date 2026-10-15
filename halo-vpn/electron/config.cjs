// Сборка итогового конфига mihomo из подписки, настроек и правил приложений.
const yaml = require('js-yaml');

const VPN = 'VPN';
const AUTO = 'Авто · лучший';
// Адрес замера пинга. gstatic через многие VPN-узлы не открывается (таймаут у всех), Cloudflare отвечает стабильно.
const TEST_URL = 'https://cp.cloudflare.com/generate_204';

// Гео-базы с российскими категориями (ru-blocked, ru-available-only-inside) поверх v2fly.
const GEOX = {
  geoip: 'https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/geoip.dat',
  geosite: 'https://github.com/runetfreedom/russia-v2ray-rules-dat/releases/latest/download/geosite.dat',
  mmdb: 'https://github.com/MetaCubeX/meta-rules-dat/releases/download/latest/country.mmdb',
};

// Категории обхода блокировок: id → правила-совпадения (без действия).
const CATEGORIES = {
  rkn: { title: 'Реестр РКН', matchers: ['GEOSITE,ru-blocked', 'GEOIP,ru-blocked,no-resolve'] },
  youtube: { title: 'YouTube', matchers: ['GEOSITE,youtube'] },
  meta: { title: 'Instagram · Facebook', matchers: ['GEOSITE,instagram', 'GEOSITE,facebook'] },
  twitter: { title: 'X (Twitter)', matchers: ['GEOSITE,twitter'] },
  ai: { title: 'AI-сервисы', matchers: ['GEOSITE,category-ai-!cn'] },
  discord: { title: 'Discord', matchers: ['GEOSITE,discord'] },
  telegram: { title: 'Telegram', matchers: ['GEOSITE,telegram', 'GEOIP,telegram,no-resolve'] },
  geoblock: {
    title: 'Ушли из РФ / геоблок',
    matchers: ['netflix', 'disney', 'notion', 'figma', 'canva', 'jetbrains', 'docker', 'intel', 'nvidia', 'autodesk', 'soundcloud', 'patreon', 'medium', 'tiktok'].map((g) => `GEOSITE,${g}`),
  },
  spotify: { title: 'Spotify', matchers: ['GEOSITE,spotify'] },
  torrents: { title: 'Торрент-трекеры', matchers: ['GEOSITE,category-public-tracker'] },
};

const DEFAULT_CATEGORIES = { rkn: true, youtube: true, meta: true, twitter: true, ai: true, discord: true, telegram: true, geoblock: true, spotify: true, torrents: false };

const DEFAULT_SETTINGS = {
  mode: 'blocked', // blocked | except-ru | global | direct
  tun: false,
  systemProxy: true,
  mixedPort: 7890,
  allowLan: false,
  dnsMode: 'fake-ip',
  doh: 'https://1.1.1.1/dns-query',
  categories: DEFAULT_CATEGORIES,
  otherApps: 'rules', // rules | direct
  adblock: false,
  autoUpdateLists: true,
  launchAtLogin: false,
  autoConnect: false, // подключаться сразу после запуска
  startHidden: false, // запускаться свёрнутым в трей
  updateSubsHours: 12,
  updateViaProxy: false,
};

const ACTION = { vpn: VPN, direct: 'DIRECT', block: 'REJECT' };

// Сервисы проверки IP для главного экрана: один всегда напрямую, другой всегда через VPN.
const IP_CHECK = { direct: 'ipwho.is', vpn: 'ipinfo.io' };

// Российские сервисы на нерусских доменах — напрямую в любом режиме, кроме «Весь трафик».
const RU_SERVICES = ['2ip.io', '2ip.me', 'gosuslugi.ru', 'sberbank.com', 'tbank-online.com', 'vk.company', 'ozone.ru', 'wb.ru'];

function withAction(matcher, action) {
  // no-resolve должен идти после действия: GEOIP,ru-blocked,VPN,no-resolve
  const parts = matcher.split(',');
  if (parts[parts.length - 1] === 'no-resolve') {
    parts.pop();
    return `${parts.join(',')},${action},no-resolve`;
  }
  return `${matcher},${action}`;
}

function andProcess(processName, matcher) {
  const clean = matcher.replace(/,no-resolve$/, '');
  return `AND,((PROCESS-NAME,${processName}),(${clean})),${VPN}`;
}

function uniqueNames(proxies) {
  const seen = new Map();
  return proxies.map((p) => {
    let name = String(p.name || `${p.server}:${p.port}`).trim();
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = `${name} (${n + 1})`;
    return { ...p, name };
  });
}

/** Правила маршрутизации в порядке приоритета (первое совпадение выигрывает). */
function buildRules({ settings, appRules = [], userSites = [] }) {
  const s = { ...DEFAULT_SETTINGS, ...settings, categories: { ...DEFAULT_CATEGORIES, ...(settings?.categories || {}) } };
  const rules = [];

  // 1. Локальные сети — всегда напрямую.
  rules.push('GEOIP,private,DIRECT,no-resolve', 'DOMAIN-SUFFIX,local,DIRECT');
  rules.push(`DOMAIN,${IP_CHECK.direct},DIRECT`, `DOMAIN,${IP_CHECK.vpn},${VPN}`);

  // 2. Правила приложений.
  for (const r of appRules) {
    if (r.action && r.action !== 'rules' && ACTION[r.action]) rules.push(`PROCESS-NAME,${r.process},${ACTION[r.action]}`);
  }

  // 3. Личные исключения по сайтам.
  for (const site of userSites) {
    if (ACTION[site.action]) rules.push(`DOMAIN-SUFFIX,${site.domain},${ACTION[site.action]}`);
  }

  // 4. Блокировка рекламы.
  if (s.adblock) rules.push('GEOSITE,category-ads-all,REJECT');

  // 5. Режим.
  const ruleApps = appRules.filter((r) => r.action === 'rules').map((r) => r.process);
  const routeToVpn = (matcher) => {
    if (s.otherApps === 'direct') {
      for (const app of ruleApps) rules.push(andProcess(app, matcher));
    } else {
      rules.push(withAction(matcher, VPN));
    }
  };

  const ruServices = () => RU_SERVICES.forEach((d) => rules.push(`DOMAIN-SUFFIX,${d},DIRECT`));

  if (s.mode === 'blocked') {
    rules.push('GEOSITE,ru-available-only-inside,DIRECT');
    ruServices();
    for (const [id, cat] of Object.entries(CATEGORIES)) {
      if (s.categories[id]) cat.matchers.forEach(routeToVpn);
    }
    rules.push('MATCH,DIRECT');
  } else if (s.mode === 'except-ru') {
    // Заблокированное в РФ — в VPN даже на русских доменах, потом всё российское напрямую.
    rules.push(`GEOSITE,ru-blocked,${VPN}`, 'GEOSITE,ru-available-only-inside,DIRECT');
    ruServices();
    rules.push('GEOSITE,category-ru,DIRECT', 'DOMAIN-SUFFIX,ru,DIRECT', 'DOMAIN-SUFFIX,su,DIRECT', 'DOMAIN-SUFFIX,xn--p1ai,DIRECT', 'GEOIP,RU,DIRECT');
    if (s.otherApps === 'direct') {
      for (const app of ruleApps) rules.push(`PROCESS-NAME,${app},${VPN}`);
      rules.push('MATCH,DIRECT');
    } else {
      rules.push(`MATCH,${VPN}`);
    }
  } else if (s.mode === 'global') {
    rules.push(`MATCH,${VPN}`);
  } else {
    rules.push('MATCH,DIRECT');
  }
  return rules;
}

// Узлы с выходом в России (флаг RU, «Россия», «через РФ»): пинг у них лучший, но заблокированное через них не откроется.
const RU_EXIT = /\u{1F1F7}\u{1F1FA}|росси|(^|[^а-яё])рф([^а-яё]|$)|russia|moscow|москв/iu;
const isRuExit = (name) => RU_EXIT.test(name);

/** Возвращает объект конфига mihomo. */
function buildConfig({ proxies, settings, appRules = [], userSites = [], controller, bindInterface }) {
  const s = { ...DEFAULT_SETTINGS, ...settings, categories: { ...DEFAULT_CATEGORIES, ...(settings?.categories || {}) } };
  const list = uniqueNames(proxies || []);
  const names = list.map((p) => p.name);
  const autoNames = names.filter((n) => !isRuExit(n));

  const blockedSites = ['ru-blocked'];
  for (const [id, cat] of Object.entries(CATEGORIES)) {
    if (id !== 'rkn' && s.categories[id]) for (const m of cat.matchers) if (m.startsWith('GEOSITE,')) blockedSites.push(m.split(',')[1]);
  }

  const cfg = {
    'mixed-port': s.mixedPort,
    'allow-lan': s.allowLan,
    'bind-address': s.allowLan ? '*' : '127.0.0.1',
    mode: 'rule',
    'log-level': 'info',
    ipv6: false,
    'unified-delay': true,
    'tcp-concurrent': true,
    'find-process-mode': 'always',
    'external-controller': `127.0.0.1:${controller.port}`,
    secret: controller.secret,
    'geodata-mode': true,
    'geo-auto-update': s.autoUpdateLists,
    'geo-update-interval': 24,
    'geox-url': GEOX,
    profile: { 'store-selected': true, 'store-fake-ip': true },
    sniffer: {
      enable: true,
      'parse-pure-ip': true,
      sniff: { HTTP: { ports: [80, '8080-8880'] }, TLS: { ports: [443, 8443] }, QUIC: { ports: [443, 8443] } },
    },
    dns: {
      enable: true,
      ipv6: false,
      'enhanced-mode': s.dnsMode,
      'fake-ip-range': '198.18.0.1/16',
      'fake-ip-filter': ['*.lan', '*.local', 'localhost.ptlogin2.qq.com', '+.msftconnecttest.com', '+.msftncsi.com'],
      'default-nameserver': ['77.88.8.8', '8.8.8.8'],
      nameserver: ['https://77.88.8.8/dns-query'],
      // Адреса VPN-серверов — только через DoH. Обычный DNS по UDP перехватывает чужой TUN (Clash Verge и т. п.)
      // и подсовывает свой fake-ip 198.18.x.x — тогда ни один сервер не отвечает. DNS Яндекса не знает часть доменов (.dev).
      'proxy-server-nameserver': ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query', 'https://77.88.8.8/dns-query'],
      // Заблокированные домены резолвим через DoH внутри туннеля — провайдер не подменит ответ.
      'nameserver-policy': { [`geosite:${blockedSites.join(',')}`]: [`${s.doh}#${VPN}`] },
    },
    proxies: list,
    'proxy-groups': [
      { name: VPN, type: 'select', proxies: [AUTO, ...names] },
      // Автовыбор — без российских узлов (вручную их можно выбрать в группе VPN).
      { name: AUTO, type: 'url-test', proxies: autoNames.length ? autoNames : names.length ? names : ['DIRECT'], url: TEST_URL, interval: 120, tolerance: 50, lazy: false },
    ],
    rules: buildRules({ settings: s, appRules, userSites }),
  };

  // Рядом работает чужой TUN: выпускаем трафик прямо через сетевую карту, иначе «напрямую» уйдёт в чужой VPN.
  if (bindInterface) cfg['interface-name'] = bindInterface;

  if (s.tun) {
    cfg.tun = {
      enable: true,
      device: 'Halo',
      stack: 'mixed',
      'auto-route': true,
      'auto-detect-interface': true,
      'strict-route': false,
      'dns-hijack': ['any:53'],
    };
  }
  return cfg;
}

function toYaml(cfg) {
  return yaml.dump(cfg, { lineWidth: -1, noRefs: true, quotingType: '"' });
}

module.exports = { buildConfig, buildRules, toYaml, CATEGORIES, DEFAULT_SETTINGS, DEFAULT_CATEGORIES, VPN, AUTO, IP_CHECK, TEST_URL, isRuExit };
