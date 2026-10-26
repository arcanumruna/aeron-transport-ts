// Extra tests of phase 3 (port-only): the group tag halves of the flyweights (spec D118) and the group tag of the
// configuration, which the multicast flow control strategies compare without a `bigint`.
import { afterEach, describe, expect, it } from 'vitest';
import { System } from '../../../src/agrona/jdkLang.js';
import { ErrorFlyweight } from '../../../src/client/protocol/ErrorFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../../src/agrona/concurrent/status/CountersReader.js';
import { LongOverflowError } from '../../../src/agrona/jdk.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { TaggedMulticastFlowControl } from '../../../src/driver/TaggedMulticastFlowControl.js';

const TAGS: bigint[] = [0n, 1n, -1n, 123n, 3_000_000_000n, -3_000_000_000n, 0x1fffffffffffffn, -0x1fffffffffffffn];

function halves(tag: bigint): [number, number] {
    return [Number(BigInt.asIntN(32, tag >> 32n)), Number(BigInt.asIntN(32, tag))];
}

describe('MulticastFlowControlExtraTest', () => {
    afterEach(() => {
        System.clearProperty(Configuration.FLOW_CONTROL_GROUP_TAG_PROP_NAME);
        System.clearProperty('aeron.PreferredMulticastFlowControl.asf');
    });

    it.each(TAGS)('StatusMessageFlyweight.groupTagHigh and groupTagLow are the halves of the group tag %d', (tag) => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(1024));
        flyweight.groupTag(tag);

        expect([flyweight.groupTagHigh(), flyweight.groupTagLow()]).toEqual(halves(tag));
        expect(flyweight.groupTag()).toBe(tag);
    });

    it.each(TAGS)('ErrorFlyweight.groupTagHigh and groupTagLow are the halves of the group tag %d', (tag) => {
        const flyweight = new ErrorFlyweight(new Uint8Array(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH));
        flyweight.groupTag(tag);

        expect([flyweight.groupTagHigh(), flyweight.groupTagLow()]).toEqual(halves(tag));
        expect(flyweight.groupTag()).toBe(tag);
    });

    it('Configuration.flowControlGroupTag defaults to the legacy ASF read as a little endian long (all ones)', () => {
        expect(Configuration.flowControlGroupTag()).toBe(-1);
        expect(new MediaDriver.Context().flowControlGroupTag()).toBe(-1);
    });

    it('Configuration.flowControlGroupTag is the property when set', () => {
        System.setProperty(Configuration.FLOW_CONTROL_GROUP_TAG_PROP_NAME, '3000000000');

        expect(Configuration.flowControlGroupTag()).toBe(3_000_000_000);
        expect(new MediaDriver.Context().flowControlGroupTag()).toBe(3_000_000_000);
    });

    it('Configuration.flowControlGroupTag falls back to the legacy ASF property', () => {
        System.setProperty('aeron.PreferredMulticastFlowControl.asf', '0100000000000000');

        expect(Configuration.flowControlGroupTag()).toBe(1);
    });

    it('MediaDriver.Context.flowControlGroupTag is set and read back', () => {
        const context = new MediaDriver.Context().flowControlGroupTag(42);

        expect(context.flowControlGroupTag()).toBe(42);
        expect(context.toString()).toContain('flowControlGroupTag=42');
    });

    describe('TaggedMulticastFlowControl', () => {
        const WINDOW = 16 * 1024;

        function newTagged(uri: string): TaggedMulticastFlowControl {
            const flowControl = new TaggedMulticastFlowControl();
            const countersManager = new CountersManager(
                new UnsafeBuffer(
                    new ArrayBuffer(16 * 1024 * (CountersReader.METADATA_LENGTH / CountersReader.COUNTER_LENGTH)),
                ),
                new UnsafeBuffer(new ArrayBuffer(16 * 1024)),
            );
            flowControl.initialize(
                new MediaDriver.Context().tempBuffer(new UnsafeBuffer(new ArrayBuffer(8192))),
                countersManager,
                UdpChannel.parse(uri),
                0,
                0,
                0,
                0,
                0,
            );
            return flowControl;
        }

        /** A status message with an application specific feedback of `asf.length` bytes after the header. */
        function statusMessage(receiverId: number, asf: number[]): StatusMessageFlyweight {
            const flyweight = new StatusMessageFlyweight(new Uint8Array(1024));
            flyweight.receiverId(BigInt(receiverId));
            flyweight.consumptionTermId(0);
            flyweight.consumptionTermOffset(0);
            flyweight.receiverWindowLength(WINDOW);
            flyweight.frameLength(StatusMessageFlyweight.HEADER_LENGTH + asf.length);
            asf.forEach((b, i) => flyweight.putByte(StatusMessageFlyweight.groupTagFieldOffset() + i, b));
            return flyweight;
        }

        const URI = 'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:7/1';

        it('a status message with a legacy ASF of 4 to 7 or more than 8 bytes starting with the preferred ASF is tracked', () => {
            for (const length of [4, 5, 6, 7, 9, 12]) {
                const flowControl = newTagged(URI);
                const asf = new Array<number>(length).fill(0xff);

                expect(flowControl.onStatusMessage(statusMessage(1, asf), null as never, 0, 0, 0, 0)).toBe(WINDOW);
                expect(flowControl.hasRequiredReceivers()).toBe(true);
            }
        });

        it('a status message whose ASF does not start with the preferred ASF, or has no ASF, is not tracked', () => {
            for (const asf of [
                [0xff, 0xff, 0xff, 0xfe],
                [0xfe, 0xff, 0xff, 0xff],
                [0xff, 0xff, 0xff],
                [0, 0, 0, 0],
                [],
            ]) {
                const flowControl = newTagged(URI);

                expect(flowControl.onStatusMessage(statusMessage(1, asf), null as never, 5, 0, 0, 0)).toBe(5);
                expect(flowControl.hasRequiredReceivers()).toBe(false);
            }
        });

        it.each([7n, 0x7fffffffn, 0x80000000n, -1n, 0x1fffffffffffffn])(
            'a status message and an error frame with the tag %d are matched as the tag of the strategy',
            (tag) => {
                const flowControl = newTagged(
                    'aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|fc=tagged,g:' + tag + '/1',
                );
                const sm = statusMessage(1, []);

                sm.groupTag(tag);
                expect(flowControl.onStatusMessage(sm, null as never, 0, 0, 0, 0)).toBe(WINDOW);
                const other = statusMessage(2, []);
                other.groupTag(tag + 1n);
                expect(flowControl.onStatusMessage(other, null as never, 0, 0, 0, 0)).toBe(WINDOW);

                const wrongError = new ErrorFlyweight(new Uint8Array(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH));
                wrongError.receiverId(1n).groupTag(tag + 1n);
                flowControl.onError(wrongError, null as never, 0);
                expect(flowControl.onIdle(0, 0, 0, false)).toBe(WINDOW);

                const noTagError = new ErrorFlyweight(new Uint8Array(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH));
                noTagError.receiverId(1n);
                flowControl.onError(noTagError, null as never, 0);
                expect(flowControl.hasRequiredReceivers()).toBe(true);

                const error = new ErrorFlyweight(new Uint8Array(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH));
                error.receiverId(1n).groupTag(tag);
                flowControl.onError(error, null as never, 0);
                flowControl.onIdle(0, 0, 0, false);
                expect(flowControl.hasRequiredReceivers()).toBe(false);
            },
        );

        it('onIdle clears the stale receiver slots after the timed out receivers are removed (StaleReceiverSlotsClearedRegression)', () => {
            const flowControl = newTagged(URI);
            for (const id of [1, 2, 3, 4]) {
                const sm = statusMessage(id, []);
                sm.groupTag(7n);
                flowControl.onStatusMessage(sm, null as never, 0, 0, 0, id < 3 ? 0 : 1_000_000_000_000);
            }
            const receivers = (flowControl as unknown as { receivers: unknown[] }).receivers;
            expect(receivers.slice(0, 4).every((r) => r !== undefined)).toBe(true);

            flowControl.onIdle(1_000_000_000_000 + 1, 0, 0, false);

            expect(receivers.slice(0, 2).every((r) => r !== undefined)).toBe(true);
            expect(receivers.slice(2).every((r) => r === undefined)).toBe(true);
        });
    });

    describe('group tags outside +/-2^53 (spec D118, D5)', () => {
        it('the URI gtag path rejects 9223372036854775807 with a LongOverflowError', () => {
            expect(() =>
                UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:24326|interface=localhost|gtag=9223372036854775807'),
            ).toThrow(expect.objectContaining({ cause: expect.any(LongOverflowError) }) as unknown as Error);
        });

        it('Configuration.flowControlGroupTag rejects 9223372036854775807 with a LongOverflowError', () => {
            System.setProperty(Configuration.FLOW_CONTROL_GROUP_TAG_PROP_NAME, '9223372036854775807');

            expect(() => Configuration.flowControlGroupTag()).toThrow(LongOverflowError);
        });
    });
});
