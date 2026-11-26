import react from '@vitejs/plugin-react'
import { handleWeb } from './api/web.ts'
import { defineConfig, type Plugin } from 'vite'

// В браузере (разработка) погода, курсы и новости идут через /api/web — белый список адресов, без CORS.
// На телефоне и в приложении для компьютера это делает нативная часть.
function devWeb(): Plugin {
  return {
    name: 'dev-web',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/web', async (req, res) => {
        try {
          const r = await handleWeb(new URL(req.url || '', 'http://x').searchParams.get('u'))
          res.statusCode = r.status
          res.setHeader('Content-Type', r.type)
          res.end(r.body)
        } catch (e) {
          res.statusCode = 502
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

export default defineConfig({
  // относительные пути: сборка открывается и из APK, и из приложения для компьютера
  base: './',
  plugins: [react(), devWeb()],
  server: { host: true, port: 5391 },
})
