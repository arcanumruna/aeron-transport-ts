import dgram from 'node:dgram';
const S = dgram.Socket.prototype as any;
const g = globalThis as any;
const log: [string, number][] = [];
const tag = process.argv[2] === 'echo' ? 'B.' : 'A.';
g.__xhop = (n: string) => { if (log.length < 200000) log.push([tag + n + '#' + (g.__dcN ?? 0), performance.timeOrigin + performance.now()]); };
const os = S.send; S.send = function (b: any, ...a: any[]) { g.__xhop('send' + b.length); return os.call(this, b, ...a); };
const oe = S.emit; S.emit = function (e: string, m: any, ...a: any[]) { if (e === 'message') g.__xhop('recv' + m.length); return oe.call(this, e, m, ...a); };
g.__xlog = log;
