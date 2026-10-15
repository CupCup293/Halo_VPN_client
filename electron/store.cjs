// Простое JSON-хранилище состояния в папке userData.
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS, DEFAULT_CATEGORIES } = require('./config.cjs');

const EMPTY = {
  profiles: [], // { id, name, url, format, proxies, usage, updatedAt, supportUrl }
  activeProfileId: null,
  settings: DEFAULT_SETTINGS,
  appRules: [], // { process, name, action: vpn|rules|direct|block }
  userSites: [], // { domain, action: vpn|direct }
};

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'halo-state.json');
    this.data = structuredClone(EMPTY);
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        ...this.data,
        ...saved,
        settings: { ...DEFAULT_SETTINGS, ...saved.settings, categories: { ...DEFAULT_CATEGORIES, ...saved.settings?.categories } },
      };
    } catch {
      /* первый запуск */
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  get activeProfile() {
    return this.data.profiles.find((p) => p.id === this.data.activeProfileId) || null;
  }
}

module.exports = { Store };
