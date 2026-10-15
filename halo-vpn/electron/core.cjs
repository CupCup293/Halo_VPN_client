// Запуск ядра mihomo и работа с его REST API (external-controller).
// Если установлена служба Halo Service, ядро запускает она (с правами SYSTEM, нужно для TUN), иначе — дочерний процесс.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class Core extends EventEmitter {
  constructor({ binPath, workDir, service = null }) {
    super();
    this.binPath = binPath;
    this.service = service;
    this.workDir = workDir;
    this.configPath = path.join(workDir, 'config.yaml');
    this.controller = { port: 9097, secret: crypto.randomBytes(12).toString('hex') };
    this.proc = null;
    this.remote = null; // { since, timer, failure } — ядро запущено службой
    this.logs = [];
    this.trafficAbort = null;
  }

  get running() {
    return !!this.proc || !!this.remote;
  }

  /** Ядро запущено службой (с правами SYSTEM). */
  get viaService() {
    return !!this.remote;
  }

  writeConfig(yamlText) {
    fs.mkdirSync(this.workDir, { recursive: true });
    fs.writeFileSync(this.configPath, yamlText, 'utf8');
  }

  log(line) {
    const entry = { t: Date.now(), line: String(line).trim() };
    if (!entry.line) return;
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    this.emit('log', entry);
  }

  /** Строки вывода ядра; запоминает последнюю ошибку, чтобы показать причину остановки. */
  onOutput(text, holder) {
    String(text)
      .split(/\r?\n/)
      .forEach((l) => {
        this.log(l);
        if (/level=(fatal|error)/.test(l)) holder.failure = l.replace(/.*msg="?/, '').replace(/"$/, '');
      });
  }

  async start() {
    if (this.running) return;
    if (this.service && (await this.service.ready())) return this.startViaService();
    if (!fs.existsSync(this.binPath)) throw new Error(`Не найдено ядро: ${this.binPath}`);
    const proc = spawn(this.binPath, ['-d', this.workDir, '-f', this.configPath], { windowsHide: true });
    this.proc = proc;
    const out = { failure: '' };
    proc.stdout.on('data', (buf) => this.onOutput(buf, out));
    proc.stderr.on('data', (buf) => this.onOutput(buf, out));
    proc.on('exit', (code) => {
      this.proc = null;
      this.stopTraffic();
      this.emit('exit', { code, reason: out.failure });
    });
    await this.waitApi(out);
  }

  async startViaService() {
    // since — чтобы служба не возвращала журнал прошлых запусков; новые строки придут в status.
    const st = await this.service.request('start', {
      configPath: this.configPath,
      workDir: this.workDir,
      ownerPid: process.pid,
      since: Number.MAX_SAFE_INTEGER,
    });
    const remote = { since: st.seq, failure: '', timer: null };
    this.remote = remote;
    const poll = async () => {
      if (this.remote !== remote) return;
      let s = null;
      try {
        s = await this.service.request('status', { since: remote.since });
      } catch {
        /* служба пропала — считаем, что ядро остановилось */
      }
      if (this.remote !== remote) return;
      if (s) {
        remote.since = s.seq;
        this.onOutput((s.logs || []).join('\n'), remote);
      }
      if (!s || !s.running) {
        this.remote = null;
        this.stopTraffic();
        this.emit('exit', { code: s ? s.exitCode : null, reason: remote.failure || (s ? '' : 'служба Halo не отвечает') });
        return;
      }
      remote.timer = setTimeout(poll, 1000);
    };
    remote.timer = setTimeout(poll, 250);
    await this.waitApi(remote);
  }

  // Ждём, пока поднимется API.
  async waitApi(out) {
    for (let i = 0; i < 60; i++) {
      if (!this.running) throw new Error(out.failure || 'Ядро завершилось при запуске');
      try {
        await this.api('GET', '/version');
        this.startTraffic();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    await this.stop();
    throw new Error(out.failure || 'Ядро не ответило за 15 секунд');
  }

  async stop() {
    this.stopTraffic();
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    if (this.remote) {
      clearTimeout(this.remote.timer);
      this.remote = null;
      await this.service.request('stop').catch(() => {});
    }
  }

  async reload() {
    if (!this.running) return;
    await this.api('PUT', '/configs?force=true', { path: this.configPath });
  }

  async api(method, p, body) {
    const res = await fetch(`http://127.0.0.1:${this.controller.port}${p}`, {
      method,
      headers: { Authorization: `Bearer ${this.controller.secret}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try {
        message = JSON.parse(text).message || text;
      } catch {
        /* не JSON */
      }
      throw new Error(message || `API ${res.status}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async startTraffic() {
    this.stopTraffic();
    const ctrl = new AbortController();
    this.trafficAbort = ctrl;
    try {
      const res = await fetch(`http://127.0.0.1:${this.controller.port}/traffic`, {
        headers: { Authorization: `Bearer ${this.controller.secret}` },
        signal: ctrl.signal,
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) {
            try {
              this.emit('traffic', JSON.parse(line));
            } catch {
              /* неполная строка */
            }
          }
        }
      }
    } catch {
      /* поток закрыт */
    }
  }

  stopTraffic() {
    if (this.trafficAbort) this.trafficAbort.abort();
    this.trafficAbort = null;
  }
}

module.exports = { Core };
