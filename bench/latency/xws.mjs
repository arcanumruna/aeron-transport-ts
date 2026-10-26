// Cross-process ws and raw dgram round trips (child echoes).
import { fork } from 'node:child_process';
import dgram from 'node:dgram';
import { createRequire } from 'node:module';
const { WebSocketServer, WebSocket } = createRequire(process.env.WSDIR + '/')('ws');
const mode = process.argv[2];
if (mode === 'wsecho') {
  const wss = new WebSocketServer({ port: 0, perMessageDeflate: false });
  wss.on('connection', (s) => s.on('message', (d) => s.send(d, { binary: true })));
  wss.on('listening', () => process.send(wss.address().port));
  process.on('message', () => process.exit(0));
} else if (mode === 'udpecho') {
  const s = dgram.createSocket('udp4');
  s.on('message', (m, r) => s.send(m, r.port, r.address));
  s.bind(0, '127.0.0.1', () => process.send(s.address().port));
  process.on('message', () => process.exit(0));
} else {
  const RUNS = Number(process.env.RUNS ?? 5), TRIPS = 3000;
  const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  for (const kind of ['ws', 'udp']) {
    const child = fork(new URL(import.meta.url).pathname, [kind + 'echo'], { env: process.env });
    const port = await new Promise((r) => child.once('message', r));
    let send, resolve;
    if (kind === 'ws') {
      const c = new WebSocket(`ws://127.0.0.1:${port}`, { perMessageDeflate: false });
      await new Promise((r) => c.on('open', r));
      c.on('message', () => resolve());
      send = (b) => c.send(b, { binary: true });
    } else {
      const c = dgram.createSocket('udp4');
      await new Promise((r) => c.bind(0, '127.0.0.1', r));
      c.on('message', () => resolve());
      send = (b) => c.send(b, port, '127.0.0.1');
    }
    async function rtt(size) {
      const buf = Buffer.alloc(size, 7), s = new Float64Array(TRIPS);
      for (let i = 0; i < 200 + TRIPS; i++) {
        const t0 = performance.now();
        await new Promise((r) => { resolve = r; send(buf); });
        if (i >= 200) s[i - 200] = (performance.now() - t0) * 1000;
      }
      s.sort();
      return [pct(s, 0.5), pct(s, 0.99), pct(s, 0.999)];
    }
    const sizes = [32, 512, 1376], res = { 32: [], 512: [], 1376: [] };
    for (let r = 0; r < RUNS; r++) for (const z of r % 2 ? [...sizes].reverse() : sizes) res[z].push(await rtt(z));
    for (const z of sizes) console.log(kind, z, [0, 1, 2].map((k) => median(res[z].map((x) => x[k])).toFixed(1)).join(' / '));
    child.send('stop');
  }
  process.exit(0);
}
