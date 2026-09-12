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

export interface ZipJob {
  container_id: string
  filename: string
  status: 'compressing' | 'done' | 'failed'
  progress: number
  current_file?: string
  exit_code?: number
}

export interface TransferJob {
  container_id: string
  filename: string
  status: 'waiting' | 'done' | 'failed'
  code?: string
  url?: string
  exit_code?: number
}
