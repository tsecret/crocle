import Docker from 'dockerode'
import { createApp } from './app'
const docker = new Docker({
  socketPath: '/var/run/docker.sock'
})

const app = createApp(docker)

const port = Number(process.env.PORT ?? 3000)
const server = Bun.serve({ port, fetch: app.fetch })
console.log(`🐚 Crocle listening on http://localhost:${server.port}`)
