import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function findSoffice(): string | null {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
  ].filter((item): item is string => Boolean(item))
  return candidates.find((item) => existsSync(item)) ?? null
}

export async function convertToPdf(input: string, outDir: string): Promise<void> {
  const soffice = findSoffice()
  if (!soffice) throw new Error('本机没有 LibreOffice，请用系统程序打开')
  await mkdir(outDir, { recursive: true })
  try {
    await execFileAsync(
      soffice,
      ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, input],
      { timeout: 120_000, windowsHide: true }
    )
  } catch {
    throw new Error('程序内预览失败，请用系统程序打开')
  }
}
