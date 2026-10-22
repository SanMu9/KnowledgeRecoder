import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FILE_MAX, NOTE_MAX } from '../src/shared/types'
import { assertCapacity, fieldRank } from '../src/shared/rules'
import { Library } from '../src/main/store'

const root = await mkdtemp(path.join(tmpdir(), 'kr-check-'))
try {
  assert.throws(() => assertCapacity(FILE_MAX + 1, 0), /100MB/)
  assert.throws(() => assertCapacity(1, NOTE_MAX), /500MB/)

  const lib = await Library.init(root)
  assert.equal(lib.listMenus().some((menu) => menu.name === '未分类'), true)
  await assert.rejects(() => lib.renameMenu('uncategorized', '别的'), /不能重命名/)

  let parent: string | null = null
  const ids: string[] = []
  for (const name of ['技术', '前端', 'React', '状态', '选择']) {
    const menu = await lib.createMenu(parent, name)
    ids.push(menu.id)
    parent = menu.id
  }
  await assert.rejects(() => lib.createMenu(null, '技术'), /同级已有这个名字/)
  const sibling = await lib.createMenu(ids[0], '后端')
  await assert.rejects(() => lib.moveMenu(ids[0], ids[4], 0), /不能移动到自身或其子菜单下/)
  assert.equal(lib.listMenus().find((menu) => menu.id === ids[0])?.parentId, null)
  await lib.moveMenu(sibling.id, ids[2], 0)
  assert.equal(lib.listMenus().find((menu) => menu.id === sibling.id)?.parentId, ids[2])

  const note = await lib.createNote(ids[4])
  const saved = await lib.saveNote({ id: note.id, title: '中文标题 useReducer', body: '正文里有预加载', tags: ['react'] })
  assert.equal(saved.title, '中文标题 useReducer')
  const file = path.join(root, 'temp.txt')
  await writeFile(file, 'hello', 'utf8')
  const added = await lib.addFile(note.id, file)
  await rm(file)
  const stored = path.join(root, 'assets', note.id, `${added.attachment.id}${added.attachment.ext}`)
  assert.equal(await readFile(stored, 'utf8'), 'hello')

  const again = await Library.open(root)
  const loaded = await again.getNote(note.id)
  assert.equal(loaded.body, '正文里有预加载')
  assert.equal(loaded.attachments.length, 1)

  const other = await again.createNote(ids[0])
  await again.saveNote({ id: other.id, title: '另一条', body: 'useReducer 只在正文', tags: [] })
  const found = await again.search('useReducer')
  assert.equal(found.notes[0].title, '中文标题 useReducer')
  assert.ok(found.notes[0].rank > found.notes[1].rank)

  await again.deleteNote(note.id)
  assert.equal(again.listSummaries().some((item) => item.id === note.id), false)
  assert.equal(again.listTrash().some((item) => item.id === note.id), true)
  const restored = await again.restore(note.id)
  assert.equal(restored.menuMissing, false)
  assert.equal(again.listSummaries().some((item) => item.id === note.id), true)

  const impact = again.menuImpact(ids[0])
  assert.ok(impact.notes >= 1)
  await again.deleteMenu(ids[0])
  assert.equal(again.listMenus().some((menu) => menu.id === ids[0]), false)
  const trashed = again.listTrash().find((item) => item.kind === 'note' && item.title === '中文标题 useReducer')
  assert.ok(trashed)
  const back = await again.restore(trashed.id)
  assert.equal(back.menuMissing, true)
  assert.equal((await again.getNote(trashed.id)).menuId, 'uncategorized')

  assert.throws(() => again.resolveAsset('../..', '../..'), /无效标识/)
  assert.equal(fieldRank({ title: 'A', body: '', tags: [], attachments: [] }, '', 'a'), 5)

  const otherRoot = await mkdtemp(path.join(tmpdir(), 'kr-import-'))
  const target = await Library.init(otherRoot)
  const exported = await again.exportTo(otherRoot)
  const first = await target.importFrom(exported.path, 'skip')
  const second = await target.importFrom(exported.path, 'skip')
  assert.ok(first.notesImported >= 1)
  assert.equal(second.notesImported, 0)
  assert.ok(second.notesSkipped >= 1)
  await rm(otherRoot, { recursive: true, force: true })

  const broken = await mkdtemp(path.join(tmpdir(), 'kr-broken-'))
  await writeFile(path.join(broken, 'library.json'), JSON.stringify({ schemaVersion: 1, name: 'x', createdAt: '', updatedAt: '' }))
  await writeFile(path.join(broken, 'menus.json'), '{')
  await assert.rejects(() => Library.open(broken), /无法识别/)
  assert.equal(await readFile(path.join(broken, 'menus.json'), 'utf8'), '{')
  await rm(broken, { recursive: true, force: true })

  console.log('store-check ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
