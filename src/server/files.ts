import { existsSync, readdirSync, statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { FILES_DIR, ZipError } from './zip'

export interface FileEntry {
  name: string
  kind: 'folder' | 'file'
  path: string
  size?: number
}

export interface FileListing {
  path: string
  files: FileEntry[]
}

export async function deleteFile(relPath: string): Promise<void> {
  if (!relPath) throw new ZipError('cannot delete the files root', 400)
  const target = path.resolve(FILES_DIR, relPath)
  if (target === FILES_DIR || !target.startsWith(FILES_DIR + path.sep)) {
    throw new ZipError('invalid path', 400)
  }
  if (!existsSync(target)) throw new ZipError('not found', 404)
  await rm(target, { recursive: true })
}

export function listFiles(relPath: string): FileListing {
  const dir = path.resolve(FILES_DIR, relPath)
  if (dir !== FILES_DIR && !dir.startsWith(FILES_DIR + path.sep)) {
    throw new ZipError('invalid path', 400)
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new ZipError('folder not found', 404)
  }
  const files = readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const full = path.join(dir, entry.name)
    const isDir = entry.isDirectory()
    return {
      name: entry.name,
      kind: isDir ? ('folder' as const) : ('file' as const),
      path: path.relative(FILES_DIR, full),
      // Folders would need a full recursive walk, so only files get a size.
      // A broken symlink has no size rather than failing the whole listing.
      size: isDir ? undefined : statSync(full, { throwIfNoEntry: false })?.size,
    }
  })
  files.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1
  )
  return { path: relPath, files }
}
