// Мост между интерфейсом и главным процессом: window.halo.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) {
    const err = new Error(r.error);
    err.code = r.code;
    throw err;
  }
  return r.data;
}

function on(channel, cb) {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

contextBridge.exposeInMainWorld('halo', {
  call,
  onState: (cb) => on('state', cb),
  onTraffic: (cb) => on('traffic', cb),
  onError: (cb) => on('error', cb),
  onLog: (cb) => on('log', cb),
  onDelay: (cb) => on('delay', cb),
});
