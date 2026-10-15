// Главная: кнопка подключения, текущий узел, режимы, скорость и быстрые проверки.
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { IpInfo, Mode } from '../api';
import { Card, Flag, Icon, Segmented, Sparkline, itemVariants, listVariants } from '../components/ui';
import { useHalo } from '../store';
import { cleanName, delayClass, formatDuration, formatSpeed, protocolLabel } from '../util';

const MODES: { value: Mode; label: string }[] = [
  { value: 'blocked', label: 'Только заблокированное' },
  { value: 'except-ru', label: 'Всё, кроме РФ' },
  { value: 'global', label: 'Весь трафик' },
];

const MODE_HINTS: Record<string, string> = {
  blocked: 'Через VPN — только заблокированные в России сайты (реестр РКН и сервисы, закрывшие доступ из РФ). Все остальные сайты открываются напрямую, с вашим обычным IP.',
  'except-ru': 'Через VPN — всё, кроме российских сайтов. Банки, Госуслуги и маркетплейсы открываются напрямую.',
  global: 'Весь трафик через VPN. Российские сайты тоже увидят зарубежный IP — некоторые из них могут не открыться.',
};

interface ServiceResult {
  id: string;
  name: string;
  ok: boolean;
  ms: number | null;
  route?: 'vpn' | 'direct';
}

export function Home() {
  const { state, run, traffic, history, currentNode, delays, go, toast, refreshProxies } = useHalo();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [services, setServices] = useState<ServiceResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [speed, setSpeed] = useState<number | null>(null);
  const [speedBusy, setSpeedBusy] = useState(false);
  const [ip, setIp] = useState<{ direct: IpInfo | null; vpn: IpInfo | null } | null>(null);
  const [ipBusy, setIpBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // IP проверяем сразу после подключения и при смене режима.
  useEffect(() => {
    if (!state?.connected) return setIp(null);
    const t = setTimeout(checkIp, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.connected, state?.settings.mode]);

  async function checkIp() {
    setIpBusy(true);
    const r = await run<{ direct: IpInfo | null; vpn: IpInfo | null }>('check:ip');
    if (r) setIp(r);
    setIpBusy(false);
  }

  if (!state) return null;
  const s = state.settings;
  const profile = state.profiles.find((p) => p.id === state.activeProfileId);
  const node = profile?.nodes.find((n) => n.name === currentNode);
  const vpnApps = state.appRules.filter((r) => r.action === 'vpn').length;
  const down = formatSpeed(traffic.down);
  const up = formatSpeed(traffic.up);

  const quick = [...(profile?.nodes || [])]
    .sort((a, b) => (delays[a.name] || 1e9) - (delays[b.name] || 1e9))
    .slice(0, 4);

  async function toggle() {
    setBusy(true);
    await run('vpn:toggle');
    setBusy(false);
  }

  async function checkAll() {
    if (!state?.connected) return toast('Подключитесь, чтобы проверить сервисы');
    setChecking(true);
    setServices(null);
    const r = await run<ServiceResult[]>('check:services');
    if (r) setServices(r);
    setChecking(false);
  }

  async function testSpeed() {
    if (!state?.connected) return toast('Подключитесь, чтобы проверить скорость');
    setSpeedBusy(true);
    const r = await run<{ mbps: number }>('check:speed');
    if (r) setSpeed(r.mbps);
    setSpeedBusy(false);
  }

  async function select(name: string) {
    if (!state?.connected) return toast('Подключитесь, чтобы сменить сервер');
    await run('proxy:select', name);
    refreshProxies();
  }

  const okCount = services?.filter((x) => x.ok).length;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Главная</h1>
        <span className="muted">
          {s.tun ? 'TUN' : s.systemProxy ? 'Системный прокси' : `Порт ${s.mixedPort}`}
          {vpnApps ? ` · ${vpnApps} прил. через VPN` : ''}
        </span>
        <Segmented value={s.mode === 'direct' ? 'blocked' : s.mode} options={MODES} onChange={(mode) => run('settings:set', { mode })} />
      </header>

      <motion.p key={s.mode} className="mode-hint" initial={{ y: -4 }} animate={{ y: 0 }}>
        {MODE_HINTS[s.mode] || MODE_HINTS.blocked}
      </motion.p>

      <div className="home-grid">
        <Card className="hero">
          <div className="hero-top">
            <PowerButton on={state.connected} busy={busy} onClick={toggle} />
            <div className="hero-info">
              <AnimatePresence mode="wait">
                <motion.p
                  key={state.connected ? 'on' : 'off'}
                  className={`hero-status ${state.connected ? 'on' : ''}`}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                >
                  {busy ? (state.connected ? 'Отключение…' : 'Подключение…') : state.connected ? `Подключено · ${formatDuration(now - state.connectedAt)}` : 'Не подключено'}
                </motion.p>
              </AnimatePresence>
              {profile ? (
                <>
                  <div className="hero-node">
                    <Flag name={currentNode || profile.nodes[0]?.name || ''} active />
                    <span className="hero-node-name">{currentNode ? cleanName(currentNode) : 'Авто · лучший'}</span>
                    {currentNode && delays[currentNode] ? <span className={`mono ${delayClass(delays[currentNode])}`}>{delays[currentNode]} мс</span> : null}
                  </div>
                  <p className="muted">{node ? protocolLabel(node) : `${profile.nodes.length} узлов в подписке`} · «{profile.name}»</p>
                  <button className="btn" onClick={() => go('servers')}>
                    Сменить сервер ▾
                  </button>
                </>
              ) : (
                <>
                  <p className="hero-node-name">Нет подписки</p>
                  <button className="btn btn-accent" onClick={() => go('profiles')}>
                    Добавить подписку
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="hero-facts">
            <IpFact label="IP обычных сайтов" info={ip?.direct} busy={ipBusy} connected={state.connected} />
            <IpFact label="IP через VPN" info={ip?.vpn} busy={ipBusy} connected={state.connected} accent />
            <div>
              <span className="muted row-between">
                DNS
                {state.connected && (
                  <button className="link" onClick={checkIp} disabled={ipBusy} title="Проверить IP ещё раз">
                    ↻
                  </button>
                )}
              </span>
              <span>{s.dnsMode} · DoH</span>
            </div>
          </div>

          <div className="services">
            <div className="row-between">
              <b className="sub">Доступность сервисов</b>
              <button className="btn btn-soft sm" onClick={checkAll} disabled={checking}>
                {checking ? <span className="spinner" /> : '▶'} {checking ? 'Проверяю…' : okCount !== undefined ? `Доступно ${okCount} из ${services!.length}` : 'Запустить все'}
              </button>
            </div>
            <motion.div className="services-grid" variants={listVariants} initial="hidden" animate="show" key={services ? 'r' : 'e'}>
              {(services || PLACEHOLDER).map((x) => (
                <motion.div key={x.id} className="service" variants={itemVariants}>
                  <span className={`dot ${x.ok === undefined ? '' : x.ok ? (x.route === 'direct' ? 'white' : 'blue') : 'orange'}`} />
                  <span className="grow">{x.name}</span>
                  <span className={`mono ${x.ok === false ? 'orange' : 'muted'}`}>
                    {x.ok === undefined ? '—' : !x.ok ? 'нет доступа' : x.route === 'direct' ? 'напрямую' : `${x.ms} мс`}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </Card>

        <div className="home-right">
          <Card delay={0.05}>
            <div className="row-between">
              <b className="sub">Скорость</b>
              <span className="muted">последние 60 с</span>
            </div>
            <div className="speed-row">
              <div>
                <span className="accent">↓ Загрузка</span>
                <span className="mono big">
                  {down.value}
                  <span className="muted"> {down.unit}</span>
                </span>
              </div>
              <div>
                <span className="orange">↑ Отдача</span>
                <span className="mono big">
                  {up.value}
                  <span className="muted"> {up.unit}</span>
                </span>
              </div>
            </div>
            <Sparkline down={history.down} up={history.up} height={60} />
          </Card>

          <Card delay={0.1} className="grow-card">
            <b className="sub">Быстрые тесты</b>
            <div className="tests">
              <TestTile icon="activity" label="Пинг узла" value={currentNode && delays[currentNode] ? `${delays[currentNode]} мс` : '—'} />
              <TestTile icon="bolt" label="Мбит/с" value={speedBusy ? '…' : speed !== null ? String(speed) : '—'} onClick={testSpeed} busy={speedBusy} />
              <TestTile icon="shield" label="Сервисы" value={okCount !== undefined ? `${okCount} / ${services!.length}` : '—'} onClick={checkAll} busy={checking} />
              <TestTile icon="globe" label="Узлов" value={profile ? String(profile.nodes.length) : '—'} onClick={() => go('servers')} />
            </div>
          </Card>
        </div>
      </div>

      {quick.length > 0 && (
        <Card className="quick" delay={0.15}>
          <div className="row-between">
            <b className="sub">Быстрый выбор</b>
            <button className="link" onClick={() => go('servers')}>
              Все серверы →
            </button>
          </div>
          <div className="quick-row">
            {quick.map((n) => (
              <motion.button key={n.name} className={`quick-node ${n.name === currentNode ? 'active' : ''}`} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }} onClick={() => select(n.name)}>
                <Flag name={n.name} active={n.name === currentNode} />
                <span className="grow ellipsis">{cleanName(n.name)}</span>
                <span className={`mono ${delays[n.name] === 0 ? 'orange' : delayClass(delays[n.name])}`}>{delays[n.name] === 0 ? 'таймаут' : delays[n.name] || '—'}</span>
              </motion.button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function IpFact({ label, info, busy, connected, accent }: { label: string; info?: IpInfo | null; busy: boolean; connected: boolean; accent?: boolean }) {
  return (
    <div>
      <span className="muted">{label}</span>
      <AnimatePresence mode="wait">
        <motion.span key={info?.ip || (busy ? 'busy' : 'none')} className={`mono ${accent ? 'accent' : ''}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          {!connected ? '—' : busy && !info ? 'проверяю…' : info ? info.ip : 'нет ответа'}
        </motion.span>
      </AnimatePresence>
      {info && <span className="muted sm-text">{[info.city, info.country].filter(Boolean).join(', ')}</span>}
    </div>
  );
}

const PLACEHOLDER: ServiceResult[] = ['YouTube', 'ChatGPT', 'Discord', 'Instagram', 'Telegram', 'Госуслуги'].map((name) => ({
  id: name,
  name,
  ok: undefined as unknown as boolean,
  ms: null,
}));

function PowerButton({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <div className="power-wrap">
      <AnimatePresence>
        {on && !busy && (
          <>
            <motion.span className="power-ring" initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 1.45, opacity: 0 }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }} />
            <motion.span className="power-ring" initial={{ scale: 1, opacity: 0.5 }} animate={{ scale: 1.45, opacity: 0 }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut', delay: 1.1 }} />
          </>
        )}
      </AnimatePresence>
      {busy && <motion.span className="power-spin" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} />}
      <motion.button
        className={`power ${on ? 'on' : ''}`}
        onClick={onClick}
        disabled={busy}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.94 }}
        animate={{ boxShadow: on ? '0 0 0 10px rgba(123,147,255,0.12), 0 16px 44px rgba(91,116,255,0.45)' : '0 0 0 10px rgba(255,255,255,0.03), 0 10px 30px rgba(0,0,0,0.35)' }}
      >
        <Icon name="power" size={34} />
        <span>{on ? 'Вкл' : 'Выкл'}</span>
      </motion.button>
    </div>
  );
}

function TestTile({ icon, label, value, onClick, busy }: { icon: string; label: string; value: string; onClick?: () => void; busy?: boolean }) {
  return (
    <motion.button className="test" onClick={onClick} disabled={!onClick || busy} whileHover={onClick ? { y: -2 } : undefined} whileTap={onClick ? { scale: 0.97 } : undefined}>
      <Icon name={icon} size={22} className="accent" />
      <div className="grow">
        <span className="muted">{label}</span>
        <motion.span key={value} className="mono test-value" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          {value}
        </motion.span>
      </div>
      {onClick && (busy ? <span className="spinner" /> : <span className="muted">▶</span>)}
    </motion.button>
  );
}
