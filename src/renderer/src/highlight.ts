import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dos from 'highlight.js/lib/languages/dos'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const languages: Array<[string, typeof javascript]> = [
  ['javascript', javascript],
  ['typescript', typescript],
  ['xml', xml],
  ['css', css],
  ['json', json],
  ['python', python],
  ['java', java],
  ['go', go],
  ['rust', rust],
  ['c', c],
  ['cpp', cpp],
  ['sql', sql],
  ['bash', bash],
  ['yaml', yaml],
  ['ini', ini],
  ['php', php],
  ['ruby', ruby],
  ['csharp', csharp],
  ['powershell', powershell],
  ['dos', dos],
  ['markdown', markdown]
]

for (const [name, language] of languages) {
  hljs.registerLanguage(name, language)
}

const byExt: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.vue': 'xml',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'xml',
  '.htm': 'xml',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.py': 'python',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.sql': 'sql',
  '.sh': 'bash',
  '.bash': 'bash',
  '.ps1': 'powershell',
  '.bat': 'dos',
  '.cmd': 'dos',
  '.toml': 'ini',
  '.ini': 'ini',
  '.md': 'markdown',
  '.markdown': 'markdown'
}

export function languageFor(ext: string): string {
  return byExt[ext.toLowerCase()] ?? 'plaintext'
}

export function highlightLine(text: string, language: string): string {
  if (!text) return ' '
  try {
    if (language !== 'plaintext' && hljs.getLanguage(language)) {
      return hljs.highlight(text, { language, ignoreIllegals: true }).value
    }
  } catch {
    /* 无法高亮时显示原文 */
  }
  return escapeHtml(text)
}

export function highlightBlock(text: string, language?: string): string {
  const lang = language && hljs.getLanguage(language) ? language : ''
  if (!lang) return escapeHtml(text)
  return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export { hljs }
