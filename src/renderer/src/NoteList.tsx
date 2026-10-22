import { useState } from 'react'
import { KIND_LABEL, formatWhen } from '../../shared/rules'
import type { NoteSummary, SortMode } from '../../shared/types'

const ROW = 84

export function NoteList({
  items,
  selectedId,
  checked,
  sortMode,
  includeChildren,
  tagFilter,
  tags,
  pathOf,
  showPath,
  customOrder,
  onSortMode,
  onIncludeChildren,
  onTagFilter,
  onOpen,
  onCheck,
  onCreate,
  onDelete,
  onReorder
}: {
  items: NoteSummary[]
  selectedId: string | null
  checked: Set<string>
  sortMode: SortMode
  includeChildren: boolean
  tagFilter: string
  tags: string[]
  pathOf: (menuId: string) => string
  showPath: boolean
  customOrder: boolean
  onSortMode: (mode: SortMode) => void
  onIncludeChildren: (value: boolean) => void
  onTagFilter: (tag: string) => void
  onOpen: (id: string) => void
  onCheck: (id: string, mode: 'toggle' | 'range' | 'only') => void
  onCreate: () => void
  onDelete: (id: string) => void
  onReorder: (orderedIds: string[]) => void
}): React.ReactElement {
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)
  const [dragId, setDragId] = useState<string | null>(null)
  const start = Math.max(0, Math.floor(scrollTop / ROW) - 6)
  const end = Math.min(items.length, start + Math.ceil(height / ROW) + 12)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <button className="rounded bg-sky-700 px-2 py-1 text-sm text-white" onClick={onCreate}>
          + 新建
        </button>
        <select className="rounded border border-zinc-300 bg-transparent px-1 py-1 text-sm dark:border-zinc-700" value={sortMode} onChange={(event) => onSortMode(event.target.value as SortMode)}>
          <option value="updated">更新时间</option>
          <option value="created">创建时间</option>
          <option value="title">标题</option>
          <option value="custom">自定义顺序</option>
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={includeChildren} onChange={(event) => onIncludeChildren(event.target.checked)} />
          包含子分类
        </label>
        <select className="rounded border border-zinc-300 bg-transparent px-1 py-1 text-sm dark:border-zinc-700" value={tagFilter} onChange={(event) => onTagFilter(event.target.value)}>
          <option value="">全部标签</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        ref={(node) => {
          if (node && node.clientHeight !== height) setHeight(node.clientHeight)
        }}
      >
        {items.length === 0 ? (
          <div className="px-4 py-8 text-sm text-zinc-500">
            这个菜单下还没有知识点。
            <button className="ml-2 text-sky-700 dark:text-sky-300" onClick={onCreate}>
              新建知识点
            </button>
          </div>
        ) : (
          <div style={{ height: items.length * ROW, position: 'relative' }}>
            {items.slice(start, end).map((item, offset) => {
              const index = start + offset
              return (
                <div
                  key={item.id}
                  style={{ position: 'absolute', top: index * ROW, height: ROW, left: 0, right: 0 }}
                  className={`flex cursor-pointer gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800 ${
                    selectedId === item.id ? 'bg-sky-50 dark:bg-sky-950/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                  draggable={customOrder}
                  onDragStart={(event) => {
                    setDragId(item.id)
                    event.dataTransfer.setData('application/x-note', item.id)
                    event.dataTransfer.setData('text/plain', item.title)
                  }}
                  onDragOver={(event) => {
                    if (!customOrder) return
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    if (!customOrder || !dragId) return
                    event.preventDefault()
                    const ordered = items.map((note) => note.id)
                    const from = ordered.indexOf(dragId)
                    const to = ordered.indexOf(item.id)
                    if (from < 0 || to < 0 || from === to) return
                    ordered.splice(from, 1)
                    ordered.splice(to, 0, dragId)
                    onReorder(ordered)
                  }}
                  onClick={(event) => {
                    if (event.ctrlKey || event.metaKey) onCheck(item.id, 'toggle')
                    else if (event.shiftKey) onCheck(item.id, 'range')
                    else {
                      onCheck(item.id, 'only')
                      onOpen(item.id)
                    }
                  }}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked.has(item.id)}
                    onChange={() => onCheck(item.id, 'toggle')}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{item.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-zinc-500">{formatWhen(item.updatedAt)}</span>
                    </div>
                    <div className="truncate text-xs text-zinc-500">{item.snippet || '没有正文'}</div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                      {showPath && <span className="truncate">{pathOf(item.menuId)}</span>}
                      {item.kinds.map((kind) => (
                        <span key={kind} className="rounded bg-zinc-200 px-1 dark:bg-zinc-800">
                          {KIND_LABEL[kind]}
                        </span>
                      ))}
                      {item.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                          {tag}
                        </span>
                      ))}
                      <button
                        className="ml-auto text-zinc-400 hover:text-red-600"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDelete(item.id)
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {scrollTop > height && (
          <button
            className="sticky bottom-3 left-[calc(100%-88px)] rounded bg-zinc-800 px-2 py-1 text-xs text-white"
            onClick={(event) => {
              event.currentTarget.parentElement?.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            回到顶部
          </button>
        )}
      </div>
    </div>
  )
}
