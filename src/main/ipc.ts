import { dialog, ipcMain, shell, clipboard, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { NO_EXECUTE } from '../shared/rules'
import type { Bootstrap, Settings } from '../shared/types'
import { convertToPdf } from './office'
import { Library } from './store'

export interface Host {
  getLibrary: () => Library | null
  setLibrary: (library: Library) => void
  getWindow: () => BrowserWindow | null
  getSettings: () => Settings
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  openDefault: () => Promise<Library>
  version: string
}

function libraryOf(host: Host): Library {
  const library = host.getLibrary()
  if (!library) throw new Error('知识数据还没有打开')
  return library
}

function bootstrap(host: Host, library: Library): Bootstrap {
  const snap = library.snapshot()
  return {
    dataDir: library.root,
    version: host.version,
    menus: snap.menus,
    summaries: snap.summaries,
    settings: host.getSettings(),
    repairs: [...library.repairs]
  }
}

async function pickDirectory(host: Host, title: string): Promise<string | null> {
  const options: OpenDialogOptions = { title, properties: ['openDirectory'] }
  const win = host.getWindow()
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
}

export function registerIpc(host: Host): void {
  const handlers: Record<string, (args: any) => Promise<unknown>> = {
    bootstrap: async () => {
      try {
        const library = await host.openDefault()
        host.setLibrary(library)
        return bootstrap(host, library)
      } catch (error) {
        return { error: error instanceof Error ? error.message : '无法打开知识数据', settings: host.getSettings() }
      }
    },
    saveSettings: async (patch: Partial<Settings>) => host.saveSettings(patch),
    snapshot: async () => libraryOf(host).snapshot(),
    createMenu: async (args: { parentId: string | null; name: string }) => libraryOf(host).createMenu(args.parentId, args.name),
    renameMenu: async (args: { id: string; name: string }) => libraryOf(host).renameMenu(args.id, args.name),
    moveMenu: async (args: { id: string; parentId: string | null; index: number }) => {
      await libraryOf(host).moveMenu(args.id, args.parentId, args.index)
    },
    menuImpact: async (args: { id: string }) => libraryOf(host).menuImpact(args.id),
    deleteMenu: async (args: { id: string }) => {
      await libraryOf(host).deleteMenu(args.id)
    },
    createNote: async (args: { menuId: string }) => libraryOf(host).createNote(args.menuId),
    getNote: async (args: { id: string }) => libraryOf(host).getNote(args.id),
    saveNote: async (args: { id: string; title: string; body: string; tags: string[] }) => libraryOf(host).saveNote(args),
    moveNote: async (args: { id: string; menuId: string }) => {
      await libraryOf(host).moveNote(args.id, args.menuId)
    },
    reorderNotes: async (args: { menuId: string; orderedIds: string[] }) => {
      await libraryOf(host).reorderNotes(args.menuId, args.orderedIds)
    },
    deleteNote: async (args: { id: string }) => {
      await libraryOf(host).deleteNote(args.id)
    },
    batchMove: async (args: { ids: string[]; menuId: string }) => {
      await libraryOf(host).batchMove(args.ids, args.menuId)
    },
    batchDelete: async (args: { ids: string[] }) => {
      await libraryOf(host).batchDelete(args.ids)
    },
    batchTag: async (args: { ids: string[]; tag: string }) => libraryOf(host).batchTag(args.ids, args.tag),
    pickFiles: async () => {
      const options: OpenDialogOptions = { properties: ['openFile', 'multiSelections'] }
      const win = host.getWindow()
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled ? [] : result.filePaths
    },
    addFile: async (args: { noteId: string; sourcePath: string }) => {
      const win = host.getWindow()
      const name = path.basename(args.sourcePath)
      try {
        return await libraryOf(host).addFile(args.noteId, args.sourcePath, (ratio) => {
          win?.webContents.send('kr:progress', { name, ratio })
        })
      } finally {
        win?.webContents.send('kr:progress', null)
      }
    },
    addBytes: async (args: { noteId: string; name: string; bytes: Uint8Array }) =>
      libraryOf(host).addBytes(args.noteId, args.name, args.bytes),
    pasteImage: async (args: { noteId: string }) => {
      const items = await clipboard.read()
      for (const item of items) {
        const type = item.types.find((entry) => entry.startsWith('image/'))
        if (!type) continue
        const blob = await item.getType(type)
        if (!(blob instanceof Blob)) continue
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const ext = type.includes('jpeg') || type.includes('jpg') ? '.jpg' : '.png'
        return libraryOf(host).addBytes(args.noteId, `粘贴图片-${Date.now()}${ext}`, bytes)
      }
      return null
    },
    removeAttachment: async (args: { noteId: string; attachmentId: string }) =>
      libraryOf(host).removeAttachment(args.noteId, args.attachmentId),
    renameAttachment: async (args: { noteId: string; attachmentId: string; name: string }) =>
      libraryOf(host).renameAttachment(args.noteId, args.attachmentId, args.name),
    readUtf8: async (args: { filePath: string }) => libraryOf(host).readUtf8(args.filePath),
    readPreview: async (args: { noteId: string; attachmentId: string }) =>
      libraryOf(host).readPreview(args.noteId, args.attachmentId),
    openAttachment: async (args: { noteId: string; attachmentId: string }) => {
      const library = libraryOf(host)
      const file = library.attachmentFile(args.noteId, args.attachmentId)
      if (NO_EXECUTE.has(path.extname(file).toLowerCase())) throw new Error('为避免执行程序，此文件不能从应用内启动，可以另存为后再处理')
      const error = await shell.openPath(file)
      if (error) throw new Error(error || '当前没有能打开此文件的程序，文件仍保留在知识点中')
    },
    revealAttachment: async (args: { noteId: string; attachmentId: string }) => {
      const file = libraryOf(host).attachmentFile(args.noteId, args.attachmentId)
      shell.showItemInFolder(file)
    },
    saveAttachmentAs: async (args: { noteId: string; attachmentId: string }) => {
      const library = libraryOf(host)
      const file = library.attachmentFile(args.noteId, args.attachmentId)
      const note = await library.getNote(args.noteId)
      const attachment = note.attachments.find((item) => item.id === args.attachmentId)
      const options: SaveDialogOptions = { defaultPath: attachment?.name ?? path.basename(file) }
      const win = host.getWindow()
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return
      await fs.copyFile(file, result.filePath)
    },
    previewOffice: async (args: { noteId: string; attachmentId: string }) => {
      const library = libraryOf(host)
      const source = library.attachmentFile(args.noteId, args.attachmentId)
      const cache = path.join(library.root, '.cache')
      const pdf = path.join(cache, `${args.attachmentId}.pdf`)
      const sourceStat = await fs.stat(source)
      let fresh = false
      try {
        const pdfStat = await fs.stat(pdf)
        fresh = pdfStat.mtimeMs >= sourceStat.mtimeMs && pdfStat.size > 0
      } catch {
        fresh = false
      }
      if (!fresh) await convertToPdf(source, cache)
      return { ok: true as const, url: `kr-asset://preview/${args.attachmentId}/pdf` }
    },
    search: async (args: { text: string }) => libraryOf(host).search(args.text),
    listTrash: async () => libraryOf(host).listTrash(),
    restore: async (args: { id: string }) => libraryOf(host).restore(args.id),
    purge: async (args: { id: string }) => {
      await libraryOf(host).purge(args.id)
    },
    emptyTrash: async () => {
      await libraryOf(host).emptyTrash()
    },
    revealDataDir: async () => {
      const error = await shell.openPath(libraryOf(host).root)
      if (error) throw new Error(error)
    },
    exportBackup: async () => {
      const parent = await pickDirectory(host, '选择备份保存位置')
      if (!parent) return null
      return libraryOf(host).exportTo(parent)
    },
    importBackup: async (args: { mode: 'skip' | 'copy' }) => {
      const parent = await pickDirectory(host, '选择要导入的知识数据目录')
      if (!parent) return null
      return libraryOf(host).importFrom(parent, args.mode)
    },
    switchDataDir: async () => {
      const picked = await pickDirectory(host, '打开知识数据目录')
      if (!picked) return null
      const next = await Library.open(picked)
      host.setLibrary(next)
      await host.saveSettings({ dataDir: picked, selectedMenuId: null, selectedNoteId: null })
      return bootstrap(host, next)
    },
    useDefaultDir: async () => {
      await host.saveSettings({ dataDir: null, selectedMenuId: null, selectedNoteId: null })
      const library = await host.openDefault()
      host.setLibrary(library)
      return bootstrap(host, library)
    },
    health: async () => libraryOf(host).health()
  }

  ipcMain.handle('kr:call', async (_event, method: unknown, args: unknown) => {
    if (typeof method !== 'string') throw new Error('未知操作')
    const handler = handlers[method]
    if (!handler) throw new Error('未知操作')
    return handler(args)
  })
}
