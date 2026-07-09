import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { IncomingMessage } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

const localEnginePort = process.env.LOCAL_ENGINE_PORT ?? '8095';

export default defineConfig({
  define: {
    global: 'globalThis',
  },
  plugins: [localPlayerDeckProxyGuard(), svelte()],
  server: {
    port: 5173,
    proxy: {
      '/local-engine': {
        target: `http://localhost:${localEnginePort}`,
        changeOrigin: true,
      },
      '/cabt-artifacts': {
        target: 'http://localhost:8765',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cabt-artifacts/, ''),
      },
    },
  },
});

function localPlayerDeckProxyGuard(): Plugin {
  return {
    name: 'local-player-deck-proxy-guard',
    configureServer(server) {
      server.middlewares.use('/local-engine/local-player-deck', (req, res, next) => {
        if (isLoopbackRequest(req)) {
          next();
          return;
        }

        const json = JSON.stringify({ ok: false, error: 'Local player deck override is available only on loopback.' });
        res.writeHead(403, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(json),
        });
        res.end(json);
      });
    },
  };
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
