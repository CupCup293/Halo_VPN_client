const test = require('node:test');
const assert = require('node:assert');
const { parseSubscription, parseLink, parseUserInfo } = require('../electron/subscription.cjs');

test('vless reality', () => {
  const p = parseLink('vless://11111111-2222-3333-4444-555555555555@1.2.3.4:443?type=tcp&security=reality&pbk=PUBKEY&sid=ab&sni=www.microsoft.com&fp=chrome&flow=xtls-rprx-vision#%F0%9F%87%AF%F0%9F%87%B5%20Tokyo');
  assert.equal(p.type, 'vless');
  assert.equal(p.server, '1.2.3.4');
  assert.equal(p.port, 443);
  assert.equal(p.flow, 'xtls-rprx-vision');
  assert.equal(p.servername, 'www.microsoft.com');
  assert.deepEqual(p['reality-opts'], { 'public-key': 'PUBKEY', 'short-id': 'ab' });
  assert.equal(p.name, '🇯🇵 Tokyo');
});

test('ss: SIP002 и старый формат', () => {
  const userinfo = Buffer.from('chacha20-ietf-poly1305:pass').toString('base64');
  const a = parseLink(`ss://${userinfo}@5.6.7.8:8388#Almaty`);
  assert.deepEqual([a.cipher, a.password, a.server, a.port, a.name], ['chacha20-ietf-poly1305', 'pass', '5.6.7.8', 8388, 'Almaty']);
  const old = Buffer.from('aes-256-gcm:pw@9.9.9.9:1234').toString('base64');
  const b = parseLink(`ss://${old}#Old`);
  assert.deepEqual([b.cipher, b.password, b.server, b.port], ['aes-256-gcm', 'pw', '9.9.9.9', 1234]);
});

test('vmess, trojan, hy2, tuic', () => {
  const vm = Buffer.from(JSON.stringify({ ps: 'HK', add: 'h.example', port: '443', id: 'uuid', aid: '0', net: 'ws', path: '/ws', host: 'h.example', tls: 'tls' })).toString('base64');
  const v = parseLink(`vmess://${vm}`);
  assert.equal(v.network, 'ws');
  assert.equal(v['ws-opts'].path, '/ws');
  assert.equal(parseLink('trojan://secret@t.example:443?sni=t.example#TR').password, 'secret');
  const h = parseLink('hy2://pw@h2.example:8443?sni=h2.example&obfs=salamander&obfs-password=x#SG');
  assert.equal(h.type, 'hysteria2');
  assert.equal(h.obfs, 'salamander');
  const t = parseLink('tuic://uuid:pw@tu.example:443?congestion_control=bbr&alpn=h3#DE');
  assert.deepEqual([t.uuid, t.password, t.alpn[0]], ['uuid', 'pw', 'h3']);
});

test('base64-подписка и Clash YAML', () => {
  const body = Buffer.from('trojan://a@x.example:443#A\nvless://u@y.example:443?security=tls#B\nmusor').toString('base64');
  const r = parseSubscription(body);
  assert.equal(r.format, 'Base64');
  assert.deepEqual(r.proxies.map((p) => p.name), ['A', 'B']);
  const y = parseSubscription('proxies:\n  - {name: N1, type: ss, server: s, port: 1, cipher: aes-128-gcm, password: p}\nrules: []\n');
  assert.equal(y.format, 'Clash YAML');
  assert.equal(y.proxies[0].name, 'N1');
});

test('subscription-userinfo', () => {
  assert.deepEqual(parseUserInfo('upload=10; download=20; total=100; expire=1700000000'), {
    upload: 10,
    download: 20,
    total: 100,
    expire: 1700000000000,
  });
});
