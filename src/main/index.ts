import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { mimeOf } from '../shared/rules'
import { defaultSettings, type Settings } from '../shared/types'
import { registerIpc } from './ipc'
import { readSettings, writeSettings } from './settings'
import { Library } from './store'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'kr-asset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainWindow: BrowserWindow | null = null
let library: Library | null = null
let settings: Settings = defaultSettings()
let allowClose = false

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function defaultDataDir(): string {
  return join(app.getPath('userData'), 'library')
}

async function openDefault(): Promise<Library> {
  const dir = settings.dataDir || defaultDataDir()
  const opened = await Library.init(dir)
  if (!settings.dataDir) {
    settings = { ...settings, dataDir: opened.root }
    await writeSettings(settingsFile(), settings)
  }
  library = opened
  return opened
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: '知识点记录',
    backgroundColor: '#f4f4f5',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow = win
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    win.webContents.send('kr:request-close')
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

async function readAsset(file: string, request: Request): Promise<Response> {
  const data = await readFile(file)
  const mime = file.endsWith('.pdf') ? 'application/pdf' : mimeOf(file.slice(file.lastIndexOf('.')))
  const range = request.headers.get('range')
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': mime }
  if (!range) return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Length': String(data.length) } })
  const matched = /bytes=(\d+)-(\d*)/.exec(range)
  if (!matched) return new Response(new Uint8Array(data), { headers })
  const start = Number(matched[1])
  const end = matched[2] ? Number(matched[2]) : data.length - 1
  if (start >= data.length || end < start) return new Response(null, { status: 416 })
  const slice = data.subarray(start, end + 1)
  return new Response(new Uint8Array(slice), {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${data.length}`,
      'Content-Length': String(slice.length)
    }
  })
}

if (gotLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    settings = await readSettings(settingsFile())
    protocol.handle('kr-asset', async (request) => {
      if (!library) return new Response('missing', { status: 404 })
      try {
        const url = new URL(request.url)
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
        if (url.hostname === 'local' && parts.length === 2) {
          const file = library.resolveAsset(parts[0], parts[1])
          await stat(file)
          return readAsset(file, request)
        }
        if (url.hostname === 'preview' && parts.length >= 1) {
          const file = library.resolvePreview(parts[0])
          await stat(file)
          return readAsset(file, request)
        }
        return new Response('bad', { status: 400 })
      } catch {
        return new Response('missing', { status: 404 })
      }
    })

    registerIpc({
      getLibrary: () => library,
      setLibrary: (next) => {
        library = next
      },
      getWindow: () => mainWindow,
      getSettings: () => settings,
      saveSettings: async (patch) => {
        settings = { ...settings, ...patch, menuWidth: clamp(patch.menuWidth ?? settings.menuWidth, 200, 480), listWidth: clamp(patch.listWidth ?? settings.listWidth, 240, 520) }
        await writeSettings(settingsFile(), settings)
        return settings
      },
      openDefault,
      version: app.getVersion()
    })

    createWindow()
  })

  app.on('window-all-closed', () => app.quit())

  ipcMain.on('kr:close-ready', () => {
    allowClose = true
    mainWindow?.close()
  })
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
