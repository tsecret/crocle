import { existsSync } from 'node:fs'
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
import type Docker from 'dockerode'
import { deleteFile, listFiles } from './files'
import { getTransferJob, listTransferJobs, startTransfers, stopTransfer, TransferError } from './transfer'
import { ensureNoRunningZip, getZipJob, listZipJobs, startZip, stopZip, ZipError } from './zip'

const UI_DIR = './dist/ui'

export function createApp(docker: Docker) {
  const api = new Hono()

  api.onError((err, c) => {
    if (err instanceof ZipError || err instanceof TransferError) {
      return c.json({ error: err.message }, err.status)
    }
    console.error(err)
    return c.json({ error: 'internal error' }, 500)
  })

  api.get('/health', (c) => c.json({ status: 'ok' }))

  api.post('/compress', async (c) => {
    const { path } = await c.req.json<{ path?: string }>()
    if (!path) throw new ZipError('path is required', 400)
    return c.json(await startZip(docker, path), 202)
  })

  api.get('/files', (c) => c.json(listFiles(c.req.query('path') ?? '')))

  api.delete('/files', async (c) => {
    const relPath = c.req.query('path') ?? ''
    await ensureNoRunningZip(docker, relPath)
    await deleteFile(relPath)
    return c.json({ status: 'deleted' })
  })

  api.get('/compress', async (c) => c.json(await listZipJobs(docker)))

  api.get('/compress/:id', async (c) => c.json(await getZipJob(docker, c.req.param('id'))))

  api.delete('/compress/:id', async (c) => {
    await stopZip(docker, c.req.param('id'))
    return c.json({ status: 'stopped' })
  })

  api.post('/transfer', async (c) => {
    const { path, copies } = await c.req.json<{ path?: string; copies?: number }>()
    if (!path) throw new TransferError('path is required', 400)
    return c.json(await startTransfers(docker, path, copies ?? 1), 202)
  })

  api.get('/transfer', async (c) => c.json(await listTransferJobs(docker)))

  api.get('/transfer/:id', async (c) => c.json(await getTransferJob(docker, c.req.param('id'))))

  api.delete('/transfer/:id', async (c) => {
    await stopTransfer(docker, c.req.param('id'))
    return c.json({ status: 'stopped' })
  })

  const app = new Hono()
  app.route('/api', api)
  app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

  // Built UI, when there is one. In development Vite serves it instead.
  if (existsSync(UI_DIR)) {
    app.use('/assets/*', async (c, next) => {
      await next()
      // Vite fingerprints these filenames, so they can be cached forever.
      if (c.res.status === 200) c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    })
    app.use('*', serveStatic({ root: UI_DIR }))
    app.get('*', serveStatic({ root: UI_DIR, path: 'index.html' }))
  }

  return app
}
