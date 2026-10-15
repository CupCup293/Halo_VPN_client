// Загрузка и разбор подписок: Clash/Mihomo YAML, base64-список ссылок, sing-box JSON.
const yaml = require('js-yaml');

const SUB_USER_AGENT = 'clash.meta';

function b64decode(s) {
  const norm = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
  return Buffer.from(norm + pad, 'base64').toString('utf8');
}

function looksBase64(s) {
  const t = s.trim();
  return t.length > 0 && /^[A-Za-z0-9+/=_\-\s]+$/.test(t);
}

function qs(url) {
  const out = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

function nameOf(url, fallback) {
  const h = url.hash ? decodeURIComponent(url.hash.slice(1)) : '';
  return h || fallback;
}

function transportOpts(p, q) {
  const net = q.type || 'tcp';
  if (net === 'ws') {
    p.network = 'ws';
    p['ws-opts'] = { path: q.path || '/', headers: q.host ? { Host: q.host } : undefined };
  } else if (net === 'grpc') {
    p.network = 'grpc';
    p['grpc-opts'] = { 'grpc-service-name': q.serviceName || q.path || '' };
  } else if (net === 'xhttp' || net === 'splithttp') {
    p.network = 'xhttp';
    p['xhttp-opts'] = { path: q.path || '/', host: q.host || undefined, mode: q.mode || undefined };
  } else if (net === 'http' || net === 'h2') {
    p.network = net;
  } else {
    p.network = 'tcp';
  }
}

function parseVless(link) {
  const u = new URL(link);
  const q = qs(u);
  const p = {
    name: nameOf(u, `${u.hostname}:${u.port}`),
    type: 'vless',
    server: u.hostname,
    port: Number(u.port || 443),
    uuid: decodeURIComponent(u.username),
    udp: true,
  };
  if (q.flow) p.flow = q.flow;
  if (q.security === 'tls' || q.security === 'reality') {
    p.tls = true;
    if (q.sni) p.servername = q.sni;
    if (q.fp) p['client-fingerprint'] = q.fp;
    if (q.alpn) p.alpn = q.alpn.split(',');
    if (q.allowInsecure === '1' || q.insecure === '1') p['skip-cert-verify'] = true;
  }
  if (q.security === 'reality') {
    p['reality-opts'] = { 'public-key': q.pbk, 'short-id': q.sid || '' };
    if (!p['client-fingerprint']) p['client-fingerprint'] = 'chrome';
  }
  transportOpts(p, q);
  return p;
}

function parseVmess(link) {
  const j = JSON.parse(b64decode(link.slice('vmess://'.length)));
  const p = {
    name: j.ps || `${j.add}:${j.port}`,
    type: 'vmess',
    server: j.add,
    port: Number(j.port),
    uuid: j.id,
    alterId: Number(j.aid || 0),
    cipher: j.scy || 'auto',
    udp: true,
  };
  if (j.tls === 'tls') {
    p.tls = true;
    if (j.sni) p.servername = j.sni;
  }
  transportOpts(p, { type: j.net, path: j.path, host: j.host, serviceName: j.path });
  return p;
}

function parseTrojan(link) {
  const u = new URL(link);
  const q = qs(u);
  const p = {
    name: nameOf(u, `${u.hostname}:${u.port}`),
    type: 'trojan',
    server: u.hostname,
    port: Number(u.port || 443),
    password: decodeURIComponent(u.username),
    udp: true,
  };
  if (q.sni) p.sni = q.sni;
  if (q.allowInsecure === '1') p['skip-cert-verify'] = true;
  if (q.fp) p['client-fingerprint'] = q.fp;
  transportOpts(p, q);
  return p;
}

function parseSS(link) {
  const body = link.slice('ss://'.length);
  const hashIdx = body.indexOf('#');
  const name = hashIdx >= 0 ? decodeURIComponent(body.slice(hashIdx + 1)) : '';
  let main = hashIdx >= 0 ? body.slice(0, hashIdx) : body;
  main = main.split('?')[0];
  let userinfo, hostport;
  if (main.includes('@')) {
    const at = main.lastIndexOf('@');
    userinfo = main.slice(0, at);
    hostport = main.slice(at + 1);
    userinfo = userinfo.includes(':') ? decodeURIComponent(userinfo) : b64decode(userinfo);
  } else {
    const decoded = b64decode(main);
    const at = decoded.lastIndexOf('@');
    userinfo = decoded.slice(0, at);
    hostport = decoded.slice(at + 1);
  }
  const colon = userinfo.indexOf(':');
  const portIdx = hostport.lastIndexOf(':');
  const server = hostport.slice(0, portIdx).replace(/^\[|\]$/g, '');
  return {
    name: name || hostport,
    type: 'ss',
    server,
    port: Number(hostport.slice(portIdx + 1)),
    cipher: userinfo.slice(0, colon),
    password: userinfo.slice(colon + 1),
    udp: true,
  };
}

function parseHy2(link) {
  const u = new URL(link.replace(/^hy2:\/\//, 'hysteria2://'));
  const q = qs(u);
  const p = {
    name: nameOf(u, `${u.hostname}:${u.port}`),
    type: 'hysteria2',
    server: u.hostname,
    port: Number(u.port || 443),
    password: decodeURIComponent(u.username + (u.password ? ':' + u.password : '')),
  };
  if (q.sni) p.sni = q.sni;
  if (q.insecure === '1') p['skip-cert-verify'] = true;
  if (q.obfs) {
    p.obfs = q.obfs;
    p['obfs-password'] = q['obfs-password'] || '';
  }
  return p;
}

function parseTuic(link) {
  const u = new URL(link);
  const q = qs(u);
  const p = {
    name: nameOf(u, `${u.hostname}:${u.port}`),
    type: 'tuic',
    server: u.hostname,
    port: Number(u.port || 443),
    uuid: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    'congestion-controller': q.congestion_control || 'bbr',
    'udp-relay-mode': q.udp_relay_mode || 'native',
  };
  if (q.sni) p.sni = q.sni;
  if (q.alpn) p.alpn = q.alpn.split(',');
  if (q.allow_insecure === '1') p['skip-cert-verify'] = true;
  return p;
}

const LINK_PARSERS = {
  'vless://': parseVless,
  'vmess://': parseVmess,
  'trojan://': parseTrojan,
  'ss://': parseSS,
  'hysteria2://': parseHy2,
  'hy2://': parseHy2,
  'tuic://': parseTuic,
};

function parseLink(line) {
  const t = line.trim();
  for (const [prefix, fn] of Object.entries(LINK_PARSERS)) {
    if (t.toLowerCase().startsWith(prefix)) {
      try {
        return fn(t);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function parseLinks(text) {
  return text.split(/\r?\n/).map(parseLink).filter(Boolean);
}

function fromSingBox(obj) {
  const out = [];
  for (const o of obj.outbounds || []) {
    if (!o.server) continue;
    const base = { name: o.tag, server: o.server, port: o.server_port };
    if (o.type === 'vless') {
      const p = { ...base, type: 'vless', uuid: o.uuid, udp: true };
      if (o.flow) p.flow = o.flow;
      if (o.tls?.enabled) {
        p.tls = true;
        p.servername = o.tls.server_name;
        if (o.tls.utls?.fingerprint) p['client-fingerprint'] = o.tls.utls.fingerprint;
        if (o.tls.reality?.enabled)
          p['reality-opts'] = { 'public-key': o.tls.reality.public_key, 'short-id': o.tls.reality.short_id || '' };
      }
      out.push(p);
    } else if (o.type === 'trojan') {
      out.push({ ...base, type: 'trojan', password: o.password, sni: o.tls?.server_name, udp: true });
    } else if (o.type === 'shadowsocks') {
      out.push({ ...base, type: 'ss', cipher: o.method, password: o.password, udp: true });
    } else if (o.type === 'hysteria2') {
      out.push({ ...base, type: 'hysteria2', password: o.password, sni: o.tls?.server_name });
    } else if (o.type === 'tuic') {
      out.push({ ...base, type: 'tuic', uuid: o.uuid, password: o.password, sni: o.tls?.server_name });
    } else if (o.type === 'vmess') {
      out.push({ ...base, type: 'vmess', uuid: o.uuid, alterId: o.alter_id || 0, cipher: o.security || 'auto' });
    }
  }
  return out;
}

/** Разбирает тело подписки, возвращает { proxies, format }. */
function parseSubscription(text) {
  const body = text.trim();
  if (body.startsWith('{')) {
    try {
      return { proxies: fromSingBox(JSON.parse(body)), format: 'sing-box JSON' };
    } catch {
      /* не JSON */
    }
  }
  if (/^\s*(proxies|proxy-groups|port|mixed-port)\s*:/m.test(body)) {
    const doc = yaml.load(body) || {};
    return { proxies: (doc.proxies || []).filter((p) => p && p.name && p.type), format: 'Clash YAML' };
  }
  if (/^[a-z0-9]+:\/\//im.test(body)) return { proxies: parseLinks(body), format: 'Ссылки' };
  if (looksBase64(body)) {
    const decoded = b64decode(body);
    return { proxies: parseLinks(decoded), format: 'Base64' };
  }
  return { proxies: [], format: 'неизвестно' };
}

/** subscription-userinfo: upload=…; download=…; total=…; expire=… */
function parseUserInfo(header) {
  if (!header) return null;
  const info = {};
  for (const part of header.split(';')) {
    const [k, v] = part.split('=').map((s) => s && s.trim());
    if (k && v && /^\d+$/.test(v)) info[k] = Number(v);
  }
  return {
    upload: info.upload || 0,
    download: info.download || 0,
    total: info.total || 0,
    expire: info.expire ? info.expire * 1000 : 0,
  };
}

function decodeTitle(v) {
  if (!v) return '';
  if (v.startsWith('base64:')) return b64decode(v.slice(7));
  return v;
}

/** Скачивает подписку. fetchImpl — Electron session.fetch (может идти через прокси) или глобальный fetch. */
async function fetchSubscription(url, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(url.trim(), { headers: { 'User-Agent': SUB_USER_AGENT }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? 'сервер не ответил за 20 с' : e.cause?.code || e.message;
    throw new Error(`Не удалось загрузить подписку (${why}). Если сайт заблокирован, включите «Обновлять через VPN».`);
  }
  if (!res.ok) throw new Error(`Сервер подписки ответил ${res.status}`);
  const text = await res.text();
  const { proxies, format } = parseSubscription(text);
  if (!proxies.length) throw new Error('В подписке не найдено ни одного сервера');
  const interval = Number(res.headers.get('profile-update-interval')) || 0;
  return {
    proxies,
    format,
    usage: parseUserInfo(res.headers.get('subscription-userinfo')),
    title: decodeTitle(res.headers.get('profile-title')),
    supportUrl: res.headers.get('support-url') || '',
    updateIntervalHours: interval,
  };
}

module.exports = { parseSubscription, parseLink, parseUserInfo, fetchSubscription, b64decode };
