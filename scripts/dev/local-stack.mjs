import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { context as buildContext } from '../../workers/api/node_modules/esbuild/lib/main.js';
import { Miniflare } from '../../workers/api/node_modules/miniflare/dist/src/index.js';
import { createServer as createViteServer } from 'vite';
import { localBindings, localFrontendEnvironment } from './local-config.mjs';
import { seedLocalStack } from './local-seed.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const api = path.join(root, 'workers/api');

export async function availablePort() {
  const socket = createNetServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function startLocalStack({ port = 8080, watch = true } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid_local_port');
  if (port === 0) port = await availablePort();
  const origin = 'https://127.0.0.1:' + port;
  const directory = await mkdtemp(path.join(tmpdir(), 'fanmark-development-'));
  await chmod(directory, 0o700);
  const deniedOutbound = [];
  const requests = [];
  let runtime, builder, vite, server, stopping;
  const stop = () => stopping ??= (async () => {
    // Stop watchers before closing their HTTP server and Worker runtime.
    console.log('[local] Stopping Worker watcher');
    await builder?.dispose();
    console.log('[local] Stopping frontend watcher');
    await vite?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    console.log('[local] Stopping local data runtime');
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  })();
  try {
    const keyPath = path.join(directory, 'tls.key');
    const certificatePath = path.join(directory, 'tls.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath,
      '-out', certificatePath, '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    await chmod(keyPath, 0o600);
    const tls = { key: await readFile(keyPath), cert: await readFile(certificatePath) };
    const bindings = localBindings(origin);
    const session = path.basename(directory);
    let seeded = false;
    const runtimeOptions = compiled => ({
      workers: [{
        config: {
          name: session, type: 'worker', compatibilityDate: '2026-09-18',
          compatibilityFlags: ['nodejs_compat'],
          exports: { NotificationWakeCoordinator: { type: 'durable-object', storage: 'sqlite' } },
          env: {
            ...Object.fromEntries(Object.entries(bindings).map(([name, value]) => [name, { type: 'text', value }])),
            ...Object.fromEntries(['AUTH_DB', 'FANMARK_DB', 'MASTER_DB'].map(name => [name, { type: 'd1', name: session + '-' + name }])),
            ...Object.fromEntries(['AVATARS_BUCKET', 'COVER_IMAGES_BUCKET'].map(name => [name, { type: 'r2', name: session + '-' + name }])),
            NOTIFICATION_WAKE: { type: 'durable-object', worker: session, exportName: 'NotificationWakeCoordinator' },
          },
          manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: compiled } } },
        },
        dev: {
          outboundService: { type: 'fetcher', handler: request => {
            const url = new URL(request.url);
            deniedOutbound.push({ method: request.method, host: url.hostname, path: url.pathname });
            return new Response('External requests are disabled in local development', { status: 503 });
          } },
        },
      }],
    });
    builder = await buildContext({
      entryPoints: [path.join(api, 'src/index.ts')], bundle: true, write: false,
      format: 'esm', platform: 'browser', target: 'es2022', conditions: ['workerd'],
      external: ['cloudflare:*', 'node:*'],
      plugins: [{
        name: 'reload-local-worker',
        setup(build) {
          build.onEnd(async result => {
            if (!seeded || result.errors.length) return;
            await runtime.setOptions(runtimeOptions(result.outputFiles[0].text));
            console.log('[local] Worker rebuilt; local data retained');
          });
        },
      }],
    });
    const compiled = await builder.rebuild();
    runtime = new Miniflare(runtimeOptions(compiled.outputFiles[0].text));
    const fixtures = await seedLocalStack(runtime);
    seeded = true;
    if (watch) await builder.watch();

    server = createHttpsServer(tls);
    const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const environment = localFrontendEnvironment(origin, packageJson);
    const emptyEnv = path.join(directory, 'empty-env');
    await mkdir(emptyEnv);
    // Vite must not expose inherited VITE values or read the tracked legacy .env.
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('VITE_')));
    for (const name of Object.keys(inherited)) delete process.env[name];
    try {
      vite = await createViteServer({
        root, mode: 'cloudflare-local', envDir: emptyEnv,
        define: Object.fromEntries(Object.entries(environment).map(([name, value]) => ['import.meta.env.' + name, JSON.stringify(value)])),
        server: { middlewareMode: true, host: '127.0.0.1', hmr: { server }, preTransformRequests: false },
      });
    } finally {
      Object.assign(process.env, inherited);
    }
    server.on('request', async (request, response) => {
      const url = new URL(request.url, origin);
      // The server is local-only, including requests with an unexpected Host.
      if (request.headers.host !== new URL(origin).host) {
        response.writeHead(403).end('Unexpected local host');
        return;
      }
      if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') {
        vite.middlewares(request, response, () => response.writeHead(404).end('Not found'));
        return;
      }
      try {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 6 * 1024 * 1024) {
            response.writeHead(413).end('Request too large');
            return;
          }
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (value !== undefined && !['host', 'transfer-encoding', 'connection'].includes(name)) {
            headers.set(name, Array.isArray(value) ? value.join(',') : value);
          }
        }
        const result = await runtime.dispatchFetch(origin + request.url, {
          method: request.method, headers, redirect: 'manual', ...(body.length ? { body } : {}),
        });
        requests.push({ method: request.method, path: url.pathname, status: result.status });
        response.statusCode = result.status;
        for (const [name, value] of result.headers) {
          if (!['set-cookie', 'transfer-encoding', 'content-length', 'connection'].includes(name)) response.setHeader(name, value);
        }
        const cookies = result.headers.getSetCookie();
        if (cookies.length) response.setHeader('set-cookie', cookies);
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch (error) {
        console.error('[local] API request failed:', error.message);
        response.writeHead(500).end('Local Worker request failed');
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    await writeFile(path.join(directory, 'fixtures.json'), JSON.stringify(fixtures), { mode: 0o600 });
    return { origin, directory, runtime, fixtures, deniedOutbound, requests, stop,
      rebuildWorker: () => builder.rebuild() };
  } catch (error) {
    await stop();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/u.test(args[1]))) {
    throw new Error('Usage: npm run dev:local -- [--port 8080]');
  }
  const startup = startLocalStack({ port: args.length ? Number(args[1]) : 8080 });
  let interrupted = false;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      interrupted = true;
      void startup.then(stack => stack.stop()).then(() => process.exit(0), () => process.exit(1));
    });
  }
  const stack = await startup;
  if (!interrupted) {
  console.log('\nLocal app: ' + stack.origin);
  console.log('Synthetic accounts: owner@example.invalid / other@example.invalid / admin@example.invalid');
  console.log('Local password: ' + stack.fixtures.users[0].password);
  console.log('Accept the loopback certificate in the browser. Data resets when this process stops.');
  console.log('Email, OAuth, payments and all external Worker requests are disabled.\n');
  }
}
