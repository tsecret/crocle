import Docker from 'dockerode'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { ensureImage, FILES_DIR, toHost } from './zip'

const CROC_IMAGE = 'schollz/croc'
export const MAX_COPIES = 10

export interface TransferJob {
  container_id: string
  filename: string
  status: 'waiting' | 'done' | 'failed'
  code?: string
  url?: string
  exit_code?: number
}

export class TransferError extends Error {
  constructor(message: string, public status: 400 | 404) {
    super(message)
  }
}

function resolveTarget(relPath: string) {
  const target = path.resolve(FILES_DIR, relPath)
  if (target === FILES_DIR || !target.startsWith(FILES_DIR + path.sep)) {
    throw new TransferError('invalid path', 400)
  }
  if (!existsSync(target)) throw new TransferError('not found', 404)
  return target
}

export async function startTransfers(docker: Docker, relPath: string, copies: number) {
  const target = resolveTarget(relPath)
  if (!Number.isInteger(copies) || copies < 1) throw new TransferError('copies must be at least 1', 400)
  if (copies > MAX_COPIES) throw new TransferError(`at most ${MAX_COPIES} copies`, 400)

  const isDir = statSync(target).isDirectory()
  const base = path.basename(target)
  await ensureImage(docker, CROC_IMAGE)

  const jobs: TransferJob[] = []
  for (let i = 0; i < copies; i++) {
    const container = await docker.createContainer({
      Image: CROC_IMAGE,
      // Trailing slash makes croc treat a directory as a directory
      Cmd: ['send', '--hash', 'imohash', `/data/${base}${isDir ? '/' : ''}`],
      // A TTY keeps logs free of Docker's stream headers
      Tty: true,
      // croc runs without a home dir; give it a writable config location
      // (otherwise it warns: "mkdir /.config: permission denied")
      Env: ['CROC_HOME=/tmp/croc'],
      Labels: {
        crocle: 'true',
        'crocle.job': 'transfer',
        'crocle.filename': base,
      },
      HostConfig: {
        Binds: [`${toHost(target)}:/data/${base}:ro`],
        Memory: 500 * 1024 * 1024,
        // Removed on exit: once the recipient finishes, the job is done
        AutoRemove: true,
      },
    })
    container.wait().catch(() => {})
    await container.start()
    jobs.push({ container_id: container.id, filename: base, status: 'waiting' })
  }
  return jobs
}

// Different croc versions phrase it differently; the getcroc URL is the most stable form
export function parseCrocCode(logs: string) {
  return (
    /getcroc\.com\/\?code=([a-z0-9-]+)/.exec(logs)?.[1] ??
    /your croc code is: (\S+)/.exec(logs)?.[1] ??
    /\bcroc ([a-z0-9-]+)\b/.exec(logs)?.[1]
  )
}

export async function getTransferJob(docker: Docker, id: string): Promise<TransferJob> {
  let info
  try {
    info = await docker.getContainer(id).inspect()
  } catch {
    throw new TransferError('job not found', 404)
  }
  if (info.Config.Labels['crocle.job'] !== 'transfer') throw new TransferError('job not found', 404)

  // The code line ends with a newline, so it is in the logs as soon as croc prints it
  const raw = (await docker.getContainer(id).logs({ stdout: true, stderr: true })).toString()
  const done = !info.State.Running && info.State.ExitCode === 0
  const code = parseCrocCode(raw)
  return {
    container_id: info.Id,
    filename: info.Config.Labels['crocle.filename'] ?? '',
    status: info.State.Running ? 'waiting' : done ? 'done' : 'failed',
    code,
    url: code ? `https://getcroc.com/?code=${code}` : undefined,
    exit_code: info.State.Running ? undefined : info.State.ExitCode,
  }
}

export async function listTransferJobs(docker: Docker) {
  const containers = await docker.listContainers({ all: true, filters: { label: ['crocle.job=transfer'] } })
  return Promise.all(containers.map((c) => getTransferJob(docker, c.Id)))
}

export async function stopTransfer(docker: Docker, id: string) {
  const job = await getTransferJob(docker, id)
  await docker.getContainer(job.container_id).remove({ force: true })
}

