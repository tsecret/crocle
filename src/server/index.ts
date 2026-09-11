import Docker from 'dockerode'
import { createApp } from './app'
import { sweepZipJobs } from './zip'

const docker = new Docker({
  socketPath: '/var/run/docker.sock'
})

const app = createApp(docker)

sweepZipJobs(docker).catch(console.error)
setInterval(() => sweepZipJobs(docker).catch(console.error), 60_000)

const port = Number(process.env.PORT ?? 3000)
const server = Bun.serve({ port, fetch: app.fetch })
console.log(`🐚 Crocle listening on http://localhost:${server.port}`)
