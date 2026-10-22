import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  PROGRESS_MIN,
  SCHEMA_VERSION,
  TEXT_PREVIEW_MAX,
  UNCATEGORIZED_ID,
  type Attachment,
  type ExportResult,
  type ImportResult,
  type MenuHit,
  type MenuNode,
  type Note,
  type NoteHit,
  type NoteSummary,
  type SearchResult,
  type TrashAttachment,
  type TrashItem,
  type TrashListItem,
  type TrashNote
} from '../shared/types'
import {
  assertCapacity,
  detectKind,
  fieldRank,
  fold,
  isId,
  mimeOf,
  normalizeMenuName,
  normalizeTag,
  normalizeTags,
  normalizeTitle,
  now,
  parseQuery,
  safeExt,
  snippetAround,
  toSummary
} from '../shared/rules'

interface LibraryFile {
  schemaVersion: number
  name: string
  createdAt: string
  updatedAt: string
}

function assertInside(root: string, target: string): void {
  const base = path.resolve(root)
  const resolved = path.resolve(target)
  const rel = path.relative(base, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('路径越界')
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function writeJson(file: string, data: unknown, keepBak: boolean): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  if (keepBak && (await exists(file))) {
    await fs.copyFile(file, `${file}.bak`)
  }
  await fs.rm(file, { force: true })
  try {
    await fs.rename(tmp, file)
  } catch {
    await fs.copyFile(tmp, file)
    await fs.rm(tmp, { force: true })
  }
}

async function readJson<T>(file: string): Promise<{ value?: T; from?: string }> {
  const order = [file, `${file}.tmp`, `${file}.bak`]
  let saw = false
  for (const candidate of order) {
    let text: string
    try {
      text = await fs.readFile(candidate, 'utf8')
      saw = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    try {
      return { value: JSON.parse(text) as T, from: candidate === file ? undefined : candidate }
    } catch {
      continue
    }
  }
  if (saw) throw new Error(`无法识别 ${path.basename(file)}，已保留原文件，没有用空数据覆盖`)
  return {}
}

function makeUncategorized(): MenuNode {
  const stamp = now()
  return {
    id: UNCATEGORIZED_ID,
    parentId: null,
    name: '未分类',
    sort: 1_000_000,
    createdAt: stamp,
    updatedAt: stamp,
    fixed: true
  }
}

async function dirSize(dir: string): Promise<number> {
  if (!(await exists(dir))) return 0
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const child = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await dirSize(child)
    else total += (await fs.stat(child)).size
  }
  return total
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = `${base}（导入）`
  let index = 2
  while (taken.has(name)) {
    name = `${base}（导入${index}）`
    index += 1
  }
  return name
}

export class Library {
  readonly repairs: string[] = []
  private readonly menus: MenuNode[] = []
  private readonly notes = new Map<string, Note>()
  private trash: TrashItem[] = []
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(readonly root: string) {}

  static async init(root: string): Promise<Library> {
    await fs.mkdir(root, { recursive: true })
    const libraryFile = path.join(root, 'library.json')
    if (!(await exists(libraryFile))) {
      const stamp = now()
      await writeJson(
        libraryFile,
        { schemaVersion: SCHEMA_VERSION, name: '我的知识库', createdAt: stamp, updatedAt: stamp },
        false
      )
      await writeJson(path.join(root, 'menus.json'), { nodes: [makeUncategorized()] }, false)
      await fs.mkdir(path.join(root, 'notes'), { recursive: true })
      await writeJson(path.join(root, 'notes', 'index.json'), { items: [] }, false)
      await fs.mkdir(path.join(root, 'assets'), { recursive: true })
      await fs.mkdir(path.join(root, 'trash', 'notes'), { recursive: true })
      await fs.mkdir(path.join(root, 'trash', 'files'), { recursive: true })
      await writeJson(path.join(root, 'trash', 'index.json'), { items: [] }, false)
    }
    return Library.open(root)
  }

  static async open(root: string): Promise<Library> {
    const library = new Library(root)
    await library.load()
    return library
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.then(fn, fn)
    this.queue = job.then(
      () => undefined,
      () => undefined
    )
    return job
  }

  private async load(): Promise<void> {
    const libraryFile = path.join(this.root, 'library.json')
    const header = await readJson<LibraryFile>(libraryFile)
    if (!header.value) throw new Error('这不是可识别的知识数据目录')
    if (header.value.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('这份知识数据来自更新的程序，请先更新后再打开')
    }

    const menusFile = path.join(this.root, 'menus.json')
    const menusDoc = await readJson<{ nodes: MenuNode[] }>(menusFile)
    if (!menusDoc.value?.nodes) throw new Error('无法识别菜单文件，已保留原文件，没有用空数据覆盖')
    if (menusDoc.from) this.repairs.push('菜单文件已从备份恢复')
    this.menus.push(...menusDoc.value.nodes)

    await fs.mkdir(path.join(this.root, 'notes'), { recursive: true })
    await this.recoverTmpNotes()
    await this.loadNotes()
    await this.loadTrash()
    const dirtyNotes = this.repairTree()
    if (menusDoc.from || this.repairs.length) await this.persistMenus()
    for (const id of dirtyNotes) {
      const note = this.notes.get(id)
      if (note) await this.persistNote(note)
    }
    if (dirtyNotes.length) await this.persistIndex()
    await this.persistTrashIndex()
  }

  private async recoverTmpNotes(): Promise<void> {
    const dir = path.join(this.root, 'notes')
    const names = await fs.readdir(dir)
    for (const name of names) {
      if (!name.endsWith('.json.tmp')) continue
      const real = name.slice(0, -4)
      if (names.includes(real)) continue
      await fs.rename(path.join(dir, name), path.join(dir, real))
      this.repairs.push(`已恢复未写完的知识点文件 ${real}`)
    }
  }

  private async loadNotes(): Promise<void> {
    const dir = path.join(this.root, 'notes')
    const names = await fs.readdir(dir)
    for (const name of names) {
      if (!name.endsWith('.json') || name === 'index.json') continue
      try {
        const note = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as Note
        if (!note?.id) throw new Error('empty')
        note.tags ??= []
        note.attachments ??= []
        note.body ??= ''
        this.notes.set(note.id, note)
      } catch {
        this.repairs.push(`知识点文件 ${name} 无法读取，已跳过且未改写`)
      }
    }
  }

  private async loadTrash(): Promise<void> {
    await fs.mkdir(path.join(this.root, 'trash', 'notes'), { recursive: true })
    await fs.mkdir(path.join(this.root, 'trash', 'files'), { recursive: true })
    const index = await readJson<{ items: Array<TrashAttachment | { id: string; kind: 'note' }> }>(
      path.join(this.root, 'trash', 'index.json')
    )
    const items = index.value?.items ?? []
    const kept: TrashItem[] = []
    for (const item of items) {
      if (item.kind === 'note') {
        const file = path.join(this.root, 'trash', 'notes', `${item.id}.json`)
        let record: TrashNote | undefined
        try {
          record = JSON.parse(await fs.readFile(file, 'utf8')) as TrashNote
        } catch {
          this.repairs.push(`回收站记录 ${item.id} 无法读取，已跳过`)
          continue
        }
        const live = this.notes.get(record.id)
        const assetsLive = await exists(path.join(this.root, 'assets', record.id))
        if (live && assetsLive) {
          await fs.rm(file, { force: true })
          this.repairs.push(`已保留知识点「${live.title}」，未完成的删除已取消`)
          continue
        }
        if (live && !assetsLive) {
          this.notes.delete(live.id)
          await fs.rm(path.join(this.root, 'notes', `${live.id}.json`), { force: true })
          this.repairs.push(`已完成中断的删除：「${record.note.title}」在回收站`)
        }
        kept.push(record)
        continue
      }
      const attachment = item as TrashAttachment
      const live = this.notes.get(attachment.noteId)
      if (live?.attachments.some((entry) => entry.id === attachment.attachment.id)) {
        await fs.rm(this.trashFile(attachment.noteId, attachment.attachment), { force: true })
        this.repairs.push(`附件「${attachment.attachment.name}」仍在知识点中，已取消未完成的移除`)
        continue
      }
      kept.push(attachment)
    }
    this.trash = kept
  }

  private repairTree(): string[] {
    const dirtyNotes: string[] = []
    if (!this.menus.some((menu) => menu.id === UNCATEGORIZED_ID)) {
      this.menus.push(makeUncategorized())
      this.repairs.push('已补回「未分类」')
    }
    const ids = new Set(this.menus.map((menu) => menu.id))
    for (const menu of this.menus) {
      if (menu.id === UNCATEGORIZED_ID) {
        menu.parentId = null
        menu.name = '未分类'
        menu.fixed = true
        continue
      }
      if (menu.parentId && !ids.has(menu.parentId)) {
        menu.parentId = null
        this.repairs.push(`菜单「${menu.name}」的上级已不存在，已改为根菜单`)
      }
    }
    for (const menu of this.menus) {
      if (menu.id === UNCATEGORIZED_ID) continue
      if (this.hasCycle(menu.id)) {
        menu.parentId = null
        this.repairs.push(`菜单「${menu.name}」的层级形成了环，已改为根菜单`)
      }
    }
    const groups = new Map<string, MenuNode[]>()
    for (const menu of this.menus) {
      const key = `${menu.parentId ?? 'root'}::${menu.name}`
      groups.set(key, [...(groups.get(key) ?? []), menu])
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue
      const taken = new Set(this.menus.filter((menu) => menu.parentId === list[0].parentId).map((menu) => menu.name))
      for (let index = 1; index < list.length; index += 1) {
        const menu = list[index]
        if (menu.fixed) continue
        taken.delete(menu.name)
        menu.name = uniqueName(menu.name, taken)
        taken.add(menu.name)
        this.repairs.push(`同级重名已改为「${menu.name}」`)
      }
    }
    for (const note of this.notes.values()) {
      if (!this.menus.some((menu) => menu.id === note.menuId)) {
        note.menuId = UNCATEGORIZED_ID
        dirtyNotes.push(note.id)
        this.repairs.push(`知识点「${note.title}」原来的菜单不在了，已放入「未分类」`)
      }
    }
    return dirtyNotes
  }

  private hasCycle(id: string): boolean {
    const start = this.menus.find((menu) => menu.id === id)
    if (!start?.parentId) return false
    let parentId: string | null = start.parentId
    const seen = new Set<string>([id])
    while (parentId) {
      if (seen.has(parentId)) return true
      seen.add(parentId)
      parentId = this.menus.find((menu) => menu.id === parentId)?.parentId ?? null
    }
    return false
  }

  listMenus(): MenuNode[] {
    return this.menus.map((menu) => ({ ...menu }))
  }

  listSummaries(): NoteSummary[] {
    return [...this.notes.values()].map(toSummary)
  }

  snapshot(): { menus: MenuNode[]; summaries: NoteSummary[] } {
    return { menus: this.listMenus(), summaries: this.listSummaries() }
  }

  createMenu(parentId: string | null, rawName: string): Promise<MenuNode> {
    return this.run(async () => {
      if (parentId === UNCATEGORIZED_ID) throw new Error('不能在「未分类」下新建子菜单')
      if (parentId && !this.menus.some((menu) => menu.id === parentId)) throw new Error('上级菜单不存在')
      const name = normalizeMenuName(rawName)
      if (this.menus.some((menu) => menu.parentId === parentId && menu.name === name)) {
        throw new Error('同级已有这个名字')
      }
      const stamp = now()
      const menu: MenuNode = {
        id: randomUUID(),
        parentId,
        name,
        sort: this.nextSort(parentId),
        createdAt: stamp,
        updatedAt: stamp
      }
      this.menus.push(menu)
      await this.persistMenus()
      return { ...menu }
    })
  }

  renameMenu(id: string, rawName: string): Promise<MenuNode> {
    return this.run(async () => {
      const menu = this.requireMenu(id)
      if (menu.fixed) throw new Error('「未分类」不能重命名')
      const name = normalizeMenuName(rawName)
      if (this.menus.some((item) => item.id !== id && item.parentId === menu.parentId && item.name === name)) {
        throw new Error('同级已有这个名字')
      }
      menu.name = name
      menu.updatedAt = now()
      await this.persistMenus()
      return { ...menu }
    })
  }

  moveMenu(id: string, parentId: string | null, index: number): Promise<void> {
    return this.run(async () => {
      const menu = this.requireMenu(id)
      if (menu.fixed) throw new Error('「未分类」不能移动')
      if (parentId === UNCATEGORIZED_ID) throw new Error('不能移动到「未分类」下面')
      if (parentId && !this.menus.some((item) => item.id === parentId)) throw new Error('目标菜单不存在')
      if (parentId && this.isInside(parentId, id)) throw new Error('不能移动到自身或其子菜单下')
      const siblings = this.menus
        .filter((item) => item.parentId === parentId && item.id !== id && item.id !== UNCATEGORIZED_ID)
        .sort((a, b) => a.sort - b.sort)
      const clamped = Math.max(0, Math.min(index, siblings.length))
      siblings.splice(clamped, 0, menu)
      menu.parentId = parentId
      const stamp = now()
      siblings.forEach((item, order) => {
        item.sort = order
        item.updatedAt = stamp
      })
      await this.persistMenus()
    })
  }

  menuImpact(id: string): { childMenus: number; notes: number } {
    this.requireMenu(id)
    const ids = [id, ...this.descendantIds(id)]
    return {
      childMenus: ids.length - 1,
      notes: [...this.notes.values()].filter((note) => ids.includes(note.menuId)).length
    }
  }

  deleteMenu(id: string): Promise<void> {
    return this.run(async () => {
      const menu = this.requireMenu(id)
      if (menu.fixed) throw new Error('「未分类」不能删除')
      const ids = new Set([id, ...this.descendantIds(id)])
      for (const note of [...this.notes.values()]) {
        if (ids.has(note.menuId)) await this.trashNote(note)
      }
      for (let index = this.menus.length - 1; index >= 0; index -= 1) {
        if (ids.has(this.menus[index].id)) this.menus.splice(index, 1)
      }
      await this.persistMenus()
    })
  }

  createNote(menuId: string): Promise<Note> {
    return this.run(async () => {
      this.requireMenu(menuId)
      const stamp = now()
      const note: Note = {
        id: randomUUID(),
        menuId,
        title: '未命名知识点',
        body: '',
        tags: [],
        attachments: [],
        sort: this.nextNoteSort(menuId),
        createdAt: stamp,
        updatedAt: stamp
      }
      this.notes.set(note.id, note)
      await this.persistNote(note)
      await this.persistIndex()
      return this.cloneNote(note)
    })
  }

  getNote(id: string): Promise<Note> {
    return this.run(async () => this.cloneNote(await this.withMissing(this.requireNote(id))))
  }

  saveNote(input: { id: string; title: string; body: string; tags: string[] }): Promise<Note> {
    return this.run(async () => {
      const note = this.requireNote(input.id)
      const title = normalizeTitle(input.title)
      const body = input.body ?? ''
      const tags = normalizeTags(input.tags ?? [])
      const updatedAt = now()
      await this.persistNote({ ...note, title, body, tags, updatedAt })
      note.title = title
      note.body = body
      note.tags = tags
      note.updatedAt = updatedAt
      await this.persistIndex()
      return this.cloneNote(note)
    })
  }

  moveNote(id: string, menuId: string): Promise<void> {
    return this.run(async () => {
      const note = this.requireNote(id)
      this.requireMenu(menuId)
      note.menuId = menuId
      note.sort = this.nextNoteSort(menuId)
      await this.persistNote(note)
      await this.persistIndex()
    })
  }

  reorderNotes(menuId: string, orderedIds: string[]): Promise<void> {
    return this.run(async () => {
      this.requireMenu(menuId)
      for (let index = 0; index < orderedIds.length; index += 1) {
        const note = this.notes.get(orderedIds[index])
        if (!note || note.menuId !== menuId) continue
        if (note.sort === index) continue
        note.sort = index
        await this.persistNote(note)
      }
      await this.persistIndex()
    })
  }

  deleteNote(id: string): Promise<void> {
    return this.run(async () => {
      await this.trashNote(this.requireNote(id))
    })
  }

  batchMove(ids: string[], menuId: string): Promise<void> {
    return this.run(async () => {
      this.requireMenu(menuId)
      for (const id of ids) {
        const note = this.notes.get(id)
        if (!note) continue
        note.menuId = menuId
        note.sort = this.nextNoteSort(menuId)
        await this.persistNote(note)
      }
      await this.persistIndex()
    })
  }

  batchDelete(ids: string[]): Promise<void> {
    return this.run(async () => {
      for (const id of ids) {
        const note = this.notes.get(id)
        if (note) await this.trashNote(note)
      }
    })
  }

  batchTag(ids: string[], rawTag: string): Promise<{ tagged: number; skipped: string[] }> {
    return this.run(async () => {
      const tag = normalizeTag(rawTag)
      let tagged = 0
      const skipped: string[] = []
      for (const id of ids) {
        const note = this.notes.get(id)
        if (!note) continue
        if (note.tags.includes(tag)) continue
        if (note.tags.length >= 10) {
          skipped.push(note.title)
          continue
        }
        note.tags.push(tag)
        note.updatedAt = now()
        await this.persistNote(note)
        tagged += 1
      }
      await this.persistIndex()
      return { tagged, skipped }
    })
  }

  addFile(
    noteId: string,
    sourcePath: string,
    onProgress?: (ratio: number) => void
  ): Promise<{ attachment: Attachment; duplicate: boolean }> {
    return this.run(() => this.addFromSource(noteId, sourcePath, onProgress))
  }

  addBytes(noteId: string, filename: string, bytes: Uint8Array): Promise<Attachment> {
    return this.run(async () => {
      const note = this.requireNote(noteId)
      assertCapacity(bytes.byteLength, this.usedBytes(note))
      const attachment = this.makeAttachment(filename || '粘贴图片.png', bytes.byteLength)
      const dest = this.assetFile(note.id, attachment)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.writeFile(dest, bytes)
      note.attachments.push(attachment)
      note.updatedAt = now()
      await this.persistNote(note)
      await this.persistIndex()
      return { ...attachment }
    })
  }

  removeAttachment(noteId: string, attachmentId: string): Promise<Note> {
    return this.run(async () => {
      const note = this.requireNote(noteId)
      const attachment = note.attachments.find((item) => item.id === attachmentId)
      if (!attachment) throw new Error('附件不存在')
      const source = this.assetFile(note.id, attachment)
      if (await exists(source)) {
        const dest = this.trashFile(note.id, attachment)
        await fs.mkdir(path.dirname(dest), { recursive: true })
        await fs.copyFile(source, dest)
        const record: TrashAttachment = {
          id: attachment.id,
          kind: 'attachment',
          deletedAt: now(),
          menuPath: this.menuPath(note.menuId),
          noteId: note.id,
          noteTitle: note.title,
          attachment: { ...attachment }
        }
        this.trash.unshift(record)
        await this.persistTrashIndex()
        await fs.rm(source, { force: true })
      }
      note.attachments = note.attachments.filter((item) => item.id !== attachmentId)
      note.updatedAt = now()
      await this.persistNote(note)
      await this.persistIndex()
      return this.cloneNote(note)
    })
  }

  renameAttachment(noteId: string, attachmentId: string, rawName: string): Promise<Note> {
    return this.run(async () => {
      const note = this.requireNote(noteId)
      const attachment = note.attachments.find((item) => item.id === attachmentId)
      if (!attachment) throw new Error('附件不存在')
      const name = rawName.trim()
      if (!name) throw new Error('文件名不能为空')
      if ([...name].length > 200) throw new Error('文件名最多 200 个字符')
      attachment.name = name
      note.updatedAt = now()
      await this.persistNote(note)
      await this.persistIndex()
      return this.cloneNote(note)
    })
  }

  readPreview(noteId: string, attachmentId: string): Promise<{ mode: 'text'; text: string } | { mode: 'skip'; reason: string }> {
    return this.run(async () => {
      const note = this.requireNote(noteId)
      const attachment = note.attachments.find((item) => item.id === attachmentId)
      if (!attachment) throw new Error('附件不存在')
      const file = this.assetFile(note.id, attachment)
      if (!(await exists(file))) return { mode: 'skip', reason: '文件缺失' }
      const textual = attachment.kind === 'code' || attachment.kind === 'markdown' || attachment.ext === '.csv'
      if (!textual) return { mode: 'skip', reason: '' }
      const stat = await fs.stat(file)
      if (stat.size > TEXT_PREVIEW_MAX) return { mode: 'skip', reason: '文件超过 1MB，请用系统程序打开或另存为' }
      const buffer = await fs.readFile(file)
      if (buffer.includes(0)) return { mode: 'skip', reason: '这不是文本文件' }
      try {
        return { mode: 'text', text: new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
      } catch {
        return { mode: 'skip', reason: '无法按 UTF-8 读取' }
      }
    })
  }

  readUtf8(filePath: string): Promise<string> {
    return this.run(async () => {
      const stat = await fs.stat(filePath)
      if (stat.size > TEXT_PREVIEW_MAX * 2) throw new Error('Markdown 文件过大，无法并入正文')
      const buffer = await fs.readFile(filePath)
      if (buffer.includes(0)) throw new Error('这不是文本文件')
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
      } catch {
        throw new Error('无法按 UTF-8 读取，没有写入正文')
      }
    })
  }

  resolveAsset(noteId: string, attachmentId: string): string {
    if (!isId(noteId) || !isId(attachmentId)) throw new Error('无效标识')
    const note = this.notes.get(noteId)
    if (!note) throw new Error('知识点不存在')
    const attachment = note.attachments.find((item) => item.id === attachmentId)
    if (!attachment) throw new Error('附件不存在')
    const file = this.assetFile(noteId, attachment)
    assertInside(this.root, file)
    return file
  }

  resolvePreview(attachmentId: string): string {
    if (!isId(attachmentId)) throw new Error('无效标识')
    const file = path.join(this.root, '.cache', `${attachmentId}.pdf`)
    assertInside(path.join(this.root, '.cache'), file)
    return file
  }

  attachmentFile(noteId: string, attachmentId: string): string {
    return this.resolveAsset(noteId, attachmentId)
  }

  // ponytail: 正文留在内存里做子串搜索。几千条短笔记够用；单条特别大或超过约 5000 条时，再改成磁盘索引。
  search(raw: string): Promise<SearchResult> {
    return this.run(async () => this.searchNow(raw))
  }

  private searchNow(raw: string): SearchResult {
    const parsed = parseQuery(raw)
    if (!parsed.words.length && !parsed.tags.length && !parsed.cats.length) {
      return { notes: [], menus: [], hiddenNotes: 0, words: [] }
    }
    const hits: NoteHit[] = []
    for (const note of this.notes.values()) {
      const menuPath = this.menuPath(note.menuId)
      if (parsed.tags.some((tag) => !note.tags.some((item) => fold(item).includes(fold(tag))))) continue
      if (parsed.cats.some((cat) => !fold(menuPath).includes(fold(cat)))) continue
      let rank = parsed.tags.length ? 4 : parsed.cats.length ? 1 : 0
      const snippets: string[] = []
      if (parsed.words.length) {
        if (!parsed.words.every((word) => fieldRank(note, menuPath, word) > 0)) continue
        rank = Math.max(rank, ...parsed.words.map((word) => fieldRank(note, menuPath, word)))
        for (const word of parsed.words) {
          if (snippets.length >= 2) break
          const snippet =
            snippetAround(note.body, word) ||
            snippetAround(note.title, word) ||
            snippetAround(note.attachments.map((item) => item.name).join(' '), word)
          if (snippet) snippets.push(snippet)
        }
      }
      hits.push({
        id: note.id,
        title: note.title,
        menuId: note.menuId,
        menuPath,
        updatedAt: note.updatedAt,
        snippets,
        rank
      })
    }
    hits.sort((a, b) => b.rank - a.rank || b.updatedAt.localeCompare(a.updatedAt))
    const menus: MenuHit[] = []
    if (!parsed.tags.length) {
      for (const menu of this.menus) {
        const menuPath = this.menuPath(menu.id)
        const wordHit = parsed.words.some((word) => fold(menu.name).includes(fold(word)) || fold(menuPath).includes(fold(word)))
        const catHit = parsed.cats.some((cat) => fold(menuPath).includes(fold(cat)))
        const wordsOk = parsed.words.every((word) => fold(menu.name).includes(fold(word)) || fold(menuPath).includes(fold(word)))
        const catsOk = parsed.cats.every((cat) => fold(menuPath).includes(fold(cat)))
        if ((wordHit || catHit) && wordsOk && catsOk) menus.push({ id: menu.id, name: menu.name, path: menuPath })
      }
    }
    return {
      notes: hits.slice(0, 100),
      menus: menus.slice(0, 50),
      hiddenNotes: Math.max(0, hits.length - 100),
      words: parsed.words
    }
  }

  listTrash(): TrashListItem[] {
    return this.trash
      .map((item) => {
        if (item.kind === 'note') {
          return {
            id: item.id,
            kind: 'note' as const,
            title: item.note.title,
            noteTitle: item.note.title,
            deletedAt: item.deletedAt,
            menuPath: item.menuPath,
            attachmentCount: item.note.attachments.length,
            bytes: item.note.attachments.reduce((sum, attachment) => sum + attachment.size, 0),
            tags: [...item.note.tags]
          }
        }
        return {
          id: item.id,
          kind: 'attachment' as const,
          title: item.attachment.name,
          noteTitle: item.noteTitle,
          deletedAt: item.deletedAt,
          menuPath: item.menuPath,
          attachmentCount: 1,
          bytes: item.attachment.size,
          tags: []
        }
      })
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
  }

  restore(id: string): Promise<{ menuMissing: boolean; noteId: string | null }> {
    return this.run(async () => {
      const item = this.trash.find((entry) => entry.id === id)
      if (!item) throw new Error('回收站中没有这一项')
      if (item.kind === 'note') {
        const menuMissing = !this.menus.some((menu) => menu.id === item.note.menuId)
        const note: Note = {
          ...item.note,
          tags: [...item.note.tags],
          attachments: item.note.attachments.map((attachment) => ({ ...attachment })),
          menuId: menuMissing ? UNCATEGORIZED_ID : item.note.menuId,
          updatedAt: now()
        }
        await fs.mkdir(path.join(this.root, 'assets', note.id), { recursive: true })
        for (const attachment of note.attachments) {
          const source = this.trashFile(note.id, attachment)
          if (await exists(source)) await fs.rename(source, this.assetFile(note.id, attachment))
        }
        this.notes.set(note.id, note)
        await this.persistNote(note)
        await this.persistIndex()
        this.trash = this.trash.filter((entry) => entry.id !== id)
        await fs.rm(path.join(this.root, 'trash', 'notes', `${id}.json`), { force: true })
        await this.persistTrashIndex()
        return { menuMissing, noteId: note.id }
      }
      const live = this.notes.get(item.noteId)
      if (live) {
        const source = this.trashFile(item.noteId, item.attachment)
        if (await exists(source)) {
          await fs.mkdir(path.dirname(this.assetFile(live.id, item.attachment)), { recursive: true })
          await fs.rename(source, this.assetFile(live.id, item.attachment))
        }
        live.attachments.push({ ...item.attachment })
        live.updatedAt = now()
        await this.persistNote(live)
        await this.persistIndex()
        this.trash = this.trash.filter((entry) => entry.id !== id)
        await this.persistTrashIndex()
        return { menuMissing: false, noteId: live.id }
      }
      const trashed = this.trash.find((entry) => entry.kind === 'note' && entry.note.id === item.noteId)
      if (trashed && trashed.kind === 'note') {
        trashed.note.attachments.push({ ...item.attachment })
        await writeJson(path.join(this.root, 'trash', 'notes', `${trashed.id}.json`), trashed, false)
        this.trash = this.trash.filter((entry) => entry.id !== id)
        await this.persistTrashIndex()
        return { menuMissing: false, noteId: null }
      }
      throw new Error('原知识点已彻底删除，这份附件不能恢复')
    })
  }

  purge(id: string): Promise<void> {
    return this.run(async () => {
      const item = this.trash.find((entry) => entry.id === id)
      if (!item) return
      if (item.kind === 'note') {
        await fs.rm(path.join(this.root, 'trash', 'notes', `${item.id}.json`), { force: true })
        await fs.rm(path.join(this.root, 'trash', 'files', item.note.id), { recursive: true, force: true })
        this.trash = this.trash.filter(
          (entry) => entry.id !== item.id && !(entry.kind === 'attachment' && entry.noteId === item.note.id)
        )
      } else {
        await fs.rm(this.trashFile(item.noteId, item.attachment), { force: true })
        this.trash = this.trash.filter((entry) => entry.id !== item.id)
      }
      await this.persistTrashIndex()
    })
  }

  emptyTrash(): Promise<void> {
    return this.run(async () => {
      await fs.rm(path.join(this.root, 'trash', 'notes'), { recursive: true, force: true })
      await fs.rm(path.join(this.root, 'trash', 'files'), { recursive: true, force: true })
      await fs.mkdir(path.join(this.root, 'trash', 'notes'), { recursive: true })
      await fs.mkdir(path.join(this.root, 'trash', 'files'), { recursive: true })
      this.trash = []
      await this.persistTrashIndex()
    })
  }

  async health(): Promise<{
    notes: number
    attachments: number
    bytes: number
    trashCount: number
    trashBytes: number
    missing: { noteId: string; noteTitle: string; name: string }[]
  }> {
    let attachments = 0
    let bytes = 0
    const missing: { noteId: string; noteTitle: string; name: string }[] = []
    for (const note of this.notes.values()) {
      for (const attachment of note.attachments) {
        attachments += 1
        bytes += attachment.size
        if (!(await exists(this.assetFile(note.id, attachment)))) {
          missing.push({ noteId: note.id, noteTitle: note.title, name: attachment.name })
        }
      }
    }
    return {
      notes: this.notes.size,
      attachments,
      bytes,
      trashCount: this.trash.length,
      trashBytes: await dirSize(path.join(this.root, 'trash')),
      missing
    }
  }

  exportTo(parentDir: string): Promise<ExportResult> {
    return this.run(async () => {
      const parent = path.resolve(parentDir)
      const root = path.resolve(this.root)
      if (parent === root || parent.startsWith(root + path.sep)) throw new Error('请把备份放到知识数据目录以外的位置')
      const day = new Date().toISOString().slice(0, 10)
      let dest = path.join(parentDir, `KnowledgeRecoder-backup-${day}`)
      if (await exists(dest)) dest = path.join(parentDir, `KnowledgeRecoder-backup-${day}-${Date.now()}`)
      await fs.cp(this.root, dest, {
        recursive: true,
        filter: (source) => {
          const base = path.basename(source)
          return base !== '.cache' && !base.endsWith('.tmp')
        }
      })
      let attachments = 0
      for (const note of this.notes.values()) attachments += note.attachments.length
      return {
        path: dest,
        notes: this.notes.size,
        attachments,
        bytes: await dirSize(dest)
      }
    })
  }

  importFrom(sourceRoot: string, mode: 'skip' | 'copy'): Promise<ImportResult> {
    return this.run(async () => {
      if (path.resolve(sourceRoot) === path.resolve(this.root)) throw new Error('不能把当前数据目录导入到自己')
      const header = await readJson<LibraryFile>(path.join(sourceRoot, 'library.json'))
      if (!header.value || header.value.schemaVersion !== SCHEMA_VERSION) throw new Error('这不是可识别的知识数据目录')
      const backupPath = path.join(path.dirname(this.root), 'knowledge-recoder-backups', `before-import-${Date.now()}`)
      await fs.cp(this.root, backupPath, {
        recursive: true,
        filter: (source) => path.basename(source) !== '.cache'
      })

      const menusDoc = await readJson<{ nodes: MenuNode[] }>(path.join(sourceRoot, 'menus.json'))
      if (!menusDoc.value?.nodes) throw new Error('备份里的菜单无法识别，当前数据未改动')
      const sourceNotes = await this.readExternalNotes(sourceRoot)
      const idMap = new Map<string, string>([[UNCATEGORIZED_ID, UNCATEGORIZED_ID]])
      let menusAdded = 0
      for (const menu of this.orderMenus(menusDoc.value.nodes)) {
        if (menu.id === UNCATEGORIZED_ID) continue
        if (this.menus.some((item) => item.id === menu.id)) {
          idMap.set(menu.id, menu.id)
          continue
        }
        const mappedParent = menu.parentId ? (idMap.get(menu.parentId) ?? null) : null
        const parentId = mappedParent === UNCATEGORIZED_ID ? null : mappedParent
        const taken = new Set(this.menus.filter((item) => item.parentId === parentId).map((item) => item.name))
        const name = taken.has(menu.name) ? uniqueName(menu.name, taken) : menu.name
        const stamp = now()
        const created: MenuNode = {
          id: menu.id,
          parentId,
          name,
          sort: this.nextSort(parentId),
          createdAt: menu.createdAt || stamp,
          updatedAt: stamp
        }
        this.menus.push(created)
        idMap.set(menu.id, created.id)
        menusAdded += 1
      }
      if (menusAdded) await this.persistMenus()

      let notesImported = 0
      let notesSkipped = 0
      for (const note of sourceNotes) {
        const already = this.notes.has(note.id) || [...this.notes.values()].some((item) => item.sourceId === note.id)
        if (already && (mode === 'skip' || [...this.notes.values()].some((item) => item.sourceId === note.id))) {
          notesSkipped += 1
          continue
        }
        const menuId = idMap.get(note.menuId) ?? UNCATEGORIZED_ID
        if (this.notes.has(note.id) && mode === 'copy') {
          const copyId = randomUUID()
          await this.copyAssets(sourceRoot, note, copyId)
          const cloned: Note = {
            ...note,
            id: copyId,
            sourceId: note.id,
            menuId: this.menus.some((menu) => menu.id === menuId) ? menuId : UNCATEGORIZED_ID,
            body: note.body.split(`assets/${note.id}/`).join(`assets/${copyId}/`),
            updatedAt: now()
          }
          this.notes.set(copyId, cloned)
          await this.persistNote(cloned)
          notesImported += 1
          continue
        }
        await this.copyAssets(sourceRoot, note, note.id)
        const imported: Note = {
          ...note,
          menuId: this.menus.some((menu) => menu.id === menuId) ? menuId : UNCATEGORIZED_ID
        }
        this.notes.set(imported.id, imported)
        await this.persistNote(imported)
        notesImported += 1
      }
      await this.persistIndex()
      return { menusAdded, notesImported, notesSkipped, backupPath }
    })
  }

  private async addFromSource(
    noteId: string,
    sourcePath: string,
    onProgress?: (ratio: number) => void
  ): Promise<{ attachment: Attachment; duplicate: boolean }> {
    const note = this.requireNote(noteId)
    const real = await fs.realpath(sourcePath)
    const stat = await fs.stat(real)
    if (!stat.isFile()) throw new Error('只能添加文件')
    assertCapacity(stat.size, this.usedBytes(note))
    const filename = path.basename(real)
    const duplicate = note.attachments.some((item) => item.name === filename)
    const attachment = this.makeAttachment(filename, stat.size)
    const dest = this.assetFile(note.id, attachment)
    assertInside(this.root, dest)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    try {
      if (stat.size >= PROGRESS_MIN && onProgress) await this.copyProgress(real, dest, stat.size, onProgress)
      else await fs.copyFile(real, dest)
      const placed = await fs.realpath(dest)
      assertInside(this.root, placed)
    } catch (error) {
      await fs.rm(dest, { force: true })
      throw error
    }
    note.attachments.push(attachment)
    note.updatedAt = now()
    await this.persistNote(note)
    await this.persistIndex()
    return { attachment: { ...attachment }, duplicate }
  }

  private async copyProgress(source: string, dest: string, size: number, onProgress: (ratio: number) => void): Promise<void> {
    let copied = 0
    const reader = createReadStream(source)
    const writer = createWriteStream(dest)
    reader.on('data', (chunk) => {
      copied += chunk.length
      onProgress(Math.min(1, copied / size))
    })
    await pipeline(reader, writer)
  }

  private makeAttachment(filename: string, size: number): Attachment {
    const ext = safeExt(filename)
    return {
      id: randomUUID(),
      name: filename,
      ext,
      mime: mimeOf(ext),
      kind: detectKind(ext),
      size,
      createdAt: now()
    }
  }

  private async trashNote(note: Note): Promise<void> {
    const record: TrashNote = {
      id: note.id,
      kind: 'note',
      deletedAt: now(),
      menuId: note.menuId,
      menuPath: this.menuPath(note.menuId),
      note: {
        ...note,
        tags: [...note.tags],
        attachments: note.attachments.map((attachment) => ({ ...attachment }))
      }
    }
    await writeJson(path.join(this.root, 'trash', 'notes', `${note.id}.json`), record, false)
    this.trash = [record, ...this.trash.filter((item) => item.id !== note.id)]
    await this.persistTrashIndex()
    await this.moveAssetsToTrash(note.id)
    this.notes.delete(note.id)
    await fs.rm(path.join(this.root, 'notes', `${note.id}.json`), { force: true })
    await this.persistIndex()
  }

  private async moveAssetsToTrash(noteId: string): Promise<void> {
    const source = path.join(this.root, 'assets', noteId)
    const dest = path.join(this.root, 'trash', 'files', noteId)
    if (!(await exists(source))) return
    await fs.mkdir(path.dirname(dest), { recursive: true })
    if (!(await exists(dest))) {
      await fs.rename(source, dest)
      return
    }
    for (const name of await fs.readdir(source)) {
      const target = path.join(dest, name)
      await fs.rm(target, { force: true })
      await fs.rename(path.join(source, name), target)
    }
    await fs.rm(source, { recursive: true, force: true })
  }

  private async copyAssets(sourceRoot: string, note: Note, destId: string): Promise<void> {
    for (const attachment of note.attachments) {
      const source = path.join(sourceRoot, 'assets', note.id, `${attachment.id}${attachment.ext}`)
      if (!(await exists(source))) continue
      const dest = path.join(this.root, 'assets', destId, `${attachment.id}${attachment.ext}`)
      assertInside(this.root, dest)
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.copyFile(source, dest)
    }
  }

  private async readExternalNotes(sourceRoot: string): Promise<Note[]> {
    const dir = path.join(sourceRoot, 'notes')
    if (!(await exists(dir))) return []
    const notes: Note[] = []
    for (const name of await fs.readdir(dir)) {
      if (!name.endsWith('.json') || name === 'index.json') continue
      const note = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as Note
      note.tags ??= []
      note.attachments ??= []
      note.body ??= ''
      notes.push(note)
    }
    return notes
  }

  private orderMenus(nodes: MenuNode[]): MenuNode[] {
    const ordered: MenuNode[] = []
    const seen = new Set<string>()
    const visit = (menu: MenuNode) => {
      if (seen.has(menu.id)) return
      seen.add(menu.id)
      if (menu.parentId) {
        const parent = nodes.find((item) => item.id === menu.parentId)
        if (parent) visit(parent)
      }
      ordered.push(menu)
    }
    nodes.forEach(visit)
    return ordered
  }

  private assetFile(noteId: string, attachment: Pick<Attachment, 'id' | 'ext'>): string {
    return path.join(this.root, 'assets', noteId, `${attachment.id}${attachment.ext}`)
  }

  private trashFile(noteId: string, attachment: Pick<Attachment, 'id' | 'ext'>): string {
    return path.join(this.root, 'trash', 'files', noteId, `${attachment.id}${attachment.ext}`)
  }

  private usedBytes(note: Note): number {
    return note.attachments.reduce((sum, attachment) => sum + attachment.size, 0)
  }

  private requireMenu(id: string): MenuNode {
    const menu = this.menus.find((item) => item.id === id)
    if (!menu) throw new Error('菜单不存在')
    return menu
  }

  private requireNote(id: string): Note {
    const note = this.notes.get(id)
    if (!note) throw new Error('知识点不存在')
    return note
  }

  private nextSort(parentId: string | null): number {
    const sorts = this.menus.filter((menu) => menu.parentId === parentId && menu.id !== UNCATEGORIZED_ID).map((menu) => menu.sort)
    return sorts.length ? Math.max(...sorts) + 1 : 0
  }

  private nextNoteSort(menuId: string): number {
    const sorts = [...this.notes.values()].filter((note) => note.menuId === menuId).map((note) => note.sort)
    return sorts.length ? Math.max(...sorts) + 1 : 0
  }

  private descendantIds(id: string): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const walk = (parentId: string) => {
      for (const menu of this.menus) {
        if (menu.parentId === parentId && !seen.has(menu.id)) {
          seen.add(menu.id)
          out.push(menu.id)
          walk(menu.id)
        }
      }
    }
    walk(id)
    return out
  }

  private isInside(id: string, ancestor: string): boolean {
    let current = this.menus.find((menu) => menu.id === id)
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      if (current.id === ancestor) return true
      seen.add(current.id)
      const parentId = current.parentId
      current = parentId ? this.menus.find((menu) => menu.id === parentId) : undefined
    }
    return false
  }

  menuPath(id: string): string {
    const names: string[] = []
    let current = this.menus.find((menu) => menu.id === id)
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      names.push(current.name)
      const parentId = current.parentId
      current = parentId ? this.menus.find((menu) => menu.id === parentId) : undefined
    }
    return names.reverse().join(' / ')
  }

  private async withMissing(note: Note): Promise<Note> {
    const attachments: Attachment[] = []
    for (const attachment of note.attachments) {
      attachments.push({ ...attachment, missing: !(await exists(this.assetFile(note.id, attachment))) })
    }
    return { ...note, tags: [...note.tags], attachments }
  }

  private cloneNote(note: Note): Note {
    return {
      ...note,
      tags: [...note.tags],
      attachments: note.attachments.map((attachment) => ({ ...attachment }))
    }
  }

  private async persistMenus(): Promise<void> {
    await writeJson(path.join(this.root, 'menus.json'), { nodes: this.menus }, true)
  }

  private async persistNote(note: Note): Promise<void> {
    const file = path.join(this.root, 'notes', `${note.id}.json`)
    assertInside(this.root, file)
    await writeJson(file, note, false)
  }

  private async persistIndex(): Promise<void> {
    await writeJson(path.join(this.root, 'notes', 'index.json'), { items: this.listSummaries() }, false)
  }

  private async persistTrashIndex(): Promise<void> {
    const items = this.trash.map((item) =>
      item.kind === 'note'
        ? { id: item.id, kind: 'note' as const }
        : item
    )
    await writeJson(path.join(this.root, 'trash', 'index.json'), { items }, false)
  }
}
