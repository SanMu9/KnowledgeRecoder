import { useEffect, useMemo, useRef, useState } from 'react'
import { assetMarkdownPath, formatBytes, formatWhen, toSummary } from '../../shared/rules'
import {
  UNCATEGORIZED_ID,
  defaultSettings,
  type Bootstrap,
  type EditorLayout,
  type MenuNode,
  type Note,
  type NoteSummary,
  type SearchResult,
  type Settings,
  type SortMode,
  type TrashListItem
} from '../../shared/types'
import { MenuTree } from './MenuTree'
import { NoteList } from './NoteList'
import { NoteView } from './NoteView'
import { HighlightText } from './markdown'

type Draft = { title: string; body: string; tags: string[] }
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
type DialogState =
  | { kind: 'confirm'; title: string; body: string; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }
  | { kind: 'choose'; title: string; body: string; options: string[]; resolve: (value: string | null) => void }
  | { kind: 'prompt'; title: string; placeholder: string; resolve: (value: string | null) => void }
  | { kind: 'menu'; title: string; options: { id: string; label: string }[]; resolve: (id: string | null) => void }

const emptyDraft = (): Draft => ({ title: '', body: '', tags: [] })

export default function App(): React.ReactElement {
  const [bootError, setBootError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [dataDir, setDataDir] = useState('')
  const [version, setVersion] = useState('')
  const [menus, setMenus] = useState<MenuNode[]>([])
  const [summaries, setSummaries] = useState<NoteSummary[]>([])
  const [settings, setSettings] = useState<Settings>(defaultSettings())
  const [repairs, setRepairs] = useState<string[]>([])
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Note | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft())
  const [editing, setEditing] = useState(false)
  const [layout, setLayout] = useState<EditorLayout>('split')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [saveError, setSaveError] = useState('')
  const [focusTitle, setFocusTitle] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<SearchResult | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [panel, setPanel] = useState<'library' | 'trash' | 'settings'>('library')
  const [trash, setTrash] = useState<TrashListItem[]>([])
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [progress, setProgress] = useState<{ name: string; ratio: number } | null>(null)
  const [fileDrag, setFileDrag] = useState(false)
  const [healthText, setHealthText] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const savedRef = useRef<Note | null>(null)
  const draftRef = useRef<Draft>(emptyDraft())
  const flushRef = useRef<() => Promise<boolean>>(async () => true)
  const lastCheck = useRef<string | null>(null)
  const toastId = useRef(1)
  savedRef.current = saved
  draftRef.current = draft

  function toast(text: string): void {
    const id = toastId.current++
    setToasts((list) => [...list, { id, text }])
    setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 3200)
  }

  function confirmDialog(title: string, body: string, confirmLabel: string, danger = false): Promise<boolean> {
    return new Promise((resolve) => setDialog({ kind: 'confirm', title, body, confirmLabel, danger, resolve }))
  }
  function choose(title: string, body: string, options: string[]): Promise<string | null> {
    return new Promise((resolve) => setDialog({ kind: 'choose', title, body, options, resolve }))
  }
  function prompt(title: string, placeholder: string): Promise<string | null> {
    return new Promise((resolve) => setDialog({ kind: 'prompt', title, placeholder, resolve }))
  }
  function pickMenu(title: string, options: { id: string; label: string }[]): Promise<string | null> {
    return new Promise((resolve) => setDialog({ kind: 'menu', title, options, resolve }))
  }

  function menuPath(id: string): string {
    const names: string[] = []
    let current = menus.find((menu) => menu.id === id)
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      names.push(current.name)
      const parentId = current.parentId
      current = parentId ? menus.find((menu) => menu.id === parentId) : undefined
    }
    return names.reverse().join(' / ')
  }

  function applyBoot(data: Bootstrap): void {
    setBootError(null)
    setDataDir(data.dataDir)
    setVersion(data.version)
    setMenus(data.menus)
    setSummaries(data.summaries)
    setSettings(data.settings)
    setRepairs(data.repairs)
    const roots = data.menus.filter((menu) => !menu.parentId).map((menu) => menu.id)
    setExpanded(new Set(data.settings.expandedMenuIds.length ? data.settings.expandedMenuIds : roots))
    const menuId = data.menus.some((menu) => menu.id === data.settings.selectedMenuId)
      ? data.settings.selectedMenuId
      : (data.menus.find((menu) => !menu.parentId)?.id ?? null)
    setSelectedMenuId(menuId)
    setReady(true)
    if (data.settings.selectedNoteId && data.summaries.some((item) => item.id === data.settings.selectedNoteId)) {
      void openNote(data.settings.selectedNoteId, true)
    }
  }

  useEffect(() => {
    let cancel = false
    void window.api.bootstrap().then((result) => {
      if (cancel) return
      if ('error' in result) {
        setBootError(result.error)
        setSettings(result.settings)
        setReady(true)
        return
      }
      applyBoot(result)
    })
    return () => {
      cancel = true
    }
  }, [])

  useEffect(() => {
    const dark =
      settings.theme === 'dark' ||
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
    if (settings.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => document.documentElement.classList.toggle('dark', media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [settings.theme])

  useEffect(() => window.api.onProgress(setProgress), [])
  useEffect(() => window.api.onRequestClose(() => {
    void flushRef.current().then((ok) => {
      if (ok) window.api.closeReady()
    })
  }), [])

  async function flush(): Promise<boolean> {
    const current = savedRef.current
    const next = draftRef.current
    if (!current) return true
    if (current.title === next.title && current.body === next.body && current.tags.join('\n') === next.tags.join('\n')) {
      setSaveState('saved')
      return true
    }
    setSaveState('saving')
    try {
      const note = await window.api.saveNote({ id: current.id, title: next.title, body: next.body, tags: next.tags })
      savedRef.current = note
      setSaved(note)
      setSummaries((list) => list.map((item) => (item.id === note.id ? toSummary(note) : item)))
      const still = draftRef.current
      if (still.title === note.title && still.body === note.body && still.tags.join('\n') === note.tags.join('\n')) setSaveState('saved')
      else setSaveState('dirty')
      return true
    } catch (error) {
      setSaveState('error')
      setSaveError(errorText(error))
      return false
    }
  }
  flushRef.current = flush

  useEffect(() => {
    if (saveState !== 'dirty') return
    const timer = window.setTimeout(() => void flushRef.current(), 1000)
    return () => window.clearTimeout(timer)
  }, [saveState, draft.title, draft.body, draft.tags])

  useEffect(() => {
    const text = query.trim()
    if (!text) {
      setSearch(null)
      return
    }
    const timer = window.setTimeout(() => {
      void window.api.search(text).then(setSearch)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  function updateDraft(patch: Partial<Draft>): void {
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    setDraft(next)
    setSaveState('dirty')
    setSaveError('')
  }

  async function openNote(id: string, skipFlush = false): Promise<void> {
    if (!skipFlush) {
      const ok = await flush()
      if (!ok) return
    }
    const note = await window.api.getNote(id)
    savedRef.current = note
    const next = { title: note.title, body: note.body, tags: [...note.tags] }
    draftRef.current = next
    setSaved(note)
    setDraft(next)
    setEditing(false)
    setSaveState('saved')
    setSelectedMenuId(note.menuId)
    expandTo(note.menuId)
    setPanel('library')
    void window.api.saveSettings({ selectedMenuId: note.menuId, selectedNoteId: note.id })
  }

  function expandTo(menuId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      let current = menus.find((menu) => menu.id === menuId)
      const seen = new Set<string>()
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        next.add(current.id)
        const parentId = current.parentId
        current = parentId ? menus.find((menu) => menu.id === parentId) : undefined
      }
      return next
    })
  }

  async function selectMenu(id: string): Promise<void> {
    const ok = await flush()
    if (!ok) return
    setSelectedMenuId(id)
    setPanel('library')
    setSearch(null)
    setQuery('')
    void window.api.saveSettings({ selectedMenuId: id })
  }

  async function createNote(): Promise<void> {
    if (!selectedMenuId) {
      toast('请先选择菜单')
      return
    }
    const ok = await flush()
    if (!ok) return
    const note = await window.api.createNote(selectedMenuId)
    savedRef.current = note
    const next = { title: note.title, body: note.body, tags: [...note.tags] }
    draftRef.current = next
    setSaved(note)
    setDraft(next)
    setSummaries((list) => [toSummary(note), ...list.filter((item) => item.id !== note.id)])
    setEditing(true)
    setFocusTitle(true)
    setSaveState('saved')
    setPanel('library')
  }

  async function refreshNote(id: string): Promise<void> {
    const note = await window.api.getNote(id)
    if (savedRef.current?.id !== id) return
    savedRef.current = note
    setSaved(note)
    setSummaries((list) => list.map((item) => (item.id === id ? toSummary(note) : item)))
  }

  async function addPaths(paths: string[]): Promise<void> {
    const note = savedRef.current
    if (!note) {
      toast('请先打开一条知识点')
      return
    }
    const onlyMd = paths.length === 1 && /\.(md|markdown)$/i.test(paths[0])
    if (onlyMd) {
      const choice = await choose('添加 Markdown', '这份文件要怎么处理？', ['并入正文', '作为附件', '取消'])
      if (!choice || choice === '取消') return
      if (choice === '并入正文') {
        try {
          const text = await window.api.readUtf8(paths[0])
          if (draftRef.current.body.trim()) {
            const how = await choose('正文已有内容', '替换现有正文，还是追加到末尾？', ['替换正文', '追加到末尾', '取消'])
            if (!how || how === '取消') return
            updateDraft({ body: how === '替换正文' ? text : `${draftRef.current.body}\n\n${text}` })
          } else updateDraft({ body: text })
        } catch (error) {
          toast(errorText(error))
        }
        return
      }
    }
    for (const filePath of paths) {
      try {
        const result = await window.api.addFile(note.id, filePath)
        if (result.duplicate) toast(`已存在同名附件「${result.attachment.name}」，已再保留一份`)
        if (result.attachment.kind === 'image') {
          const rel = assetMarkdownPath(note.id, result.attachment)
          if (!draftRef.current.body.includes(rel)) updateDraft({ body: `${draftRef.current.body}\n![](${rel})\n` })
        }
      } catch (error) {
        toast(errorText(error))
      }
    }
    await refreshNote(note.id)
  }

  useEffect(() => {
    const over = (event: DragEvent) => {
      if ([...(event.dataTransfer?.types ?? [])].includes('Files')) {
        event.preventDefault()
        setFileDrag(true)
      }
    }
    const drop = (event: DragEvent) => {
      if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return
      const handled = event.defaultPrevented
      event.preventDefault()
      setFileDrag(false)
      if (handled) return
      const paths = [...(event.dataTransfer?.files ?? [])].map((file) => window.api.pathForFile(file)).filter(Boolean)
      if (paths.length) void addPaths(paths)
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (meta && key === 'n') {
        event.preventDefault()
        void createNote()
      } else if (meta && key === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (meta && key === 's') {
        event.preventDefault()
        void flushRef.current()
      } else if (meta && key === 'e') {
        event.preventDefault()
        void toggleEdit()
      } else if (event.key === 'Escape') {
        if (dialog) {
          closeDialog(null)
          return
        }
        const target = event.target as HTMLElement | null
        if (!target?.closest('input, textarea') && editing) setEditing(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function toggleEdit(): Promise<void> {
    if (!savedRef.current) return
    if (editing) {
      const ok = await flush()
      if (!ok) return
      setEditing(false)
    } else setEditing(true)
  }

  function closeDialog(value: string | boolean | null): void {
    setDialog((current) => {
      if (!current) return null
      if (current.kind === 'confirm') current.resolve(Boolean(value))
      else current.resolve(typeof value === 'string' ? value : null)
      return null
    })
  }

  const visible = useMemo(() => {
    if (!selectedMenuId) return []
    const ids = new Set<string>([selectedMenuId])
    if (settings.includeChildren) {
      const walk = (parentId: string) => {
        for (const menu of menus) {
          if (menu.parentId === parentId && !ids.has(menu.id)) {
            ids.add(menu.id)
            walk(menu.id)
          }
        }
      }
      walk(selectedMenuId)
    }
    const items = summaries.filter((item) => ids.has(item.menuId))
    return sortNotes(items, settings.sortMode)
  }, [summaries, menus, selectedMenuId, settings.includeChildren, settings.sortMode])

  const [tagFilter, setTagFilter] = useState('')
  const filtered = tagFilter ? visible.filter((item) => item.tags.includes(tagFilter)) : visible
  const tags = [...new Set(visible.flatMap((item) => item.tags))]

  async function reloadTrash(): Promise<void> {
    setTrash(await window.api.listTrash())
  }

  if (!ready) return <div className="grid h-full place-items-center text-sm text-zinc-500">正在打开知识数据…</div>
  if (bootError) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-lg space-y-3">
          <h1 className="text-xl font-semibold">无法打开知识数据</h1>
          <p>{bootError}</p>
          <div className="flex gap-2">
            <button className="rounded bg-sky-700 px-3 py-1 text-white" onClick={() => void window.api.switchDataDir().then((data) => data && applyBoot(data)).catch((error) => setBootError(errorText(error)))}>
              打开其他目录
            </button>
            <button className="rounded border border-zinc-300 px-3 py-1" onClick={() => void window.api.useDefaultDir().then(applyBoot).catch((error) => setBootError(errorText(error)))}>
              使用默认目录
            </button>
          </div>
        </div>
      </div>
    )
  }

  const checkedIds = [...checked].filter((id) => summaries.some((item) => item.id === id))

  return (
    <div className="flex h-full flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex h-12 items-center gap-3 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
        <strong className="shrink-0">知识点记录</strong>
        <input
          ref={searchRef}
          className="min-w-0 flex-1 rounded border border-zinc-300 bg-transparent px-3 py-1 dark:border-zinc-700"
          placeholder="搜索标题、正文、文件名、菜单"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className={`rounded px-2 py-1 text-sm ${panel === 'trash' ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`} onClick={() => { setPanel('trash'); void reloadTrash() }}>
          回收站
        </button>
        <button className={`rounded px-2 py-1 text-sm ${panel === 'settings' ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`} onClick={() => setPanel(panel === 'settings' ? 'library' : 'settings')}>
          设置
        </button>
      </header>
      {repairs.length > 0 && (
        <div className="flex items-start justify-between gap-3 bg-amber-100 px-3 py-2 text-sm text-amber-950">
          <span>{repairs.join('；')}</span>
          <button onClick={() => setRepairs([])}>知道了</button>
        </div>
      )}
      {progress && (
        <div className="bg-sky-100 px-3 py-1 text-xs text-sky-950">
          正在复制 {progress.name} {Math.round(progress.ratio * 100)}%
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" style={{ width: settings.menuWidth }}>
          <MenuTree
            menus={menus}
            summaries={summaries}
            selectedId={selectedMenuId}
            expanded={expanded}
            onToggle={(id) => {
              setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                void window.api.saveSettings({ expandedMenuIds: [...next] })
                return next
              })
            }}
            onSelect={(id) => void selectMenu(id)}
            onCreate={async (parentId, name) => {
              try {
                const menu = await window.api.createMenu(parentId, name)
                setMenus((list) => [...list, menu])
                setExpanded((prev) => new Set([...prev, menu.id, ...(parentId ? [parentId] : [])]))
                setSelectedMenuId(menu.id)
              } catch (error) {
                toast(errorText(error))
                throw error
              }
            }}
            onRename={async (id, name) => {
              try {
                const menu = await window.api.renameMenu(id, name)
                setMenus((list) => list.map((item) => (item.id === id ? menu : item)))
              } catch (error) {
                toast(errorText(error))
                throw error
              }
            }}
            onDelete={(id) => void deleteMenu(id)}
            onMove={(id, parentId, index) => void window.api.moveMenu(id, parentId, index).then(() => window.api.snapshot()).then((snap) => setMenus(snap.menus)).catch((error) => toast(errorText(error)))}
            onMoveNote={(noteId, menuId) => void window.api.moveNote(noteId, menuId).then(() => window.api.snapshot()).then((snap) => setSummaries(snap.summaries)).then(() => toast('已移动知识点')).catch((error) => toast(errorText(error)))}
          />
        </aside>
        <div className="w-1 cursor-col-resize bg-zinc-200 dark:bg-zinc-800" onMouseDown={(event) => startResize('menu', event)} />
        <section className="shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" style={{ width: settings.listWidth }}>
          {panel === 'trash' ? (
            <TrashList
              items={trash}
              onRestore={(id) => void restoreTrash(id)}
              onPurge={(id) => void purgeTrash(id)}
              onEmpty={() => void emptyTrash()}
              onBack={() => setPanel('library')}
            />
          ) : search ? (
            <SearchList result={search} onNote={(id) => void openNote(id)} onMenu={(id) => void selectMenu(id).then(() => expandTo(id))} />
          ) : (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <NoteList
                  items={filtered}
                  selectedId={saved?.id ?? null}
                  checked={checked}
                  sortMode={settings.sortMode}
                  includeChildren={settings.includeChildren}
                  tagFilter={tagFilter}
                  tags={tags}
                  pathOf={menuPath}
                  showPath={settings.includeChildren}
                  customOrder={settings.sortMode === 'custom' && !settings.includeChildren && !tagFilter}
                  onSortMode={(mode) => {
                    setSettings((prev) => ({ ...prev, sortMode: mode }))
                    void window.api.saveSettings({ sortMode: mode })
                  }}
                  onIncludeChildren={(value) => {
                    setSettings((prev) => ({ ...prev, includeChildren: value }))
                    void window.api.saveSettings({ includeChildren: value })
                  }}
                  onTagFilter={setTagFilter}
                  onOpen={(id) => void openNote(id)}
                  onCheck={onCheck}
                  onCreate={() => void createNote()}
                  onDelete={(id) => void deleteNote(id)}
                  onReorder={(orderedIds) => {
                    if (!selectedMenuId) return
                    void window.api.reorderNotes(selectedMenuId, orderedIds).then(() => window.api.snapshot()).then((snap) => setSummaries(snap.summaries))
                  }}
                />
              </div>
              {checkedIds.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-zinc-200 p-2 text-sm dark:border-zinc-800">
                  <span>已选 {checkedIds.length}</span>
                  <button onClick={() => void batchMove()}>移动</button>
                  <button onClick={() => void batchDelete()}>删除</button>
                  <button onClick={() => void batchTag()}>加标签</button>
                  <button onClick={() => setChecked(new Set())}>取消</button>
                </div>
              )}
            </div>
          )}
        </section>
        <div className="w-1 cursor-col-resize bg-zinc-200 dark:bg-zinc-800" onMouseDown={(event) => startResize('list', event)} />
        <main className={`relative min-w-0 flex-1 bg-white dark:bg-zinc-950 ${fileDrag ? 'outline outline-2 outline-sky-500' : ''}`}>
          {panel === 'settings' ? (
            <SettingsPanel
              dataDir={dataDir}
              version={version}
              theme={settings.theme}
              healthText={healthText}
              onTheme={(theme) => {
                setSettings((prev) => ({ ...prev, theme }))
                void window.api.saveSettings({ theme })
              }}
              onReveal={() => void window.api.revealDataDir()}
              onCopy={() => void navigator.clipboard.writeText(dataDir).then(() => toast('已复制路径'))}
              onExport={() => void window.api.exportBackup().then((result) => result && toast(`已导出 ${result.notes} 条，${formatBytes(result.bytes)}`)).catch((error) => toast(errorText(error)))}
              onImport={async (mode) => {
                const ok = await flush()
                if (!ok) return
                try {
                  const result = await window.api.importBackup(mode)
                  if (!result) return
                  const snap = await window.api.snapshot()
                  setMenus(snap.menus)
                  setSummaries(snap.summaries)
                  toast(`导入 ${result.notesImported} 条，跳过 ${result.notesSkipped} 条。备份在 ${result.backupPath}`)
                } catch (error) {
                  toast(errorText(error))
                }
              }}
              onSwitch={async () => {
                const ok = await flush()
                if (!ok) return
                try {
                  const data = await window.api.switchDataDir()
                  if (!data) return
                  setSaved(null)
                  savedRef.current = null
                  setDraft(emptyDraft())
                  applyBoot(data)
                  toast('已切换数据目录')
                } catch (error) {
                  toast(errorText(error))
                }
              }}
              onHealth={() => void window.api.health().then((health) => setHealthText(`知识点 ${health.notes}，附件 ${health.attachments}，占用 ${formatBytes(health.bytes)}，回收站 ${health.trashCount}（${formatBytes(health.trashBytes)}）${health.missing.length ? `，缺失 ${health.missing.length} 个文件` : ''}`))}
            />
          ) : (
            <NoteView
              note={saved}
              draft={draft}
              editing={editing}
              layout={layout}
              saveState={saveState}
              saveError={saveError}
              savedAt={saved?.updatedAt ?? ''}
              focusTitle={focusTitle}
              onDraft={updateDraft}
              onLayout={setLayout}
              onAddPaths={(paths) => void addPaths(paths)}
              onPasteImage={() => {
                const note = savedRef.current
                if (!note) return
                void window.api.pasteImage(note.id).then(async (attachment) => {
                  if (!attachment) {
                    toast('剪贴板里没有图片')
                    return
                  }
                  await refreshNote(note.id)
                  const rel = assetMarkdownPath(note.id, attachment)
                  if (!draftRef.current.body.includes(rel)) updateDraft({ body: `${draftRef.current.body}\n![](${rel})\n` })
                }).catch((error) => toast(errorText(error)))
              }}
              onPickFiles={() => {
                void window.api.pickFiles().then((paths) => {
                  if (paths.length) void addPaths(paths)
                })
              }}
              onRemove={(attachment) => {
                const note = savedRef.current
                if (!note) return
                void confirmDialog('移除附件', `「${attachment.name}」会进入回收站。`, '移除', true).then(async (ok) => {
                  if (!ok) return
                  const updated = await window.api.removeAttachment(note.id, attachment.id)
                  savedRef.current = updated
                  setSaved(updated)
                  setSummaries((list) => list.map((item) => (item.id === updated.id ? toSummary(updated) : item)))
                  toast('附件已移入回收站')
                })
              }}
              onRename={(attachment) => {
                const note = savedRef.current
                if (!note) return
                void prompt('修改显示名', attachment.name).then(async (name) => {
                  if (!name) return
                  const updated = await window.api.renameAttachment(note.id, attachment.id, name)
                  savedRef.current = updated
                  setSaved(updated)
                }).catch((error) => toast(errorText(error)))
              }}
              onOpen={(attachment) => {
                const note = savedRef.current
                if (!note) return
                void window.api.openAttachment(note.id, attachment.id).catch((error) => toast(errorText(error)))
              }}
              onReveal={(attachment) => {
                const note = savedRef.current
                if (!note) return
                void window.api.revealAttachment(note.id, attachment.id).catch((error) => toast(errorText(error)))
              }}
              onSaveAs={(attachment) => {
                const note = savedRef.current
                if (!note) return
                void window.api.saveAttachmentAs(note.id, attachment.id).catch((error) => toast(errorText(error)))
              }}
              onInserted={(rel) => {
                const note = savedRef.current
                if (!note) return
                void refreshNote(note.id).then(() => {
                  if (!draftRef.current.body.includes(rel)) updateDraft({ body: `${draftRef.current.body}\n![](${rel})\n` })
                })
              }}
            />
          )}
        </main>
      </div>
      <footer className="flex h-8 items-center gap-4 border-t border-zinc-200 bg-white px-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <span className="min-w-0 truncate">{selectedMenuId ? menuPath(selectedMenuId) : '未选择菜单'}</span>
        <span>{search ? `搜索 ${search.notes.length} 条` : `${filtered.length} 条`}</span>
        <button className="ml-auto truncate" onClick={() => void window.api.revealDataDir()}>
          {dataDir.split(/[/\\]/).pop()}
        </button>
      </footer>
      {fileDrag && <div className="pointer-events-none fixed bottom-12 left-1/2 -translate-x-1/2 rounded bg-sky-700 px-3 py-1 text-sm text-white">松开以添加文件</div>}
      <div className="fixed right-3 bottom-12 space-y-2">
        {toasts.map((item) => (
          <div key={item.id} className="max-w-sm rounded bg-zinc-900 px-3 py-2 text-sm text-white shadow">{item.text}</div>
        ))}
      </div>
      {dialog && <DialogView dialog={dialog} menus={menus} onClose={closeDialog} />}
    </div>
  )

  async function deleteMenu(id: string): Promise<void> {
    const impact = await window.api.menuImpact(id)
    const body = impact.childMenus || impact.notes
      ? `将删除 ${impact.childMenus} 个子菜单，并把 ${impact.notes} 条知识点移入回收站。`
      : '删除这个空菜单？'
    const ok = await confirmDialog('删除菜单', body, '删除', true)
    if (!ok) return
    await window.api.deleteMenu(id)
    const snap = await window.api.snapshot()
    setMenus(snap.menus)
    setSummaries(snap.summaries)
    if (selectedMenuId === id) setSelectedMenuId(snap.menus.find((menu) => !menu.parentId)?.id ?? null)
    if (saved && !snap.summaries.some((item) => item.id === saved.id)) {
      setSaved(null)
      savedRef.current = null
    }
    toast('已删除')
  }

  async function deleteNote(id: string): Promise<void> {
    const ok = await confirmDialog('删除知识点', '删除后将进入回收站，可以恢复。', '删除', true)
    if (!ok) return
    await window.api.deleteNote(id)
    setSummaries((list) => list.filter((item) => item.id !== id))
    if (savedRef.current?.id === id) {
      setSaved(null)
      savedRef.current = null
      setDraft(emptyDraft())
    }
    toast('已移入回收站，可在回收站恢复')
  }

  async function restoreTrash(id: string): Promise<void> {
    const result = await window.api.restore(id)
    const snap = await window.api.snapshot()
    setMenus(snap.menus)
    setSummaries(snap.summaries)
    await reloadTrash()
    if (result.menuMissing) toast('原菜单已不在，已放入「未分类」')
    else toast('已恢复')
    if (result.noteId) await openNote(result.noteId, true)
  }

  async function purgeTrash(id: string): Promise<void> {
    const item = trash.find((entry) => entry.id === id)
    const ok = await confirmDialog('彻底删除', `彻底删除后无法恢复，将释放 ${formatBytes(item?.bytes ?? 0)}。`, '彻底删除', true)
    if (!ok) return
    await window.api.purge(id)
    await reloadTrash()
  }

  async function emptyTrash(): Promise<void> {
    const bytes = trash.reduce((sum, item) => sum + item.bytes, 0)
    const ok = await confirmDialog('清空回收站', `将永久删除 ${trash.length} 项，释放 ${formatBytes(bytes)}。`, '清空', true)
    if (!ok) return
    await window.api.emptyTrash()
    setTrash([])
  }

  async function batchMove(): Promise<void> {
    const menuId = await pickMenu('移动到菜单', menus.map((menu) => ({ id: menu.id, label: menuPath(menu.id) })))
    if (!menuId) return
    await window.api.batchMove(checkedIds, menuId)
    setSummaries((await window.api.snapshot()).summaries)
    setChecked(new Set())
  }

  async function batchDelete(): Promise<void> {
    const ok = await confirmDialog('批量删除', `将 ${checkedIds.length} 条知识点移入回收站。`, '删除', true)
    if (!ok) return
    await window.api.batchDelete(checkedIds)
    setSummaries((await window.api.snapshot()).summaries)
    setChecked(new Set())
    if (saved && checkedIds.includes(saved.id)) {
      setSaved(null)
      savedRef.current = null
    }
  }

  async function batchTag(): Promise<void> {
    const tag = await prompt('添加标签', '')
    if (!tag) return
    const result = await window.api.batchTag(checkedIds, tag)
    setSummaries((await window.api.snapshot()).summaries)
    if (result.skipped.length) toast(`有 ${result.skipped.length} 条已有 10 个标签，已跳过`)
    else toast(`已给 ${result.tagged} 条加上标签`)
  }

  function onCheck(id: string, mode: 'toggle' | 'range' | 'only'): void {
    setChecked((prev) => {
      const next = new Set(mode === 'only' ? [] : prev)
      if (mode === 'toggle') {
        if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      if (mode === 'range' && lastCheck.current) {
        const ids = filtered.map((item) => item.id)
        const from = ids.indexOf(lastCheck.current)
        const to = ids.indexOf(id)
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from]
          for (let index = start; index <= end; index += 1) next.add(ids[index])
        }
      }
      return next
    })
    if (mode !== 'range') lastCheck.current = id
  }

  function startResize(which: 'menu' | 'list', event: React.MouseEvent): void {
    event.preventDefault()
    const startX = event.clientX
    const key = which === 'menu' ? 'menuWidth' : 'listWidth'
    const start = settings[key]
    const min = which === 'menu' ? 200 : 240
    const max = which === 'menu' ? 480 : 520
    const move = (ev: MouseEvent) => {
      const next = Math.max(min, Math.min(max, start + ev.clientX - startX))
      setSettings((prev) => ({ ...prev, [key]: next }))
    }
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const next = Math.max(min, Math.min(max, start + ev.clientX - startX))
      void window.api.saveSettings({ [key]: next })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
}

function sortNotes(items: NoteSummary[], mode: SortMode): NoteSummary[] {
  const copy = [...items]
  if (mode === 'created') copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  else if (mode === 'title') copy.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  else if (mode === 'custom') copy.sort((a, b) => a.sort - b.sort)
  else copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return copy
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败'
}

function SearchList({ result, onNote, onMenu }: { result: SearchResult; onNote: (id: string) => void; onMenu: (id: string) => void }): React.ReactElement {
  if (!result.notes.length && !result.menus.length) return <div className="p-4 text-sm text-zinc-500">没有匹配项</div>
  return (
    <div className="h-full overflow-auto">
      {result.menus.length > 0 && <p className="px-3 pt-2 text-xs text-zinc-500">菜单</p>}
      {result.menus.map((menu) => (
        <button key={menu.id} className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900" onClick={() => onMenu(menu.id)}>
          <HighlightText text={menu.path} words={result.words} />
        </button>
      ))}
      {result.notes.length > 0 && <p className="px-3 pt-2 text-xs text-zinc-500">知识点</p>}
      {result.notes.map((note) => (
        <button key={note.id} className="block w-full border-b border-zinc-100 px-3 py-2 text-left dark:border-zinc-800" onClick={() => onNote(note.id)}>
          <div className="font-medium"><HighlightText text={note.title} words={result.words} /></div>
          <div className="text-xs text-zinc-500">{note.menuPath} · {formatWhen(note.updatedAt)}</div>
          {note.snippets.map((snippet) => (
            <div key={snippet} className="truncate text-xs"><HighlightText text={snippet} words={result.words} /></div>
          ))}
        </button>
      ))}
      {result.hiddenNotes > 0 && <p className="px-3 py-2 text-xs text-zinc-500">还有 {result.hiddenNotes} 条未展示</p>}
    </div>
  )
}

function TrashList(props: {
  items: TrashListItem[]
  onRestore: (id: string) => void
  onPurge: (id: string) => void
  onEmpty: () => void
  onBack: () => void
}): React.ReactElement {
  const bytes = props.items.reduce((sum, item) => sum + item.bytes, 0)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        <button onClick={props.onBack}>返回</button>
        <span className="font-medium">回收站</span>
        <span className="text-xs text-zinc-500">{formatBytes(bytes)}</span>
        <button className="ml-auto text-red-600" onClick={props.onEmpty} disabled={!props.items.length}>清空</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {props.items.length === 0 && <p className="p-4 text-sm text-zinc-500">回收站是空的。删除的知识点和附件会留在这里。</p>}
        {props.items.map((item) => (
          <div key={item.id} className="border-b border-zinc-100 px-3 py-2 text-sm dark:border-zinc-800">
            <div className="font-medium">{item.kind === 'note' ? item.title : item.title}</div>
            <div className="text-xs text-zinc-500">
              {item.kind === 'attachment' ? `附件 · 来自 ${item.noteTitle}` : item.menuPath} · {formatWhen(item.deletedAt)} · {formatBytes(item.bytes)}
            </div>
            <div className="mt-1 flex gap-2 text-xs">
              <button className="text-sky-700" onClick={() => props.onRestore(item.id)}>恢复</button>
              <button className="text-red-600" onClick={() => props.onPurge(item.id)}>彻底删除</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsPanel(props: {
  dataDir: string
  version: string
  theme: Settings['theme']
  healthText: string
  onTheme: (theme: Settings['theme']) => void
  onReveal: () => void
  onCopy: () => void
  onExport: () => void
  onImport: (mode: 'skip' | 'copy') => void
  onSwitch: () => void
  onHealth: () => void
}): React.ReactElement {
  return (
    <div className="h-full overflow-auto p-6">
      <h1 className="mb-4 text-xl font-semibold">设置</h1>
      <section className="mb-6 space-y-2">
        <h2 className="font-medium">数据目录</h2>
        <p className="break-all text-sm text-zinc-600 dark:text-zinc-300">{props.dataDir}</p>
        <div className="flex flex-wrap gap-2 text-sm">
          <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={props.onCopy}>复制路径</button>
          <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={props.onReveal}>在资源管理器中打开</button>
          <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={props.onSwitch}>打开其他目录</button>
          <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={props.onExport}>导出备份</button>
          <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={() => props.onImport('skip')}>导入（跳过已存在）</button>
          <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={() => props.onImport('copy')}>导入（已存在则做副本）</button>
        </div>
      </section>
      <section className="mb-6 space-y-2">
        <h2 className="font-medium">外观</h2>
        <select className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" value={props.theme} onChange={(event) => props.onTheme(event.target.value as Settings['theme'])}>
          <option value="system">跟随系统</option>
          <option value="light">浅色</option>
          <option value="dark">深色</option>
        </select>
      </section>
      <section className="mb-6 space-y-2 text-sm">
        <h2 className="font-medium">快捷键</h2>
        <p>Ctrl+N 新建知识点，Ctrl+F 搜索，Ctrl+S 保存，Ctrl+E 切换查看和编辑，Esc 关闭弹层。</p>
      </section>
      <section className="mb-6 space-y-2">
        <h2 className="font-medium">数据检查</h2>
        <button className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700" onClick={props.onHealth}>开始检查</button>
        {props.healthText && <p className="text-sm">{props.healthText}</p>}
      </section>
      <p className="text-sm text-zinc-500">版本 {props.version}</p>
    </div>
  )
}

function DialogView({ dialog, onClose }: { dialog: DialogState; menus: MenuNode[]; onClose: (value: string | boolean | null) => void }): React.ReactElement {
  const [value, setValue] = useState(dialog.kind === 'prompt' ? dialog.placeholder : '')
  const [menuId, setMenuId] = useState(dialog.kind === 'menu' ? dialog.options[0]?.id ?? '' : '')
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40">
      <div className="w-[420px] rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-900">
        <h2 className="text-lg font-semibold">{dialog.title}</h2>
        {dialog.kind !== 'prompt' && dialog.kind !== 'menu' && <p className="mt-2 text-sm">{dialog.kind === 'confirm' || dialog.kind === 'choose' ? dialog.body : ''}</p>}
        {dialog.kind === 'prompt' && (
          <input autoFocus className="mt-3 w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950" defaultValue={dialog.placeholder} onChange={(event) => setValue(event.target.value)} />
        )}
        {dialog.kind === 'menu' && (
          <select className="mt-3 w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700" value={menuId} onChange={(event) => setMenuId(event.target.value)}>
            {dialog.options.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="rounded px-3 py-1" onClick={() => onClose(null)}>取消</button>
          {dialog.kind === 'confirm' && (
            <button className={`rounded px-3 py-1 text-white ${dialog.danger ? 'bg-red-600' : 'bg-sky-700'}`} onClick={() => onClose(true)}>
              {dialog.confirmLabel}
            </button>
          )}
          {dialog.kind === 'choose' && dialog.options.filter((option) => option !== '取消').map((option) => (
            <button key={option} className="rounded bg-sky-700 px-3 py-1 text-white" onClick={() => onClose(option)}>{option}</button>
          ))}
          {dialog.kind === 'prompt' && <button className="rounded bg-sky-700 px-3 py-1 text-white" onClick={() => onClose(value)}>确定</button>}
          {dialog.kind === 'menu' && <button className="rounded bg-sky-700 px-3 py-1 text-white" onClick={() => onClose(menuId)}>移动</button>}
        </div>
      </div>
    </div>
  )
}
