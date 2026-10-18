import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.map': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt',
  '.json': 'application/json',
  '.ts': 'text/plain'
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') {
      res.writeHead(302, { location: '/examples/index.html' });
      res.end();
      return;
    }
    const path = normalize(join(ROOT, pathname));
    if (!path.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(Number(process.env.PORT ?? 8899), '127.0.0.1', () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${process.env.PORT ?? 8899}`);
});
