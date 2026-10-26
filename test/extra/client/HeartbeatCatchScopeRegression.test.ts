// Regression test of issue #59 (item 3, port-only, spec D128): the heartbeat counter lookup of `ClientConductor`
// catches what Java's `catch (final RuntimeException ex)` catches, so a programming error (a `TypeError`) is not
// turned into "unexpected close of heartbeat timestamp counter".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IllegalStateException } from '../../../src/agrona/jdk.js';
import { AeronException } from '../../../src/client/exceptions/AeronException.js';
import { EmbeddedRig } from '../../support/EmbeddedRig.js';
import { freeUdpPort } from '../../support/Udp.js';

describe('HeartbeatCatchScopeRegression', () => {
    let rig: EmbeddedRig | null = null;

    afterEach(() => {
        vi.restoreAllMocks();
        rig?.close();
        rig = null;
    });

    /** Makes the label append of the heartbeat counter throw `error`, and runs cycles until the conductor reports. */
    async function heartbeatFailsWith(error: Error): Promise<Error[]> {
        const r = new EmbeddedRig(true);
        rig = r;
        const reader = r.aeron.countersReader();
        const metaDataBuffer = reader.metaDataBuffer.bind(reader);
        // only the call of the heartbeat lookup (the label append) fails; the other users of the buffer are unharmed
        vi.spyOn(reader, 'metaDataBuffer').mockImplementation(() => {
            if (
                (new Error().stack ?? '').includes('checkLiveness') &&
                !(new Error().stack ?? '').includes('findCounterId')
            ) {
                throw error;
            }
            return metaDataBuffer();
        });
        r.aeron.asyncAddPublication('aeron:udp?endpoint=localhost:' + freeUdpPort(), 1001);
        await r.until(() => r.errors.length > 0, 'an error of the heartbeat lookup');
        return r.errors;
    }

    it('aTypeErrorOfTheHeartbeatLookupIsNotWrappedInAnAeronException', async () => {
        const cause = new TypeError('a programming error');
        const errors = await heartbeatFailsWith(cause);

        expect(errors[0]).toBe(cause);
        expect(errors.some((e) => e instanceof AeronException)).toBe(false);
    });

    it('aRuntimeExceptionOfTheHeartbeatLookupIsWrappedInAnAeronExceptionAsInJava', async () => {
        const cause = new IllegalStateException('the counter was freed');
        const errors = await heartbeatFailsWith(cause);

        expect(errors[0]).toBeInstanceOf(AeronException);
        expect((errors[0] as AeronException).message).toContain('unexpected close of heartbeat timestamp counter: ');
        expect((errors[0] as AeronException).cause).toBe(cause);
    });
});
