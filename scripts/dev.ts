// Development: the API on 3000, Vite on 5173 proxying /api to it.
// Ctrl-C stops both.
const server = Bun.spawn(['bun', '--hot', 'src/server/index.ts'], { stdio: ['inherit', 'inherit', 'inherit'] })
const vite = Bun.spawn(['bunx', 'vite'], { stdio: ['inherit', 'inherit', 'inherit'] })

function stop(): never {
  server.kill()
  vite.kill()
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

await Promise.race([server.exited, vite.exited])
stop()
