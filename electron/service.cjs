// Клиент службы-помощника Halo Service (service/HaloService.cs): установка, удаление и команды по именованному каналу.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const SERVICE_NAME = 'HaloService';
const SERVICE_VERSION = '1';
const PIPE = '\\\\.\\pipe\\halo-service';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = String(stdout);
        err.stderr = String(stderr);
        reject(err);
      } else resolve(String(stdout));
    });
  });
}

function sha256(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return '';
  }
}

class ServiceClient {
  /**
   * @param {{ exePath: string, corePath: string, secretFile: string, pipe?: string }} opts
   * exePath — halo-service.exe из ресурсов, corePath — mihomo.exe, который копируется в службу при установке.
   */
  constructor({ exePath, corePath, secretFile, pipe = PIPE }) {
    this.exePath = exePath;
    this.corePath = corePath;
    this.secretFile = secretFile;
    this.pipe = pipe;
    this.coreHash = null;
  }

  secret() {
    try {
      const s = fs.readFileSync(this.secretFile, 'utf8').trim();
      if (s.length >= 16) return s;
    } catch {
      /* создадим */
    }
    const s = crypto.randomBytes(24).toString('hex');
    fs.mkdirSync(path.dirname(this.secretFile), { recursive: true });
    fs.writeFileSync(this.secretFile, s, 'utf8');
    return s;
  }

  /** Одна команда службе: строка JSON туда, строка JSON обратно. */
  request(cmd, extra = {}, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const sock = net.connect(this.pipe);
      let buf = '';
      const timer = setTimeout(() => sock.destroy(new Error('Служба Halo не отвечает')), timeout);
      sock.on('connect', () => sock.write(JSON.stringify({ cmd, secret: this.secret(), ...extra }) + '\n'));
      sock.on('data', (d) => {
        buf += d;
        const nl = buf.indexOf('\n');
        if (nl < 0) return;
        clearTimeout(timer);
        sock.end();
        let res;
        try {
          res = JSON.parse(buf.slice(0, nl));
        } catch {
          return reject(new Error('Служба Halo ответила непонятно'));
        }
        if (res.ok) resolve(res);
        else reject(new Error(res.error || 'Ошибка службы Halo'));
      });
      sock.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      sock.on('close', () => {
        clearTimeout(timer);
        reject(new Error('Служба Halo закрыла соединение'));
      });
    });
  }

  /** Служба отвечает и говорит на нашем протоколе — можно запускать ядро через неё. */
  async ready() {
    try {
      const s = await this.request('status', { since: Number.MAX_SAFE_INTEGER }, 1500);
      return s.version === SERVICE_VERSION;
    } catch {
      return false;
    }
  }

  async installed() {
    if (process.platform !== 'win32') return false;
    try {
      await run('sc.exe', ['query', SERVICE_NAME]);
      return true;
    } catch {
      return false;
    }
  }

  /** { installed, running, outdated, error? } — для экрана настроек. */
  async info() {
    const installed = await this.installed();
    if (!installed) return { installed: false, running: false, outdated: false };
    try {
      const s = await this.request('status', { since: Number.MAX_SAFE_INTEGER }, 1500);
      if (this.coreHash === null) this.coreHash = sha256(this.corePath);
      const outdated = s.version !== SERVICE_VERSION || (!!this.coreHash && s.coreHash !== this.coreHash);
      return { installed, running: true, outdated };
    } catch (e) {
      return { installed, running: false, outdated: false, error: e.code === 'ENOENT' ? 'служба не запущена' : e.message };
    }
  }

  /** Установка (или переустановка) с одним запросом UAC. */
  async install() {
    if (!fs.existsSync(this.exePath)) throw new Error(`Не найдена служба: ${this.exePath}`);
    this.secret();
    await this.elevated(`install "${this.secretFile}" "${this.corePath}" "${this.errorLog()}"`);
    this.coreHash = null;
    for (let i = 0; i < 40; i++) {
      if (await this.ready()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Служба установлена, но не отвечает');
  }

  async uninstall() {
    await this.elevated(`uninstall "${this.errorLog()}"`);
  }

  /** Файл, куда служба пишет причину сбоя установки (вывод процесса под UAC до нас не доходит). */
  errorLog() {
    return path.join(path.dirname(this.secretFile), 'service-error.log');
  }

  /** Запуск halo-service.exe от администратора: Windows один раз показывает UAC. */
  async elevated(args) {
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    const script =
      `try { $p = Start-Process -FilePath ${q(this.exePath)} -ArgumentList ${q(args)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode } ` +
      `catch { Write-Output $_.Exception.Message; exit 1223 }`;
    try {
      fs.rmSync(this.errorLog(), { force: true });
    } catch {
      /* нет файла */
    }
    try {
      await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    } catch (e) {
      if (e.code === 1223) throw new Error('Установка отменена: Windows не получила разрешение администратора');
      let reason = '';
      try {
        reason = fs.readFileSync(this.errorLog(), 'utf8').trim();
      } catch {
        reason = (e.stdout || '').trim();
      }
      throw new Error(reason ? `Служба Halo: ${reason}` : `Служба Halo завершилась с кодом ${e.code}`);
    }
  }
}

module.exports = { ServiceClient, SERVICE_NAME, SERVICE_VERSION, PIPE };
