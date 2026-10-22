import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { KrApi } from '../shared/bridge'

const api: KrApi = {
  bootstrap: () => ipcRenderer.invoke('kr:call', 'bootstrap'),
  saveSettings: (patch) => ipcRenderer.invoke('kr:call', 'saveSettings', patch),
  snapshot: () => ipcRenderer.invoke('kr:call', 'snapshot'),
  createMenu: (parentId, name) => ipcRenderer.invoke('kr:call', 'createMenu', { parentId, name }),
  renameMenu: (id, name) => ipcRenderer.invoke('kr:call', 'renameMenu', { id, name }),
  moveMenu: (id, parentId, index) => ipcRenderer.invoke('kr:call', 'moveMenu', { id, parentId, index }),
  menuImpact: (id) => ipcRenderer.invoke('kr:call', 'menuImpact', { id }),
  deleteMenu: (id) => ipcRenderer.invoke('kr:call', 'deleteMenu', { id }),
  createNote: (menuId) => ipcRenderer.invoke('kr:call', 'createNote', { menuId }),
  getNote: (id) => ipcRenderer.invoke('kr:call', 'getNote', { id }),
  saveNote: (input) => ipcRenderer.invoke('kr:call', 'saveNote', input),
  moveNote: (id, menuId) => ipcRenderer.invoke('kr:call', 'moveNote', { id, menuId }),
  reorderNotes: (menuId, orderedIds) => ipcRenderer.invoke('kr:call', 'reorderNotes', { menuId, orderedIds }),
  deleteNote: (id) => ipcRenderer.invoke('kr:call', 'deleteNote', { id }),
  batchMove: (ids, menuId) => ipcRenderer.invoke('kr:call', 'batchMove', { ids, menuId }),
  batchDelete: (ids) => ipcRenderer.invoke('kr:call', 'batchDelete', { ids }),
  batchTag: (ids, tag) => ipcRenderer.invoke('kr:call', 'batchTag', { ids, tag }),
  pickFiles: () => ipcRenderer.invoke('kr:call', 'pickFiles'),
  addFile: (noteId, sourcePath) => ipcRenderer.invoke('kr:call', 'addFile', { noteId, sourcePath }),
  addBytes: (noteId, name, bytes) => ipcRenderer.invoke('kr:call', 'addBytes', { noteId, name, bytes }),
  pasteImage: (noteId) => ipcRenderer.invoke('kr:call', 'pasteImage', { noteId }),
  removeAttachment: (noteId, attachmentId) => ipcRenderer.invoke('kr:call', 'removeAttachment', { noteId, attachmentId }),
  renameAttachment: (noteId, attachmentId, name) => ipcRenderer.invoke('kr:call', 'renameAttachment', { noteId, attachmentId, name }),
  readUtf8: (filePath) => ipcRenderer.invoke('kr:call', 'readUtf8', { filePath }),
  readPreview: (noteId, attachmentId) => ipcRenderer.invoke('kr:call', 'readPreview', { noteId, attachmentId }),
  openAttachment: (noteId, attachmentId) => ipcRenderer.invoke('kr:call', 'openAttachment', { noteId, attachmentId }),
  revealAttachment: (noteId, attachmentId) => ipcRenderer.invoke('kr:call', 'revealAttachment', { noteId, attachmentId }),
  saveAttachmentAs: (noteId, attachmentId) => ipcRenderer.invoke('kr:call', 'saveAttachmentAs', { noteId, attachmentId }),
  previewOffice: (noteId, attachmentId) => ipcRenderer.invoke('kr:call', 'previewOffice', { noteId, attachmentId }),
  search: (text) => ipcRenderer.invoke('kr:call', 'search', { text }),
  listTrash: () => ipcRenderer.invoke('kr:call', 'listTrash'),
  restore: (id) => ipcRenderer.invoke('kr:call', 'restore', { id }),
  purge: (id) => ipcRenderer.invoke('kr:call', 'purge', { id }),
  emptyTrash: () => ipcRenderer.invoke('kr:call', 'emptyTrash'),
  revealDataDir: () => ipcRenderer.invoke('kr:call', 'revealDataDir'),
  exportBackup: () => ipcRenderer.invoke('kr:call', 'exportBackup'),
  importBackup: (mode) => ipcRenderer.invoke('kr:call', 'importBackup', { mode }),
  switchDataDir: () => ipcRenderer.invoke('kr:call', 'switchDataDir'),
  useDefaultDir: () => ipcRenderer.invoke('kr:call', 'useDefaultDir'),
  health: () => ipcRenderer.invoke('kr:call', 'health'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (callback) => {
    const listener = (_event: unknown, payload: { name: string; ratio: number } | null) => callback(payload)
    ipcRenderer.on('kr:progress', listener)
    return () => ipcRenderer.removeListener('kr:progress', listener)
  },
  onRequestClose: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('kr:request-close', listener)
    return () => ipcRenderer.removeListener('kr:request-close', listener)
  },
  closeReady: () => ipcRenderer.send('kr:close-ready')
}

contextBridge.exposeInMainWorld('api', api)
