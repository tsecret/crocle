import Docker from 'dockerode'
import { existsSync, statSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import path from 'node:path'

const ZIP_IMAGE = 'crazymax/7zip'

// Where crocle sees the files vs. where the Docker host sees them.
// They differ when crocle itself runs in a container with a bind mount.
export const FILES_DIR = path.resolve(process.env.FILES_DIR ?? 'data')
const HOST_FILES_DIR = path.resolve(process.env.HOST_FILES_DIR ?? FILES_DIR)

export interface ZipJob {
  container_id: string
  filename: string
  status: 'compressing' | 'done' | 'failed'
  progress: number
  current_file?: string
  exit_code?: number
}

export class ZipError extends Error {
  constructor(message: string, public status: 400 | 404 | 409) {
    super(message)
  }
}

export const toHost = (p: string) => path.join(HOST_FILES_DIR, path.relative(FILES_DIR, p))
const partialName = (zipName: string) => `.${zipName}.partial`

function resolveFolder(relPath: string) {
  const folder = path.resolve(FILES_DIR, relPath)
  if (folder === FILES_DIR || !folder.startsWith(FILES_DIR + path.sep)) {
    throw new ZipError('invalid path', 400)
  }
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new ZipError('folder not found', 404)
  }
  return folder
}

export async function ensureImage(docker: Docker, image: string = ZIP_IMAGE) {
  try {
    await docker.getImage(image).inspect()
  } catch {
    const stream = await docker.pull(image)
    await new Promise((resolve, reject) =>
      docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve(null)))
    )
  }
}

export async function startZip(docker: Docker, relPath: string) {
  const folder = resolveFolder(relPath)
  const outDir = path.dirname(folder)
  const zipName = `${path.basename(folder)}.zip`
  const finalPath = path.join(outDir, zipName)
  const partialPath = path.join(outDir, partialName(zipName))

  if (existsSync(finalPath)) throw new ZipError(`${zipName} already exists`, 409)
  const running = await docker.listContainers({
    filters: { label: ['crocle.job=zip', `crocle.output=${finalPath}`] },
  })
  if (running.length) throw new ZipError(`${zipName} is already being compressed`, 409)

  // 7za "a" appends to an existing archive, so never start on a leftover partial
  await rm(partialPath, { force: true })
  await ensureImage(docker)

  const container = await docker.createContainer({
    Image: ZIP_IMAGE,
    // -bsp1: progress to stdout; -mx=9: max compression, smaller archive, fewer bytes to send;
    // -mmt=on: use every core, since -mx=9 is CPU-bound
    Cmd: ['7za', 'a', '-tzip', '-mx=9', '-mmt=on', '-bsp1', `/out/${partialName(zipName)}`, '/data/.'],
    // A TTY makes 7za emit progress and keeps logs free of Docker's stream headers
    Tty: true,
    Labels: {
      crocle: 'true',
      'crocle.job': 'zip',
      'crocle.filename': zipName,
      'crocle.output': finalPath,
      'crocle.partial': partialPath,
    },
    HostConfig: {
      Binds: [`${toHost(folder)}:/data:ro`, `${toHost(outDir)}:/out`],
      Memory: 500 * 1024 * 1024,
      // The container is removed on exit, so the wait() callback must finalize
      // from the captured paths and exit code, not from a later inspect
      AutoRemove: true,
    },
  })
  await track(docker, container.id)
  await container.start()
  container
    .wait()
    .then((res) => finalizeZip(partialPath, finalPath, res.StatusCode))
    .catch(() => {})

  return { container_id: container.id, filename: zipName, status: 'compressing' as const }
}

// Refuse to delete a folder that a running zip job has mounted read-only.
export async function ensureNoRunningZip(docker: Docker, relPath: string) {
  if (!relPath) return
  const folder = path.resolve(FILES_DIR, relPath)
  const finalPath = path.join(path.dirname(folder), `${path.basename(folder)}.zip`)
  const running = await docker.listContainers({
    filters: { label: ['crocle.job=zip', `crocle.output=${finalPath}`], status: ['running'] },
  })
  if (running.length) throw new ZipError(`${path.basename(folder)}.zip is being compressed`, 409)
}

// Docker's log driver only flushes on newline, and 7za's progress line never
// ends one, so `docker logs` shows nothing until the job exits. Read the live
// attached stream instead and keep the latest progress in memory.
const liveProgress = new Map<string, { progress: number; currentFile?: string }>()

async function track(docker: Docker, id: string) {
  if (liveProgress.has(id)) return
  const state: { progress: number; currentFile?: string } = { progress: 0 }
  liveProgress.set(id, state)
  let tail = ''
  const stream = await docker.getContainer(id).attach({ stream: true, stdout: true, stderr: true })
  stream.on('data', (chunk: Buffer) => {
    tail = (tail + chunk.toString()).slice(-2000)
    Object.assign(state, parseProgress(tail, state.progress, state.currentFile))
  })
  stream.on('end', () => liveProgress.delete(id))
}

// 7za redraws its progress line with backspaces: " 47% 202 + file.bin".
// Readings can briefly go backwards, so keep the highest one seen.
export function parseProgress(logs: string, progress = 0, currentFile?: string) {
  for (const chunk of logs.split(/[\b\r\n]+/)) {
    const m = chunk.match(/^\s*(\d{1,3})%(?:\s+\d+\s+\+\s+(.+))?/)
    if (m && Number(m[1]) >= progress) {
      progress = Number(m[1])
      currentFile = m[2]?.trim() || currentFile
    }
  }
  return { progress, currentFile }
}

// Once the zip has finished: publish it on success, drop the partial on failure.
// Idempotent, so both the wait() callback and status reads can call it.
async function finalizeZip(partial: string | undefined, output: string | undefined, exitCode: number) {
  if (!partial || !existsSync(partial)) return
  if (exitCode === 0 && output && !existsSync(output)) await rename(partial, output)
  else await rm(partial, { force: true })
}

async function settle(docker: Docker, id: string) {
  const info = await docker.getContainer(id).inspect()
  if (info.State.Running) return info
  await finalizeZip(
    info.Config.Labels['crocle.partial'],
    info.Config.Labels['crocle.output'],
    info.State.ExitCode
  )
  return info
}

export async function getZipJob(docker: Docker, id: string): Promise<ZipJob> {
  let info
  try {
    info = await settle(docker, id)
  } catch {
    throw new ZipError('job not found', 404)
  }
  if (info.Config.Labels['crocle.job'] !== 'zip') throw new ZipError('job not found', 404)

  let progress = 0
  let currentFile: string | undefined
  if (info.State.Running) {
    // Re-attaches after a crocle restart; progress resumes from the next redraw
    await track(docker, id)
    ;({ progress, currentFile } = liveProgress.get(id) ?? { progress: 0 })
  } else {
    // After exit the log driver has flushed everything
    const raw = (await docker.getContainer(id).logs({ stdout: true, stderr: true })).toString()
    ;({ progress, currentFile } = parseProgress(raw))
  }
  const done = !info.State.Running && info.State.ExitCode === 0
  return {
    container_id: info.Id,
    filename: info.Config.Labels['crocle.filename'] ?? '',
    status: info.State.Running ? 'compressing' : done ? 'done' : 'failed',
    progress: done ? 100 : progress,
    current_file: currentFile,
    exit_code: info.State.Running ? undefined : info.State.ExitCode,
  }
}

export async function listZipJobs(docker: Docker) {
  const containers = await docker.listContainers({ all: true, filters: { label: ['crocle.job=zip'] } })
  return Promise.all(containers.map((c) => getZipJob(docker, c.Id)))
}

export async function stopZip(docker: Docker, id: string) {
  const job = await getZipJob(docker, id)
  const container = docker.getContainer(id)
  const partial = (await container.inspect()).Config.Labels['crocle.partial']
  await container.remove({ force: true })
  if (job.status !== 'done' && partial) await rm(partial, { force: true })
}

