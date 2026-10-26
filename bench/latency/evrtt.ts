// Event-driven round trips: each side polls from its driver's wake hook.
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { Aeron } from '../../src/client/Aeron.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { Publication } from '../../src/client/Publication.js';
import type { Subscription } from '../../src/client/Subscription.js';
import './hops.ts';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { SleepingMillisIdleStrategy } from '../../src/agrona/concurrent/SleepingMillisIdleStrategy.js';
const mk = () => process.env.PARK ? new MediaDriver.Context().sharedIdleStrategy(new SleepingMillisIdleStrategy(1)) : new MediaDriver.Context();
import { freePort, until, message } from '../lib/e2e.js';

const RUNS = Number(process.env.RUNS ?? 5), TRIPS = 3000;
const pct = (a: Float64Array, p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

let onA = (): void => {};
let onB = (): void => {};
const da = MediaDriver.launch(mk().wakeUp(() => onA()));
const db = MediaDriver.launch(mk().wakeUp(() => onB()));
const aa = Aeron.connect(new Aeron.Context().mediaDriver(da));
const ab = Aeron.connect(new Aeron.Context().mediaDriver(db));
const pB = await freePort(), pA = await freePort();
const ps = '|term-length=1048576';
const pingSub: Subscription = ab.addSubscription('aeron:udp?endpoint=127.0.0.1:' + pB, 1001);
const pingPub = aa.addPublication('aeron:udp?endpoint=127.0.0.1:' + pB + ps, 1001) as Publication;
const pongSub: Subscription = aa.addSubscription('aeron:udp?endpoint=127.0.0.1:' + pA, 1002);
const pongPub = ab.addPublication('aeron:udp?endpoint=127.0.0.1:' + pA + ps, 1002) as Publication;
await until(() => pingPub.isConnected() && pongPub.isConnected() && pingSub.imageCount() > 0 && pongSub.imageCount() > 0, 'connect');

let received = 0;
let resolve: () => void = () => {};
const echo: FragmentHandler = { onFragment: (b, o, l) => { (globalThis as any).__hop('echo'); while (pongPub.offer(b, o, l) < 0) {} db.wake(); } };
const pong: FragmentHandler = { onFragment: () => { (globalThis as any).__hop('pong'); received++; resolve(); } };
onB = () => { pingSub.poll(echo, 16); };
onA = () => { pongSub.poll(pong, 16); };

async function rtt(size: number): Promise<number[]> {
    const buf: UnsafeBuffer = message(size);
    const s = new Float64Array(TRIPS);
    for (let i = 0; i < 200 + TRIPS; i++) {
        const t0 = performance.now();
        await new Promise<void>((r) => { resolve = r; while (pingPub.offer(buf, 0, size) < 0) {} da.wake(); });
        if (i >= 200) s[i - 200] = (performance.now() - t0) * 1000;
    }
    s.sort();
    return [pct(s, 0.5), pct(s, 0.99), pct(s, 0.999)];
}
if (process.env.IDLE) { await rtt(32); const g = globalThis as any; for (let r = 0; r < 5; r++) { const n0 = g.__dcN, t0 = performance.now(); for (let i = 0; i < 200000; i++) da.wake(); console.log('idle cycle us', ((performance.now() - t0) * 1000 / (g.__dcN - n0)).toFixed(2), 'cycles/wake', ((g.__dcN - n0) / 200000).toFixed(2)); } process.exit(0); }
if (process.env.HOPS) { const g = globalThis as any; const m = message(32); await rtt(32); await rtt(32);
const agg = new Map<string, number[]>();
for (let k = 0; k < 3000; k++) { g.__on = true; g.__hop('offer'); await new Promise<void>((r) => { resolve = r; while (pingPub.offer(m, 0, 32) < 0) {} da.wake(); }); g.__hop('done'); g.__on = false; const key = g.__seq(); if (!agg.has(key)) agg.set(key, []); (agg.get(key) as any).push(g.__deltas()); g.__clear(); }
for (const [n, v] of [...agg].sort((a, b) => b[1].length - a[1].length).slice(0, 4)) { const names = n.split(' '); console.log(v.length, names.map((x, i) => { const m = (k: number) => { const c = (v as any).map((d: number[][]) => d[i][k]).sort((x: number, y: number) => x - y); return c[c.length >> 1].toFixed(1); }; return x + ' +' + m(0) + ' (dc ' + m(1) + ')'; }).join('  ')); } process.exit(0); }
const sizes = [32, 512, 1376];
const res: Record<number, number[][]> = { 32: [], 512: [], 1376: [] };
for (let r = 0; r < RUNS; r++) for (const z of r % 2 ? [...sizes].reverse() : sizes) res[z].push(await rtt(z));
for (const z of sizes) console.log(z, [0, 1, 2].map((k) => median(res[z].map((x) => x[k])).toFixed(1)).join(' / '));
aa.close(); ab.close(); da.close(); db.close();
