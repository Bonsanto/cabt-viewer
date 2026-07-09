import http from 'node:http';
import { LocalEngineController } from './localEngine';
import { loadLocalPlayerDeck } from './localPlayerDeck';

const port = Number(process.env.LOCAL_ENGINE_PORT ?? 8095);
const host = process.env.LOCAL_ENGINE_HOST ?? '127.0.0.1';
const controller = new LocalEngineController();

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/local-engine/health') {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/local-engine/replays') {
    writeJson(res, 200, controller.listReplays());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/local-engine/local-player-deck') {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { ok: false, error: 'Local player deck override is available only on loopback.' });
      return;
    }
    const response = loadLocalPlayerDeck();
    writeJson(res, response.ok ? 200 : response.missing ? 404 : 400, response);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/local-engine/traces/tag-latest') {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { ok: false, error: 'Trace annotation is available only on loopback.' });
      return;
    }
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const response = controller.tagLatestTrace(body);
      writeJson(res, response.ok ? 200 : 400, response);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/local-engine/replays/')) {
    const id = decodeURIComponent(url.pathname.slice('/local-engine/replays/'.length));
    const response = controller.loadReplay(id);
    writeJson(res, response.ok ? 200 : 404, response);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/local-engine/replays/load') {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const response = controller.loadReplayData(body.replayData, body.name);
      writeJson(res, response.ok ? 200 : 400, response);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/local-engine/save-replay') {
    const response = controller.saveReplay();
    writeJson(res, response.ok ? 200 : 400, response);
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/local-engine') {
    writeJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  try {
    const raw = await readBody(req);
    const command = raw ? JSON.parse(raw) : { type: 'state' };
    const response = await controller.handle(command);
    writeJson(res, response.ok ? 200 : 400, response);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`[cabt-local-engine] listening on http://${host}:${port}\n`);
});

function isLoopbackRequest(req: http.IncomingMessage): boolean {
  const address = req.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
