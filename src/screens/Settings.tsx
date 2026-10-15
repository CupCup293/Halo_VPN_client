// Настройки: сеть, DNS, приложение, обход блокировок.
import { useEffect, useRef, useState } from 'react';
import { Card, Segmented, Toggle } from '../components/ui';
import { useHalo } from '../store';
import { halo } from '../api';

export function Settings() {
  const { state, run } = useHalo();
  const [port, setPort] = useState<string | null>(null);
  const [doh, setDoh] = useState<string | null>(null);
  if (!state) return null;
  const s = state.settings;
  const set = (p: object) => run('settings:set', p);

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Настройки</h1>
      </header>
      <div className="settings-grid">
        <div className="col gap">
          <h3 className="group-title">Сеть</h3>
          <Card className="settings-list">
            <Row title="TUN-режим" hint="Весь трафик системы через Halo, нужен для правил приложений">
              <Toggle on={s.tun} onChange={(tun) => set({ tun })} />
            </Row>
            <ServiceRow />
            <Row title="Системный прокси" hint="Для браузеров и приложений">
              <Toggle on={s.systemProxy} onChange={(systemProxy) => set({ systemProxy })} />
            </Row>
            <Row title="Разрешить LAN" hint="Раздавать прокси в локальную сеть">
              <Toggle on={s.allowLan} onChange={(allowLan) => set({ allowLan })} />
            </Row>
            <Row title="Смешанный порт" hint="HTTP и SOCKS5 на одном порту">
              <input
                className="field mono"
                style={{ width: 90 }}
                value={port ?? String(s.mixedPort)}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                onBlur={() => {
                  const n = Number(port);
                  if (port !== null && n > 1023 && n < 65536) set({ mixedPort: n });
                  setPort(null);
                }}
              />
            </Row>
            <Row title="Блокировать рекламу" hint="Список category-ads-all">
              <Toggle on={s.adblock} onChange={(adblock) => set({ adblock })} />
            </Row>
          </Card>
        </div>

        <div className="col gap">
          <h3 className="group-title">DNS</h3>
          <Card className="settings-list" delay={0.04}>
            <Row title="Режим">
              <Segmented
                size="sm"
                value={s.dnsMode}
                options={[
                  { value: 'fake-ip', label: 'fake-ip' },
                  { value: 'redir-host', label: 'redir-host' },
                ]}
                onChange={(dnsMode) => set({ dnsMode })}
              />
            </Row>
            <Row title="DoH для заблокированных" hint="Запросы идут внутри туннеля">
              <input
                className="field mono"
                style={{ width: 230 }}
                value={doh ?? s.doh}
                onChange={(e) => setDoh(e.target.value)}
                onBlur={() => {
                  if (doh && /^https:\/\//.test(doh)) set({ doh });
                  setDoh(null);
                }}
              />
            </Row>
          </Card>

          <h3 className="group-title">Запуск</h3>
          <Card className="settings-list" delay={0.08}>
            <Row title="Запускать вместе с Windows" hint="Halo стартует при входе в систему">
              <Toggle on={s.launchAtLogin} onChange={(launchAtLogin) => set({ launchAtLogin })} />
            </Row>
            <Row title="Подключаться при запуске" hint="VPN включается сам, без нажатия кнопки">
              <Toggle on={s.autoConnect} onChange={(autoConnect) => set({ autoConnect })} />
            </Row>
            <Row title="Запускать свёрнутым в трей" hint="Окно не открывается — Halo тихо работает в трее">
              <Toggle on={s.startHidden} onChange={(startHidden) => set({ startHidden })} />
            </Row>
          </Card>

          <h3 className="group-title">Приложение</h3>
          <Card className="settings-list" delay={0.1}>
            <Row title="Ядро">
              <span className="field">{state.coreVersion}</span>
            </Row>
          </Card>

          <h3 className="group-title">Обход блокировок</h3>
          <Card className="settings-list" delay={0.12}>
            <Row title="Обновлять списки ежедневно">
              <Toggle on={s.autoUpdateLists} onChange={(autoUpdateLists) => set({ autoUpdateLists })} />
            </Row>
            <Row title="Источник списков">
              <span className="field">runetfreedom (РКН + геоблок)</span>
            </Row>
          </Card>
        </div>
      </div>
      <CoreLogs />
    </div>
  );
}

/** Последние строки журнала ядра — чтобы понять, почему не подключается. */
function CoreLogs() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<{ t: number; line: string }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    halo.call<{ t: number; line: string }[]>('core:logs').then((l) => setLines(l.slice(-200)));
    return halo.onLog((l) => setLines((prev) => [...prev.slice(-199), l]));
  }, [open]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines]);
  const clean = (line: string) => line.replace(/^time="[^"]+"\s*/, '').replace(/^level=/, '');
  return (
    <div className="col gap">
      <div className="row-between">
        <h3 className="group-title">Журнал ядра</h3>
        <button className="link" onClick={() => setOpen(!open)}>
          {open ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      {open && (
        <div className="card logs" ref={box}>
          {lines.length ? lines.map((l, i) => <div key={i} className={/level=(error|fatal)/.test(l.line) ? 'orange' : /level=warn/.test(l.line) ? 'accent' : ''}>{clean(l.line)}</div>) : <span className="muted">Пусто — ядро ещё не запускалось</span>}
        </div>
      )}
    </div>
  );
}

function ServiceRow() {
  const { state, toast } = useHalo();
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const sv = state.service;
  const act = async (channel: string, done: string) => {
    setBusy(true);
    try {
      await halo.call(channel);
      toast(done);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hint = !sv.installed
    ? 'Не установлена — TUN требует запуска от администратора'
    : !sv.running
      ? `Установлена, но не отвечает${sv.error ? `: ${sv.error}` : ''}`
      : sv.outdated
        ? 'Работает, есть обновление (новое ядро или служба)'
        : 'Работает — TUN включается без прав администратора';
  return (
    <Row title="Служба Halo" hint={hint}>
      <div style={{ display: 'flex', gap: 8 }}>
        {sv.installed && (
          <button className="btn sm" disabled={busy} onClick={() => act('service:uninstall', 'Служба Halo удалена')}>
            Удалить
          </button>
        )}
        {(!sv.installed || !sv.running || sv.outdated) && (
          <button className="btn btn-accent sm" disabled={busy} onClick={() => act('service:install', 'Служба Halo установлена')}>
            {busy ? 'Ждём Windows…' : sv.installed ? 'Переустановить' : 'Установить службу'}
          </button>
        )}
      </div>
    </Row>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="grow col">
        <span className="setting-title">{title}</span>
        {hint && <span className="muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
