// WebSocket (ws, TCP loopback) counterpart of bench:e2e: round trips and one-way streams, same process.
import { createRequire } from 'node:module';
const { WebSocketServer, WebSocket } = createRequire(process.env.WSDIR + '/')('ws');

const RUNS = 5, TRIPS = 3000, STREAM_RUNS = 3, STREAM_MSGS = 50_000;
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const wss = new WebSocketServer({ port: 0, perMessageDeflate: false });
let serverMode = 'echo', serverCount = 0, streamDone = null, streamTarget = 0;
wss.on('connection', (s) => {
  s.on('message', (d) => {
    if (serverMode === 'echo') s.send(d, { binary: true });
    else if (++serverCount === streamTarget) streamDone();
  });
});
await new Promise((r) => wss.on('listening', r));
const c = new WebSocket(`ws://127.0.0.1:${wss.address().port}`, { perMessageDeflate: false });
await new Promise((r) => c.on('open', r));

async function rtt(size) {
  const buf = Buffer.alloc(size, 7), samples = new Float64Array(TRIPS);
  let resolve;
  c.on('message', () => resolve());
  for (let i = 0; i < 200 + TRIPS; i++) {
    const t0 = process.hrtime.bigint();
    await new Promise((r) => { resolve = r; c.send(buf, { binary: true }); });
    if (i >= 200) samples[i - 200] = Number(process.hrtime.bigint() - t0) / 1000;
  }
  c.removeAllListeners('message');
  samples.sort();
  return [pct(samples, 0.5), pct(samples, 0.99), pct(samples, 0.999)];
}

async function stream(size) {
  const buf = Buffer.alloc(size, 7);
  serverMode = 'sink'; serverCount = 0; streamTarget = STREAM_MSGS;
  const done = new Promise((r) => (streamDone = r));
  const t0 = process.hrtime.bigint();
  let sent = 0;
  while (sent < STREAM_MSGS) {
    // respect backpressure like a real sender: stop when 1 MB is queued
    if (c.bufferedAmount > 1 << 20) { await new Promise((r) => setImmediate(r)); continue; }
    c.send(buf, { binary: true }); sent++;
    if ((sent & 255) === 0) await new Promise((r) => setImmediate(r));
  }
  await done;
  const s = Number(process.hrtime.bigint() - t0) / 1e9;
  serverMode = 'echo';
  return STREAM_MSGS / s;
}

const sizes = [32, 512, 1376], res = Object.fromEntries(sizes.map((s) => [s, []]));
for (let r = 0; r < RUNS; r++) {
  const order = r % 2 ? [...sizes].reverse() : sizes;
  for (const s of order) res[s].push(await rtt(s));
}
console.log('round trip us (median of per-run p50/p99/p99.9):');
for (const s of sizes) console.log(s, [0, 1, 2].map((k) => median(res[s].map((x) => x[k])).toFixed(1)).join(' / '));
for (const s of [64, 1376]) {
  const rates = [];
  for (let r = 0; r < STREAM_RUNS; r++) rates.push(await stream(s));
  const m = median(rates);
  console.log(`stream ${s} B: ${Math.round(m)} msgs/s, ${((m * s) / 1e6).toFixed(1)} MB/s`);
}
c.close(); wss.close();
