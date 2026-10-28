import { ipcMain } from 'electron'
import { IPC, type DirListing, type FileSearchQuery, type FileSearchResult, type ProjectCreateResult } from '../../shared/ipc'
import { listDirectory } from '../files'
import { searchFiles } from '../fileSearch'
import { createProjectFolder } from '../projectCreate'
import { detectClaudeLogins, linkClaudeAccount, suggestAccountDir } from '../claudeAccount'

/** Read-only folder listing for the file panel. */
export function registerFilesIpc(): void {
  ipcMain.handle(IPC.FILES_LIST, async (_event, dir: unknown, showHidden: unknown): Promise<DirListing | null> =>
    typeof dir === 'string' ? listDirectory(dir, showHidden === true) : null)
  ipcMain.handle(IPC.FILES_SEARCH, async (_event, dir: unknown, query: FileSearchQuery): Promise<FileSearchResult> => searchFiles(dir, query))
  ipcMain.handle(IPC.PROJECT_CREATE, async (_event, parent: unknown, name: unknown): Promise<ProjectCreateResult> =>
    typeof parent === 'string' && typeof name === 'string' ? createProjectFolder(parent, name) : { ok: false, error: 'Invalid request.' })
  ipcMain.handle(IPC.CLAUDE_ACCOUNT_LINK, async (_event, dir: unknown) => typeof dir === 'string' ? linkClaudeAccount(dir) : { ok: false, error: 'Invalid request.' })
  ipcMain.handle(IPC.CLAUDE_ACCOUNT_DETECT, () => detectClaudeLogins())
  ipcMain.handle(IPC.CLAUDE_ACCOUNT_SUGGEST, (_event, name: unknown) => suggestAccountDir(typeof name === 'string' ? name : ''))
}
