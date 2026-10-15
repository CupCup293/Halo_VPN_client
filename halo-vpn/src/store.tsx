// Общее состояние приложения: состояние главного процесса, трафик, уведомления.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { halo, type State, type Traffic } from './api';

export type Screen = 'home' | 'servers' | 'rules' | 'apps' | 'profiles' | 'connections' | 'settings';

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface Ctx {
  state: State | null;
  traffic: Traffic;
  history: { down: number[]; up: number[] };
  screen: Screen;
  go: (s: Screen) => void;
  toasts: Toast[];
  toast: (message: string, action?: Toast['action']) => void;
  closeToast: (id: number) => void;
  run: <T>(channel: string, ...args: unknown[]) => Promise<T | undefined>;
  delays: Record<string, number>;
  setDelays: (d: Record<string, number>) => void;
  currentNode: string | null;
  refreshProxies: () => void;
}

const HaloCtx = createContext<Ctx | null>(null);
const HISTORY = 60;

export function HaloProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(null);
  const [traffic, setTraffic] = useState<Traffic>({ up: 0, down: 0 });
  const [history, setHistory] = useState<{ down: number[]; up: number[] }>({ down: [], up: [] });
  const [screen, setScreen] = useState<Screen>(() => (location.hash.slice(1) as Screen) || 'home');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [delays, setDelays] = useState<Record<string, number>>({});
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const toastId = useRef(0);

  const closeToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (message: string, action?: Toast['action']) => {
      const id = ++toastId.current;
      setToasts((t) => [...t.slice(-2), { id, message, action }]);
      setTimeout(() => closeToast(id), action ? 12000 : 5000);
    },
    [closeToast],
  );

  const adminAction = useMemo(
    () => ({
      label: 'Установить службу',
      run: () =>
        halo
          .call('service:install')
          .then(() => toast('Служба Halo установлена — TUN работает без прав администратора'))
          .catch((e: Error) => toast(e.message)),
    }),
    [toast],
  );

  const run = useCallback(
    async <T,>(channel: string, ...args: unknown[]) => {
      try {
        return await halo.call<T>(channel, ...args);
      } catch (e) {
        const err = e as Error & { code?: string };
        toast(err.message, err.code === 'NEED_ADMIN' ? adminAction : undefined);
        return undefined;
      }
    },
    [toast, adminAction],
  );

  const refreshProxies = useCallback(async () => {
    try {
      const p = await halo.call<{ now: string; auto: string; all: Record<string, { history: { delay: number }[] }> } | null>('proxies:get');
      if (!p) return setCurrentNode(null);
      setCurrentNode(p.now === 'Авто · лучший' ? p.auto : p.now);
      const d: Record<string, number> = {};
      for (const [name, info] of Object.entries(p.all)) {
        // В истории ядра 0 — узел не ответил при последней проверке (таймаут).
        const last = info.history?.at(-1);
        if (last) d[name] = last.delay || 0;
      }
      setDelays((prev) => ({ ...prev, ...d }));
    } catch {
      /* ядро не запущено */
    }
  }, []);

  useEffect(() => {
    halo.call<State>('state:get').then(setState);
    const offs = [
      halo.onState(setState),
      halo.onDelay((d) => setDelays((prev) => ({ ...prev, [d.name]: d.delay }))),
      halo.onTraffic((t) => {
        setTraffic(t);
        setHistory((h) => ({ down: [...h.down, t.down].slice(-HISTORY), up: [...h.up, t.up].slice(-HISTORY) }));
      }),
      halo.onError((e) => toast(e.message, e.code === 'NEED_ADMIN' ? adminAction : undefined)),
    ];
    return () => offs.forEach((f) => f());
  }, [toast, adminAction]);

  useEffect(() => {
    if (!state?.connected) {
      setTraffic({ up: 0, down: 0 });
      setHistory({ down: [], up: [] });
      setCurrentNode(null);
      return;
    }
    refreshProxies();
    const t = setInterval(refreshProxies, 5000);
    return () => clearInterval(t);
  }, [state?.connected, refreshProxies]);

  const value: Ctx = { state, traffic, history, screen, go: setScreen, toasts, toast, closeToast, run, delays, setDelays, currentNode, refreshProxies };
  return <HaloCtx.Provider value={value}>{children}</HaloCtx.Provider>;
}

export function useHalo() {
  const c = useContext(HaloCtx);
  if (!c) throw new Error('useHalo вне HaloProvider');
  return c;
}
