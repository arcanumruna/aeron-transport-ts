// Cross-process event-driven round trips: this process pings, a forked child echoes.
import { fork } from 'node:child_process';
import { Aeron } from '../../src/client/Aeron.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { Publication } from '../../src/client/Publication.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { SleepingMillisIdleStrategy } from '../../src/agrona/concurrent/SleepingMillisIdleStrategy.js';
import './xhops.ts'; import './cnt.ts';
import { freePort, until, message } from '../lib/e2e.js';

const mk = () => process.env.PARK ? new MediaDriver.Context().sharedIdleStrategy(new SleepingMillisIdleStrategy(Number(process.env.PARK))) : new MediaDriver.Context();
const ps = '|term-length=1048576';
const isEcho = process.argv[2] === 'echo';
let onWake = (): void => {};
const d = MediaDriver.launch(mk().wakeUp(() => onWake()));
const a = Aeron.connect(new Aeron.Context().mediaDriver(d));

if (isEcho) {
    const [pIn, pOut] = [Number(process.argv[3]), Number(process.argv[4])];
    const sub = a.addSubscription('aeron:udp?endpoint=127.0.0.1:' + pIn, 1001);
    const pub = a.addPublication('aeron:udp?endpoint=127.0.0.1:' + pOut + ps, 1002) as Publication;
    const echo: FragmentHandler = { onFragment: (b, o, l) => { (globalThis as any).__xhop('echo'); while (pub.offer(b, o, l) < 0) {} d.wake(); } };
    onWake = () => { sub.poll(echo, 16); };
    process.on('message', (m) => { if (m === 'log') { process.send!((globalThis as any).__xlog.slice(-3000)); return; } a.close(); d.close(); process.exit(0); });
    process.send!('ready');
} else {
    const RUNS = Number(process.env.RUNS ?? 5), TRIPS = 3000;
    const pct = (x: Float64Array, p: number) => x[Math.min(x.length - 1, Math.floor(p * x.length))];
    const median = (x: number[]) => [...x].sort((u, v) => u - v)[Math.floor(x.length / 2)];
    const pB = await freePort(), pA = await freePort();
    const child = fork(new URL(import.meta.url).pathname, ['echo', String(pB), String(pA)], { env: process.env });
    await new Promise((r) => child.once('message', r));
    const pub = a.addPublication('aeron:udp?endpoint=127.0.0.1:' + pB + ps, 1001) as Publication;
    const sub = a.addSubscription('aeron:udp?endpoint=127.0.0.1:' + pA, 1002);
    await until(() => pub.isConnected() && sub.imageCount() > 0, 'connect');
    let resolve: () => void = () => {};
    const pong: FragmentHandler = { onFragment: () => { (globalThis as any).__xhop('pong'); resolve(); } };
    onWake = () => { sub.poll(pong, 16); };
    async function rtt(size: number): Promise<number[]> {
        const buf = message(size), s = new Float64Array(TRIPS);
        for (let i = 0; i < 200 + TRIPS; i++) {
            const t0 = performance.now();
            await new Promise<void>((r) => { resolve = r; (globalThis as any).__xhop('offer'); while (pub.offer(buf, 0, size) < 0) {} d.wake(); });
            (globalThis as any).__xhop('resumed');
            if (i >= 200) s[i - 200] = (performance.now() - t0) * 1000;
        }
        s.sort();
        return [pct(s, 0.5), pct(s, 0.99), pct(s, 0.999)];
    }
    const sizes = [32, 512, 1376];
    const res: Record<number, number[][]> = { 32: [], 512: [], 1376: [] };
    for (let r = 0; r < RUNS; r++) for (const z of r % 2 ? [...sizes].reverse() : sizes) res[z].push(await rtt(z));
    for (const z of sizes) console.log('aeron', z, [0, 1, 2].map((k) => median(res[z].map((x) => x[k])).toFixed(1)).join(' / '));
    if (process.env.XHOPS) {
        child.send('log');
        const bl: [string, number][] = await new Promise((r) => child.once('message', r as any));
        const al: [string, number][] = (globalThis as any).__xlog;
        const tEnd = bl[bl.length - 1][1];
        const all = [...al.filter(([, t]) => t >= bl[0][1] && t <= tEnd), ...bl].sort((x, y) => x[1] - y[1]);
        // per trip: sequence from offer to pong
        const agg = new Map<string, number[][]>();
        let cur: [string, number][] = [];
        for (const e of all) { if (e[0].startsWith('A.offer')) { if (cur.length) { const n0 = (k: string) => k.replace(/#\d+$/, ''); const key = cur.map(([n]) => n0(n)).join(' '); const d = cur.map(([, t], i) => (t - (i ? cur[i - 1][1] : t)) * 1000); if (!agg.has(key)) agg.set(key, []); agg.get(key)!.push(d); } cur = []; } cur.push(e); }
        for (const [k, v] of [...agg].sort((x, y) => y[1].length - x[1].length).slice(0, 3)) { const names = k.split(' '); console.log(v.length, names.map((n, i) => { const c = v.map((d) => d[i]).sort((x, y) => x - y); return n + ' +' + c[c.length >> 1].toFixed(1); }).join('  ')); }
    }
    child.send('stop');
    a.close(); d.close();
}
