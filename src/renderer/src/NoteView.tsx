import { useEffect, useMemo, useState } from 'react'
import { KIND_LABEL, NO_EXECUTE, assetMarkdownPath, formatBytes, formatWhen } from '../../shared/rules'
import type { Attachment, EditorLayout, Note } from '../../shared/types'
import { highlightLine, languageFor } from './highlight'
import { MarkdownView, assetUrl } from './markdown'

type Draft = { title: string; body: string; tags: string[] }
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

export function NoteView(props: {
  note: Note | null
  draft: Draft
  editing: boolean
  layout: EditorLayout
  saveState: SaveState
  saveError: string
  savedAt: string
  focusTitle: boolean
  onDraft: (patch: Partial<Draft>) => void
  onLayout: (layout: EditorLayout) => void
  onAddPaths: (paths: string[]) => void
  onPasteImage: () => void
  onPickFiles: () => void
  onRemove: (attachment: Attachment) => void
  onRename: (attachment: Attachment) => void
  onOpen: (attachment: Attachment) => void
  onReveal: (attachment: Attachment) => void
  onSaveAs: (attachment: Attachment) => void
  onInserted: (markdown: string) => void
}): React.ReactElement {
  const { note } = props
  const [attachmentId, setAttachmentId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ mode: 'text'; text: string } | { mode: 'skip'; reason: string } | null>(null)
  const [officeUrl, setOfficeUrl] = useState<string | null>(null)
  const [officeError, setOfficeError] = useState('')
  const [mediaError, setMediaError] = useState('')
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [scale, setScale] = useState(1)
  const images = note?.attachments.filter((item) => item.kind === 'image' && !item.missing) ?? []
  const selected = note?.attachments.find((item) => item.id === attachmentId) ?? null

  useEffect(() => {
    setAttachmentId(null)
    setOfficeUrl(null)
    setOfficeError('')
    setMediaError('')
  }, [note?.id])

  useEffect(() => {
    if (!note || !selected) return
    const textual = selected.kind === 'code' || selected.kind === 'markdown' || selected.ext === '.csv'
    if (!textual) {
      setPreview(null)
      return
    }
    let cancel = false
    void window.api.readPreview(note.id, selected.id).then((result) => {
      if (!cancel) setPreview(result)
    })
    return () => {
      cancel = true
    }
  }, [note?.id, selected?.id, selected?.kind, selected?.ext])

  const titleRef = useMemo(() => ({ current: null as HTMLInputElement | null }), [])
  useEffect(() => {
    if (props.focusTitle) titleRef.current?.focus()
  }, [props.focusTitle, note?.id, titleRef])

  if (!note) {
    return <div className="grid h-full place-items-center text-sm text-zinc-500">从列表选择一条知识点，或新建一条。</div>
  }

  const showEditor = props.editing && props.layout !== 'preview'
  const showPreview = !props.editing || props.layout !== 'edit'

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        {props.editing ? (
          <input
            ref={(node) => {
              titleRef.current = node
            }}
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent text-xl font-semibold outline-none focus:border-sky-500"
            value={props.draft.title}
            onChange={(event) => props.onDraft({ title: event.target.value })}
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{note.title}</h1>
        )}
        <span className="text-xs text-zinc-500">{props.editing ? '编辑' : '查看'}</span>
        {props.editing && (
          <div className="flex rounded border border-zinc-300 text-xs dark:border-zinc-700">
            {(['edit', 'split', 'preview'] as EditorLayout[]).map((layout) => (
              <button key={layout} className={`px-2 py-1 ${props.layout === layout ? 'bg-zinc-200 dark:bg-zinc-700' : ''}`} onClick={() => props.onLayout(layout)}>
                {layout === 'edit' ? '源文' : layout === 'split' ? '分屏' : '预览'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={`grid min-h-0 flex-1 ${props.editing && props.layout === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {showEditor && (
          <textarea
            className="h-full resize-none bg-transparent p-4 outline-none"
            value={props.draft.body}
            placeholder="用 Markdown 写下这条知识点"
            onChange={(event) => props.onDraft({ body: event.target.value })}
            onPaste={(event) => {
              const image = [...event.clipboardData.items].find((item) => item.type.startsWith('image/'))
              if (!image) return
              event.preventDefault()
              const file = image.getAsFile()
              if (!file) return
              void file.arrayBuffer().then((buffer) => {
                void window.api.addBytes(note.id, file.name || '粘贴图片.png', new Uint8Array(buffer)).then((attachment) => {
                  props.onInserted(assetMarkdownPath(note.id, attachment))
                })
              })
            }}
          />
        )}
        {showPreview && (
          <div className="h-full overflow-auto p-4">
            {props.draft.body.trim() ? (
              <MarkdownView
                body={props.editing ? props.draft.body : note.body}
                attachments={note.attachments}
                onImage={(id) => {
                  const index = images.findIndex((item) => item.id === id)
                  setScale(1)
                  setLightbox(index < 0 ? 0 : index)
                }}
              />
            ) : (
              <p className="text-sm text-zinc-500">没有正文。</p>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
        {props.editing && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {props.draft.tags.map((tag) => (
              <button key={tag} className="rounded bg-amber-100 px-2 py-0.5 text-xs dark:bg-amber-950" onClick={() => props.onDraft({ tags: props.draft.tags.filter((item) => item !== tag) })}>
                {tag} ×
              </button>
            ))}
            <input
              className="w-28 rounded border border-zinc-300 bg-transparent px-2 py-0.5 text-sm dark:border-zinc-700"
              placeholder="标签回车"
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                const value = event.currentTarget.value.trim()
                if (!value || props.draft.tags.includes(value)) return
                props.onDraft({ tags: [...props.draft.tags, value] })
                event.currentTarget.value = ''
              }}
            />
          </div>
        )}
        {!props.editing && props.draft.tags.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {props.draft.tags.map((tag) => (
              <span key={tag} className="rounded bg-amber-100 px-2 py-0.5 text-xs dark:bg-amber-950">
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="mb-2 flex gap-2 text-sm">
          <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={props.onPickFiles}>
            添加文件
          </button>
          <button className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" onClick={props.onPasteImage}>
            粘贴图片
          </button>
          <span className="self-center text-xs text-zinc-500">也可以把文件拖到这里</span>
        </div>
        <div
          className="max-h-48 space-y-1 overflow-auto"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault()
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes('Files')) return
            event.preventDefault()
            const paths = [...event.dataTransfer.files].map((file) => window.api.pathForFile(file)).filter(Boolean)
            if (paths.length) props.onAddPaths(paths)
          }}
        >
          {note.attachments.length === 0 && <p className="text-xs text-zinc-500">还没有文件。</p>}
          {note.attachments.map((attachment) => (
            <div key={attachment.id} className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${attachmentId === attachment.id ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}>
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => setAttachmentId(attachment.id)}>
                {attachment.name}
                <span className="ml-2 text-xs text-zinc-500">
                  {KIND_LABEL[attachment.kind]} · {formatBytes(attachment.size)} · {formatWhen(attachment.createdAt)}
                  {attachment.missing ? ' · 文件缺失' : ''}
                </span>
              </button>
              {!NO_EXECUTE.has(attachment.ext) && (
                <button className="text-xs text-sky-700 dark:text-sky-300" onClick={() => props.onOpen(attachment)}>
                  打开
                </button>
              )}
              <button className="text-xs" onClick={() => props.onReveal(attachment)}>
                定位
              </button>
              <button className="text-xs" onClick={() => props.onSaveAs(attachment)}>
                另存为
              </button>
              {props.editing && (
                <button className="text-xs" onClick={() => props.onRename(attachment)}>
                  改名
                </button>
              )}
              <button className="text-xs text-red-600" onClick={() => props.onRemove(attachment)}>
                移除
              </button>
            </div>
          ))}
        </div>
        {selected && <AttachmentPreview noteId={note.id} attachment={selected} preview={preview} officeUrl={officeUrl} officeError={officeError} mediaError={mediaError} onMediaError={setMediaError} onOffice={setOfficeUrl} onOfficeError={setOfficeError} onOpen={() => props.onOpen(selected)} />}
      </div>
      <div className="border-t border-zinc-200 px-4 py-1 text-xs text-zinc-500 dark:border-zinc-800">
        {props.saveState === 'saving' && '保存中'}
        {props.saveState === 'dirty' && '未保存的更改'}
        {props.saveState === 'error' && `保存失败：${props.saveError}`}
        {props.saveState === 'saved' && `已保存 ${formatWhen(props.savedAt)}`}
      </div>
      {lightbox !== null && images[lightbox] && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/80" onClick={() => setLightbox(null)}>
          <img
            src={assetUrl(note.id, images[lightbox].id)}
            alt={images[lightbox].name}
            className="max-h-[80vh] max-w-[90vw]"
            style={{ transform: `scale(${scale})` }}
            onClick={(event) => event.stopPropagation()}
          />
          <div className="absolute bottom-6 flex gap-2" onClick={(event) => event.stopPropagation()}>
            <button className="rounded bg-white px-3 py-1 text-sm" onClick={() => setLightbox((index) => (index === null ? 0 : (index + images.length - 1) % images.length))}>
              上一张
            </button>
            <button className="rounded bg-white px-3 py-1 text-sm" onClick={() => setScale((value) => Math.min(4, value + 0.25))}>
              放大
            </button>
            <button className="rounded bg-white px-3 py-1 text-sm" onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}>
              缩小
            </button>
            <button className="rounded bg-white px-3 py-1 text-sm" onClick={() => setLightbox((index) => (index === null ? 0 : (index + 1) % images.length))}>
              下一张
            </button>
            <button className="rounded bg-white px-3 py-1 text-sm" onClick={() => setLightbox(null)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AttachmentPreview(props: {
  noteId: string
  attachment: Attachment
  preview: { mode: 'text'; text: string } | { mode: 'skip'; reason: string } | null
  officeUrl: string | null
  officeError: string
  mediaError: string
  onMediaError: (value: string) => void
  onOffice: (url: string) => void
  onOfficeError: (value: string) => void
  onOpen: () => void
}): React.ReactElement {
  const { attachment } = props
  if (attachment.missing) return <p className="mt-2 text-sm text-red-600">文件缺失。标题和正文仍可查看，可以移除这条记录。</p>
  if (attachment.kind === 'image') {
    return <img className="mt-2 max-h-48 rounded" src={assetUrl(props.noteId, attachment.id)} alt={attachment.name} />
  }
  if (attachment.kind === 'pdf') {
    return <iframe className="mt-2 h-64 w-full rounded border border-zinc-300" title={attachment.name} src={assetUrl(props.noteId, attachment.id)} />
  }
  if (attachment.kind === 'video') {
    return (
      <div className="mt-2">
        <video className="max-h-48 w-full" controls preload="none" src={assetUrl(props.noteId, attachment.id)} onError={() => props.onMediaError('这个视频无法在程序内播放')} />
        {props.mediaError && <Fallback reason={props.mediaError} onOpen={props.onOpen} />}
      </div>
    )
  }
  if (attachment.kind === 'audio') {
    return <audio className="mt-2 w-full" controls preload="none" src={assetUrl(props.noteId, attachment.id)} />
  }
  if (attachment.kind === 'markdown' && props.preview?.mode === 'text') {
    return (
      <div className="mt-2 max-h-64 overflow-auto rounded border border-zinc-200 p-2 dark:border-zinc-700">
        <MarkdownView body={props.preview.text} attachments={[]} />
      </div>
    )
  }
  if ((attachment.kind === 'code' || attachment.ext === '.csv') && props.preview?.mode === 'text') {
    return <CodePreview text={props.preview.text} ext={attachment.ext} />
  }
  if (props.preview?.mode === 'skip' && props.preview.reason) return <Fallback reason={props.preview.reason} onOpen={props.onOpen} />
  if (attachment.kind === 'word' || attachment.kind === 'excel' || attachment.kind === 'ppt') {
    return (
      <div className="mt-2">
        <button
          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
          onClick={() => {
            props.onOfficeError('')
            void window.api
              .previewOffice(props.noteId, attachment.id)
              .then((result) => props.onOffice(result.url))
              .catch((error: unknown) => props.onOfficeError(error instanceof Error ? error.message : '预览失败'))
          }}
        >
          程序内预览
        </button>
        {props.officeError && <Fallback reason={props.officeError} onOpen={props.onOpen} />}
        {props.officeUrl && <iframe className="mt-2 h-64 w-full rounded border border-zinc-300" title="办公预览" src={props.officeUrl} />}
      </div>
    )
  }
  return <p className="mt-2 text-xs text-zinc-500">此文件可以打开或另存为。</p>
}

function Fallback({ reason, onOpen }: { reason: string; onOpen: () => void }): React.ReactElement {
  return (
    <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
      {reason}
      <button className="ml-2 text-sky-700 dark:text-sky-300" onClick={onOpen}>
        用系统程序打开
      </button>
    </p>
  )
}

function CodePreview({ text, ext }: { text: string; ext: string }): React.ReactElement {
  const lines = text.split('\n')
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(240)
  const row = 20
  const start = Math.max(0, Math.floor(scrollTop / row) - 8)
  const end = Math.min(lines.length, start + Math.ceil(height / row) + 16)
  const language = languageFor(ext)
  return (
    <div className="mt-2">
      <button
        className="mb-1 text-xs text-sky-700 dark:text-sky-300"
        onClick={() => void navigator.clipboard.writeText(text)}
      >
        复制全部
      </button>
      <div
        className="h-60 overflow-auto rounded border border-zinc-200 bg-zinc-50 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        ref={(node) => {
          if (node && node.clientHeight !== height) setHeight(node.clientHeight)
        }}
      >
        <div style={{ height: lines.length * row, position: 'relative' }}>
          {lines.slice(start, end).map((line, offset) => {
            const index = start + offset
            return (
              <div key={index} style={{ position: 'absolute', top: index * row, height: row }} className="flex w-full">
                <span className="w-12 shrink-0 select-none pr-2 text-right text-zinc-400">{index + 1}</span>
                <span className="whitespace-pre" dangerouslySetInnerHTML={{ __html: highlightLine(line, language) }} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
