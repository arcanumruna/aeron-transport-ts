// Extra tests of T18 (port-only): the members of the `DriverConductor` that `DriverConductorTest` does not reach (the
// termination request, the session ids, an image that is rejected, the error frame of a publication, the keepalive
// and the close of a client), the multicast flow control that the manual MDC publications use (`MaxMulticastFlowControl`,
// pulled forward from phase 3) and the `Configuration` readers of the suppliers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { System } from '../../../src/agrona/jdkLang.js';
import { ClassNotFoundException } from '../../../src/agrona/jdk.js';
import { ErrorCode } from '../../../src/client/ErrorCode.js';
import { AeronException } from '../../../src/client/exceptions/AeronException.js';
import { ControlProtocolException } from '../../../src/client/exceptions/ControlProtocolException.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { DefaultAllowTerminationValidator } from '../../../src/driver/DefaultAllowTerminationValidator.js';
import { DefaultCongestionControlSupplier } from '../../../src/driver/DefaultCongestionControlSupplier.js';
import { DefaultDenyTerminationValidator } from '../../../src/driver/DefaultDenyTerminationValidator.js';
import { DefaultMulticastFlowControlSupplier } from '../../../src/driver/DefaultMulticastFlowControlSupplier.js';
import { DefaultUnicastFlowControlSupplier } from '../../../src/driver/DefaultUnicastFlowControlSupplier.js';
import { DriverConductor } from '../../../src/driver/DriverConductor.js';
import type { DriverConductorProxy } from '../../../src/driver/DriverConductorProxy.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MaxMulticastFlowControl } from '../../../src/driver/MaxMulticastFlowControl.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { NativeResourceAgent } from '../../../src/driver/NativeResourceAgent.js';
import type { NativeResourceAgentProxy } from '../../../src/driver/NativeResourceAgentProxy.js';
import { SessionKey } from '../../../src/driver/SessionKey.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { assertThrows } from '../../support/Assertions.js';
import { mock } from '../../support/Mockito.js';

describe('DriverConductor extra', () => {
    let ctx: MediaDriver.Context;
    let conductor: DriverConductor;
    let agent: NativeResourceAgent;
    let errors: Error[];
    let hookCalls: number;

    function newConductor(configure: (ctx: MediaDriver.Context) => MediaDriver.Context = (c) => c): void {
        errors = [];
        hookCalls = 0;
        ctx = configure(
            new MediaDriver.Context()
                .threadingMode(ThreadingMode.INVOKER)
                .errorHandler({ onError: (e) => errors.push(e) })
                .terminationHook(() => hookCalls++),
        ).conclude();
        agent = new NativeResourceAgent(ctx);
        (ctx.nativeResourceAgentProxy() as NativeResourceAgentProxy).nativeResourceAgent(agent);
        conductor = new DriverConductor(ctx);
        (ctx.driverConductorProxy() as DriverConductorProxy).driverConductor(conductor);
        conductor.onStart();
    }

    afterEach(() => {
        agent.onClose();
        conductor.onClose();
    });

    it('does not terminate on a termination request with the default validator, and does with an allowing one', () => {
        newConductor();
        const token = new UnsafeBuffer(new Uint8Array(8));
        conductor.onTerminateDriver(token, 0, 8);
        expect(hookCalls).toBe(0);
        agent.onClose();
        conductor.onClose();

        newConductor((c) => c.terminationValidator(new DefaultAllowTerminationValidator()));
        conductor.onTerminateDriver(token, 0, 8);
        expect(hookCalls).toBe(1);
        expect(ctx.terminationValidator()).toBeInstanceOf(DefaultAllowTerminationValidator);
    });

    it('hands out session ids that are not reserved and not in use, and that wrap', () => {
        newConductor((c) => c.publicationReservedSessionIdLow(-10).publicationReservedSessionIdHigh(10));
        const seen = new Set<number>();
        for (let i = 0; i < 100; i++) {
            const sessionId = conductor.nextAvailableSessionId(1, 'aeron:udp?endpoint=127.0.0.1:4000');
            expect(sessionId < -10 || sessionId > 10).toBe(true);
            expect(seen.has(sessionId)).toBe(false);
            seen.add(sessionId);
        }
    });

    it('rejects an image that is unknown or whose reason is too long', () => {
        newConductor();

        const unknown = assertThrows(ControlProtocolException, () => conductor.onRejectImage(1, 99, 0, 'reason'));
        expect(unknown.errorCode()).toBe(ErrorCode.GENERIC_ERROR);
        expect(unknown.message).toContain('Unable to resolve image for correlationId=99');

        const tooLong = assertThrows(ControlProtocolException, () =>
            conductor.onRejectImage(1, 99, 0, 'x'.repeat(1024)),
        );
        expect(tooLong.message).toContain('Invalidation reason must be 1023 bytes or less');
    });

    it('records an error frame of a publication as a warning and forwards it to the clients', () => {
        newConductor();
        const forwarded = vi.fn();
        Object.defineProperty(conductor, 'clientProxy', { value: { onPublicationErrorFrame: forwarded } });
        const address = new InetSocketAddress('127.0.0.1', 4000);

        conductor.onPublicationError(10, 11, 12, 13, 14n, null, address, 5, 'oops');

        expect(forwarded).toHaveBeenCalledWith(10, 11, 12, 13, 14n, null, address, 5, 'oops');
        expect(errors).toHaveLength(1);
        expect(errors[0]!.message).toContain(
            'onPublicationError: registrationId=10, destinationRegistrationId=11, sessionId=12, streamId=13, ' +
                'receiverId=14, groupId=-1, errorCode=5, errorMessage=oops',
        );
        expect((errors[0] as AeronException).category()).toBe(AeronException.Category.WARN);
    });

    it('a keepalive and a close of an unknown client are ignored', () => {
        newConductor();

        conductor.onClientKeepalive(12345);
        conductor.onClientClose(12345);

        expect(errors).toEqual([]);
    });

    it('answers the role name for the thread naming mode', () => {
        newConductor();
        expect(conductor.roleName()).toBe('driver-conductor');
        System.setProperty('aeron.thread.naming', 'new');
        try {
            expect(new DriverConductor(ctx).roleName()).toBe('aeron-md-cnd');
        } finally {
            System.clearProperty('aeron.thread.naming');
        }
    });

    it('session keys are equal by value in the set of the active sessions', () => {
        expect(new SessionKey(1, 2, 'c').equals(new SessionKey(1, 2, 'c'))).toBe(true);
    });
});

describe('MaxMulticastFlowControl and its supplier', () => {
    const channel = (uri: string): UdpChannel => UdpChannel.parse(uri);

    afterEach(() => {
        System.clearProperty(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME);
        System.clearProperty(Configuration.UNICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME);
        System.clearProperty(Configuration.CONGESTION_CONTROL_STRATEGY_SUPPLIER_PROP_NAME);
        System.clearProperty(Configuration.TERMINATION_VALIDATOR_PROP_NAME);
    });

    it('takes the maximum of the right edges and does not track receivers', () => {
        const flowControl = new MaxMulticastFlowControl();
        const ctx = new MediaDriver.Context();
        flowControl.initialize(ctx, null as never, channel('aeron:udp?endpoint=224.20.30.39:5555'), 1, 2, 3, 0, 65536);
        const msg = mock(StatusMessageFlyweight).mock;
        (msg.consumptionTermId as unknown as Mock).mockReturnValue(0);
        (msg.consumptionTermOffset as unknown as Mock).mockReturnValue(1024);
        (msg.receiverWindowLength as unknown as Mock).mockReturnValue(4096);
        const address = new InetSocketAddress('127.0.0.1', 1);

        expect(flowControl.onStatusMessage(msg, address, 100, 0, 16, 0)).toBe(1024 + 4096);
        expect(flowControl.onStatusMessage(msg, address, 100_000, 0, 16, 0)).toBe(100_000);
        expect(flowControl.onSetup(undefined as never, 7, 8, 16, 0)).toBe(7);
        expect(flowControl.onIdle(0, 9, 10, false)).toBe(9);
        expect(flowControl.hasRequiredReceivers()).toBe(true);
        expect(flowControl.maxRetransmissionLength(0, 1 << 30, 65536, 1408)).toBe(65536);
    });

    it('the supplier gives the max strategy by default and by fc=max, and refuses an unknown one', () => {
        const supplier = new DefaultMulticastFlowControlSupplier();

        expect(supplier.newInstance(channel('aeron:udp?endpoint=224.20.30.39:5555'), 1, 2)).toBeInstanceOf(
            MaxMulticastFlowControl,
        );
        expect(
            supplier.newInstance(channel('aeron:udp?endpoint=224.20.30.39:5555|fc=max,rrwm:3'), 1, 2),
        ).toBeInstanceOf(MaxMulticastFlowControl);
        expect(() =>
            supplier.newInstance(channel('aeron:udp?endpoint=224.20.30.39:5555|fc=foobar'), 1, 2),
        ).toThrowError('unsupported multicast flow control strategy: fc=foobar');
        expect(supplier.toString()).toContain('DefaultMulticastFlowControlSupplier{flowControlClass=');
    });

    it('the readers of Configuration give the defaults and refuse a class name (spec D25)', () => {
        expect(Configuration.unicastFlowControlSupplier()).toBeInstanceOf(DefaultUnicastFlowControlSupplier);
        expect(Configuration.multicastFlowControlSupplier()).toBeInstanceOf(DefaultMulticastFlowControlSupplier);
        expect(Configuration.congestionControlSupplier()).toBeInstanceOf(DefaultCongestionControlSupplier);
        expect(Configuration.terminationValidator()).toBeInstanceOf(DefaultDenyTerminationValidator);

        System.setProperty(Configuration.UNICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME, 'x.Y');
        System.setProperty(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME, 'x.Y');
        System.setProperty(Configuration.CONGESTION_CONTROL_STRATEGY_SUPPLIER_PROP_NAME, 'x.Y');
        System.setProperty(Configuration.TERMINATION_VALIDATOR_PROP_NAME, 'x.Y');
        expect(() => Configuration.unicastFlowControlSupplier()).toThrowError(ClassNotFoundException);
        expect(() => Configuration.multicastFlowControlSupplier()).toThrowError(ClassNotFoundException);
        expect(() => Configuration.congestionControlSupplier()).toThrowError(ClassNotFoundException);
        expect(() => Configuration.terminationValidator()).toThrowError(ClassNotFoundException);

        System.setProperty(
            Configuration.TERMINATION_VALIDATOR_PROP_NAME,
            'io.aeron.driver.DefaultDenyTerminationValidator',
        );
        expect(Configuration.terminationValidator()).toBeInstanceOf(DefaultDenyTerminationValidator);
    });
});
