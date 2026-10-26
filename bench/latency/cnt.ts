import dgram from 'node:dgram';
const S = dgram.Socket.prototype as any; const c = new Map<number, number>();
const os = S.send; S.send = function (b: any, ...a: any[]) { c.set(b.length, (c.get(b.length) ?? 0) + 1); return os.call(this, b, ...a); };
process.on('exit', () => console.error((process.argv[2] ?? 'A') + ' sends by size', JSON.stringify([...c])));
