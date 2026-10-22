import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Attachment } from '../../shared/types'
import { highlightBlock } from './highlight'

export function assetUrl(noteId: string, attachmentId: string): string {
  return `kr-asset://local/${noteId}/${attachmentId}`
}

export function parseAssetSrc(src: string): { noteId: string; attachmentId: string } | null {
  const match = /^assets\/([0-9a-f-]+)\/([0-9a-f-]+)\.[a-z0-9]+$/i.exec(src.split('?')[0] ?? '')
  if (!match) return null
  return { noteId: match[1], attachmentId: match[2] }
}

export function MarkdownView({
  body,
  attachments,
  onImage
}: {
  body: string
  attachments: Attachment[]
  onImage?: (attachmentId: string) => void
}): ReactNode {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ src, alt }) => {
            const parsed = src ? parseAssetSrc(src) : null
            if (parsed && !attachments.some((item) => item.id === parsed.attachmentId && !item.missing)) {
              return <span className="inline-block rounded border border-dashed border-zinc-400 px-2 py-1 text-sm">图片已删除</span>
            }
            const url = parsed ? assetUrl(parsed.noteId, parsed.attachmentId) : src
            return (
              <img
                src={url}
                alt={alt ?? ''}
                onClick={() => parsed && onImage?.(parsed.attachmentId)}
              />
            )
          },
          a: ({ children }) => <span>{children}</span>,
          code: ({ className, children }) => {
            const text = String(children).replace(/\n$/, '')
            const language = /language-([\w-]+)/.exec(className ?? '')?.[1]
            if (!className) return <code>{text}</code>
            return <code className={className} dangerouslySetInnerHTML={{ __html: highlightBlock(text, language) }} />
          }
        }}
      >
        {body || ''}
      </ReactMarkdown>
    </div>
  )
}

export function HighlightText({ text, words }: { text: string; words: string[] }): ReactNode {
  const usable = words.map((word) => word.trim()).filter(Boolean)
  if (!usable.length) return <>{text}</>
  const pattern = new RegExp(`(${usable.map(escapeReg).join('|')})`, 'ig')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, index) =>
        usable.some((word) => part.toLowerCase() === word.toLowerCase()) ? (
          <mark key={index} className="rounded bg-amber-200 px-0.5 dark:bg-amber-700/70">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
