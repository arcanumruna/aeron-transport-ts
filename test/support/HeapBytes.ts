// Bytes allocated per unit of work, to the byte (issue #52). `expectNoAllocation` counts minor collections, which needs
// millions of iterations to see a few bytes and cannot tell a leak of 16 bytes from none in a short loop; this reads
// `heapUsed` (the new space grows by exactly what is allocated until a scavenge) around chunks of work and takes the
// median chunk. A chunk that contains a scavenge shows less than it allocated (or a negative delta), and a chunk that
// contains other work of the process shows more; the median of many chunks is neither.
import v8 from 'node:v8';
import vm from 'node:vm';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;

/**
 * Median bytes per unit of work of `run(chunk)`, which does at least `chunk` units and returns the number it did, over
 * `chunks` chunks, after `warmUpChunks` chunks that are not measured. A collection is forced before the first, so that it
 * starts with an empty new space.
 */
export function medianBytesPerUnit(
    run: (units: number) => number,
    chunk: number,
    chunks: number,
    warmUpChunks: number,
): number {
    for (let i = 0; i < warmUpChunks; i++) {
        run(chunk);
    }
    gc();
    const samples = new Float64Array(chunks);
    for (let i = 0; i < chunks; i++) {
        const before = process.memoryUsage().heapUsed;
        const done = run(chunk);
        samples[i] = (process.memoryUsage().heapUsed - before) / done;
    }
    samples.sort();
    return samples[chunks >> 1] as number;
}
