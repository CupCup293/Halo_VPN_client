// Типы состояния и обёртка над window.halo (preload).

export type Mode = 'blocked' | 'except-ru' | 'global' | 'direct';
export type AppAction = 'vpn' | 'rules' | 'direct' | 'block';

export interface Settings {
  mode: Mode;
  tun: boolean;
  systemProxy: boolean;
  mixedPort: number;
  allowLan: boolean;
  dnsMode: 'fake-ip' | 'redir-host';
  doh: string;
  categories: Record<string, boolean>;
  otherApps: 'rules' | 'direct';
  adblock: boolean;
  autoUpdateLists: boolean;
  launchAtLogin: boolean;
  autoConnect: boolean;
  startHidden: boolean;
  updateSubsHours: number;
  updateViaProxy: boolean;
}

export interface Node {
  name: string;
  type: string;
  server: string;
  network?: string;
  reality?: boolean;
}

export interface Profile {
  id: string;
  name: string;
  url: string;
  format: string;
  nodes: Node[];
  usage: { upload: number; download: number; total: number; expire: number } | null;
  supportUrl?: string;
  updatedAt: number;
}

export interface AppRule {
  process: string;
  name: string;
  action: AppAction;
  icon?: string;
  path?: string;
}

export interface UserSite {
  domain: string;
  action: 'vpn' | 'direct';
}

export interface Conflict {
  kind: 'client' | 'tun' | 'proxy';
  title: string;
}

export interface IpInfo {
  ip: string;
  country: string;
  city: string;
  code: string;
}

export interface State {
  profiles: Profile[];
  activeProfileId: string | null;
  settings: Settings;
  appRules: AppRule[];
  userSites: UserSite[];
  categories: Record<string, string>;
  connected: boolean;
  connectedAt: number;
  coreVersion: string;
  service: ServiceInfo;
  conflicts: Conflict[];
}

/** Служба Halo Service: запускает ядро с правами SYSTEM, чтобы TUN работал без администратора. */
export interface ServiceInfo {
  installed: boolean;
  running: boolean;
  outdated: boolean;
  error?: string;
}

export interface Traffic {
  up: number;
  down: number;
}

export interface Connection {
  id: string;
  metadata: { host: string; destinationIP: string; destinationPort: string; process?: string; network: string };
  upload: number;
  download: number;
  start: string;
  chains: string[];
  rule: string;
  rulePayload: string;
}

interface HaloBridge {
  call<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  onState(cb: (s: State) => void): () => void;
  onTraffic(cb: (t: Traffic) => void): () => void;
  onError(cb: (e: { message: string; code?: string }) => void): () => void;
  onLog(cb: (l: { t: number; line: string }) => void): () => void;
  onDelay(cb: (d: { name: string; delay: number }) => void): () => void;
}

declare global {
  interface Window {
    halo: HaloBridge;
  }
}

// Мост читается лениво: в браузере его подставляет демо-режим после загрузки модуля.
export const halo: HaloBridge = new Proxy({} as HaloBridge, { get: (_t, k) => (window.halo as never)[k] });
