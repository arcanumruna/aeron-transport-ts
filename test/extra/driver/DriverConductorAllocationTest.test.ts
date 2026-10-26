// Extra test of T18 (port-only, spec 5.3): the duty cycle of the conductor, with a publication and a subscription
// registered and no command to take, allocates nothing in the port's own code: the clocks, the timers, the empty read
// of the command ring and of the command queue, and the tracking of the positions of the stream.
import { afterEach, describe, it } from 'vitest';
import { Configuration } from '../../../src/driver/Configuration.js';
import { DriverConductor } from '../../../src/driver/DriverConductor.js';
import type { DriverConductorProxy } from '../../../src/driver/DriverConductorProxy.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { NativeResourceAgent } from '../../../src/driver/NativeResourceAgent.js';
import type { NativeResourceAgentProxy } from '../../../src/driver/NativeResourceAgentProxy.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { ITERATIONS, expectNoAllocation } from '../../support/Allocation.js';
import { DriverProxy } from '../../support/DriverProxy.js';
import { freeUdpPort } from '../../support/Udp.js';

describe('DriverConductor allocation', () => {
    let conductor: DriverConductor;
    let agent: NativeResourceAgent;

    afterEach(() => {
        agent.onClose();
        conductor.onClose();
    });

    it('the duty cycle with a publication and a subscription allocates nothing', async () => {
        const ctx = new MediaDriver.Context()
            .threadingMode(ThreadingMode.INVOKER)
            .timerIntervalNs(Configuration.DEFAULT_TIMER_INTERVAL_NS)
            .conclude();
        agent = new NativeResourceAgent(ctx);
        (ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy).nativeResourceAgent(agent);
        conductor = new DriverConductor(ctx);
        (ctx.driverConductorProxy() as DriverConductorProxy).driverConductor(conductor);
        conductor.onStart();
        const proxy = new DriverProxy(ctx.toDriverCommands()!, ctx.toDriverCommands()!.nextCorrelationId());
        proxy.addPublication('aeron:udp?endpoint=127.0.0.1:' + freeUdpPort(), 1001);
        proxy.addSubscription('aeron:udp?endpoint=127.0.0.1:' + freeUdpPort(), 1001);
        for (let i = 0; i < 1000; i++) {
            conductor.doWork();
            agent.doWork();
        }

        await expectNoAllocation((n) => {
            for (let i = 0; i < n; i++) {
                conductor.doWork();
            }
        }, ITERATIONS / 4);
    });
});
