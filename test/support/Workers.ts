// Runs worker_threads for the cross-worker tests of the shared-memory classes (spec D16, 8.2). Node strips the
// TypeScript types of a worker script itself; workerRegister.mjs maps the `./X.js` imports of the sources to `X.ts`.
// A worker script is a `*.worker.ts` file (vitest does not run it as a test), posts one result with
// `parentPort.postMessage`, and must have a hard iteration cap on every loop so that a bug fails instead of hanging.
import { Worker } from 'node:worker_threads';

const REGISTER_URL = new URL('./workerRegister.mjs', import.meta.url).href;

/**
 * Starts one worker per entry of `workerDatas` on the script, and resolves with the single result that each posted,
 * in the order of `workerDatas`.
 *
 * @param scriptUrl   of the `*.worker.ts` script.
 * @param workerDatas the `workerData` of each worker (a `SharedArrayBuffer` in it is shared, not copied).
 * @param timeoutMs   after which all workers are terminated and the promise rejects.
 * @return the results.
 * @throws Error on the first worker error or non-zero exit, or on the timeout (all workers are terminated first).
 */
export function runWorkers(scriptUrl: URL, workerDatas: unknown[], timeoutMs: number): Promise<unknown[]> {
    return new Promise<unknown[]>((resolve, reject) => {
        const results: unknown[] = new Array<unknown>(workerDatas.length);
        const received: boolean[] = new Array<boolean>(workerDatas.length).fill(false);
        let pending = workerDatas.length;
        let finished = false;
        const workers: Worker[] = [];

        const finish = (outcome: () => void): void => {
            if (finished) {
                return;
            }
            finished = true;
            clearTimeout(timer);
            void Promise.all(workers.map((w) => w.terminate())).then(outcome);
        };
        const fail = (error: Error): void => finish(() => reject(error));

        const timer = setTimeout(() => fail(new Error('workers timed out after ' + timeoutMs + ' ms')), timeoutMs);

        if (0 === pending) {
            finish(() => resolve(results));
            return;
        }

        workerDatas.forEach((workerData, i) => {
            const worker = new Worker(scriptUrl, { workerData, execArgv: ['--import', REGISTER_URL, '--no-warnings'] });
            workers.push(worker);
            worker.once('message', (message: unknown) => {
                results[i] = message;
                received[i] = true;
                if (0 === --pending) {
                    finish(() => resolve(results));
                }
            });
            worker.once('error', (error: Error) => fail(error));
            worker.once('exit', (code: number) => {
                if (!received[i]) {
                    fail(new Error('worker ' + i + ' exited with code ' + code + ' without a result'));
                }
            });
        });
    });
}
