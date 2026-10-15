// Приложения: раздельное туннелирование по процессам.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { AppAction, AppRule } from '../api';
import { Icon, Segmented, itemVariants, listVariants } from '../components/ui';
import { useHalo } from '../store';

interface RunningApp {
  name: string;
  process: string;
  path: string;
  icon?: string;
}

const ACTIONS: { value: AppAction; label: string }[] = [
  { value: 'vpn', label: 'VPN' },
  { value: 'rules', label: 'Правила' },
  { value: 'direct', label: 'Напрямую' },
];

export function Apps() {
  const { state, run } = useHalo();
  const [tab, setTab] = useState<'saved' | 'installed' | 'running'>('saved');
  const [running, setRunning] = useState<RunningApp[] | null>(null);
  const [installed, setInstalled] = useState<RunningApp[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (tab === 'running' && !running) run<RunningApp[]>('apps:running').then((r) => setRunning(r || []));
    if (tab === 'installed' && !installed) run<RunningApp[]>('apps:installed').then((r) => setInstalled(r || []));
  }, [tab, running, installed, run]);

  if (!state) return null;
  const rules = state.appRules;
  const s = state.settings;
  const ruleOf = (process: string) => rules.find((r) => r.process.toLowerCase() === process.toLowerCase());

  function save(next: AppRule[]) {
    run('apps:set', next);
  }

  function setAction(app: { process: string; name: string; icon?: string; path?: string }, action: AppAction) {
    const rest = rules.filter((r) => r.process.toLowerCase() !== app.process.toLowerCase());
    save([...rest, { process: app.process, name: app.name, icon: app.icon, path: app.path, action }]);
  }

  function remove(process: string) {
    save(rules.filter((r) => r.process !== process));
  }

  async function pickExe() {
    const app = await run<RunningApp | null>('apps:pickExe');
    if (app) setAction(app, 'vpn');
  }

  const external = tab === 'running' ? running : installed;
  const source =
    tab === 'saved'
      ? rules.map((r) => ({ ...r }))
      : (external || []).map((a) => ({ ...a, action: ruleOf(a.process)?.action || ('rules' as AppAction) }));
  const query = q.trim().toLowerCase();
  const list = source.filter((a) => !query || a.name.toLowerCase().includes(query) || a.process.toLowerCase().includes(query));

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Приложения</h1>
        <span className="muted grow">Раздельное туннелирование</span>
        <span className="muted">Остальные приложения:</span>
        <Segmented
          value={s.otherApps}
          options={[
            { value: 'rules', label: 'По правилам' },
            { value: 'direct', label: 'Напрямую' },
          ]}
          onChange={(otherApps) => run('settings:set', { otherApps })}
        />
      </header>

      <div className="toolbar">
        <Segmented
          value={tab}
          options={[
            { value: 'saved', label: `Мои правила · ${rules.length}` },
            { value: 'installed', label: `Установленные${installed ? ` · ${installed.length}` : ''}` },
            { value: 'running', label: `Запущенные${running ? ` · ${running.length}` : ''}` },
          ]}
          onChange={setTab}
        />
        <label className="search grow">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск приложения" />
        </label>
        {tab !== 'saved' && (
          <button className="btn" onClick={() => (tab === 'running' ? setRunning(null) : setInstalled(null))}>
            <Icon name="refresh" size={15} /> Обновить
          </button>
        )}
        <button className="btn btn-accent" onClick={pickExe}>
          <Icon name="plus" size={15} /> Выбрать .exe
        </button>
      </div>

      <div className="card list-card grow-card scroll">
        {tab !== 'saved' && !external ? (
          <div className="empty">
            <span className="spinner" /> Собираю список программ…
          </div>
        ) : list.length === 0 ? (
          <div className="empty">{tab === 'saved' ? 'Правил пока нет — выберите программу во вкладке «Установленные» или «Запущенные» либо укажите .exe' : 'Ничего не найдено'}</div>
        ) : (
          <motion.div variants={listVariants} initial="hidden" animate="show" key={tab}>
            <AnimatePresence initial={false}>
              {list.map((a) => (
                <motion.div key={a.process} className="app-row" variants={itemVariants} exit={{ opacity: 0, x: -20, transition: { duration: 0.2 } }} layout>
                  {a.icon ? <img src={a.icon} className="app-icon" alt="" /> : <span className="app-icon letter">{a.name[0]?.toUpperCase()}</span>}
                  <b className="app-name ellipsis">{a.name}</b>
                  <span className="mono muted grow ellipsis">{a.process}</span>
                  <Segmented size="sm" accent={a.action === 'vpn'} value={a.action === 'block' ? 'direct' : a.action} options={ACTIONS} onChange={(v) => setAction(a, v)} />
                  {tab === 'saved' && (
                    <button className="icon-btn" onClick={() => remove(a.process)} title="Убрать правило">
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <motion.div className={`note ${s.tun ? '' : 'warn'}`} layout>
        <Icon name={s.tun ? 'check' : 'warning'} size={18} />
        <span className="grow">{s.tun ? 'Правила приложений работают в TUN-режиме · TUN включён' : 'Без TUN правила действуют только для программ, которые используют системный прокси'}</span>
        {!s.tun && (
          <button className="btn btn-accent sm" onClick={() => run('settings:set', { tun: true })}>
            Включить TUN
          </button>
        )}
        {s.tun && <span className="muted">Применяется сразу, без переподключения</span>}
      </motion.div>
    </div>
  );
}
