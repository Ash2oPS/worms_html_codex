import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve('dist');
const preferredPort = Number.parseInt(process.env.QA_PORT ?? '41783', 10);
const scriptPath = process.argv[2];
const forwardedArgs = process.argv.slice(3);

if (!scriptPath) {
  console.error('Usage: node scripts/qa/run_with_static_server.mjs <script> [...args]');
  process.exit(1);
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

const waitForExit = (child) =>
  new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 0));
  });

const listen = (port) =>
  new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });

const server = http.createServer(async (req, res) => {
  try {
    const requestPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
    const candidatePath = path.resolve(root, `.${normalizedPath}`);
    const withinRoot = candidatePath === root || candidatePath.startsWith(`${root}${path.sep}`);
    if (!withinRoot) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    let filePath = candidatePath;
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
    } catch {
      filePath = path.join(root, 'index.html');
    }

    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': mimeTypes.get(ext) ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});

try {
  await listen(preferredPort);
} catch (error) {
  if (error?.code !== 'EADDRINUSE') {
    throw error;
  }

  await listen(0);
}

const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Unable to resolve QA static-server address.');
}
const activePort = address.port;

try {
  const child = spawn(
    process.execPath,
    [scriptPath, `http://127.0.0.1:${activePort}`, ...forwardedArgs],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
    },
  );
  const exitCode = await waitForExit(child);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
