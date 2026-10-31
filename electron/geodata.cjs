// Гео-базы ядра (GeoIP.dat, GeoSite.dat — формат v2ray): какие категории в них есть.
// На чужом компьютере может лежать стандартная база mihomo без российских категорий (ru-blocked и т. п.),
// а ядро на любой отсутствующей категории отказывается загружать конфиг целиком. Поэтому перед запуском
// проверяем базы: чужую удаляем (ядро скачает правильную по geox-url), а правила с недостающими
// категориями убираем из конфига — VPN запускается, просто без этой части списков.
const fs = require('node:fs');
const path = require('node:path');

const FILES = { geoip: ['GeoIP.dat', 'geoip.dat'], geosite: ['GeoSite.dat', 'geosite.dat'] };
// Без этих категорий база точно не та (не российская сборка runetfreedom).
const REQUIRED = { geoip: ['ru-blocked'], geosite: ['ru-blocked', 'ru-available-only-inside'] };

const cache = new Map(); // путь → { mtimeMs, size, codes }

/** Коды категорий из .dat: protobuf { repeated Entry entry = 1 { string code = 1 } }. Читает только заголовки записей. */
function readCodes(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.codes;
  const codes = new Set();
  try {
    const b = fs.readFileSync(file);
    let i = 0;
    const varint = () => {
      let x = 0;
      let s = 0;
      let c;
      do {
        if (i >= b.length) throw new Error('обрыв');
        c = b[i++];
        x += (c & 127) * 2 ** s;
        s += 7;
      } while (c & 128);
      return x;
    };
    while (i < b.length) {
      const tag = varint();
      const len = varint();
      const end = i + len;
      if (end > b.length) break; // недокачанный файл — что успели прочитать
      if (tag >> 3 === 1) {
        const t2 = varint();
        if (t2 >> 3 === 1) {
          const l = varint();
          codes.add(b.subarray(i, i + l).toString('utf8').toLowerCase());
        }
      }
      i = end;
    }
  } catch {
    /* битый файл — вернём, что прочитали */
  }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, codes });
  return codes;
}

function fileOf(dir, kind) {
  for (const name of FILES[kind]) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** { geoip: Set | null, geosite: Set | null } — null, если файла нет (ядро скачает сам, судить не о чем). */
function available(dir) {
  const out = {};
  for (const kind of Object.keys(FILES)) {
    const f = fileOf(dir, kind);
    out[kind] = f ? readCodes(f) : null;
  }
  return out;
}

/** Удаляет базы без обязательных категорий (чужие или пустые). Возвращает имена удалённых файлов. */
function dropForeign(dir) {
  const removed = [];
  for (const kind of Object.keys(FILES)) {
    const f = fileOf(dir, kind);
    if (!f) continue;
    const codes = readCodes(f);
    if (codes && REQUIRED[kind].every((c) => codes.has(c))) continue;
    try {
      fs.rmSync(f, { force: true });
      cache.delete(f);
      removed.push(path.basename(f));
    } catch {
      /* занят — правила с недостающими категориями всё равно отфильтруются */
    }
  }
  return removed;
}

/**
 * Подкладывает резервные базы из программы (resources/geo), если на компьютере базы нет или она чужая.
 * Так ядру не нужно ничего скачивать: работает и без доступа к GitHub. Свежие базы ядро всё равно
 * скачивает само раз в сутки (geo-auto-update) — резерв нужен, только если что-то пошло не так.
 * Возвращает имена подложенных файлов.
 */
function restoreBackup(dir, backupDir) {
  const restored = [];
  for (const kind of Object.keys(FILES)) {
    const f = fileOf(dir, kind);
    const codes = f ? readCodes(f) : null;
    if (codes && REQUIRED[kind].every((c) => codes.has(c))) continue;
    const backup = path.join(backupDir, FILES[kind][0]);
    if (!fs.existsSync(backup)) continue;
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (f && f !== path.join(dir, FILES[kind][0])) fs.rmSync(f, { force: true });
      fs.copyFileSync(backup, path.join(dir, FILES[kind][0]));
      if (f) cache.delete(f);
      restored.push(FILES[kind][0]);
    } catch {
      /* файл занят — сработает фильтр правил */
    }
  }
  return restored;
}

/** Категории, на которые ссылается правило: GEOIP,x / GEOSITE,x, в том числе внутри AND,((…),(GEOSITE,x)). */
function ruleCategories(rule) {
  const out = [];
  const re = /(GEOIP|GEOSITE),([^,()]+)/g;
  let m;
  while ((m = re.exec(rule))) out.push({ kind: m[1] === 'GEOIP' ? 'geoip' : 'geosite', code: m[2].toLowerCase() });
  return out;
}

/** Оставляет правила, все категории которых есть в базах (или базы ещё нет — тогда судить не о чем). */
function filterRules(rules, geo) {
  const dropped = [];
  const kept = rules.filter((r) => {
    const missing = ruleCategories(r).filter((c) => geo[c.kind] && !geo[c.kind].has(c.code));
    if (missing.length) dropped.push(r);
    return !missing.length;
  });
  return { rules: kept, dropped };
}

module.exports = { readCodes, available, dropForeign, restoreBackup, filterRules, ruleCategories, REQUIRED };
