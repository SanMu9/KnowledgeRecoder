import {
  FILE_MAX,
  NOTE_MAX,
  type Attachment,
  type FileKind,
  type Note,
  type NoteSummary
} from './types'

const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
const MD = new Set(['.md', '.markdown'])
const WORD = new Set(['.doc', '.docx'])
const EXCEL = new Set(['.xls', '.xlsx', '.csv'])
const PPT = new Set(['.ppt', '.pptx'])
const VIDEO = new Set(['.mp4', '.webm', '.ogv', '.mov', '.mkv'])
const AUDIO = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a'])
const CODE = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.css', '.scss', '.less', '.html', '.htm',
  '.json', '.yaml', '.yml', '.xml', '.py', '.java', '.go', '.rs', '.c', '.cpp',
  '.h', '.hpp', '.cs', '.php', '.rb', '.sql', '.sh', '.bash', '.ps1', '.bat',
  '.cmd', '.toml', '.ini'
])

export const NO_EXECUTE = new Set(['.exe', '.msi', '.bat', '.cmd', '.ps1'])

export const KIND_LABEL: Record<FileKind, string> = {
  image: '图片',
  markdown: 'Markdown',
  pdf: 'PDF',
  word: 'Word',
  excel: '表格',
  ppt: 'PPT',
  video: '视频',
  audio: '音频',
  code: '代码',
  other: '文件'
}

export function chars(value: string): number {
  return [...value].length
}

export function now(): string {
  return new Date().toISOString()
}

export function normalizeMenuName(raw: string): string {
  const name = raw.trim()
  if (!name) throw new Error('名称不能为空')
  if (chars(name) > 100) throw new Error('名称最多 100 个字符')
  if (/[\\/:*?"<>|\r\n]/.test(name)) throw new Error('名称不能包含 \\ / : * ? " < > | 或换行')
  return name
}

export function normalizeTitle(raw: string): string {
  const title = raw.trim()
  if (!title) throw new Error('标题不能为空')
  if (chars(title) > 200) throw new Error('标题最多 200 个字符')
  return title
}

export function normalizeTag(raw: string): string {
  const tag = raw.trim()
  if (!tag) throw new Error('标签不能为空')
  if (chars(tag) > 20) throw new Error('单个标签最多 20 个字符')
  return tag
}

export function normalizeTags(tags: string[]): string[] {
  const out: string[] = []
  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (!out.includes(tag)) out.push(tag)
  }
  if (out.length > 10) throw new Error('一条知识点最多 10 个标签')
  return out
}

export function safeExt(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename
  const index = base.lastIndexOf('.')
  if (index <= 0) return ''
  const ext = base.slice(index).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : ''
}

export function detectKind(ext: string): FileKind {
  const e = ext.toLowerCase()
  if (IMAGE.has(e)) return 'image'
  if (MD.has(e)) return 'markdown'
  if (e === '.pdf') return 'pdf'
  if (WORD.has(e)) return 'word'
  if (EXCEL.has(e)) return 'excel'
  if (PPT.has(e)) return 'ppt'
  if (VIDEO.has(e)) return 'video'
  if (AUDIO.has(e)) return 'audio'
  if (CODE.has(e)) return 'code'
  return 'other'
}

export function mimeOf(ext: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.txt': 'text/plain'
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}

export function assertCapacity(fileSize: number, used: number): void {
  if (fileSize > FILE_MAX) throw new Error('单个文件不能超过 100MB')
  if (used + fileSize > NOTE_MAX) throw new Error('这条知识点的附件合计不能超过 500MB')
}

export function makeSnippet(body: string): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [...text].slice(0, 80).join('')
}

export function toSummary(note: Note): NoteSummary {
  const kinds: FileKind[] = []
  for (const attachment of note.attachments) {
    if (!kinds.includes(attachment.kind)) kinds.push(attachment.kind)
  }
  return {
    id: note.id,
    menuId: note.menuId,
    title: note.title,
    tags: [...note.tags],
    sort: note.sort,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    kinds,
    snippet: makeSnippet(note.body),
    attachmentCount: note.attachments.length
  }
}

export function fold(value: string): string {
  return value.toLowerCase()
}

export interface ParsedQuery {
  tags: string[]
  cats: string[]
  words: string[]
}

export function parseQuery(raw: string): ParsedQuery {
  const text = raw.trim()
  if (!text) return { tags: [], cats: [], words: [] }
  const tags: string[] = []
  const cats: string[] = []
  const words: string[] = []
  for (const token of text.split(/\s+/)) {
    const lower = token.toLowerCase()
    if (lower.startsWith('tag:') && token.length > 4) tags.push(token.slice(4))
    else if (lower.startsWith('cat:') && token.length > 4) cats.push(token.slice(4))
    else if (token) words.push(token)
  }
  return { tags, cats, words }
}

export function fieldRank(note: Pick<Note, 'title' | 'body' | 'tags' | 'attachments'>, menuPath: string, word: string): number {
  const w = fold(word)
  if (!w) return 0
  if (fold(note.title).includes(w)) return 5
  if (note.tags.some((tag) => fold(tag).includes(w))) return 4
  if (fold(note.body).includes(w)) return 3
  if (note.attachments.some((attachment) => fold(attachment.name).includes(w))) return 2
  if (fold(menuPath).includes(w)) return 1
  return 0
}

export function snippetAround(text: string, word: string): string | undefined {
  const index = fold(text).indexOf(fold(word))
  if (index < 0) return undefined
  const start = Math.max(0, index - 24)
  const end = Math.min(text.length, index + word.length + 24)
  const slice = text.slice(start, end).replace(/\s+/g, ' ')
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`
}

export function assetMarkdownPath(noteId: string, attachment: Pick<Attachment, 'id' | 'ext'>): string {
  return `assets/${noteId}/${attachment.id}${attachment.ext}`
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN')
}

export function isId(value: string): boolean {
  return /^[0-9a-f-]{8,80}$/i.test(value)
}
