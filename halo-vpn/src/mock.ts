// Демо-мост для просмотра интерфейса в обычном браузере (npm run vite) — без Electron и ядра.
import type { State } from './api';

const nodes = [
  ['🇯🇵 Токио-03', 'vless', true],
  ['🇰🇿 Алматы-01', 'ss', false],
  ['🇸🇬 Сингапур-01', 'hysteria2', false],
  ['🇳🇱 Амстердам-02', 'vless', true],
  ['🇩🇪 Франкфурт-01', 'tuic', false],
  ['🇫🇮 Хельсинки-01', 'trojan', false],
  ['🇹🇷 Стамбул-02', 'vless', false],
  ['🇺🇸 Нью-Йорк-04', 'hysteria2', false],
] as const;

export function installMock() {
  let state: State = {
    profiles: [
      {
        id: 'p1',
        name: 'Основная',
        url: 'https://example.com/sub',
        format: 'Clash YAML',
        nodes: nodes.map(([name, type, reality]) => ({ name, type, server: '45.76.12.34', reality })),
        usage: { upload: 4e9, download: 58.4e9, total: 200e9, expire: Date.now() + 28 * 864e5 },
        updatedAt: Date.now() - 5 * 60e3,
      },
    ],
    activeProfileId: 'p1',
    settings: {
      mode: 'blocked',
      tun: true,
      systemProxy: true,
      mixedPort: 7890,
      allowLan: false,
      dnsMode: 'fake-ip',
      doh: 'https://1.1.1.1/dns-query',
      categories: { rkn: true, youtube: true, meta: true, twitter: true, ai: true, discord: true, telegram: true, spotify: false, torrents: false },
      otherApps: 'rules',
      adblock: false,
      autoUpdateLists: true,
      launchAtLogin: true,
      autoConnect: true,
      startHidden: true,
      updateSubsHours: 12,
      updateViaProxy: false,
    },
    appRules: [
      { process: 'Discord.exe', name: 'Discord', action: 'vpn' },
      { process: 'Telegram.exe', name: 'Telegram', action: 'vpn' },
      { process: 'chrome.exe', name: 'Google Chrome', action: 'rules' },
      { process: 'steam.exe', name: 'Steam', action: 'direct' },
    ],
    userSites: [{ domain: 'rutracker.org', action: 'vpn' }],
    categories: { rkn: 'Реестр РКН', youtube: 'YouTube', meta: 'Instagram · Facebook', twitter: 'X (Twitter)', ai: 'AI-сервисы', discord: 'Discord', telegram: 'Telegram', spotify: 'Spotify', torrents: 'Торрент-трекеры' },
    connected: true,
    connectedAt: Date.now() - 8077e3,
    coreVersion: 'mihomo 1.19',
    conflicts: [],
    service: { installed: false, running: false, outdated: false },
  };
  const listeners: Record<string, ((p: unknown) => void)[]> = {};
  const emit = (ch: string, p: unknown) => (listeners[ch] || []).forEach((f) => f(p));
  const on = (ch: string) => (cb: (p: never) => void) => {
    (listeners[ch] ||= []).push(cb as (p: unknown) => void);
    return () => (listeners[ch] = listeners[ch].filter((f) => f !== cb));
  };
  setInterval(() => emit('traffic', { down: 30e6 + Math.random() * 25e6, up: 4e6 + Math.random() * 3e6 }), 1000);
  const delays = Object.fromEntries(nodes.map(([n], i) => [n, [38, 29, 52, 61, 64, 71, 84, 118][i]]));

  window.halo = {
    async call<T>(ch: string, ...args: unknown[]): Promise<T> {
      const set = (patch: Partial<State>) => {
        state = { ...state, ...patch };
        emit('state', state);
      };
      switch (ch) {
        case 'state:get':
          return state as T;
        case 'vpn:toggle':
          await new Promise((r) => setTimeout(r, 900));
          set({ connected: !state.connected, connectedAt: Date.now() });
          return undefined as T;
        case 'settings:set': {
          const p = args[0] as Partial<State['settings']>;
          set({ settings: { ...state.settings, ...p, categories: { ...state.settings.categories, ...(p.categories || {}) } } });
          return state as T;
        }
        case 'service:install':
          await new Promise((r) => setTimeout(r, 900));
          set({ service: { installed: true, running: true, outdated: false } });
          return undefined as T;
        case 'service:uninstall':
          set({ service: { installed: false, running: false, outdated: false } });
          return undefined as T;
        case 'apps:set':
          set({ appRules: args[0] as State['appRules'] });
          return undefined as T;
        case 'sites:set':
          set({ userSites: args[0] as State['userSites'] });
          return undefined as T;
        case 'proxies:get':
          return (state.connected ? { now: 'Авто · лучший', auto: nodes[0][0], all: Object.fromEntries(Object.entries(delays).map(([k, d]) => [k, { history: [{ delay: d }] }])) } : null) as T;
        case 'proxy:testAll':
          return delays as T;
        case 'check:services':
          await new Promise((r) => setTimeout(r, 1200));
          return [
            { id: 'youtube', name: 'YouTube', ok: true, ms: 112, route: 'vpn' },
            { id: 'chatgpt', name: 'ChatGPT', ok: true, ms: 184, route: 'vpn' },
            { id: 'discord', name: 'Discord', ok: true, ms: 96, route: 'vpn' },
            { id: 'instagram', name: 'Instagram', ok: true, ms: 140, route: 'vpn' },
            { id: 'telegram', name: 'Telegram', ok: true, ms: 58, route: 'vpn' },
            { id: 'gosuslugi', name: 'Госуслуги', ok: true, ms: 31, route: 'direct' },
          ] as T;
        case 'check:speed':
          await new Promise((r) => setTimeout(r, 1500));
          return { mbps: 86.4 } as T;
        case 'connections:get':
          return {
            uploadTotal: 1.2e9,
            downloadTotal: 12.6e9,
            connections: [
              ['chrome.exe', 'rr4.googlevideo.com', 'GeoSite', 'ru-blocked', '🇯🇵 Токио-03', 38.6e6],
              ['Discord.exe', 'gateway.discord.gg', 'ProcessName', 'Discord.exe', '🇯🇵 Токио-03', 1.2e6],
              ['chrome.exe', 'github.com', 'Match', '', 'DIRECT', 4.1e6],
              ['steam.exe', 'cdn.steamstatic.com', 'ProcessName', 'steam.exe', 'DIRECT', 22.4e6],
            ].map(([process, host, rule, rulePayload, chain, dl], i) => ({
              id: String(i),
              metadata: { host, destinationIP: '', destinationPort: '443', process, network: 'tcp' },
              upload: 0,
              download: dl,
              start: '',
              chains: [chain],
              rule,
              rulePayload,
            })),
          } as T;
        case 'core:api-rules':
          return { rules: [{ type: 'ProcessName', payload: 'Discord.exe', proxy: 'VPN' }, { type: 'GeoSite', payload: 'ru-blocked', proxy: 'VPN' }, { type: 'Match', payload: '', proxy: 'DIRECT' }] } as T;
        case 'check:ip':
          await new Promise((r) => setTimeout(r, 700));
          return { direct: { ip: '95.24.118.7', country: 'Россия', city: 'Москва', code: 'RU' }, vpn: { ip: '45.76.12.34', country: 'Japan', city: 'Tokyo', code: 'JP' } } as T;
        case 'check:site': {
          await new Promise((r) => setTimeout(r, 800));
          const host = String(args[0]).replace(/^\w+:\/\//, '').split('/')[0];
          const ru = /\.ru$|\.рф$/.test(host);
          return { host, ok: true, ms: ru ? 34 : 140, rule: ru ? 'Match' : 'GeoSite ru-blocked', route: ru ? 'direct' : 'vpn', node: ru ? null : nodes[0][0] } as T;
        }
        case 'proxy:test':
          await new Promise((r) => setTimeout(r, 500));
          return (delays[String(args[0])] || 0) as T;
        case 'apps:installed':
          return [{ name: 'Brave', process: 'brave.exe', path: '' }, { name: 'Google Chrome', process: 'chrome.exe', path: '' }, { name: 'Steam', process: 'steam.exe', path: '' }] as T;
        case 'apps:running':
          return [{ name: 'Spotify', process: 'Spotify.exe', path: '' }, { name: 'Code', process: 'Code.exe', path: '' }] as T;
        default:
          return undefined as T;
      }
    },
    onState: on('state'),
    onTraffic: on('traffic'),
    onError: on('error'),
    onLog: on('log'),
    onDelay: on('delay'),
  } as Window['halo'];
}
