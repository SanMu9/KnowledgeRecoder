import type {
  Attachment,
  Bootstrap,
  ExportResult,
  Health,
  ImportResult,
  MenuNode,
  Note,
  SearchResult,
  Settings,
  Snapshot,
  TrashListItem
} from './types'

export interface KrApi {
  bootstrap: () => Promise<Bootstrap | { error: string; settings: Settings }>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  snapshot: () => Promise<Snapshot>
  createMenu: (parentId: string | null, name: string) => Promise<MenuNode>
  renameMenu: (id: string, name: string) => Promise<MenuNode>
  moveMenu: (id: string, parentId: string | null, index: number) => Promise<void>
  menuImpact: (id: string) => Promise<{ childMenus: number; notes: number }>
  deleteMenu: (id: string) => Promise<void>
  createNote: (menuId: string) => Promise<Note>
  getNote: (id: string) => Promise<Note>
  saveNote: (input: { id: string; title: string; body: string; tags: string[] }) => Promise<Note>
  moveNote: (id: string, menuId: string) => Promise<void>
  reorderNotes: (menuId: string, orderedIds: string[]) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  batchMove: (ids: string[], menuId: string) => Promise<void>
  batchDelete: (ids: string[]) => Promise<void>
  batchTag: (ids: string[], tag: string) => Promise<{ tagged: number; skipped: string[] }>
  pickFiles: () => Promise<string[]>
  addFile: (noteId: string, sourcePath: string) => Promise<{ attachment: Attachment; duplicate: boolean }>
  addBytes: (noteId: string, name: string, bytes: Uint8Array) => Promise<Attachment>
  pasteImage: (noteId: string) => Promise<Attachment | null>
  removeAttachment: (noteId: string, attachmentId: string) => Promise<Note>
  renameAttachment: (noteId: string, attachmentId: string, name: string) => Promise<Note>
  readUtf8: (filePath: string) => Promise<string>
  readPreview: (noteId: string, attachmentId: string) => Promise<{ mode: 'text'; text: string } | { mode: 'skip'; reason: string }>
  openAttachment: (noteId: string, attachmentId: string) => Promise<void>
  revealAttachment: (noteId: string, attachmentId: string) => Promise<void>
  saveAttachmentAs: (noteId: string, attachmentId: string) => Promise<void>
  previewOffice: (noteId: string, attachmentId: string) => Promise<{ ok: true; url: string }>
  search: (text: string) => Promise<SearchResult>
  listTrash: () => Promise<TrashListItem[]>
  restore: (id: string) => Promise<{ menuMissing: boolean; noteId: string | null }>
  purge: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  revealDataDir: () => Promise<void>
  exportBackup: () => Promise<ExportResult | null>
  importBackup: (mode: 'skip' | 'copy') => Promise<ImportResult | null>
  switchDataDir: () => Promise<Bootstrap | null>
  useDefaultDir: () => Promise<Bootstrap>
  health: () => Promise<Health>
  pathForFile: (file: File) => string
  onProgress: (callback: (payload: { name: string; ratio: number } | null) => void) => () => void
  onRequestClose: (callback: () => void) => () => void
  closeReady: () => void
}
