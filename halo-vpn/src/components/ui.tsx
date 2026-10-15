// Общие элементы интерфейса: иконки, переключатель, сегменты, флаг, график.
import { motion, AnimatePresence } from 'framer-motion';
import { useId, type ComponentType, type ReactNode } from 'react';
import * as Flags from 'country-flag-icons/react/3x2';
import { countryCode } from '../util';

const ICONS: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5" />
    </>
  ),
  apps: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  cloud: <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  check: <path d="m5 12 5 5L20 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.9-4M4 4v4h4M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  warning: <path d="M12 3 2 20h20zM12 10v4M12 17h.01" />,
};

export function Icon({ name, size = 18, className }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!on)} aria-pressed={on}>
      <motion.span className="knob" layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  accent,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  accent?: boolean;
}) {
  const id = useId();
  return (
    <div className={`segmented ${size}`}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.value === value && (
            <motion.span layoutId={`seg-${id}`} className={`thumb ${accent ? 'accent' : ''}`} transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
          )}
          <span className="label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Флаг страны узла: SVG (Windows не рисует эмодзи-флаги), без страны — буквенный значок. */
export function Flag({ name, code, active, size = 'md' }: { name?: string; code?: string; active?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const cc = (code || countryCode(name || '')).replace('UK', 'GB');
  const Svg = (Flags as Record<string, ComponentType<{ title?: string; className?: string }>>)[cc];
  if (!Svg) return <span className={`flag ${active ? 'active' : ''}`}>{cc === '··' ? '?' : cc}</span>;
  return (
    <span className={`flag-icon ${size} ${active ? 'active' : ''}`} title={cc}>
      <Svg />
    </span>
  );
}

/** Плавный график двух серий (загрузка/отдача) по последним точкам. */
export function Sparkline({ down, up, height = 56 }: { down: number[]; up: number[]; height?: number }) {
  const w = 600;
  const max = Math.max(1, ...down, ...up) * 1.15;
  const pts = (arr: number[]) =>
    arr.map((v, i) => `${((i / Math.max(1, arr.length - 1)) * w).toFixed(1)},${(height - (v / max) * (height - 4) - 2).toFixed(1)}`).join(' L');
  const area = down.length > 1 ? `M0,${height} L${pts(down)} L${w},${height} Z` : '';
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
      {area && <path d={area} className="spark-area" />}
      {down.length > 1 && <path d={`M${pts(down)}`} className="spark-down" />}
      {up.length > 1 && <path d={`M${pts(up)}`} className="spark-up" />}
    </svg>
  );
}

export function Card({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <div className={`card rise ${className}`} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

// Появление списков делает CSS (.stagger > * в styles.css); варианты оставлены пустыми,
// чтобы содержимое никогда не зависло невидимым.
export const listVariants = { hidden: {}, show: {} };
export const itemVariants = { hidden: {}, show: {} };

export function Toasts({ items, onClose }: { items: { id: number; message: string; action?: { label: string; run: () => void } }[]; onClose: (id: number) => void }) {
  return (
    <div className="toasts">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <Icon name="warning" size={18} className="toast-icon" />
            <span>{t.message}</span>
            {t.action && (
              <button className="btn btn-accent sm" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
            <button className="icon-btn" onClick={() => onClose(t.id)}>
              <Icon name="x" size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
