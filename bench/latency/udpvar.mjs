import { fork } from 'node:child_process';
import dgram from 'node:dgram';
const V = process.env.V ?? 'plain';
const busy = (us) => { const e = performance.now() + us / 1000; while (performance.now() < e); };
if (V === 'interval') setInterval(() => {}, 1);
if (V === 'interval1s') setInterval(() => {}, 1000);
let prev = null; const D = Number(process.env.D ?? 1);
const after = () => {
  if (V === 'rearm') { if (prev) clearTimeout(prev); prev = setTimeout(() => {}, D); }
  if (V === 'refresh') { if (prev) prev.refresh(); else prev = setTimeout(() => {}, D); }
  if (V === 'timer') setTimeout(() => {}, 1);
  if (V === 'timer100') setTimeout(() => {}, 100);
  if (V === 'imm0') { let n = 3; const f = () => { busy(3); if (--n) setImmediate(f); }; setImmediate(f); }
  if (V === 'imm') { let n = 3; const f = () => { busy(3); if (--n) setImmediate(f); else setTimeout(() => {}, 1); }; setImmediate(f); }
};
if (process.argv[2] === 'echo') {
  const s = dgram.createSocket('udp4');
  s.on('message', (m, r) => { s.send(m, r.port, r.address, () => {}); after(); });
  s.bind(0, '127.0.0.1', () => process.send(s.address().port));
  process.on('message', () => process.exit(0));
} else {
  const child = fork(new URL(import.meta.url).pathname, ['echo'], { env: process.env });
  const port = await new Promise((r) => child.once('message', r));
  const c = dgram.createSocket('udp4'); await new Promise((r) => c.bind(0, '127.0.0.1', r));
  let resolve; c.on('message', () => { resolve(); after(); });
  const buf = Buffer.alloc(1376), s = new Float64Array(5000);
  for (let i = 0; i < 5500; i++) { const t0 = performance.now(); await new Promise((r) => { resolve = r; c.send(buf, port, '127.0.0.1', () => {}); }); if (i >= 500) s[i - 500] = (performance.now() - t0) * 1000; }
  s.sort(); console.log(V, s[2500].toFixed(1), s[4950].toFixed(1)); child.send(0); process.exit(0);
}
