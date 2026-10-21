import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://localhost:${process.env.API_PORT ?? 8787}`;

/** Serve scripts/checkin.py at /checkin.py (dev) and ship it in the build, so setup can download it. */
function checkinScript(): Plugin {
  const file = new URL('./scripts/checkin.py', import.meta.url);
  return {
    name: 'platter-checkin-script',
    configureServer(server) {
      server.middlewares.use('/checkin.py', (_req, res) => {
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'checkin.py', source: readFileSync(file, 'utf8') });
    },
  };
}

export default defineConfig({
  plugins: [react(), checkinScript()],
  // Keep the browser's host on proxied requests, so links the API builds (setup links,
  // /checkin.py) point at this dev server, like they point at the one domain in production.
  server: { proxy: Object.fromEntries(['/api', '/mcp', '/s/'].map((p) => [p, { target: api, changeOrigin: false }])) },
});
