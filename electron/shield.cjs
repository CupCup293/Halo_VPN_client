// Совместная работа с файрволом Halo Shield — через два файла в папке данных Halo VPN (%APPDATA%\halo-vpn):
//   shield-bridge.json  — пишет Halo VPN: подключён ли VPN, TUN-адаптер, fake-ip, адрес API ядра, пути своих программ.
//                         Halo Shield по нему всегда пропускает Halo VPN, не считает TUN-адаптер новой сетью
//                         и показывает в журнале настоящие домены вместо адресов 198.18.x.x.
//   shield-domains.json — пишет Halo Shield: домены, которые нужно блокировать (телеметрия, реклама, трекеры).
//                         При включённом VPN файл hosts обходится (DNS идёт через ядро), поэтому их блокирует ядро.
const fs = require('node:fs');
const path = require('node:path');

const BRIDGE_VERSION = 1;
const MAX_DOMAINS = 50000;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z][a-z0-9-]{1,62}$/;
const MAX_PROCESSES = 2000;
// Полный путь к .exe без запятых и переводов строк (запятая сломала бы строку правила ядра).
const PATH_RE = /^[a-zA-Z]:\\[^,\r\n"]{1,400}\.exe$/i;

class ShieldBridge {
  constructor(dataDir) {
    this.bridgeFile = path.join(dataDir, 'shield-bridge.json');
    this.domainsFile = path.join(dataDir, 'shield-domains.json');
    this.lastBridge = '';
    this.domains = [];
    this.processes = [];
    this.found = false;
  }

  /** Сообщает Halo Shield текущее состояние. Пишет, только если что-то изменилось (атомарно — через временный файл). */
  writeBridge(info) {
    const body = JSON.stringify({ version: BRIDGE_VERSION, app: 'Halo VPN', ...info }, null, 2);
    if (body === this.lastBridge) return;
    this.lastBridge = body;
    try {
      const tmp = `${this.bridgeFile}.tmp`;
      fs.writeFileSync(tmp, body, 'utf8');
      fs.renameSync(tmp, this.bridgeFile);
    } catch {
      /* не критично: Halo Shield просто не узнает о VPN */
    }
  }

  /**
   * Домены для блокировки из shield-domains.json — только корректные, без дублей, не больше MAX_DOMAINS.
   * Заодно читает processes — программы, которым Halo Shield запретил выход в сеть (this.processes).
   */
  readDomains() {
    let list = [];
    let procs = [];
    try {
      const data = JSON.parse(fs.readFileSync(this.domainsFile, 'utf8'));
      list = Array.isArray(data.block) ? data.block : [];
      procs = Array.isArray(data.processes) ? data.processes : [];
      this.found = true;
    } catch {
      list = [];
      this.found = false; // файла нет — Halo Shield не установлен или связка выключена
    }
    // Запрещённые программы: при системном прокси их трафик идёт через 127.0.0.1 — Брандмауэр Windows
    // локальные соединения не фильтрует, поэтому запрет повторяет ядро (PROCESS-PATH,…,REJECT).
    const p = new Set();
    for (const raw of procs) {
      const s = String(raw).trim();
      if (PATH_RE.test(s)) p.add(s);
      if (p.size >= MAX_PROCESSES) break;
    }
    this.processes = [...p];
    const out = new Set();
    for (const raw of list) {
      const d = String(raw).trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
      if (DOMAIN_RE.test(d)) out.add(d);
      if (out.size >= MAX_DOMAINS) break;
    }
    this.domains = [...out];
    return this.domains;
  }

  /** Следит за shield-domains.json и вызывает onChange(domains), когда список меняется. */
  watchDomains(onChange) {
    const snapshot = () => JSON.stringify([this.readDomains(), this.processes]);
    let last = snapshot();
    // watchFile (опрос), а не watch: Halo Shield может заменять файл целиком, и обычный watch такое теряет.
    fs.watchFile(this.domainsFile, { interval: 2000 }, () => {
      const next = snapshot();
      if (next !== last) {
        last = next;
        onChange(this.domains);
      }
    });
  }

  stop() {
    fs.unwatchFile(this.domainsFile);
  }
}

module.exports = { ShieldBridge, BRIDGE_VERSION };
