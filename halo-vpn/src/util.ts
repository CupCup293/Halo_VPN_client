// Форматирование и мелкие помощники.

export function formatSpeed(bytesPerSec: number): { value: string; unit: string } {
  if (bytesPerSec >= 1024 * 1024) return { value: (bytesPerSec / 1024 / 1024).toFixed(1), unit: 'MB/s' };
  if (bytesPerSec >= 1024) return { value: (bytesPerSec / 1024).toFixed(0), unit: 'KB/s' };
  return { value: String(Math.round(bytesPerSec)), unit: 'B/s' };
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

export function timeAgo(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

const COUNTRY_WORDS: [RegExp, string][] = [
  [/япон|japan|tokyo|токио|osaka/i, 'JP'],
  [/казах|kazakh|almaty|алмат|astana/i, 'KZ'],
  [/сингап|singapore/i, 'SG'],
  [/нидерл|netherl|amsterdam|амстер|holland/i, 'NL'],
  [/герман|german|frankfurt|франкф|berlin/i, 'DE'],
  [/финл|finland|helsinki|хельс/i, 'FI'],
  [/турц|turk|istanbul|стамб/i, 'TR'],
  [/сша|usa|united states|new york|нью-йорк|los angeles|america/i, 'US'],
  [/гонконг|hong ?kong/i, 'HK'],
  [/британ|united kingdom|london|лондон|england/i, 'UK'],
  [/франц|france|paris|париж/i, 'FR'],
  [/польш|poland|warsaw|варш/i, 'PL'],
  [/швец|sweden|stockholm/i, 'SE'],
  [/латв|latvia|riga|рига/i, 'LV'],
  [/эстон|estonia|tallinn/i, 'EE'],
  [/росси|russia|moscow|москва/i, 'RU'],
];

/** Код страны из флага-эмодзи, ISO-кода или названия города в имени узла. */
export function countryCode(name: string): string {
  const flags = [...name].filter((c) => {
    const cp = c.codePointAt(0)!;
    return cp >= 0x1f1e6 && cp <= 0x1f1ff;
  });
  if (flags.length >= 2) return flags.slice(0, 2).map((c) => String.fromCharCode(c.codePointAt(0)! - 0x1f1e6 + 65)).join('').replace('GB', 'UK');
  for (const [re, code] of COUNTRY_WORDS) if (re.test(name)) return code;
  const iso = name.match(/\b([A-Z]{2})\b/);
  return iso ? iso[1] : '··';
}

/** Имя узла без флага-эмодзи. */
export function cleanName(name: string): string {
  return name.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim();
}

export function protocolLabel(n: { type: string; network?: string; reality?: boolean }): string {
  const t: Record<string, string> = { vless: 'VLESS', vmess: 'VMess', trojan: 'Trojan', ss: 'Shadowsocks', hysteria2: 'Hysteria2', tuic: 'TUIC v5', wireguard: 'WireGuard' };
  const base = t[n.type] || n.type;
  if (n.reality) return `${base} · Reality`;
  if (n.network && n.network !== 'tcp') return `${base} · ${n.network.toUpperCase() === 'GRPC' ? 'gRPC' : n.network.toUpperCase()}`;
  return base;
}

export function delayClass(ms?: number | null): string {
  if (!ms) return 'delay-none';
  if (ms < 80) return 'delay-good';
  if (ms < 200) return 'delay-ok';
  return 'delay-bad';
}
