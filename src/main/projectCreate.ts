import { mkdir, readdir, stat } from 'fs/promises'
import { isAbsolute, join, normalize } from 'path'
import type { ProjectCreateResult } from '../shared/ipc'

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const INVALID = /[<>:"/\|?*\x00-\x1f]/

/** Returns an error message for a bad project folder name, or null when it is fine. */
export function validateProjectName(name: string): string | null {
  const value = name.trim()
  if (!value) return 'Enter a project name.'
  if (value.length > 100) return 'The project name is too long.'
  if (value === '.' || value === '..' || INVALID.test(value)) return 'The name contains characters a folder cannot have.'
  if (RESERVED.test(value)) return 'This name is reserved by Windows.'
  if (/[. ]$/.test(value)) return 'The name cannot end with a dot or space.'
  return null
}

/** Creates `<parent>/<name>`; an existing empty folder is reused, a non-empty one is refused. */
export async function createProjectFolder(parent: string, name: string): Promise<ProjectCreateResult> {
  const nameError = validateProjectName(name)
  if (nameError) return { ok: false, error: nameError }
  if (!isAbsolute(parent)) return { ok: false, error: 'Choose an absolute parent folder.' }
  const base = normalize(parent)
  try {
    if (!(await stat(base)).isDirectory()) return { ok: false, error: 'The parent path is not a folder.' }
  } catch { return { ok: false, error: 'The parent folder does not exist.' } }
  const path = join(base, name.trim())
  try {
    if ((await readdir(path)).length > 0) return { ok: false, error: 'This folder already exists and is not empty.' }
  } catch {
    try { await mkdir(path) } catch (e) { return { ok: false, error: `Could not create the folder: ${(e as Error).message}` } }
  }
  return { ok: true, path }
}
