import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { migrate, seed } from './database/database.mjs';
import { handleApiRequest } from './routes/index.mjs';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ROOT = join(process.cwd(), 'frontend', 'public');
const mime = {
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.svg':'image/svg+xml'
};

migrate();
seed();

async function serveFrontend(res, url) {
  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const safe = normalize(pathname).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '');
  if (safe.startsWith('.') || safe.includes('../')) return false;
  const file = join(FRONTEND_ROOT, safe);
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const bytes = await readFile(file);
    res.writeHead(200, {
      'Content-Type':mime[extname(file)] || 'application/octet-stream',
      'Cache-Control':'no-cache',
      'X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'SAMEORIGIN',
      'Referrer-Policy':'strict-origin-when-cross-origin'
    });
    res.end(bytes);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname.startsWith('/api/')) return handleApiRequest(req, res, url);
  if (await serveFrontend(res, url)) return;
  res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
  res.end('Not found');
});

server.listen(PORT, HOST, () => console.log(`Chirps & Roar running at http://${HOST}:${PORT}`));
