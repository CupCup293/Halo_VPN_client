// Подписки: карточки с остатком трафика и сроком, импорт ссылкой, автообновление.
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import type { Profile } from '../api';
import { Card, Flag, Icon, Toggle, itemVariants, listVariants } from '../components/ui';
import { useHalo } from '../store';
import { countryCode, formatBytes, formatDate, protocolLabel, timeAgo } from '../util';

export function Profiles() {
  const { state, run, toast } = useHalo();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  function saveName() {
    if (renaming?.name.trim()) run('profile:rename', renaming.id, renaming.name);
    setRenaming(null);
  }

  if (!state) return null;
  const s = state.settings;

  // В поле можно вставить сразу несколько ссылок — через пробел или с новой строки.
  async function importUrl(raw = url) {
    // Пустое поле — берём ссылку из буфера обмена.
    if (!raw.trim()) raw = (await run<string>('clipboard:read')) || '';
    const known = new Set(state!.profiles.map((p) => p.url));
    const links = [...new Set(raw.match(/https?:\/\/\S+/gi) || [])].filter((u) => !known.has(u));
    if (!links.length) {
      return toast(raw.trim() && /https?:\/\//i.test(raw) ? 'Эта подписка уже добавлена' : 'Вставьте ссылку подписки, начинающуюся с http:// или https://');
    }
    setBusy(true);
    let added = 0;
    for (const u of links) if (await run<string>('profile:add', u)) added++;
    setBusy(false);
    if (added) {
      setUrl('');
      toast(added === 1 ? 'Подписка добавлена' : `Добавлено подписок: ${added} из ${links.length}`);
    }
  }

  async function pasteClipboard() {
    try {
      const text = (await run<string>('clipboard:read')) || '';
      if (/https?:\/\//i.test(text)) setUrl(text.trim());
    } catch {
      /* нет доступа к буферу */
    }
  }

  async function update(id: string) {
    setUpdating(id);
    await run('profile:update', id);
    setUpdating(null);
  }

  async function updateAll() {
    setUpdating('all');
    await run('profile:updateAll');
    setUpdating(null);
  }

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>Подписки</h1>
        <span className="spacer" />
        {state.profiles.length > 0 && (
          <button className="btn" onClick={updateAll} disabled={!!updating}>
            {updating === 'all' ? <span className="spinner" /> : <Icon name="refresh" size={15} />} Обновить все
          </button>
        )}
      </header>

      <motion.div className="profile-grid" variants={listVariants} initial="hidden" animate="show">
        <AnimatePresence>
          {state.profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              active={p.id === state.activeProfileId}
              updating={updating}
              renaming={renaming}
              setRenaming={setRenaming}
              saveName={saveName}
              onUpdate={update}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      <Card className="import" delay={0.08}>
        <Icon name="link" size={28} className="accent" />
        <div className="grow col">
          <b>Вставьте ссылку подписки</b>
          <input
            className="import-input"
            value={url}
            onFocus={() => !url && pasteClipboard()}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importUrl()}
            placeholder="Вставьте ссылку (Ctrl+V) или просто нажмите «Импорт» — возьмём из буфера"
          />
        </div>
        <button className="btn btn-accent" onClick={() => importUrl()} disabled={busy}>
          {busy ? <span className="spinner dark" /> : null} Импорт
        </button>
      </Card>

      <Card className="settings-list" delay={0.12}>
        <div className="setting">
          <span className="grow">Автообновление каждые {s.updateSubsHours} ч</span>
          <Toggle on={s.updateSubsHours > 0} onChange={(on) => run('settings:set', { updateSubsHours: on ? 12 : 0 })} />
        </div>
        <div className="setting">
          <div className="grow col">
            <span>Обновлять через VPN</span>
            <span className="muted">Если сайт подписки заблокирован напрямую</span>
          </div>
          <Toggle on={s.updateViaProxy} onChange={(updateViaProxy) => run('settings:set', { updateViaProxy })} />
        </div>
      </Card>
    </div>
  );
}

function ProfileCard({
  profile: p,
  active,
  updating,
  renaming,
  setRenaming,
  saveName,
  onUpdate,
}: {
  profile: Profile;
  active: boolean;
  updating: string | null;
  renaming: { id: string; name: string } | null;
  setRenaming: (r: { id: string; name: string } | null) => void;
  saveName: () => void;
  onUpdate: (id: string) => void;
}) {
  const { run, toast } = useHalo();
  const used = p.usage ? p.usage.upload + p.usage.download : 0;
  const total = p.usage?.total || 0;
  const left = total ? Math.max(0, total - used) : 0;
  const pct = total ? Math.min(100, (used / total) * 100) : 0;
  const days = p.usage?.expire ? Math.ceil((p.usage.expire - Date.now()) / 864e5) : null;
  // Срок «через 100 лет» у некоторых провайдеров означает бессрочную подписку.
  const forever = days === null || days > 3650;

  const countries = new Map<string, number>();
  for (const n of p.nodes) {
    const c = countryCode(n.name);
    countries.set(c, (countries.get(c) || 0) + 1);
  }
  const byCount = [...countries.entries()].sort((a, b) => b[1] - a[1]);
  const protocols = new Map<string, number>();
  for (const n of p.nodes) {
    const label = protocolLabel(n);
    protocols.set(label, (protocols.get(label) || 0) + 1);
  }

  async function copyLink() {
    await run('clipboard:write', p.url);
    toast('Ссылка подписки скопирована');
  }

  return (
    <motion.div className={`profile ${active ? 'active' : ''}`} variants={itemVariants} exit={{ opacity: 0, scale: 0.95 }} layout onClick={() => !active && run('profile:select', p.id)}>
      <div className="profile-head">
        <div className="flag-stack">
          {byCount.slice(0, 3).map(([code]) => (
            <Flag key={code} code={code} size="lg" />
          ))}
        </div>
        <div className="grow col">
          {renaming?.id === p.id ? (
            <input
              className="rename-input"
              autoFocus
              value={renaming.name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenaming({ id: p.id, name: e.target.value })}
              onBlur={saveName}
              onKeyDown={(e) => (e.key === 'Enter' ? saveName() : e.key === 'Escape' && setRenaming(null))}
            />
          ) : (
            <b
              className="profile-name ellipsis"
              title="Дважды щёлкните, чтобы переименовать"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenaming({ id: p.id, name: p.name });
              }}
            >
              {p.name}
            </b>
          )}
          <span className="muted sm-text">
            {p.format} · обновлено {timeAgo(p.updatedAt)}
          </span>
        </div>
        {active ? <span className="badge">Активна</span> : <span className="badge soft hover-hint">Выбрать</span>}
      </div>

      <div className="profile-stats">
        <div>
          <span className="muted">Осталось</span>
          <b className="mono">{total ? formatBytes(left) : '∞'}</b>
        </div>
        <div>
          <span className="muted">Дней</span>
          <b className={`mono ${!forever && days! <= 3 ? 'orange' : ''}`}>{forever ? '∞' : Math.max(0, days!)}</b>
        </div>
        <div>
          <span className="muted">Серверов</span>
          <b className="mono">{p.nodes.length}</b>
        </div>
      </div>

      <div className="col">
        <div className={`bar ${total ? '' : 'striped'}`}>
          {total > 0 && <motion.div className={`bar-fill ${pct > 90 ? 'warn' : ''}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} />}
        </div>
        <div className="row-between sm-text muted">
          <span>{total ? `Использовано ${formatBytes(used)} из ${formatBytes(total)}` : 'Трафик без ограничений'}</span>
          <span>{forever ? 'Без срока' : `До ${formatDate(p.usage!.expire)}`}</span>
        </div>
      </div>

      <div className="country-row">
        {byCount.slice(0, 10).map(([code, n]) => (
          <span key={code} className="country-chip" title={`${code}: ${n}`}>
            <Flag code={code} size="sm" />
            {n > 1 && <span className="muted">{n}</span>}
          </span>
        ))}
        {byCount.length > 10 && <span className="muted sm-text">+{byCount.length - 10} стран</span>}
      </div>

      <div className="proto-row">
        {[...protocols.entries()].map(([label, n]) => (
          <span key={label} className="proto-chip">
            {label} <span className="muted">{n}</span>
          </span>
        ))}
      </div>

      <div className="profile-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn sm" onClick={() => onUpdate(p.id)} disabled={!!updating}>
          {updating === p.id ? <span className="spinner" /> : <Icon name="refresh" size={14} />} Обновить
        </button>
        <button className="btn sm" onClick={copyLink}>
          <Icon name="link" size={14} /> Ссылка
        </button>
        {p.supportUrl && (
          <button className="btn sm" onClick={() => run('open:external', p.supportUrl)}>
            Поддержка
          </button>
        )}
        <span className="spacer" />
        <button className="icon-btn" title="Удалить" onClick={() => confirm(`Удалить подписку «${p.name}»?`) && run('profile:remove', p.id)}>
          <Icon name="trash" size={15} />
        </button>
      </div>
    </motion.div>
  );
}
