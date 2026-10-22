export const UNCATEGORIZED_ID = 'uncategorized'
export const SCHEMA_VERSION = 1
export const FILE_MAX = 100 * 1024 * 1024
export const NOTE_MAX = 500 * 1024 * 1024
export const TEXT_PREVIEW_MAX = 1024 * 1024
export const PROGRESS_MIN = 50 * 1024 * 1024

export type FileKind =
  | 'image'
  | 'markdown'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'video'
  | 'audio'
  | 'code'
  | 'other'

export type ThemeMode = 'system' | 'light' | 'dark'
export type SortMode = 'updated' | 'created' | 'title' | 'custom'
export type EditorLayout = 'edit' | 'preview' | 'split'

export interface MenuNode {
  id: string
  parentId: string | null
  name: string
  sort: number
  createdAt: string
  updatedAt: string
  fixed?: boolean
}

export interface Attachment {
  id: string
  name: string
  ext: string
  mime: string
  kind: FileKind
  size: number
  createdAt: string
  missing?: boolean
}

export interface Note {
  id: string
  menuId: string
  title: string
  body: string
  tags: string[]
  attachments: Attachment[]
  sort: number
  createdAt: string
  updatedAt: string
  sourceId?: string
}

export interface NoteSummary {
  id: string
  menuId: string
  title: string
  tags: string[]
  sort: number
  createdAt: string
  updatedAt: string
  kinds: FileKind[]
  snippet: string
  attachmentCount: number
}

export interface TrashNote {
  id: string
  kind: 'note'
  deletedAt: string
  menuId: string
  menuPath: string
  note: Note
}

export interface TrashAttachment {
  id: string
  kind: 'attachment'
  deletedAt: string
  menuPath: string
  noteId: string
  noteTitle: string
  attachment: Attachment
}

export type TrashItem = TrashNote | TrashAttachment

export interface TrashListItem {
  id: string
  kind: 'note' | 'attachment'
  title: string
  noteTitle: string
  deletedAt: string
  menuPath: string
  attachmentCount: number
  bytes: number
  tags: string[]
}

export interface Settings {
  dataDir: string | null
  expandedMenuIds: string[]
  selectedMenuId: string | null
  selectedNoteId: string | null
  menuWidth: number
  listWidth: number
  theme: ThemeMode
  sortMode: SortMode
  includeChildren: boolean
}

export interface NoteHit {
  id: string
  title: string
  menuId: string
  menuPath: string
  updatedAt: string
  snippets: string[]
  rank: number
}

export interface MenuHit {
  id: string
  name: string
  path: string
}

export interface SearchResult {
  notes: NoteHit[]
  menus: MenuHit[]
  hiddenNotes: number
  words: string[]
}

export interface Bootstrap {
  dataDir: string
  version: string
  menus: MenuNode[]
  summaries: NoteSummary[]
  settings: Settings
  repairs: string[]
}

export interface Health {
  notes: number
  attachments: number
  bytes: number
  trashCount: number
  trashBytes: number
  missing: { noteId: string; noteTitle: string; name: string }[]
}

export interface ImportResult {
  menusAdded: number
  notesImported: number
  notesSkipped: number
  backupPath: string
}

export interface ExportResult {
  path: string
  notes: number
  attachments: number
  bytes: number
}

export interface Snapshot {
  menus: MenuNode[]
  summaries: NoteSummary[]
}

export function defaultSettings(): Settings {
  return {
    dataDir: null,
    expandedMenuIds: [],
    selectedMenuId: null,
    selectedNoteId: null,
    menuWidth: 260,
    listWidth: 320,
    theme: 'system',
    sortMode: 'updated',
    includeChildren: false
  }
}
