// Серверы: список узлов подписки, поиск, проверка задержки, выбор узла.
import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Flag, Icon, itemVariants, listVariants } from '../components/ui';
import { useHalo } from '../store';
import { cleanName, countryCode, delayClass, protocolLabel } from '../util';

const AUTO = 'Авто · лучший';

export function Servers() {
  const { state, run, delays, setDelays, currentNode, refreshProxies, toast } = useHalo();
  const [q, setQ] = useState('');
  const [testing, setTesting] = useState(false);
  const [region, setRegion] = useState('all');
  const [testingOne, setTestingOne] = useState<string | null>(null);
  const profile = state?.profiles.find((p) => p.id === state.activeProfileId);
  const nodes = profile?.nodes || [];

  const regions = useMemo(() => {
    const set = new Map<string, number>();
    for (const n of nodes) {
      const c = countryCode(n.name);
      set.set(c, (set.get(c) || 0) + 1);
    }
    return [...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [nodes]);

  const list = nodes.filter((n) => {
    if (region !== 'all' && countryCode(n.name) !== region) return false;
    const s = q.trim().toLowerCase();
    return !s || n.name.toLowerCase().includes(s) || n.type.includes(s) || n.server.includes(s) || countryCode(n.name).toLowerCase() === s;
  });

  async function testAll() {
    setTesting(true);
    const r = await run<Record<string, number>>('proxy:testAll');
    if (r) {
      setDelays({ ...delays, ...Object.fromEntries(nodes.map((n) => [n.name, r[n.name] || 0])) });
      const alive = nodes.filter((n) => r[n.name] > 0).length;
      if (!alive) toast('Ни один сервер не ответил за 5 с — проверьте интернет или подписку');
    }
    setTesting(false);
  }

  async function testOne(name: string) {
    setTestingOne(name);
    const d = await run<number>('proxy:test', name);
    if (d !== undefined) setDelays({ ...delays, [name]: d });
    setTestingOne(null);
  }

  async function select(name: string) {
    if (!state?.connected) return toast('Подключитесь, чтобы выбрать сервер');
    await run('proxy:select', name);
    refreshProxies();
  }

  if (!profile) {
    return (
      <div className="screen">
        <header className="screen-head">
          <h1>Серверы</h1>
        </header>
        <div className="empty">Добавьте подписку, чтобы увидеть серверы.</div>
      </div>
    );
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Серверы</h1>
        <label className="search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск узла, страны или протокола" />
        </label>
        <span className="spacer" />
        <button className="btn btn-soft" onClick={testAll} disabled={testing}>
          {testing ? <span className="spinner" /> : <Icon name="bolt" size={16} />} Проверить задержку
        </button>
      </header>

      <div className="chips">
        <button className={`chip ${region === 'all' ? 'on' : ''}`} onClick={() => setRegion('all')}>
          Все узлы · {nodes.length}
        </button>
        {regions.map(([code, n]) => (
          <button key={code} className={`chip ${region === code ? 'on' : ''}`} onClick={() => setRegion(code)}>
            <Flag code={code} size="sm" /> {n}
          </button>
        ))}
        <span className="spacer" />
        <motion.button className={`chip ${!currentNode || currentNode === AUTO ? '' : ''}`} whileTap={{ scale: 0.96 }} onClick={() => select(AUTO)}>
          ⚡ Авто · лучший
        </motion.button>
      </div>

      <motion.div className="node-grid" variants={listVariants} initial="hidden" animate="show" key={region + q}>
        {list.map((n) => {
          const active = n.name === currentNode;
          const d = delays[n.name];
          return (
            <motion.button key={n.name} className={`node ${active ? 'active' : ''}`} variants={itemVariants} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => select(n.name)} layout>
              <Flag name={n.name} active={active} />
              <div className="grow col">
                <b className="ellipsis">{cleanName(n.name)}</b>
                <span className="muted">{protocolLabel(n)}</span>
              </div>
              <motion.span
                key={`${d}-${testingOne === n.name}`}
                className={`mono delay-btn ${d === 0 ? 'orange' : delayClass(d)}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                title={d === 0 ? 'Сервер не ответил за 5 секунд. Нажмите, чтобы проверить ещё раз' : 'Проверить этот узел'}
                onClick={(e) => {
                  e.stopPropagation();
                  if (state?.connected) testOne(n.name);
                  else toast('Подключитесь, чтобы проверить задержку');
                }}
              >
                {testingOne === n.name ? <span className="spinner" /> : d === 0 ? 'таймаут' : d ? `${d} мс` : '—'}
              </motion.span>
              {active && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="accent">
                  <Icon name="check" size={20} />
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}
