import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.csv': 'text/csv; charset=utf-8', '.webmanifest': 'application/manifest+json' };
export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end('Method not allowed'); }
    try {
      const url = new URL(req.url, 'http://localhost');
      const requested = decodeURIComponent(url.pathname);
      const name = requested === '/' ? 'index.html' : requested.slice(1);
      if (!/^(?:index\.html|styles\.css|sw\.js|manifest\.webmanifest|src\/[a-z-]+\.js|assets\/[a-z-]+\.svg|examples\/[a-z-]+\.csv)$/.test(name)) { res.writeHead(404); return res.end('Not found'); }
      const body = await readFile(path.join(root, name));
      res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) { res.writeHead(error instanceof URIError ? 400 : 404); res.end('Not found'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('PORT must be an integer from 1 to 65535.'); process.exitCode = 1; }
  else {
    const server = createServer();
    server.on('error', error => { console.error(`Cannot start BenchFlow: ${error.message}`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`BenchFlow: http://127.0.0.1:${port}\nData stays in your browser. Press Ctrl+C to stop.`));
  }
}
