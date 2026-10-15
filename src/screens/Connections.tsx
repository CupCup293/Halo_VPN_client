// Соединения: график трафика и живой список с приложением, правилом и узлом.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { Connection } from '../api';
import { Card, Icon, Sparkline } from '../components/ui';
import { useHalo } from '../store';
import { cleanName, formatBytes } from '../util';

export function Connections() {
  const { state, run, history } = useHalo();
  const [list, setList] = useState<Connection[]>([]);
  const [totals, setTotals] = useState({ up: 0, down: 0 });
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!state?.connected) return setList([]);
    let alive = true;
    const load = async () => {
      const r = await run<{ connections: Connection[]; uploadTotal: number; downloadTotal: number }>('connections:get');
      if (alive && r) {
        setList((r.connections || []).sort((a, b) => b.download - a.download));
        setTotals({ up: r.uploadTotal || 0, down: r.downloadTotal || 0 });
      }
    };
    load();
    const t = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [state?.connected, run]);

  const query = q.trim().toLowerCase();
  const shown = list.filter((c) => !query || (c.metadata.host || c.metadata.destinationIP).includes(query) || (c.metadata.process || '').toLowerCase().includes(query)).slice(0, 200);

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Соединения</h1>
        <span className="badge soft">Активные · {list.length}</span>
        <label className="search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Хост или приложение" />
        </label>
        <span className="spacer" />
        <button className="btn orange-text" onClick={() => run('connections:close')} disabled={!list.length}>
          Закрыть все
        </button>
      </header>

      <Card>
        <div className="row-between">
          <b>Трафик за последнюю минуту</b>
          <span className="muted mono">
            Всего ↓ {formatBytes(totals.down)} · ↑ {formatBytes(totals.up)}
          </span>
        </div>
        <Sparkline down={history.down} up={history.up} height={110} />
      </Card>

      <div className="card list-card grow-card scroll">
        {!state?.connected ? (
          <div className="empty">Подключитесь, чтобы увидеть соединения.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Приложение</th>
                <th>Хост</th>
                <th>Правило</th>
                <th>Узел</th>
                <th style={{ textAlign: 'right' }}>↓ Получено</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {shown.map((c) => {
                  const chain = c.chains[0] || '';
                  const blocked = chain === 'REJECT';
                  return (
                    <motion.tr key={c.id} initial={{ opacity: 0, backgroundColor: 'rgba(123,147,255,0.12)' }} animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
                      <td className="ellipsis">{c.metadata.process || '—'}</td>
                      <td className="ellipsis">{c.metadata.host || c.metadata.destinationIP}</td>
                      <td className="muted ellipsis">{c.rulePayload ? `${c.rule} ${c.rulePayload}` : c.rule}</td>
                      <td className={blocked ? 'orange' : chain === 'DIRECT' ? '' : 'accent'}>{blocked ? 'Заблокировано' : chain === 'DIRECT' ? 'Напрямую' : cleanName(chain)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {formatBytes(c.download)}
                      </td>
                      <td>
                        <button className="icon-btn" title="Закрыть" onClick={() => run('connections:close', c.id)}>
                          <Icon name="x" size={13} />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
