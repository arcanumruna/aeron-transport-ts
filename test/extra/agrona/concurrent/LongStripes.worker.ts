// The worker script of LongStripesExtraTest (run through test/support/Workers.ts).
import { parentPort, workerData } from 'node:worker_threads';
import { LongStripes } from '../../../../src/agrona/concurrent/LongStripes.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';

const data = workerData as { kind: 'add' | 'wrap' };

if ('add' === data.kind) {
    parentPort!.postMessage(Atomics.add(LongStripes.table()!, 0, 7));
} else {
    try {
        new UnsafeBuffer(new SharedArrayBuffer(64));
        parentPort!.postMessage({ name: 'none', message: '' });
    } catch (e) {
        parentPort!.postMessage({ name: (e as Error).constructor.name, message: (e as Error).message });
    }
}
