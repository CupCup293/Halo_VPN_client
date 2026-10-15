// Правила: категории обхода блокировок, личные исключения по сайтам, итоговые правила ядра.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { halo, type UserSite } from '../api';
import { Card, Icon } from '../components/ui';
import { useHalo } from '../store';

interface SiteResult {
  host: string;
  ok: boolean;
  ms: number | null;
  rule: string | null;
  route: 'vpn' | 'direct' | 'block' | null;
  node: string | null;
}

interface CoreRule {
  type: string;
  payload: string;
  proxy: string;
}

function cleanDomain(input: string): string {
  const s = input.trim().toLowerCase();
  try {
    return new URL(s.includes('://') ? s : `https://${s}`).hostname.replace(/^www\./, '');
  } catch {
    return s;
  }
}

export function Rules() {
  const { state, run } = useHalo();
  const [site, setSite] = useState('');
  const [rules, setRules] = useState<CoreRule[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<SiteResult | null>(null);

  useEffect(() => {
    if (!state?.connected) return setRules(null);
    halo
      .call<{ rules: CoreRule[] }>('core:api-rules')
      .then((r) => setRules(r.rules))
      .catch(() => setRules(null));
  }, [state?.connected, state?.settings, state?.appRules, state?.userSites]);

  if (!state) return null;
  const s = state.settings;

  function setCategory(id: string, on: boolean) {
    run('settings:set', { categories: { [id]: on } });
  }

  function addSite(action: UserSite['action'], value = site) {
    const domain = cleanDomain(value);
    if (!domain || !domain.includes('.')) return;
    const next = [...state!.userSites.filter((x) => x.domain !== domain), { domain, action }];
    run('sites:set', next);
    setSite('');
    setResult(null);
  }

  async function check() {
    const domain = cleanDomain(site);
    if (!domain.includes('.')) return;
    setChecking(true);
    setResult(null);
    const r = await run<SiteResult>('check:site', domain);
    if (r) setResult(r);
    setChecking(false);
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Правила</h1>
        <span className="muted">{rules ? `${rules.length} правил в ядре` : 'Гео-базы обновляются раз в сутки'}</span>
      </header>

      <Card>
        <div className="row-between">
          <b>Через VPN — только заблокированное в РФ</b>
          <span className="muted">Для режима «Только заблокированное»</span>
        </div>
        <div className="chips wrap">
          {Object.entries(state.categories).map(([id, title]) => {
            const on = !!s.categories[id];
            return (
              <motion.button key={id} className={`chip big ${on ? 'filled' : ''}`} onClick={() => setCategory(id, !on)} whileTap={{ scale: 0.94 }} layout>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: 'auto', opacity: 1 }} exit={{ width: 0, opacity: 0 }} className="chip-check">
                      ✓
                    </motion.span>
                  )}
                </AnimatePresence>
                {title}
              </motion.button>
            );
          })}
        </div>
      </Card>

      <Card delay={0.05}>
        <b>Свои сайты</b>
        <div className="site-input">
          <Icon name="search" size={18} className="accent" />
          <input value={site} onChange={(e) => setSite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && check()} placeholder="Сайт не открывается? Введите адрес, например rutracker.org" />
          <button className="btn btn-soft sm" onClick={check} disabled={checking}>
            {checking ? <span className="spinner" /> : null} Проверить
          </button>
          <button className="btn btn-accent sm" onClick={() => addSite('vpn')}>
            Всегда через VPN
          </button>
          <button className="btn sm" onClick={() => addSite('direct')}>
            Всегда напрямую
          </button>
        </div>
        <AnimatePresence>
          {result && (
            <motion.div className={`site-result ${result.route || ''}`} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <b>{result.host}</b>
              <span>
                {result.route === 'vpn' ? `идёт через VPN${result.node ? ` (${result.node})` : ''}` : result.route === 'direct' ? 'идёт напрямую' : result.route === 'block' ? 'заблокирован правилом' : 'маршрут не определён'}
                {result.rule ? ` · правило ${result.rule}` : ''}
              </span>
              <span className={result.ok ? 'muted' : 'orange'}>{result.ok ? `открылся за ${result.ms} мс` : 'не открылся'}</span>
              <span className="spacer" />
              {result.route !== 'vpn' && (
                <button className="btn btn-accent sm" onClick={() => addSite('vpn', result.host)}>
                  Пустить через VPN
                </button>
              )}
              {result.route === 'vpn' && (
                <button className="btn sm" onClick={() => addSite('direct', result.host)}>
                  Пустить напрямую
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="chips wrap">
          <AnimatePresence>
            {state.userSites.map((x) => (
              <motion.span key={x.domain} className={`chip ${x.action === 'vpn' ? 'blue' : ''}`} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} layout>
                {x.domain} · {x.action === 'vpn' ? 'VPN' : 'напрямую'}
                <button className="icon-btn" onClick={() => run('sites:set', state.userSites.filter((y) => y.domain !== x.domain))}>
                  <Icon name="x" size={12} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
          {!state.userSites.length && <span className="muted">Пока пусто</span>}
        </div>
      </Card>

      <Card delay={0.1} className="grow-card scroll">
        <div className="row-between">
          <b>Правила ядра</b>
          <span className="muted">первое совпадение выигрывает</span>
        </div>
        {rules ? (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Тип</th>
                <th>Значение</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td>{r.type}</td>
                  <td className="mono">{r.payload || '*'}</td>
                  <td className={r.proxy === 'DIRECT' ? '' : r.proxy === 'REJECT' ? 'orange' : 'accent'}>{r.proxy === 'DIRECT' ? 'Напрямую' : r.proxy === 'REJECT' ? 'Блокировать' : `→ ${r.proxy}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Подключитесь, чтобы увидеть, какие правила применило ядро.</p>
        )}
      </Card>
    </div>
  );
}
