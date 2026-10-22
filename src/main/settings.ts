import { promises as fs } from 'node:fs'
import path from 'node:path'
import { defaultSettings, type Settings } from '../shared/types'

export async function readSettings(file: string): Promise<Settings> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<Settings>
    return { ...defaultSettings(), ...parsed }
  } catch {
    return defaultSettings()
  }
}

export async function writeSettings(file: string, settings: Settings): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8')
  await fs.rm(file, { force: true })
  await fs.rename(tmp, file)
}
