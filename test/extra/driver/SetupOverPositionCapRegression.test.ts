// Regression test of issue #58 (port-only, spec D126): a SETUP whose position is over the position cap is rejected
// before any image log is allocated, and at most one error is recorded for it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OneToOneConcurrentArrayQueue } from '../../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import { DriverProxy } from '../../../src/client/DriverProxy.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { DriverConductor } from '../../../src/driver/DriverConductor.js';
import type { DriverConductorProxy } from '../../../src/driver/DriverConductorProxy.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import type { ReceiveChannelEndpoint } from '../../../src/driver/media/ReceiveChannelEndpoint.js';
import { NativeResourceAgent } from '../../../src/driver/NativeResourceAgent.js';
import type { NativeResourceAgentProxy } from '../../../src/driver/NativeResourceAgentProxy.js';
import type { ReceiverProxy } from '../../../src/driver/ReceiverProxy.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { mock } from '../../support/Mockito.js';

const TERM_16_MIB = 16 * 1024 * 1024;

describe('SetupOverPositionCapRegression', () => {
    let ctx: MediaDriver.Context;
    let conductor: DriverConductor;
    let agent: NativeResourceAgent;
    let driverProxy: DriverProxy;
    let errors: Error[];
    let endpoint: ReceiveChannelEndpoint;

    beforeEach(() => {
        errors = [];
        ctx = new MediaDriver.Context()
            .threadingMode(ThreadingMode.INVOKER)
            .publicationTermBufferLength(LogBufferDescriptor.TERM_MIN_LENGTH)
            .counterValuesBufferLength(2 * 1024 * 1024)
            .errorHandler({ onError: (e) => errors.push(e) })
            .senderCommandQueue(new OneToOneConcurrentArrayQueue<() => void>(1024))
            .receiverCommandQueue(new OneToOneConcurrentArrayQueue<() => void>(1024))
            .conclude();
        agent = new NativeResourceAgent(ctx);
        (ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy).nativeResourceAgent(agent);
        conductor = new DriverConductor(ctx);
        (ctx.driverConductorProxy() as DriverConductorProxy).driverConductor(conductor);
        conductor.onStart();
        driverProxy = new DriverProxy(ctx.toDriverCommands() as never, ctx.toDriverCommands()!.nextCorrelationId());
        driverProxy.addSubscription('aeron:udp?endpoint=127.0.0.1:30700', 7000);
        cycles(200);
        endpoint = conductor.subscriptionLinks[0]!.channelEndpoint() as ReceiveChannelEndpoint;
    });

    afterEach(() => {
        agent.onClose();
        conductor.onClose();
    });

    function cycles(n: number): void {
        for (let i = 0; i < n; i++) {
            conductor.doWork();
            agent.doWork();
        }
    }

    function setup(initialTermId: number, activeTermId: number, termOffset: number, termLength: number): void {
        conductor.onCreatePublicationImage(
            99,
            7000,
            initialTermId,
            activeTermId,
            termOffset,
            termLength,
            1408,
            0,
            0,
            mock(InetSocketAddress).mock,
            mock(InetSocketAddress).mock,
            endpoint,
        );
        cycles(200);
    }

    it('aSetupOverThePositionCapAllocatesNoLogAndRecordsAtMostOneError', () => {
        const newImageLog = vi.spyOn(ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy, 'newImageLog');
        const removeInit = vi.spyOn(ctx.receiverProxy() as ReceiverProxy, 'removeInitInProgress');
        const errorsBefore = errors.length;

        for (let round = 0; round < 3; round++) {
            setup(0, 2147483647, 0, TERM_16_MIB);
            // each SETUP is rejected on its own: no log, the marker is removed, one error at most
            expect(newImageLog).not.toHaveBeenCalled();
            expect(removeInit).toHaveBeenCalledTimes(round + 1);
            expect(errors.length - errorsBefore).toBeLessThanOrEqual(round + 1);
        }
    });

    it('aSetupAtThePositionCapIsStillAccepted', () => {
        // 16 MiB terms: the cap is 2^53 - 2^24, which termCount 2^29 - 1 at offset 0 reaches exactly
        const termCount = 2 ** 29 - 1;
        const newImageLog = vi.spyOn(ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy, 'newImageLog');
        const removeInit = vi.spyOn(ctx.receiverProxy() as ReceiverProxy, 'removeInitInProgress');
        const errorsBefore = errors.length;

        setup(0, termCount, 0, TERM_16_MIB);
        expect(newImageLog).toHaveBeenCalledTimes(1);
        expect(removeInit).not.toHaveBeenCalled();
        expect(errors.length - errorsBefore).toBe(0);

        // 32 bytes further is over the cap: rejected, with exactly one error
        setup(0, termCount, 32, TERM_16_MIB);
        expect(newImageLog).toHaveBeenCalledTimes(1);
        expect(removeInit).toHaveBeenCalledTimes(1);
        expect(errors.length - errorsBefore).toBe(1);
    });
});
