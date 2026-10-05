/**
 * Exposes `window.overtime` to both windows. The renderers never touch Node
 * or Electron directly; everything goes through these channels.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS, type OvertimeApi } from '../shared/ipc';

/** Subscribe to a push channel and hand back an unsubscribe function. */
function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: OvertimeApi = {
  getState: () => ipcRenderer.invoke(CHANNELS.getState),
  onState: (cb) => listen(CHANNELS.state, cb),
  onEffect: (cb) => listen(CHANNELS.effect, cb),
  onOfficeTab: (cb) => listen(CHANNELS.officeTab, cb),
  act: (action) => ipcRenderer.invoke(CHANNELS.act, action),
  chat: (text) => ipcRenderer.invoke(CHANNELS.chat, text),
  hire: (id) => ipcRenderer.invoke(CHANNELS.hire, id),
  rerollCandidates: () => ipcRenderer.invoke(CHANNELS.rerollCandidates),
  assign: (id) => ipcRenderer.invoke(CHANNELS.assign, id),
  openOffice: (tab) => ipcRenderer.send(CHANNELS.openOffice, tab),
  openPath: (path) => ipcRenderer.send(CHANNELS.openPath, path),
  setInteractive: (on) => ipcRenderer.send(CHANNELS.setInteractive, on),
  updateSettings: (patch) =>
    ipcRenderer.invoke(CHANNELS.updateSettings, patch),
  testClaude: () => ipcRenderer.invoke(CHANNELS.testClaude),
};

contextBridge.exposeInMainWorld('overtime', api);
