// Каркас окна: заголовок, боковое меню, строка состояния.
import { motion } from 'framer-motion';
import { halo } from '../api';
import { useHalo, type Screen } from '../store';
import { formatBytes, formatSpeed, cleanName } from '../util';
import { Icon } from './ui';

const NAV: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: 'Главная', icon: 'home' },
  { id: 'servers', label: 'Серверы', icon: 'globe' },
  { id: 'rules', label: 'Правила', icon: 'route' },
  { id: 'apps', label: 'Приложения', icon: 'apps' },
  { id: 'profiles', label: 'Подписки', icon: 'cloud' },
  { id: 'connections', label: 'Соединения', icon: 'activity' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

export function TitleBar() {
  return (
    <div className="titlebar">
      <span className="titlebar-name">Halo</span>
      <div className="titlebar-buttons">
        <button onClick={() => halo.call('win:minimize')} aria-label="Свернуть">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button onClick={() => halo.call('win:maximize')} aria-label="Развернуть">
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
        <button className="close" onClick={() => halo.call('win:close')} aria-label="Закрыть">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.2" /></svg>
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { screen, go, state } = useHalo();
  const profile = state?.profiles.find((p) => p.id === state.activeProfileId);
  const used = profile?.usage ? profile.usage.upload + profile.usage.download : 0;
  const total = profile?.usage?.total || 0;
  return (
    <aside className="sidebar">
      <div className="brand">
        <motion.span className={`brand-dot ${state?.connected ? 'live' : ''}`} animate={state?.connected ? { scale: [1, 1.12, 1] } : { scale: 1 }} transition={{ duration: 2.4, repeat: Infinity }} />
        <span>Halo</span>
      </div>
      <nav>
        {NAV.map((n) => (
          <button key={n.id} className={`nav-item ${screen === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
            {screen === n.id && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <Icon name={n.icon} size={19} className="nav-icon" />
            <span className="nav-label">{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="spacer" />
      {profile && (
        <button className="sub-mini" onClick={() => go('profiles')}>
          <b>{profile.name}</b>
          <span className="mono muted">{total ? `${formatBytes(used)} / ${formatBytes(total)}` : `${profile.nodes.length} узлов`}</span>
          {total > 0 && (
            <div className="bar">
              <motion.div className="bar-fill" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (used / total) * 100)}%` }} transition={{ duration: 0.8 }} />
            </div>
          )}
        </button>
      )}
    </aside>
  );
}

export function StatusBar() {
  const { state, traffic, currentNode, delays } = useHalo();
  const down = formatSpeed(traffic.down);
  const up = formatSpeed(traffic.up);
  const s = state?.settings;
  return (
    <footer className="statusbar">
      <span className={`status-dot ${state?.connected ? 'on' : ''}`} />
      <span className="status-text">
        {state?.connected ? `Подключено${currentNode ? ` · ${cleanName(currentNode)}` : ''}${currentNode && delays[currentNode] ? ` · ${delays[currentNode]} мс` : ''}` : 'Отключено'}
      </span>
      <span className="spacer" />
      <span className="mono accent">↓ {down.value} {down.unit}</span>
      <span className="mono orange">↑ {up.value} {up.unit}</span>
      <span className="muted">
        {state?.coreVersion} · {s?.tun ? 'TUN' : s?.systemProxy ? 'Прокси' : 'Порт ' + s?.mixedPort}
      </span>
    </footer>
  );
}
