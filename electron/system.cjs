// Системные вещи Windows: системный прокси, права администратора, список процессов.
const { execFile } = require('node:child_process');

const INET_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
const BYPASS = 'localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.2*;172.30.*;172.31.*;192.168.*;<local>';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

async function setSystemProxy(enabled, port) {
  if (process.platform !== 'win32') return;
  if (enabled) {
    await run('reg', ['add', INET_KEY, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${port}`, '/f']);
    await run('reg', ['add', INET_KEY, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', BYPASS, '/f']);
    await run('reg', ['add', INET_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
  } else {
    await run('reg', ['add', INET_KEY, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
  }
}

async function isAdmin() {
  if (process.platform !== 'win32') return process.getuid?.() === 0;
  try {
    await run('net', ['session']);
    return true;
  } catch {
    return false;
  }
}

function relaunchAsAdmin(exePath, args) {
  const argList = args.length ? `-ArgumentList '${args.map((a) => a.replace(/'/g, "''")).join("','")}'` : '';
  return run('powershell', ['-NoProfile', '-Command', `Start-Process -FilePath '${exePath.replace(/'/g, "''")}' ${argList} -Verb RunAs`]);
}

/** Запущенные процессы с окнами/сетью: [{ name, path }] без дублей. */
async function runningProcesses() {
  if (process.platform !== 'win32') return [];
  const out = await run('powershell', [
    '-NoProfile',
    '-Command',
    'Get-Process | Where-Object { $_.Path } | Select-Object -Property ProcessName,Path | ConvertTo-Json -Compress',
  ]);
  let list = [];
  try {
    list = JSON.parse(out);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) list = [list];
  const seen = new Map();
  for (const p of list) {
    const file = p.Path.split('\\').pop();
    if (/^(svchost|conhost|RuntimeBroker|dllhost|sihost|ctfmon|smartscreen)\.exe$/i.test(file)) continue;
    if (/\\Windows\\(System32|SysWOW64)\\/i.test(p.Path)) continue;
    if (!seen.has(file.toLowerCase())) seen.set(file.toLowerCase(), { name: p.ProcessName, process: file, path: p.Path });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Установленные программы из разделов Uninstall реестра: [{ name, process, path }]. */
async function installedApps() {
  if (process.platform !== 'win32') return [];
  const script = [
    "$keys = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
    'Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and $_.DisplayIcon -and -not $_.SystemComponent } | Select-Object DisplayName,DisplayIcon | ConvertTo-Json -Compress',
  ].join('; ');
  let list = [];
  try {
    list = JSON.parse(await run('powershell', ['-NoProfile', '-Command', script]));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) list = [list];
  const seen = new Map();
  for (const p of list) {
    const exe = String(p.DisplayIcon).replace(/"/g, '').replace(/,\s*-?\d+$/, '').trim();
    if (!/\.exe$/i.test(exe) || /unins\w*\.exe$|uninstall|setup|installer|install |vc_redist|update|service\.exe$|helper/i.test(exe)) continue;
    const file = exe.split('\\').pop();
    if (!seen.has(file.toLowerCase())) seen.set(file.toLowerCase(), { name: String(p.DisplayName).replace(/\s+\(?(x64|64-bit|x86)\)?$/i, ''), process: file, path: exe });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Другие VPN/прокси-клиенты: если они работают, они перехватывают трафик мимо Halo.
const KNOWN_CLIENTS = [
  [/^(clash-verge|verge-mihomo|clash-verge-service)$/i, 'Clash Verge Rev'],
  [/^(clash for windows|clash-win64|cfw)$/i, 'Clash for Windows'],
  [/^v2rayn$/i, 'v2rayN'],
  [/^(hiddify|hiddifycli|hiddify-service)$/i, 'Hiddify'],
  [/^nekoray|^nekobox$/i, 'NekoRay'],
  [/^(amneziavpn|amneziavpn-service)$/i, 'AmneziaVPN'],
  [/^happ$/i, 'Happ'],
  [/^(flclash|flclashcore)$/i, 'FlClash'],
  [/^(karing|karingservice)$/i, 'Karing'],
  [/^outline/i, 'Outline'],
];

/**
 * Ищет конфликты: чужие клиенты, чужие TUN-адаптеры и системный прокси не на нашем порту.
 * ownPort — порт Halo, ownProxyOn — включал ли прокси сам Halo.
 */
async function detectConflicts(ownPort) {
  if (process.platform !== 'win32') return [];
  const script = [
    '$p = (Get-Process | Select-Object -ExpandProperty ProcessName) -join ","',
    "$a = (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.Name -ne 'Halo' -and ($_.InterfaceDescription -match 'Wintun|WireGuard|sing-tun|Meta Tunnel' -or $_.Name -match 'Mihomo|Meta|Clash|sing|tun|wg') } | Select-Object -ExpandProperty Name) -join ','",
    '"$p|$a"',
  ].join('; ');
  const out = [];
  try {
    const [procs, adapters] = (await run('powershell', ['-NoProfile', '-Command', script])).trim().split('|');
    const names = new Set();
    for (const proc of procs.split(',')) for (const [re, title] of KNOWN_CLIENTS) if (re.test(proc.trim())) names.add(title);
    for (const title of names) out.push({ kind: 'client', title });
    for (const a of adapters.split(',').filter(Boolean)) out.push({ kind: 'tun', title: a });
  } catch {
    /* PowerShell недоступен */
  }
  const proxy = await foreignProxy(ownPort);
  if (proxy) out.push({ kind: 'proxy', title: proxy });
  return out;
}

/** Адрес чужого системного прокси или null, если прокси выключен или указывает на Halo. Дёшево — только реестр. */
async function foreignProxy(ownPort) {
  if (process.platform !== 'win32') return null;
  try {
    const reg = await run('reg', ['query', INET_KEY]);
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/.test(reg);
    const server = (reg.match(/ProxyServer\s+REG_SZ\s+(\S+)/) || [])[1] || '';
    return enabled && server && server !== `127.0.0.1:${ownPort}` ? server : null;
  } catch {
    return null;
  }
}

/**
 * Настоящая сетевая карта (Wi-Fi/Ethernet), через которую идёт интернет, — без чужих TUN-адаптеров.
 * К ней Halo привязывает исходящий трафик, чтобы «напрямую» не уходило в TUN другого клиента.
 */
async function physicalInterface() {
  if (process.platform !== 'win32') return null;
  const script =
    "Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.NextHop -notlike '198.18.*' -and $_.InterfaceAlias -notmatch 'Mihomo|Meta|Clash|sing|tun|wg|Halo|WireGuard' } | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1 -ExpandProperty InterfaceAlias";
  try {
    return (await run('powershell', ['-NoProfile', '-Command', script])).trim() || null;
  } catch {
    return null;
  }
}

module.exports = { setSystemProxy, isAdmin, relaunchAsAdmin, runningProcesses, installedApps, detectConflicts, foreignProxy, physicalInterface };
