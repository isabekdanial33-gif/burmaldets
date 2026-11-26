// Мост между веб-ядром Гудвина и Windows. Веб видит только window.bmDesk — без доступа к Node.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bmDesk', {
  fetch: (url, o, timeoutMs) => ipcRenderer.invoke('bm:fetch', url, o, timeoutMs),
  call: (method, args) => ipcRenderer.invoke('bm:call', method, args),
  tts: (text, voice, rate) => ipcRenderer.invoke('bm:tts', text, voice, rate),
  piper: (text) => ipcRenderer.invoke('bm:piper', text),
})
// только для шара на рабочем столе
contextBridge.exposeInMainWorld('bmOrb', {
  down: () => ipcRenderer.send('orb:down'),
  move: () => ipcRenderer.send('orb:move'),
  up: () => ipcRenderer.send('orb:up'),
  menu: () => ipcRenderer.send('orb:menu'),
  onPhase: (f) => ipcRenderer.on('bm:phase', (_e, p) => f(p)),
})
