import Docker from 'dockerode'
import { createApp } from './app'
import { sweepTransferJobs } from './transfer'
import { sweepZipJobs } from './zip'
const docker = new Docker({
  socketPath: '/var/run/docker.sock'
})

const app = createApp(docker)

const sweep = () => {
  sweepZipJobs(docker).catch(console.error)
  sweepTransferJobs(docker).catch(console.error)
}
sweep()
setInterval(sweep, 60_000)

const port = Number(process.env.PORT ?? 3000)
const server = Bun.serve({ port, fetch: app.fetch })
console.log(`🐚 Crocle listening on http://localhost:${server.port}`)
