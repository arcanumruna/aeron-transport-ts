// Extra tests of T19 (port-only, spec 5.3): the duty cycle of the client conductor with no events allocates nothing: the
// service check, the liveness check (the heartbeat counter of the client is stamped), the check of the lingering logs, the
// empty receive of the broadcast buffer and the empty list of the commands that wait for a host name. A minor collection
// happens only after something is allocated, so the test counts the collections over a long loop
// (test/support/Allocation.ts). The clocks are small integers, so that no heap number comes from the clocks themselves.
import { describe, it } from 'vitest';
import { NoOpIdleStrategy } from '../../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { NoOpLock } from '../../../src/agrona/concurrent/NoOpLock.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import type { Aeron } from '../../../src/client/Aeron.js';
import { Aeron as AeronClass } from '../../../src/client/Aeron.js';
import { ClientConductor } from '../../../src/client/ClientConductor.js';
import type { DriverProxy } from '../../../src/client/DriverProxy.js';
import type { LogBuffersFactory } from '../../../src/client/LogBuffersFactory.js';
import { HeartbeatTimestamp } from '../../../src/client/status/HeartbeatTimestamp.js';
import { expectNoAllocation } from '../../support/Allocation.js';
import { mock } from '../../support/Mockito.js';

const ITERATIONS = 300_000;

describe('ClientConductorAllocation', () => {
    it('anIdleDutyCycleAllocatesNothing', async () => {
        const metaData = new UnsafeBuffer(new ArrayBuffer(64 * 1024));
        const values = new UnsafeBuffer(new ArrayBuffer(16 * 1024));
        const countersManager = new CountersManager(metaData, values);
        const clientId = 0;
        HeartbeatTimestamp.allocate(
            new UnsafeBuffer(new ArrayBuffer(512)),
            'client-heartbeat',
            HeartbeatTimestamp.HEARTBEAT_TYPE_ID,
            countersManager,
            clientId,
        );

        let nowNs = 0;
        const aeron = mock(AeronClass).mock as Aeron;
        const errors: Error[] = [];
        const ctx = new AeronClass.Context()
            .clientLock(NoOpLock.INSTANCE)
            .epochClock({ time: () => 5 })
            .nanoClock({ nanoTime: () => ++nowNs })
            .awaitingIdleStrategy(new NoOpIdleStrategy())
            .toClientBuffer({ receive: () => 0 } as never)
            .driverProxy({ timeOfLastDriverKeepaliveMs: () => 5 } as unknown as DriverProxy)
            .logBuffersFactory({ map: () => null } as unknown as LogBuffersFactory)
            .errorHandler({ onError: (e) => void errors.push(e) })
            .idleSleepDurationNs(1_000)
            .keepAliveIntervalNs(100_000)
            .interServiceTimeoutNs(500_000_000)
            .driverTimeoutMs(1_000);
        ctx.countersMetaDataBuffer(metaData);
        ctx.countersValuesBuffer(values);
        const conductor = new ClientConductor(ctx, aeron);

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                conductor.doWork();
            }
        }, ITERATIONS);

        if (errors.length > 0) {
            throw errors[0];
        }
    });
});
