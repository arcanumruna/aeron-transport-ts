// Extra tests of T21 (no Java counterpart): the debug endpoints pass to the endpoint they extend exactly the frames that
// their loss generators let through, and drop exactly the others, on the send side (data out, control in) and the
// receive side (data in, control out); the generator is shown the frame the Java endpoint shows it; the dropped
// result is Java's; the suppliers and `Configuration` build the debug endpoints. The sockets are not opened: the
// calls to the endpoint that is extended are counted on its prototype.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CachedNanoClock } from '../../../../src/agrona/concurrent/CachedNanoClock.js';
import { UnsafeBuffer } from '../../../../src/agrona/concurrent/UnsafeBuffer.js';
import { AtomicCounter } from '../../../../src/agrona/concurrent/status/AtomicCounter.js';
import { System } from '../../../../src/agrona/jdkLang.js';
import { ClassNotFoundException } from '../../../../src/agrona/jdk.js';
import { DataHeaderFlyweight } from '../../../../src/client/protocol/DataHeaderFlyweight.js';
import { NakFlyweight } from '../../../../src/client/protocol/NakFlyweight.js';
import { RttMeasurementFlyweight } from '../../../../src/client/protocol/RttMeasurementFlyweight.js';
import { SetupFlyweight } from '../../../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../../../src/driver/Configuration.js';
import { DataPacketDispatcher } from '../../../../src/driver/DataPacketDispatcher.js';
import { DefaultReceiveChannelEndpointSupplier } from '../../../../src/driver/DefaultReceiveChannelEndpointSupplier.js';
import { DefaultSendChannelEndpointSupplier } from '../../../../src/driver/DefaultSendChannelEndpointSupplier.js';
import { DebugReceiveChannelEndpoint } from '../../../../src/driver/ext/DebugReceiveChannelEndpoint.js';
import { DebugReceiveChannelEndpointSupplier } from '../../../../src/driver/ext/DebugReceiveChannelEndpointSupplier.js';
import { DebugSendChannelEndpoint } from '../../../../src/driver/ext/DebugSendChannelEndpoint.js';
import { DebugSendChannelEndpointSupplier } from '../../../../src/driver/ext/DebugSendChannelEndpointSupplier.js';
import { FixedLossGenerator } from '../../../../src/driver/ext/FixedLossGenerator.js';
import type { LossGenerator } from '../../../../src/driver/ext/LossGenerator.js';
import { InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import { ReceiveChannelEndpoint } from '../../../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpointThreadLocals } from '../../../../src/driver/media/ReceiveChannelEndpointThreadLocals.js';
import { SendChannelEndpoint } from '../../../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { WildcardPortManager } from '../../../../src/driver/media/WildcardPortManager.js';
import { SystemCounters } from '../../../../src/driver/status/SystemCounters.js';
import { assertThrows } from '../../../support/Assertions.js';
import { newFakeConductorProxy } from '../../../support/ConductorProxyFake.js';
import { mock } from '../../../support/Mockito.js';

const SEND_CHANNEL = UdpChannel.parse('aeron:udp?interface=localhost:40224|endpoint=localhost:40223');
const RCV_CHANNEL = UdpChannel.parse('aeron:udp?endpoint=localhost:40223');
const SOURCE = new InetSocketAddress('127.0.0.1', 40224);
const STREAM_ID = 1001;
const SESSION_ID = -77;
const TERM_ID = 12;

/** A generator that returns a scripted answer to each call and records what it was shown. */
class ScriptedLossGenerator implements LossGenerator {
    public readonly shortCalls: {
        address: InetSocketAddress | null;
        length: number;
        capacity: number;
        first: number;
    }[] = [];
    public readonly longCalls: {
        address: InetSocketAddress | null;
        streamId: number;
        sessionId: number;
        termId: number;
        termOffset: number;
        length: number;
    }[] = [];
    private next = 0;

    private readonly script: boolean[];
    public constructor(script: boolean[]) {
        this.script = script;
    }

    public shouldDropFrame(address: InetSocketAddress | null, buffer: UnsafeBuffer | null, length: number): boolean;
    public shouldDropFrame(
        address: InetSocketAddress | null,
        buffer: UnsafeBuffer | null,
        streamId: number,
        sessionId: number,
        termId: number,
        termOffset: number,
        length: number,
    ): boolean;
    public shouldDropFrame(
        address: InetSocketAddress | null,
        buffer: UnsafeBuffer | null,
        streamIdOrLength: number,
        sessionId?: number,
        termId?: number,
        termOffset?: number,
        length?: number,
    ): boolean {
        if (undefined === sessionId) {
            this.shortCalls.push({
                address,
                length: streamIdOrLength,
                capacity: buffer!.capacity(),
                first: buffer!.getByte(0),
            });
        } else {
            this.longCalls.push({
                address,
                streamId: streamIdOrLength,
                sessionId,
                termId: termId!,
                termOffset: termOffset!,
                length: length!,
            });
        }

        return this.script[this.next++ % this.script.length]!;
    }

    public get calls(): number {
        return this.shortCalls.length + this.longCalls.length;
    }
}

const NEVER = (): LossGenerator => new ScriptedLossGenerator([false]);

describe('DebugEndpointsExtraTest', () => {
    const nanoClock = new CachedNanoClock();
    const systemCounters = mock(SystemCounters).mock;
    const counter = mock(AtomicCounter).mock;
    const dispatcher = mock(DataPacketDispatcher).mock;
    const conductorProxy = newFakeConductorProxy();
    const context = new MediaDriver.Context()
        .systemCounters(systemCounters)
        .cachedNanoClock(nanoClock)
        .senderCachedNanoClock(nanoClock)
        .receiverCachedNanoClock(nanoClock)
        .receiveChannelEndpointThreadLocals(new ReceiveChannelEndpointThreadLocals())
        .senderPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, true))
        .receiverPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, false));

    const frame = new UnsafeBuffer(new Uint8Array(4096));
    const statusMessage = new StatusMessageFlyweight(new UnsafeBuffer(new Uint8Array(64)));
    const nak = new NakFlyweight(new UnsafeBuffer(new Uint8Array(64)));
    const rtt = new RttMeasurementFlyweight(new UnsafeBuffer(new Uint8Array(64)));
    const setup = new SetupFlyweight(new UnsafeBuffer(new Uint8Array(64)));
    const dataHeader = new DataHeaderFlyweight(new UnsafeBuffer(new Uint8Array(64)));

    const sendBase = {
        send: vi.spyOn(SendChannelEndpoint.prototype, 'send'),
        onStatusMessage: vi.spyOn(SendChannelEndpoint.prototype, 'onStatusMessage'),
        onNakMessage: vi.spyOn(SendChannelEndpoint.prototype, 'onNakMessage'),
        onRttMeasurement: vi.spyOn(SendChannelEndpoint.prototype, 'onRttMeasurement'),
    };
    const receiveBase = {
        sendTo: vi.spyOn(ReceiveChannelEndpoint.prototype, 'sendTo'),
        onDataPacket: vi.spyOn(ReceiveChannelEndpoint.prototype, 'onDataPacket'),
        onSetupMessage: vi.spyOn(ReceiveChannelEndpoint.prototype, 'onSetupMessage'),
        onRttMeasurement: vi.spyOn(ReceiveChannelEndpoint.prototype, 'onRttMeasurement'),
    };

    beforeEach(() => {
        vi.mocked(systemCounters.get).mockReturnValue(counter);
        for (const spy of [...Object.values(sendBase), ...Object.values(receiveBase)]) {
            spy.mockReset();
        }
        sendBase.send.mockImplementation((_buffer, _offset, length) => length - 1); // distinguishable from a drop
        receiveBase.sendTo.mockImplementation((_buffer, _offset, length) => length - 1);
        receiveBase.onDataPacket.mockReturnValue(4321);
        sendBase.onStatusMessage.mockImplementation(() => {});
        sendBase.onNakMessage.mockImplementation(() => {});
        sendBase.onRttMeasurement.mockImplementation(() => {});
        receiveBase.onSetupMessage.mockImplementation(() => {});
        receiveBase.onRttMeasurement.mockImplementation(() => {});
        for (let i = 0; i < 4096; i++) {
            frame.putByte(i, (i * 7) & 0x7f);
        }
        dataHeader.streamId(STREAM_ID).sessionId(SESSION_ID).termId(TERM_ID).termOffset(0);
    });

    afterEach(() => {
        System.clearProperty(Configuration.SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME);
        System.clearProperty(Configuration.RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME);
    });

    afterAll(() => {
        vi.restoreAllMocks();
    });

    function newSend(data: LossGenerator, control: LossGenerator): DebugSendChannelEndpoint {
        return new DebugSendChannelEndpoint(SEND_CHANNEL, counter, context, data, control);
    }

    function newReceive(data: LossGenerator, control: LossGenerator): DebugReceiveChannelEndpoint {
        return new DebugReceiveChannelEndpoint(RCV_CHANNEL, dispatcher, counter, context, data, control);
    }

    describe('send side', () => {
        it('shouldSendExactlyTheDataFramesTheGeneratorKeeps', () => {
            const script = [true, false, false, true, true, false, true, false];
            const data = new ScriptedLossGenerator(script);
            const endpoint = newSend(data, NEVER());

            const sent: number[] = [];
            script.forEach((_drop, i) => {
                const result = endpoint.send(frame, i * 64, 32 + i);
                if (!script[i]) {
                    sent.push(i);
                    expect(result, 'the result of the endpoint it extends, for frame ' + i).toBe(32 + i - 1);
                } else {
                    expect(result, 'a dropped frame reports its whole length, for frame ' + i).toBe(32 + i);
                }
            });

            expect(sendBase.send).toHaveBeenCalledTimes(sent.length);
            expect(sendBase.send.mock.calls.map((call) => call[1] / 64)).toEqual(sent);
            expect(sendBase.send.mock.calls.map((call) => call[2])).toEqual(sent.map((i) => 32 + i));
            expect(data.calls).toBe(script.length);
        });

        it('shouldShowTheGeneratorTheFrameAtTheOffsetWithTheLengthAndTheConnectAddress', () => {
            const data = new ScriptedLossGenerator([false]);
            const endpoint = newSend(data, NEVER());

            endpoint.send(frame, 640, 48);

            expect(data.longCalls).toEqual([]);
            expect(data.shortCalls).toHaveLength(1);
            const call = data.shortCalls[0]!;
            expect(call.length).toBe(48);
            expect(call.capacity).toBe(48);
            expect(call.first).toBe((640 * 7) & 0x7f);
            expect(call.address).toBe(SEND_CHANNEL.remoteData());
        });

        it('shouldPassEveryControlFrameWhenTheGeneratorKeepsThemAndNoneWhenItDropsThem', () => {
            const keep = new ScriptedLossGenerator([false]);
            const keeping = newSend(NEVER(), keep);
            keeping.onStatusMessage(statusMessage, frame, 36, SOURCE, conductorProxy);
            keeping.onNakMessage(nak, frame, 28, SOURCE);
            keeping.onRttMeasurement(rtt, frame, 40, SOURCE);

            expect(sendBase.onStatusMessage).toHaveBeenCalledExactlyOnceWith(
                statusMessage,
                frame,
                36,
                SOURCE,
                conductorProxy,
            );
            expect(sendBase.onNakMessage).toHaveBeenCalledExactlyOnceWith(nak, frame, 28, SOURCE);
            expect(sendBase.onRttMeasurement).toHaveBeenCalledExactlyOnceWith(rtt, frame, 40, SOURCE);
            expect(keep.shortCalls.map((call) => [call.length, call.address])).toEqual([
                [36, SOURCE],
                [28, SOURCE],
                [40, SOURCE],
            ]);

            const drop = new ScriptedLossGenerator([true]);
            const dropping = newSend(NEVER(), drop);
            dropping.onStatusMessage(statusMessage, frame, 36, SOURCE, conductorProxy);
            dropping.onNakMessage(nak, frame, 28, SOURCE);
            dropping.onRttMeasurement(rtt, frame, 40, SOURCE);

            expect(sendBase.onStatusMessage).toHaveBeenCalledTimes(1);
            expect(sendBase.onNakMessage).toHaveBeenCalledTimes(1);
            expect(sendBase.onRttMeasurement).toHaveBeenCalledTimes(1);
            expect(drop.calls).toBe(3);
        });

        it('shouldDropControlFramesAccordingToTheScriptAcrossTheThreeKinds', () => {
            const script = [true, false, false, true, false, true];
            const control = new ScriptedLossGenerator(script);
            const endpoint = newSend(NEVER(), control);

            for (let i = 0; i < script.length; i += 3) {
                endpoint.onStatusMessage(statusMessage, frame, 36, SOURCE, conductorProxy);
                endpoint.onNakMessage(nak, frame, 28, SOURCE);
                endpoint.onRttMeasurement(rtt, frame, 40, SOURCE);
            }

            // calls 1, 2 and 4 are kept: the NAK, the RTT measurement and the NAK again
            expect(sendBase.onStatusMessage).toHaveBeenCalledTimes(0);
            expect(sendBase.onNakMessage).toHaveBeenCalledTimes(2);
            expect(sendBase.onRttMeasurement).toHaveBeenCalledTimes(1);
        });

        it('shouldKeepTheDataAndControlGeneratorsApart', () => {
            const data = new ScriptedLossGenerator([true]);
            const control = new ScriptedLossGenerator([false]);
            const endpoint = newSend(data, control);

            endpoint.send(frame, 0, 32);
            endpoint.onNakMessage(nak, frame, 28, SOURCE);

            expect(data.calls).toBe(1);
            expect(control.calls).toBe(1);
            expect(sendBase.send).not.toHaveBeenCalled();
            expect(sendBase.onNakMessage).toHaveBeenCalledTimes(1);
        });
    });

    describe('receive side', () => {
        it('shouldPassExactlyTheDataPacketsTheGeneratorKeepsAndReportZeroForTheOthers', () => {
            const script = [true, false, false, true, false];
            const data = new ScriptedLossGenerator(script);
            const endpoint = newReceive(data, NEVER());

            const results: number[] = [];
            script.forEach((_drop, i) => {
                dataHeader.termOffset(i * 1408);
                results.push(endpoint.onDataPacket(dataHeader, frame, 1408, SOURCE, 0));
            });

            expect(results).toEqual(script.map((drop) => (drop ? 0 : 4321)));
            expect(receiveBase.onDataPacket).toHaveBeenCalledTimes(script.filter((drop) => !drop).length);
            expect(receiveBase.onDataPacket.mock.calls.map((call) => call[4])).toEqual([0, 0, 0]);
            expect(data.shortCalls).toEqual([]);
            expect(data.longCalls).toEqual(
                script.map((_drop, i) => ({
                    address: SOURCE,
                    streamId: STREAM_ID,
                    sessionId: SESSION_ID,
                    termId: TERM_ID,
                    termOffset: i * 1408,
                    length: 1408,
                })),
            );
        });

        it('shouldDropTheFramesOfAFixedGeneratorOnceThroughTheEndpoint', () => {
            const endpoint = newReceive(new FixedLossGenerator(TERM_ID, 1408, 2 * 1408), NEVER());

            const attempt = (termOffset: number): number => {
                dataHeader.termOffset(termOffset);
                return endpoint.onDataPacket(dataHeader, frame, 1408, SOURCE, 0);
            };

            // the first pass loses the frames at 1408 and 2816; the repeat of them (a retransmission) gets through
            expect([0, 1408, 2816, 4224].map(attempt)).toEqual([4321, 0, 0, 4321]);
            expect([1408, 2816].map(attempt)).toEqual([4321, 4321]);
            expect(receiveBase.onDataPacket).toHaveBeenCalledTimes(4);
        });

        it('shouldPassSetupAndRttMeasurementFramesAccordingToTheDataGenerator', () => {
            const data = new ScriptedLossGenerator([true, false, false, true]);
            const endpoint = newReceive(data, NEVER());

            endpoint.onSetupMessage(setup, frame, 40, SOURCE, 2); // dropped
            endpoint.onSetupMessage(setup, frame, 41, SOURCE, 3); // kept
            endpoint.onRttMeasurement(rtt, frame, 42, SOURCE, 4); // kept
            endpoint.onRttMeasurement(rtt, frame, 43, SOURCE, 5); // dropped

            expect(receiveBase.onSetupMessage).toHaveBeenCalledExactlyOnceWith(setup, frame, 41, SOURCE, 3);
            expect(receiveBase.onRttMeasurement).toHaveBeenCalledExactlyOnceWith(rtt, frame, 42, SOURCE, 4);
            expect(data.shortCalls.map((call) => call.length)).toEqual([40, 41, 42, 43]);
        });

        it('shouldSendExactlyTheControlFramesTheGeneratorKeeps', () => {
            const script = [false, true, true, false, true];
            const control = new ScriptedLossGenerator(script);
            const endpoint = newReceive(NEVER(), control);

            const results = script.map((_drop, i) => endpoint.sendTo(frame, i * 64, 32 + i, SOURCE));

            expect(results).toEqual(script.map((drop, i) => (drop ? 32 + i : 32 + i - 1)));
            expect(receiveBase.sendTo.mock.calls.map((call) => call[1] / 64)).toEqual([0, 3]);
            expect(control.shortCalls.map((call) => [call.length, call.capacity, call.address])).toEqual(
                script.map((_drop, i) => [32 + i, 32 + i, SOURCE]),
            );
            expect(control.shortCalls[2]!.first).toBe((128 * 7) & 0x7f);
        });

        it('shouldKeepTheDataAndControlGeneratorsApart', () => {
            const data = new ScriptedLossGenerator([false]);
            const control = new ScriptedLossGenerator([true]);
            const endpoint = newReceive(data, control);

            endpoint.sendTo(frame, 0, 32, SOURCE);
            endpoint.onDataPacket(dataHeader, frame, 1408, SOURCE, 0);

            expect(control.calls).toBe(1);
            expect(data.calls).toBe(1);
            expect(receiveBase.sendTo).not.toHaveBeenCalled();
            expect(receiveBase.onDataPacket).toHaveBeenCalledTimes(1);
        });
    });

    describe('suppliers and configuration', () => {
        it('shouldSupplyDebugEndpointsThatDropNothingByDefault', () => {
            const send = new DebugSendChannelEndpointSupplier().newInstance(SEND_CHANNEL, counter, context);
            const receive = new DebugReceiveChannelEndpointSupplier().newInstance(
                RCV_CHANNEL,
                dispatcher,
                counter,
                context,
            );

            expect(send).toBeInstanceOf(DebugSendChannelEndpoint);
            expect(receive).toBeInstanceOf(DebugReceiveChannelEndpoint);

            for (let i = 0; i < 50; i++) {
                send.send(frame, 0, 32);
                receive.onDataPacket(dataHeader, frame, 1408, SOURCE, 0);
            }
            expect(sendBase.send).toHaveBeenCalledTimes(50);
            expect(receiveBase.onDataPacket).toHaveBeenCalledTimes(50);
        });

        it('shouldNameTheDebugSuppliersInTheConfigurationProperties', () => {
            System.setProperty(
                Configuration.SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME,
                'io.aeron.driver.ext.DebugSendChannelEndpointSupplier',
            );
            System.setProperty(
                Configuration.RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME,
                'io.aeron.driver.ext.DebugReceiveChannelEndpointSupplier',
            );

            expect(Configuration.sendChannelEndpointSupplier()).toBeInstanceOf(DebugSendChannelEndpointSupplier);
            expect(Configuration.receiveChannelEndpointSupplier()).toBeInstanceOf(DebugReceiveChannelEndpointSupplier);
        });

        it('shouldKeepTheDefaultSuppliersAndRejectOtherNames', () => {
            expect(Configuration.sendChannelEndpointSupplier()).toBeInstanceOf(DefaultSendChannelEndpointSupplier);
            expect(Configuration.receiveChannelEndpointSupplier()).toBeInstanceOf(
                DefaultReceiveChannelEndpointSupplier,
            );

            System.setProperty(Configuration.SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME, 'io.example.Missing');
            assertThrows(ClassNotFoundException, () => Configuration.sendChannelEndpointSupplier());
            System.setProperty(Configuration.RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME, 'io.example.Missing');
            assertThrows(ClassNotFoundException, () => Configuration.receiveChannelEndpointSupplier());
        });
    });
});
