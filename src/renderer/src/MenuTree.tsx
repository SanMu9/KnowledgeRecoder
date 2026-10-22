import { useEffect, useState } from 'react'
import { UNCATEGORIZED_ID, type MenuNode, type NoteSummary } from '../../shared/types'

type DropPos = 'before' | 'inside' | 'after'
type ContextAction = { id: string; x: number; y: number; fixed: boolean }

export function MenuTree({
  menus,
  summaries,
  selectedId,
  expanded,
  onToggle,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onMove,
  onMoveNote
}: {
  menus: MenuNode[]
  summaries: NoteSummary[]
  selectedId: string | null
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onCreate: (parentId: string | null, name: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => void
  onMove: (id: string, parentId: string | null, index: number) => void
  onMoveNote: (noteId: string, menuId: string) => void
}): React.ReactElement {
  const [creating, setCreating] = useState<string | null | undefined>(undefined)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null)
  const [action, setAction] = useState<ContextAction | null>(null)
  const roots = childrenOf(menus, null)

  function beginCreate(parentId: string | null): void {
    setAction(null)
    setRenaming(null)
    setCreating(parentId)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium">菜单</span>
        <button className="rounded px-2 py-1 text-sm hover:bg-zinc-200 dark:hover:bg-zinc-800" onClick={() => beginCreate(null)}>
          + 根菜单
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {roots.length === 0 && creating === undefined && (
          <div className="px-2 py-6 text-sm text-zinc-500">还没有菜单。先新建一个根菜单。</div>
        )}
        {roots.map((menu) => (
          <MenuRow
            key={menu.id}
            menu={menu}
            depth={0}
            menus={menus}
            summaries={summaries}
            selectedId={selectedId}
            expanded={expanded}
            renaming={renaming}
            creatingId={creating}
            drop={drop}
            onToggle={onToggle}
            onSelect={onSelect}
            onContextMenu={setAction}
            onRename={async (id, name) => {
              try {
                await onRename(id, name)
                setRenaming(null)
              } catch {
                /* 上层已提示 */
              }
            }}
            onRenameCancel={() => setRenaming(null)}
            onCreateSubmit={async (parentId, name) => {
              try {
                await onCreate(parentId, name)
                setCreating(undefined)
              } catch {
                /* 上层已提示 */
              }
            }}
            onCreateCancel={() => setCreating(undefined)}
            onDropMenu={onMove}
            onDropNote={onMoveNote}
            onDropTarget={setDrop}
          />
        ))}
        {creating === null && (
          <NameInput
            depth={0}
            onSubmit={async (name) => {
              try {
                await onCreate(null, name)
                setCreating(undefined)
              } catch {
                /* 上层已提示 */
              }
            }}
            onCancel={() => setCreating(undefined)}
          />
        )}
      </div>
      {action && (
        <ContextMenu
          action={action}
          onClose={() => setAction(null)}
          onCreate={() => beginCreate(action.id)}
          onRename={() => {
            setAction(null)
            setCreating(undefined)
            setRenaming(action.id)
          }}
          onDelete={() => {
            const id = action.id
            setAction(null)
            onDelete(id)
          }}
        />
      )}
    </div>
  )
}

function MenuRow(props: {
  menu: MenuNode
  depth: number
  menus: MenuNode[]
  summaries: NoteSummary[]
  selectedId: string | null
  expanded: Set<string>
  renaming: string | null
  creatingId: string | null | undefined
  drop: { id: string; pos: DropPos } | null
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onContextMenu: (action: ContextAction) => void
  onRename: (id: string, name: string) => Promise<void>
  onRenameCancel: () => void
  onCreateSubmit: (parentId: string, name: string) => Promise<void>
  onCreateCancel: () => void
  onDropMenu: (id: string, parentId: string | null, index: number) => void
  onDropNote: (noteId: string, menuId: string) => void
  onDropTarget: (drop: { id: string; pos: DropPos } | null) => void
}): React.ReactElement {
  const { menu } = props
  const kids = childrenOf(props.menus, menu.id)
  const open = props.expanded.has(menu.id)
  const fixed = menu.id === UNCATEGORIZED_ID
  const direct = props.summaries.filter((item) => item.menuId === menu.id).length
  const total = countTotal(props.menus, props.summaries, menu.id)
  const mark = props.drop?.id === menu.id ? props.drop.pos : null

  return (
    <div>
      {props.renaming === menu.id ? (
        <NameInput
          depth={props.depth}
          initial={menu.name}
          onSubmit={(name) => props.onRename(menu.id, name)}
          onCancel={props.onRenameCancel}
        />
      ) : (
        <div
          className={`flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-sm ${
            props.selectedId === menu.id ? 'bg-sky-100 dark:bg-sky-950' : 'hover:bg-zinc-200/70 dark:hover:bg-zinc-800'
          } ${mark === 'inside' ? 'ring-2 ring-sky-500' : ''} ${mark === 'before' ? 'border-t-2 border-sky-500' : ''} ${
            mark === 'after' ? 'border-b-2 border-sky-500' : ''
          }`}
          style={{ paddingLeft: props.depth * 14 + 4 }}
          title={fixed ? '未分类不能修改' : '右键可新建子菜单、重命名或删除'}
          draggable={!fixed}
          onClick={() => props.onSelect(menu.id)}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            props.onSelect(menu.id)
            props.onContextMenu({ id: menu.id, x: event.clientX, y: event.clientY, fixed })
          }}
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-menu', menu.id)
            event.dataTransfer.setData('text/plain', menu.name)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(event) => {
            if (fixed && !event.dataTransfer.types.includes('application/x-note')) return
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            const y = event.clientY - rect.top
            const pos: DropPos = fixed ? 'before' : y < rect.height * 0.28 ? 'before' : y > rect.height * 0.72 ? 'after' : 'inside'
            props.onDropTarget({ id: menu.id, pos })
          }}
          onDragLeave={() => props.onDropTarget(null)}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
            const pos = mark ?? 'inside'
            props.onDropTarget(null)
            const noteId = event.dataTransfer.getData('application/x-note')
            if (noteId) {
              props.onDropNote(noteId, menu.id)
              return
            }
            const menuId = event.dataTransfer.getData('application/x-menu')
            if (!menuId || menuId === menu.id) return
            if (fixed) return
            if (pos === 'inside') {
              const index = childrenOf(props.menus, menu.id).filter((item) => item.id !== menuId).length
              props.onDropMenu(menuId, menu.id, index)
              return
            }
            const siblings = childrenOf(props.menus, menu.parentId).filter((item) => item.id !== menuId && item.id !== UNCATEGORIZED_ID)
            const index = siblings.findIndex((item) => item.id === menu.id)
            props.onDropMenu(menuId, menu.parentId, pos === 'after' ? index + 1 : Math.max(0, index))
          }}
        >
          <button
            className="w-4 shrink-0 text-zinc-500"
            onClick={(event) => {
              event.stopPropagation()
              if (kids.length) props.onToggle(menu.id)
            }}
            aria-label={open ? '收起' : '展开'}
          >
            {kids.length ? (open ? '▾' : '▸') : ''}
          </button>
          <span className="min-w-0 flex-1 truncate">{menu.name}</span>
          <span className="shrink-0 text-xs text-zinc-500">
            {direct}/{total}
          </span>
        </div>
      )}
      {props.creatingId === menu.id && (
        <NameInput
          depth={props.depth + 1}
          onSubmit={(name) => props.onCreateSubmit(menu.id, name)}
          onCancel={props.onCreateCancel}
        />
      )}
      {open &&
        kids.map((child) => (
          <MenuRow key={child.id} {...props} menu={child} depth={props.depth + 1} />
        ))}
    </div>
  )
}

function NameInput({
  depth,
  initial = '',
  onSubmit,
  onCancel
}: {
  depth: number
  initial?: string
  onSubmit: (name: string) => Promise<void> | void
  onCancel: () => void
}): React.ReactElement {
  const [value, setValue] = useState(initial)
  return (
    <input
      autoFocus
      className="my-1 w-[calc(100%-8px)] rounded border border-sky-500 bg-white px-2 py-1 text-sm dark:bg-zinc-900"
      style={{ marginLeft: depth * 14 }}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void onSubmit(value)
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
    />
  )
}

function ContextMenu({
  action,
  onClose,
  onCreate,
  onRename,
  onDelete
}: {
  action: ContextAction
  onClose: () => void
  onCreate: () => void
  onRename: () => void
  onDelete: () => void
}): React.ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-menu-context]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onPointer, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(action.x, window.innerWidth - 168))
  const top = Math.max(8, Math.min(action.y, window.innerHeight - 132))
  return (
    <div
      data-menu-context
      className="fixed z-50 w-40 rounded border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left, top }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {action.fixed ? (
        <p className="px-3 py-2 text-xs text-zinc-500">「未分类」不能修改</p>
      ) : (
        <>
          <MenuCommand label="新建子菜单" onClick={onCreate} />
          <MenuCommand label="重命名" onClick={onRename} />
          <MenuCommand label="删除" danger onClick={onDelete} />
        </>
      )}
    </div>
  )
}

function MenuCommand({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }): React.ReactElement {
  return (
    <button
      className={`block w-full px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 ${danger ? 'text-red-600 dark:text-red-400' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function childrenOf(menus: MenuNode[], parentId: string | null): MenuNode[] {
  return menus
    .filter((menu) => menu.parentId === parentId)
    .sort((a, b) => {
      if (a.id === UNCATEGORIZED_ID) return 1
      if (b.id === UNCATEGORIZED_ID) return -1
      return a.sort - b.sort
    })
}

function countTotal(menus: MenuNode[], summaries: NoteSummary[], id: string): number {
  const ids = new Set<string>([id])
  const walk = (parentId: string) => {
    for (const menu of menus) {
      if (menu.parentId === parentId && !ids.has(menu.id)) {
        ids.add(menu.id)
        walk(menu.id)
      }
    }
  }
  walk(id)
  return summaries.filter((item) => ids.has(item.menuId)).length
}
