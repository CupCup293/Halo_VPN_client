const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ServiceClient, SERVICE_VERSION, PIPE } = require('../electron/service.cjs');
const { Core } = require('../electron/core.cjs');

const root = path.join(__dirname, '..');
const serviceExe = path.join(root, 'resources', 'service', 'halo-service.exe');
const mihomo = path.join(root, 'resources', 'core', 'mihomo.exe');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'halo-svc-'));
}

function pipeName() {
  return `\\\\.\\pipe\\halo-test-${process.pid}-${Math.random().toString(16).slice(2)}`;
}

/** Поддельная служба: тот же протокол, что у HaloService.cs. */
function fakeService(pipe, handler) {
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (d) => {
      buf += d;
      if (!buf.includes('\n')) return;
      sock.end(JSON.stringify(handler(JSON.parse(buf))) + '\n');
    });
  });
  return new Promise((r) => server.listen(pipe, () => r(server)));
}

test('клиент службы шлёт секрет и разбирает ответ', async () => {
  const dir = tmpDir();
  const pipe = pipeName();
  const seen = [];
  const server = await fakeService(pipe, (req) => {
    seen.push(req);
    return req.cmd === 'boom' ? { ok: false, error: 'плохо' } : { ok: true, version: SERVICE_VERSION, running: false, seq: 0, logs: [] };
  });
  const client = new ServiceClient({ exePath: '', corePath: '', secretFile: path.join(dir, 'service.key'), pipe });
  try {
    assert.equal(await client.ready(), true);
    const secret = fs.readFileSync(path.join(dir, 'service.key'), 'utf8');
    assert.ok(secret.length >= 32);
    assert.equal(seen[0].secret, secret);
    await assert.rejects(client.request('boom'), /плохо/);
  } finally {
    server.close();
  }
  const absent = new ServiceClient({ exePath: '', corePath: '', secretFile: path.join(dir, 'service.key'), pipe: pipeName() });
  assert.equal(await absent.ready(), false);
});

test('ядро через службу: запуск, логи, остановка и падение', async () => {
  const dir = tmpDir();
  const api = http.createServer((req, res) => {
    if (req.url === '/traffic') return res.writeHead(200).write('{"up":1,"down":2}\n');
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"version":"fake"}');
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));

  let running = false;
  const cmds = [];
  const pipe = pipeName();
  const server = await fakeService(pipe, (req) => {
    cmds.push(req);
    if (req.cmd === 'start') running = true;
    if (req.cmd === 'stop') running = false;
    const logs = req.cmd === "status" && req.since < 1 ? ['level=info msg="Start initial configuration"'] : [];
    return { ok: true, version: SERVICE_VERSION, running, seq: req.cmd === "start" ? 0 : 1, exitCode: running ? null : 1, logs };
  });
  const service = new ServiceClient({ exePath: '', corePath: '', secretFile: path.join(dir, 'service.key'), pipe });
  const core = new Core({ binPath: path.join(dir, 'нет.exe'), workDir: dir, service });
  core.controller.port = api.address().port;
  try {
    await core.start();
    assert.ok(core.running && core.viaService);
    const start = cmds.find((c) => c.cmd === 'start');
    assert.equal(start.configPath, core.configPath);
    assert.equal(start.ownerPid, process.pid);
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(core.logs.some((l) => l.line.includes('Start initial configuration')));

    await core.stop();
    assert.ok(!core.running);
    assert.equal(cmds.at(-1).cmd, 'stop');

    // Ядро упало само — Core замечает это по статусу службы.
    await core.start();
    const exited = new Promise((r) => core.once('exit', r));
    running = false;
    const ev = await exited;
    assert.equal(ev.code, 1);
    assert.ok(!core.running);
  } finally {
    await core.stop();
    server.close();
    api.close();
  }
});

// Настоящая служба в консольном режиме + настоящий mihomo (без TUN, поэтому права не нужны).
// fs.existsSync не видит именованные каналы в Windows — про установленную службу спрашиваем у sc.exe.
function realServiceRunning() {
  try {
    return /RUNNING/.test(require('node:child_process').execFileSync('sc', ['query', 'HaloService'], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}
const canRunReal = process.platform === 'win32' && fs.existsSync(serviceExe) && fs.existsSync(mihomo) && !fs.existsSync(PIPE) && !realServiceRunning();
test('halo-service.exe запускает mihomo по команде', { skip: !canRunReal && 'нет собранной службы или служба уже запущена' }, async () => {
  const dir = tmpDir();
  const secretFile = path.join(dir, 'service.key');
  const client = new ServiceClient({ exePath: serviceExe, corePath: mihomo, secretFile });
  client.secret();
  const proc = spawn(serviceExe, ['run', secretFile, mihomo], { stdio: ['pipe', 'ignore', 'ignore'] });
  const core = new Core({ binPath: mihomo, workDir: path.join(dir, 'core'), service: client });
  try {
    for (let i = 0; i < 40 && !(await client.ready()); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(await client.ready(), true, await client.request('status').then(JSON.stringify, (e) => e.message));

    const bad = new ServiceClient({ exePath: '', corePath: '', secretFile: path.join(dir, 'other.key') });
    await assert.rejects(bad.request('status'), /секрет/);
    await assert.rejects(client.request('start', { configPath: 'C:\\x\\..\\y.txt', workDir: dir }), /Недопустимый путь|yaml/);

    const port = 20000 + Math.floor(Math.random() * 20000);
    core.controller.port = port;
    core.writeConfig(
      `mixed-port: ${port + 1}\nexternal-controller: 127.0.0.1:${port}\nsecret: ${core.controller.secret}\nmode: direct\nlog-level: info\n`,
    );
    await core.start();
    assert.ok(core.viaService);
    const st = await client.request('status');
    assert.equal(st.running, true);
    assert.ok(st.pid > 0);
    assert.ok(st.coreHash.length === 64);
    assert.ok((await core.api('GET', '/version')).version);
    await core.stop();
    assert.equal((await client.request('status')).running, false);

    // Клиент завершился аварийно — служба сама гасит ядро, чтобы TUN не остался висеть.
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    await client.request('start', { configPath: core.configPath, workDir: core.workDir, ownerPid: owner.pid });
    assert.equal((await client.request('status')).running, true);
    owner.kill();
    let st2;
    for (let i = 0; i < 30; i++) {
      st2 = await client.request('status');
      if (!st2.running) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(st2.running, false);
  } finally {
    await core.stop();
    proc.stdin.end('\n');
    await new Promise((r) => proc.on('exit', r));
  }
});
