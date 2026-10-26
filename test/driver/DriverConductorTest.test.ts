/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of io/aeron/driver/DriverConductorTest.java @ 1.53.3
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { CloseHelper } from '../../src/agrona/CloseHelper.js';
import { CachedEpochClock } from '../../src/agrona/concurrent/CachedEpochClock.js';
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import { CountedErrorHandler } from '../../src/agrona/concurrent/CountedErrorHandler.js';
import { ManyToOneConcurrentLinkedQueue } from '../../src/agrona/concurrent/ManyToOneConcurrentLinkedQueue.js';
import { OneToOneConcurrentArrayQueue } from '../../src/agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { ManyToOneRingBuffer } from '../../src/agrona/concurrent/ringbuffer/ManyToOneRingBuffer.js';
import { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import { IllegalStateException } from '../../src/agrona/jdk.js';
import { Aeron } from '../../src/client/Aeron.js';
import { ChannelUri } from '../../src/client/ChannelUri.js';
import { CommonContext, InferableBoolean } from '../../src/client/CommonContext.js';
import { ErrorCode } from '../../src/client/ErrorCode.js';
import { ConfigurationException } from '../../src/client/exceptions/ConfigurationException.js';
import { ControlProtocolException } from '../../src/client/exceptions/ControlProtocolException.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { HeaderWriter } from '../../src/client/logbuffer/HeaderWriter.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { SetupFlyweight } from '../../src/client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import { ChannelEndpointStatus } from '../../src/client/status/ChannelEndpointStatus.js';
import { HeartbeatTimestamp } from '../../src/client/status/HeartbeatTimestamp.js';
import { ClientProxy } from '../../src/driver/ClientProxy.js';
import { Configuration } from '../../src/driver/Configuration.js';
import { DefaultNameResolver } from '../../src/driver/DefaultNameResolver.js';
import { DriverConductor } from '../../src/driver/DriverConductor.js';
import { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';
import { InvalidChannelException } from '../../src/driver/exceptions/InvalidChannelException.js';
import type { FeedbackDelayGenerator } from '../../src/driver/FeedbackDelayGenerator.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { ReceiveChannelEndpoint } from '../../src/driver/media/ReceiveChannelEndpoint.js';
import { ReceiveChannelEndpointThreadLocals } from '../../src/driver/media/ReceiveChannelEndpointThreadLocals.js';
import { SendChannelEndpoint } from '../../src/driver/media/SendChannelEndpoint.js';
import { UdpChannel } from '../../src/driver/media/UdpChannel.js';
import { WildcardPortManager } from '../../src/driver/media/WildcardPortManager.js';
import { NativeResourceAgent } from '../../src/driver/NativeResourceAgent.js';
import { NativeResourceAgentProxy } from '../../src/driver/NativeResourceAgentProxy.js';
import { NetworkPublication } from '../../src/driver/NetworkPublication.js';
import { OptimalMulticastDelayGenerator } from '../../src/driver/OptimalMulticastDelayGenerator.js';
import type { PublicationImage } from '../../src/driver/PublicationImage.js';
import { ReceiverProxy } from '../../src/driver/ReceiverProxy.js';
import { SenderProxy } from '../../src/driver/SenderProxy.js';
import { StaticDelayGenerator } from '../../src/driver/StaticDelayGenerator.js';
import { DutyCycleStallTracker } from '../../src/driver/status/DutyCycleStallTracker.js';
import { SystemCounterDescriptor } from '../../src/driver/status/SystemCounterDescriptor.js';
import { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { ThreadingMode } from '../../src/driver/ThreadingMode.js';
import { assertThrowsExactly } from '../support/Assertions.js';
import { DriverProxy } from '../../src/client/DriverProxy.js';
import { InOrder } from '../support/InOrder.js';
import { mock } from '../support/Mockito.js';
import { TestLogFactory } from '../support/TestLogFactory.js';

const { MILLISECONDS, SECONDS } = {
    MILLISECONDS: { toNanos: (ms: number) => ms * 1_000_000 },
    SECONDS: { toNanos: (s: number) => s * 1_000_000_000 },
};
const { CONTROL_MODE_RESPONSE, MDC_CONTROL_MODE_PARAM_NAME, RESPONSE_CORRELATION_ID_PARAM_NAME } = CommonContext;
const { GENERIC_ERROR, INVALID_CHANNEL, UNKNOWN_PUBLICATION, UNKNOWN_SUBSCRIPTION } = ErrorCode;
const {
    CLIENT_LIVENESS_TIMEOUT_DEFAULT_NS,
    CMD_QUEUE_CAPACITY,
    CONDUCTOR_BUFFER_LENGTH_DEFAULT,
    DEFAULT_TIMER_INTERVAL_NS,
    MTU_LENGTH_DEFAULT,
    PUBLICATION_LINGER_DEFAULT_NS,
    imageLivenessTimeoutNs,
    publicationConnectionTimeoutNs,
} = Configuration;
const {
    CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED,
    CONDUCTOR_MAX_CYCLE_TIME,
    NAME_RESOLVER_MAX_TIME,
    NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED,
} = SystemCounterDescriptor;
const { FRAME_ALIGNMENT, frameLengthOrdered } = FrameDescriptor;
const { HEADER_LENGTH, createDefaultHeader } = DataHeaderFlyweight;
const { ACTIVE, CLOSING, ERRORED, INITIALIZING } = ChannelEndpointStatus;
const { HEARTBEAT_TYPE_ID } = HeartbeatTimestamp;
const { align } = BitUtil;
const { METADATA_LENGTH, RECORD_ALLOCATED, RECORD_UNUSED } = CountersReader;

const CHANNEL_4000 = 'aeron:udp?endpoint=localhost:4000';
const CHANNEL_4001 = 'aeron:udp?endpoint=localhost:4001';
const CHANNEL_4002 = 'aeron:udp?endpoint=localhost:4002';
const CHANNEL_4003 = 'aeron:udp?endpoint=localhost:4003';
const CHANNEL_4004 = 'aeron:udp?endpoint=localhost:4004';
const CHANNEL_4000_TAG_ID_1 = 'aeron:udp?endpoint=localhost:4000|tags=1001';
const CHANNEL_TAG_ID_1 = 'aeron:udp?tags=1001';
const CHANNEL_SUB_CONTROL_MODE_MANUAL = 'aeron:udp?control-mode=manual';
const INVALID_URI = 'aeron:udp://';
const SESSION_ID = 100;
const STREAM_ID_1 = 1010;
const STREAM_ID_2 = 1020;
const STREAM_ID_3 = 1030;
const STREAM_ID_4 = 1040;
const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const BUFFER_LENGTH = 16 * 1024;
const CLIENT_LIVENESS_TIMEOUT_NS = CLIENT_LIVENESS_TIMEOUT_DEFAULT_NS;
const PUBLICATION_LINGER_TIMEOUT_NS = PUBLICATION_LINGER_DEFAULT_NS;
const MTU_LENGTH = MTU_LENGTH_DEFAULT;

/** The hard cap of every drive loop: a loop that does not finish fails instead of hanging. */
const MAX_ITERATIONS = 200_000;

type AnyMock = Mock<(...args: unknown[]) => unknown>;

/** A spy or mock function of a mocked object, as a vitest `Mock`. */
function m(fn: unknown): AnyMock {
    return fn as AnyMock;
}

function matches(args: unknown[], matchers: unknown[]): boolean {
    try {
        expect(args).toEqual(matchers);
        return true;
    } catch {
        return false;
    }
}

/** `verify(mock, times(n)).method(matchers)`: exactly n calls match, others may exist. */
function verifyTimes(n: number, fn: unknown, ...matchers: unknown[]): void {
    const matching = m(fn).mock.calls.filter((args) => matches(args, matchers));
    expect(matching.length).toBe(n);
}

/** `verify(mock).method(matchers)`. */
function verify(fn: unknown, ...matchers: unknown[]): void {
    verifyTimes(1, fn, ...matchers);
}

/** `verify(mock, never()).method(matchers)`. */
function verifyNever(fn: unknown, ...matchers: unknown[]): void {
    verifyTimes(0, fn, ...matchers);
}

/** `verify(mock).method(args)` where the arguments are anything: any number of arguments of any value. */
function anyArgs(count: number): unknown[] {
    return new Array<unknown>(count).fill(expect.anything());
}

/** `spy(real)`: every method of the instance records its calls and calls through. */
function spyOnAll<T extends object>(instance: T): Map<string, AnyMock> {
    const spies = new Map<string, AnyMock>();
    for (
        let proto: object | null = Object.getPrototypeOf(instance) as object;
        null !== proto && proto !== Object.prototype;
    ) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (
                'constructor' !== name &&
                !spies.has(name) &&
                typeof (instance as Record<string, unknown>)[name] === 'function'
            ) {
                spies.set(name, vi.spyOn(instance as never, name as never) as unknown as AnyMock);
            }
        }
        proto = Object.getPrototypeOf(proto) as object | null;
    }
    return spies;
}

/** `verifyNoMoreInteractions` once the expected calls were verified: exactly these members were called, this often. */
function expectOnlyCalls(spies: Map<string, AnyMock>, expected: Record<string, number>): void {
    for (const [name, spy] of spies) {
        expect(spy.mock.calls.length, name).toBe(Object.hasOwn(expected, name) ? (expected[name] as number) : 0);
    }
}

function startsWith(prefix: string): unknown {
    return expect.stringMatching(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

function newCountersManager(dataLength: number): CountersManager {
    return new CountersManager(
        new UnsafeBuffer(new ArrayBuffer(Configuration.countersMetadataBufferLength(dataLength))),
        new UnsafeBuffer(new ArrayBuffer(dataLength)),
    );
}

function clientHeartbeatCounter(countersReader: CountersReader): AtomicCounter {
    for (let counterId = 0, maxId = countersReader.maxCounterId(); counterId <= maxId; counterId++) {
        const counterState = countersReader.getCounterState(counterId);
        if (counterState === RECORD_ALLOCATED && countersReader.getCounterTypeId(counterId) === HEARTBEAT_TYPE_ID) {
            return new AtomicCounter(countersReader.valuesBuffer(), counterId);
        } else if (RECORD_UNUSED === counterState) {
            break;
        }
    }

    throw new IllegalStateException('could not find client heartbeat counter');
}

describe('DriverConductorTest', () => {
    let toDriverCommands: ManyToOneRingBuffer;
    let mockClientProxy: ClientProxy;
    let mockErrorHandler: CountedErrorHandler;
    let mockErrorCounter: AtomicCounter;
    let senderProxy: SenderProxy;
    let receiverProxy: ReceiverProxy;
    let nativeResourceAgentProxy: NativeResourceAgentProxy;
    let nativeResourceAgentProxySpies: Map<string, AnyMock>;
    let driverConductorProxy: DriverConductorProxy;
    let receiveChannelEndpoint: ReceiveChannelEndpoint | null;
    let nanoClock: CachedNanoClock;
    let epochClock: CachedEpochClock;
    let spySystemCounters: SystemCounters;
    let spyCountersManager: CountersManager;
    let ctx: MediaDriver.Context;
    let driverProxy: DriverProxy;
    let driverConductor: DriverConductor;
    let nativeResourceAgent: NativeResourceAgent;

    beforeEach(() => {
        receiveChannelEndpoint = null;
        nanoClock = new CachedNanoClock();
        epochClock = new CachedEpochClock();
        toDriverCommands = new ManyToOneRingBuffer(new UnsafeBuffer(new ArrayBuffer(CONDUCTOR_BUFFER_LENGTH_DEFAULT)));
        vi.spyOn(toDriverCommands, 'consumerHeartbeatTime');
        mockClientProxy = mock(ClientProxy).mock;
        mockErrorHandler = mock(CountedErrorHandler).mock;
        mockErrorCounter = mock(AtomicCounter).mock;
        senderProxy = mock(SenderProxy).mock;
        receiverProxy = mock(ReceiverProxy).mock;

        spyCountersManager = newCountersManager(BUFFER_LENGTH);
        spySystemCounters = new SystemCounters(spyCountersManager);

        const conductorDutyCycleTracker = new DutyCycleStallTracker(
            spySystemCounters.get(CONDUCTOR_MAX_CYCLE_TIME),
            spySystemCounters.get(CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED),
            600_000_000,
        );

        const nameResolverTimeTracker = new DutyCycleStallTracker(
            spySystemCounters.get(NAME_RESOLVER_MAX_TIME),
            spySystemCounters.get(NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED),
            1_000_000_000,
        );

        const nativeResourceAgentCommandQueue = new OneToOneConcurrentArrayQueue<() => void>(CMD_QUEUE_CAPACITY);
        nativeResourceAgentProxy = new NativeResourceAgentProxy(nativeResourceAgentCommandQueue, mockErrorCounter);
        nativeResourceAgentProxySpies = spyOnAll(nativeResourceAgentProxy);

        const driverCommandQueue = new ManyToOneConcurrentLinkedQueue<() => void>();
        driverConductorProxy = new DriverConductorProxy(driverCommandQueue);

        ctx = new MediaDriver.Context()
            .tempBuffer(new UnsafeBuffer(new Uint8Array(METADATA_LENGTH)))
            .timerIntervalNs(DEFAULT_TIMER_INTERVAL_NS)
            .publicationTermBufferLength(TERM_BUFFER_LENGTH)
            .ipcTermBufferLength(TERM_BUFFER_LENGTH)
            .unicastFlowControlSupplier(Configuration.unicastFlowControlSupplier())
            .multicastFlowControlSupplier(Configuration.multicastFlowControlSupplier())
            .driverCommandQueue(driverCommandQueue)
            .nativeResourceAgentCommandQueue(nativeResourceAgentCommandQueue)
            .errorHandler(mockErrorHandler)
            .countedErrorHandler(mockErrorHandler)
            .logFactory(new TestLogFactory())
            .countersManager(spyCountersManager)
            .epochClock(epochClock)
            .nanoClock(nanoClock)
            .senderCachedNanoClock(nanoClock)
            .receiverCachedNanoClock(nanoClock)
            .cachedEpochClock(new CachedEpochClock())
            .cachedNanoClock(new CachedNanoClock())
            .sendChannelEndpointSupplier(Configuration.sendChannelEndpointSupplier())
            .receiveChannelEndpointSupplier(Configuration.receiveChannelEndpointSupplier())
            .congestControlSupplier(Configuration.congestionControlSupplier())
            .toDriverCommands(toDriverCommands)
            .clientProxy(mockClientProxy)
            .systemCounters(spySystemCounters)
            .receiverProxy(receiverProxy)
            .senderProxy(senderProxy)
            .nativeResourceAgentProxy(nativeResourceAgentProxy)
            .driverConductorProxy(driverConductorProxy)
            .receiveChannelEndpointThreadLocals(new ReceiveChannelEndpointThreadLocals())
            .conductorCycleThresholdNs(600_000_000)
            .nameResolver(DefaultNameResolver.INSTANCE)
            .threadingMode(ThreadingMode.INVOKER)
            .conductorDutyCycleTracker(conductorDutyCycleTracker)
            .nameResolverTimeTracker(nameResolverTimeTracker)
            .senderPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, true))
            .receiverPortManager(new WildcardPortManager(WildcardPortManager.EMPTY_PORT_RANGE, false))
            .cncByteBuffer(new SharedArrayBuffer(1024))
            .countersMetaDataBuffer(spyCountersManager.metaDataBuffer() as UnsafeBuffer)
            .countersValuesBuffer(spyCountersManager.valuesBuffer() as UnsafeBuffer);

        nativeResourceAgent = new NativeResourceAgent(ctx);
        nativeResourceAgentProxy.nativeResourceAgent(nativeResourceAgent);

        driverProxy = new DriverProxy(toDriverCommands, toDriverCommands.nextCorrelationId());
        driverConductor = new DriverConductor(ctx.clone());
        driverConductorProxy.driverConductor(driverConductor);

        driverConductor.onStart();
        nativeResourceAgent.onStart();

        m(receiverProxy.closeReceiveChannelEndpoint).mockImplementation((channelEndpoint) => {
            (channelEndpoint as ReceiveChannelEndpoint).close();
        });
    });

    afterEach(() => {
        CloseHelper.close(receiveChannelEndpoint);
        nativeResourceAgent.onClose();
        driverConductor.onClose();
        vi.restoreAllMocks();
    });

    function doWork(): number {
        return driverConductor.doWork() + nativeResourceAgent.doWork();
    }

    function doWorkUntilComplete(): void {
        // Java: while (0 != doWork()) Tests.yield(); the drive loop has a hard cap here
        for (let i = 0; 0 !== doWork(); i++) {
            expect(i, 'doWorkUntilComplete did not complete').toBeLessThan(MAX_ITERATIONS);
        }
    }

    function doWorkUntilWithConsumer(condition: () => boolean, timeConsumer: (timeNs: number) => void): void {
        for (let i = 0; !condition(); i++) {
            expect(i, 'doWorkUntil did not reach its condition').toBeLessThan(MAX_ITERATIONS);
            const millisecondsToAdvance = 16;

            nanoClock.advance(MILLISECONDS.toNanos(millisecondsToAdvance));
            epochClock.advance(millisecondsToAdvance);
            timeConsumer(nanoClock.nanoTime());
            doWork();
        }
    }

    function doWorkUntil(condition: () => boolean): void {
        doWorkUntilWithConsumer(condition, () => {});
    }

    function newPublications(): NetworkPublication[] {
        return m(senderProxy.newNetworkPublication).mock.calls.map((args) => args[0] as NetworkPublication);
    }

    function newPublication(): NetworkPublication {
        verify(senderProxy.newNetworkPublication, expect.anything());
        return newPublications()[0] as NetworkPublication;
    }

    function registeredReceiveEndpoint(): ReceiveChannelEndpoint {
        verify(receiverProxy.registerReceiveChannelEndpoint, expect.anything());
        receiveChannelEndpoint = m(receiverProxy.registerReceiveChannelEndpoint).mock
            .calls[0]![0] as ReceiveChannelEndpoint;
        return receiveChannelEndpoint;
    }

    /** The protected `CommandProxy.offer`, which the Java test verifies on the spy. */
    function offerOf(): unknown {
        return (nativeResourceAgentProxy as unknown as { offer: unknown }).offer;
    }

    function appendUnfragmentedMessage(
        rawLog: { termBuffers(): UnsafeBuffer[]; metaData(): UnsafeBuffer },
        partitionIndex: number,
        termId: number,
        termOffset: number,
        header: HeaderWriter,
        srcBuffer: UnsafeBuffer,
        srcOffset: number,
        length: number,
    ): void {
        const termBuffer = rawLog.termBuffers()[partitionIndex] as UnsafeBuffer;
        const frameLength = length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const resultingOffset = termOffset + alignedLength;
        const rawTail = LogBufferDescriptor.packTail(termId, resultingOffset);

        LogBufferDescriptor.rawTail(rawLog.metaData(), partitionIndex, rawTail);

        header.write(termBuffer, termOffset, frameLength, termId);
        termBuffer.putBytes(termOffset + HEADER_LENGTH, srcBuffer, srcOffset, length);

        frameLengthOrdered(termBuffer, termOffset, frameLength);
    }

    it('notAcceptingClientCommands', () => {
        for (const proxy of [senderProxy, receiverProxy, nativeResourceAgentProxy]) {
            m(proxy.isApplyingBackpressure).mockReset();
            m(proxy.isApplyingBackpressure).mockReturnValueOnce(false).mockReturnValueOnce(true).mockReturnValue(false);
        }

        const sender = m(senderProxy.isApplyingBackpressure);
        const receiver = m(receiverProxy.isApplyingBackpressure);
        const nativeResource = m(nativeResourceAgentProxy.isApplyingBackpressure);

        const inOrder = new InOrder(senderProxy, receiverProxy, nativeResourceAgentProxy);

        expect(driverConductor.notAcceptingClientCommands()).toBe(false);
        inOrder.verify(sender, 1);
        inOrder.verify(receiver, 1);
        inOrder.verify(nativeResource, 1);

        expect(driverConductor.notAcceptingClientCommands()).toBe(true);
        inOrder.verify(sender, 1);

        expect(driverConductor.notAcceptingClientCommands()).toBe(true);
        inOrder.verify(sender, 1);
        inOrder.verify(receiver, 1);

        expect(driverConductor.notAcceptingClientCommands()).toBe(true);
        inOrder.verify(sender, 1);
        inOrder.verify(receiver, 1);
        inOrder.verify(nativeResource, 1);

        expect(driverConductor.notAcceptingClientCommands()).toBe(false);
        inOrder.verify(sender, 1);
        inOrder.verify(receiver, 1);
        inOrder.verify(nativeResource, 1);
    });

    it('shouldErrorWhenOriginalPublicationHasNoDistinguishingCharacteristicBeyondTag', () => {
        const expectedMessage = 'URI must have explicit control, endpoint, or be manual control-mode when original:';

        driverProxy.addPublication('aeron:udp?tags=1001', STREAM_ID_1);
        doWorkUntilComplete();

        const onError = m(mockErrorHandler.onError);
        expect(onError).toHaveBeenCalledTimes(1);
        const ex = onError.mock.calls[0]![0] as Error;
        expect(ex).toBeInstanceOf(InvalidChannelException);
        expect(ex.message).toContain(expectedMessage);
    });

    it('shouldBeAbleToAddSinglePublication', () => {
        driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        verify(senderProxy.registerSendChannelEndpoint, expect.anything());
        const publication = newPublication();
        expect(publication.streamId()).toBe(STREAM_ID_1);

        verify(
            mockClientProxy.onPublicationReady,
            expect.any(Number),
            expect.any(Number),
            STREAM_ID_1,
            expect.any(Number),
            expect.anything(),
            expect.any(Number),
            expect.any(Number),
            false,
        );
    });

    it('shouldBeAbleToAddPublicationForReplay', () => {
        const mtu = 1024 * 8;
        const termLength = 128 * 1024;
        const initialTermId = 7;
        const termId = 11;
        const termOffset = 64;
        const params =
            '|mtu=' +
            mtu +
            '|term-length=' +
            termLength +
            '|init-term-id=' +
            initialTermId +
            '|term-id=' +
            termId +
            '|term-offset=' +
            termOffset;

        driverProxy.addExclusivePublication(CHANNEL_4000 + params, STREAM_ID_1);

        doWorkUntilComplete();

        verify(senderProxy.registerSendChannelEndpoint, expect.anything());
        const publication = newPublication();
        expect(publication.streamId()).toBe(STREAM_ID_1);
        expect(publication.mtuLength()).toBe(mtu);

        const expectedPosition = termLength * (termId - initialTermId) + termOffset;
        expect(publication.producerPosition()).toBe(expectedPosition);
        expect(publication.consumerPosition()).toBe(expectedPosition);

        verify(
            mockClientProxy.onPublicationReady,
            expect.any(Number),
            expect.any(Number),
            STREAM_ID_1,
            expect.any(Number),
            expect.anything(),
            expect.any(Number),
            expect.any(Number),
            true,
        );
    });

    // IPC publications are not ported (spec section 3, D54): there is no IpcPublication
    it.skip('shouldBeAbleToAddIpcPublicationForReplay', () => {});

    it('shouldBeAbleToAddSingleSubscription', () => {
        const id = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        registeredReceiveEndpoint();

        verify(receiverProxy.addSubscription, expect.anything(), STREAM_ID_1);
        verify(mockClientProxy.onSubscriptionReady, id, expect.any(Number));
    });

    it('shouldBeAbleToAddAndRemoveSingleSubscription', () => {
        const id = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);
        driverProxy.removeSubscription(id);

        doWorkUntilComplete();

        verify(receiverProxy.registerReceiveChannelEndpoint, expect.anything());
        verify(receiverProxy.closeReceiveChannelEndpoint, expect.anything());
    });

    it('shouldBeAbleToAddMultipleStreams', () => {
        driverProxy.addPublication(CHANNEL_4001, STREAM_ID_1);
        driverProxy.addPublication(CHANNEL_4002, STREAM_ID_2);
        driverProxy.addPublication(CHANNEL_4003, STREAM_ID_3);
        driverProxy.addPublication(CHANNEL_4004, STREAM_ID_4);

        doWorkUntilComplete();

        verifyTimes(4, senderProxy.newNetworkPublication, expect.anything());
    });

    it('shouldBeAbleToRemoveSingleStream', () => {
        const id = driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);
        driverProxy.removePublication(id, false);

        doWorkUntil(() => CLIENT_LIVENESS_TIMEOUT_NS + PUBLICATION_LINGER_TIMEOUT_NS * 2 - nanoClock.nanoTime() < 0);

        verify(senderProxy.registerSendChannelEndpoint, expect.anything());
        verify(senderProxy.removeNetworkPublication, expect.anything());
    });

    it('shouldBeAbleToRemoveMultipleStreams', () => {
        const id1 = driverProxy.addPublication(CHANNEL_4001, STREAM_ID_1);
        const id2 = driverProxy.addPublication(CHANNEL_4002, STREAM_ID_2);
        const id3 = driverProxy.addPublication(CHANNEL_4003, STREAM_ID_3);
        const id4 = driverProxy.addPublication(CHANNEL_4004, STREAM_ID_4);

        driverProxy.removePublication(id1, false);
        driverProxy.removePublication(id2, false);
        driverProxy.removePublication(id3, false);
        driverProxy.removePublication(id4, false);

        doWorkUntil(
            () => CLIENT_LIVENESS_TIMEOUT_NS * 2 + PUBLICATION_LINGER_TIMEOUT_NS * 2 - nanoClock.nanoTime() <= 0,
        );

        verifyTimes(4, senderProxy.removeNetworkPublication, expect.anything());
    });

    it('shouldKeepSubscriptionMediaEndpointUponRemovalOfAllButOneSubscriber', () => {
        const id1 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);
        const id2 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_2);
        driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_3);

        doWorkUntilComplete();

        const endpoint = registeredReceiveEndpoint();

        expect(endpoint).not.toBeNull();
        expect(endpoint.distinctSubscriptionCount()).toBe(3);

        driverProxy.removeSubscription(id1);
        driverProxy.removeSubscription(id2);

        doWorkUntilComplete();

        expect(endpoint.distinctSubscriptionCount()).toBe(1);
    });

    it('shouldOnlyRemoveSubscriptionMediaEndpointUponRemovalOfAllSubscribers', () => {
        const id1 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);
        const id2 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_2);
        const id3 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_3);

        doWorkUntilComplete();

        const endpoint = registeredReceiveEndpoint();

        expect(endpoint).not.toBeNull();
        expect(endpoint.distinctSubscriptionCount()).toBe(3);

        driverProxy.removeSubscription(id2);
        driverProxy.removeSubscription(id3);

        doWorkUntilComplete();

        expect(endpoint.distinctSubscriptionCount()).toBe(1);

        driverProxy.removeSubscription(id1);

        doWorkUntilComplete();

        verify(receiverProxy.closeReceiveChannelEndpoint, endpoint);
    });

    it('shouldErrorOnRemovePublicationOnUnknownRegistrationId', () => {
        const id = driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);
        driverProxy.removePublication(id + 1, false);

        doWorkUntilComplete();

        const inOrder = new InOrder(senderProxy, mockClientProxy);

        inOrder.verify(senderProxy.newNetworkPublication, 1, expect.anything());
        inOrder.verify(
            mockClientProxy.onPublicationReady,
            1,
            expect.any(Number),
            id,
            STREAM_ID_1,
            expect.any(Number),
            expect.anything(),
            expect.any(Number),
            expect.any(Number),
            false,
        );
        inOrder.verify(mockClientProxy.onError, 1, expect.any(Number), UNKNOWN_PUBLICATION, expect.any(String));
        inOrder.verifyNoMoreInteractions();

        verify(mockErrorHandler.onError, expect.any(Error));
    });

    it('shouldAddPublicationWithMtu', () => {
        const mtuLength = 4096;
        const mtuParam = '|' + CommonContext.MTU_LENGTH_PARAM_NAME + '=' + mtuLength;
        driverProxy.addPublication(CHANNEL_4000 + mtuParam, STREAM_ID_1);

        doWorkUntilComplete();

        expect(newPublication().mtuLength()).toBe(mtuLength);
    });

    it('shouldErrorOnRemoveSubscriptionOnUnknownRegistrationId', () => {
        const id1 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);
        driverProxy.removeSubscription(id1 + 100);

        doWorkUntilComplete();

        const inOrder = new InOrder(receiverProxy, mockClientProxy);

        inOrder.verify(receiverProxy.addSubscription, 1, expect.anything(), expect.any(Number));
        inOrder.verify(mockClientProxy.onSubscriptionReady, 1, id1, expect.any(Number));
        inOrder.verify(mockClientProxy.onError, 1, expect.any(Number), UNKNOWN_SUBSCRIPTION, expect.any(String));
        inOrder.verifyNoMoreInteractions();

        verify(mockErrorHandler.onError, expect.any(Error));
        registeredReceiveEndpoint();
    });

    it('shouldErrorOnAddSubscriptionWithInvalidChannel', () => {
        driverProxy.addSubscription(INVALID_URI, STREAM_ID_1);

        doWorkUntilComplete();

        verifyNever(receiverProxy.newPublicationImage, expect.anything(), expect.anything());

        verify(mockClientProxy.onError, expect.any(Number), INVALID_CHANNEL, expect.any(String));
        verifyNever(mockClientProxy.operationSucceeded, expect.any(Number));

        verify(mockErrorHandler.onError, expect.any(Error));
    });

    it('shouldTimeoutPublication', () => {
        driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const publication = newPublication();

        doWorkUntil(() => CLIENT_LIVENESS_TIMEOUT_NS + PUBLICATION_LINGER_TIMEOUT_NS * 2 - nanoClock.nanoTime() <= 0);

        verify(senderProxy.removeNetworkPublication, publication);
        verify(senderProxy.registerSendChannelEndpoint, expect.anything());
    });

    it('shouldNotTimeoutPublicationOnKeepAlive', () => {
        driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const publication = newPublication();
        const heartbeatCounter = clientHeartbeatCounter(spyCountersManager);

        doWorkUntil(() => CLIENT_LIVENESS_TIMEOUT_NS / 2 - nanoClock.nanoTime() <= 0);

        heartbeatCounter.setRelease(epochClock.time());

        doWorkUntil(() => CLIENT_LIVENESS_TIMEOUT_NS + 1000 - nanoClock.nanoTime() <= 0);

        heartbeatCounter.setRelease(epochClock.time());

        doWorkUntil(() => nanoClock.nanoTime() >= CLIENT_LIVENESS_TIMEOUT_NS * 2);

        verifyNever(senderProxy.removeNetworkPublication, publication);
    });

    it('shouldTimeoutPublicationWithNoKeepaliveButNotDrained', () => {
        driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const publication = newPublication();

        const termId = 101;
        const index = LogBufferDescriptor.indexByTerm(termId, termId);
        const rawLog = publication.rawLog();
        LogBufferDescriptor.rawTail(rawLog.metaData(), index, LogBufferDescriptor.packTail(termId, 0));
        const srcBuffer = new UnsafeBuffer(new Uint8Array(256));
        const headerWriter = HeaderWriter.newInstance(createDefaultHeader(SESSION_ID, STREAM_ID_1, termId));

        const msg = mock(StatusMessageFlyweight).mock;
        m(msg.consumptionTermId).mockReturnValue(termId);
        m(msg.consumptionTermOffset).mockReturnValue(0);
        m(msg.receiverWindowLength).mockReturnValue(10);

        publication.onStatusMessage(msg, new InetSocketAddress('localhost', 4059), driverConductorProxy);
        appendUnfragmentedMessage(rawLog, index, 0, termId, headerWriter, srcBuffer, 0, 256);

        expect(publication.state()).toBe(NetworkPublication.State.ACTIVE);

        doWorkUntilWithConsumer(
            () => nanoClock.nanoTime() >= CLIENT_LIVENESS_TIMEOUT_NS * 1.25,
            (timeNs) => {
                publication.onStatusMessage(msg, new InetSocketAddress('localhost', 4059), driverConductorProxy);
                publication.updateHasReceivers(timeNs);
            },
        );

        expect([NetworkPublication.State.DRAINING, NetworkPublication.State.LINGER]).toContain(publication.state());

        const endTime = nanoClock.nanoTime() + publicationConnectionTimeoutNs() + DEFAULT_TIMER_INTERVAL_NS;
        doWorkUntilWithConsumer(
            () => nanoClock.nanoTime() >= endTime,
            (timeNs) => publication.updateHasReceivers(timeNs),
        );

        expect([NetworkPublication.State.LINGER, NetworkPublication.State.DONE]).toContain(publication.state());

        nanoClock.advance(DEFAULT_TIMER_INTERVAL_NS + PUBLICATION_LINGER_TIMEOUT_NS);
        doWorkUntilComplete();
        expect(publication.state()).toBe(NetworkPublication.State.DONE);

        verify(senderProxy.removeNetworkPublication, publication);
        verify(senderProxy.registerSendChannelEndpoint, expect.anything());
    });

    it('shouldTimeoutSubscription', () => {
        driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const endpoint = registeredReceiveEndpoint();

        verify(receiverProxy.addSubscription, endpoint, STREAM_ID_1);

        doWorkUntil(() => nanoClock.nanoTime() >= CLIENT_LIVENESS_TIMEOUT_NS * 2);

        verifyTimes(1, receiverProxy.removeSubscription, endpoint, STREAM_ID_1);

        verify(receiverProxy.closeReceiveChannelEndpoint, endpoint);
    });

    it('shouldNotTimeoutSubscriptionOnKeepAlive', () => {
        driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const endpoint = registeredReceiveEndpoint();

        verify(receiverProxy.addSubscription, endpoint, STREAM_ID_1);
        const heartbeatCounter = clientHeartbeatCounter(spyCountersManager);

        doWorkUntil(() => nanoClock.nanoTime() >= CLIENT_LIVENESS_TIMEOUT_NS);

        heartbeatCounter.setRelease(epochClock.time());

        doWorkUntil(() => nanoClock.nanoTime() >= CLIENT_LIVENESS_TIMEOUT_NS + 1000);

        heartbeatCounter.setRelease(epochClock.time());

        doWorkUntil(() => nanoClock.nanoTime() >= CLIENT_LIVENESS_TIMEOUT_NS * 2);

        verifyNever(receiverProxy.removeSubscription, expect.anything(), expect.any(Number));
    });

    /** `mock(InetSocketAddress.class)` */
    function mockAddress(): InetSocketAddress {
        return mock(InetSocketAddress).mock;
    }

    function createImage(
        endpoint: ReceiveChannelEndpoint,
        streamId: number,
        initialTermId: number,
        activeTermId: number,
        termOffset: number,
        sourceAddress: InetSocketAddress,
    ): void {
        driverConductor.onCreatePublicationImage(
            SESSION_ID,
            streamId,
            initialTermId,
            activeTermId,
            termOffset,
            TERM_BUFFER_LENGTH,
            MTU_LENGTH,
            0,
            0,
            mockAddress(),
            sourceAddress,
            endpoint,
        );
    }

    it('shouldCreateImageOnSubscription', () => {
        const sourceAddress = new InetSocketAddress('localhost', 4400);
        const initialTermId = 1;
        const activeTermId = 2;
        const termOffset = 160;

        driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const endpoint = registeredReceiveEndpoint();

        createImage(endpoint, STREAM_ID_1, initialTermId, activeTermId, termOffset, sourceAddress);

        doWorkUntilComplete();
        doWorkUntilComplete();

        verify(receiverProxy.newPublicationImage, endpoint, expect.anything());
        const publicationImage = m(receiverProxy.newPublicationImage).mock.calls[0]![1] as PublicationImage;
        expect(publicationImage.sessionId()).toBe(SESSION_ID);
        expect(publicationImage.streamId()).toBe(STREAM_ID_1);

        verify(
            mockClientProxy.onAvailableImage,
            expect.any(Number),
            STREAM_ID_1,
            SESSION_ID,
            expect.any(Number),
            expect.any(Number),
            expect.any(String),
            expect.any(String),
        );
    });

    it('shouldNotCreateImageOnUnknownSubscription', () => {
        const sourceAddress = new InetSocketAddress('localhost', 4400);

        driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const endpoint = registeredReceiveEndpoint();

        createImage(endpoint, STREAM_ID_2, 1, 1, 0, sourceAddress);

        verifyNever(receiverProxy.newPublicationImage, expect.anything(), expect.anything());
        verifyNever(mockClientProxy.onAvailableImage, ...anyArgs(7));
    });

    /** Add a subscription, create an image on it and take the image the receiver is given. */
    function subscribeAndCreateImage(): { subId: number; endpoint: ReceiveChannelEndpoint; image: PublicationImage } {
        const sourceAddress = new InetSocketAddress('localhost', 4400);

        const subId = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const endpoint = registeredReceiveEndpoint();

        createImage(endpoint, STREAM_ID_1, 1, 1, 0, sourceAddress);

        doWorkUntilComplete();

        verify(receiverProxy.newPublicationImage, endpoint, expect.anything());
        const image = m(receiverProxy.newPublicationImage).mock.calls[0]![1] as PublicationImage;
        return { subId, endpoint, image };
    }

    it('shouldSignalInactiveImageWhenImageTimesOut', () => {
        const { subId, image: publicationImage } = subscribeAndCreateImage();

        publicationImage.activate();
        publicationImage.deactivate();

        doWorkUntil(() => nanoClock.nanoTime() >= imageLivenessTimeoutNs() + 1000);

        verify(
            mockClientProxy.onUnavailableImage,
            publicationImage.correlationId(),
            subId,
            STREAM_ID_1,
            expect.any(String),
        );
    });

    it('shouldAlwaysGiveNetworkPublicationCorrelationIdToClientCallbacks', () => {
        const { subId: subId1, image: publicationImage } = subscribeAndCreateImage();

        publicationImage.activate();

        const subId2 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        publicationImage.deactivate();

        doWorkUntil(() => nanoClock.nanoTime() >= imageLivenessTimeoutNs() + 1000);

        const inOrder = new InOrder(mockClientProxy);
        inOrder.verify(
            mockClientProxy.onAvailableImage,
            2,
            publicationImage.correlationId(),
            STREAM_ID_1,
            SESSION_ID,
            expect.any(Number),
            expect.any(Number),
            expect.any(String),
            expect.any(String),
        );
        inOrder.verify(
            mockClientProxy.onUnavailableImage,
            1,
            publicationImage.correlationId(),
            subId1,
            STREAM_ID_1,
            expect.any(String),
        );
        inOrder.verify(
            mockClientProxy.onUnavailableImage,
            1,
            publicationImage.correlationId(),
            subId2,
            STREAM_ID_1,
            expect.any(String),
        );
    });

    it('shouldNotSendAvailableImageWhileImageNotActiveOnAddSubscription', () => {
        const { subId: subOneId, image: publicationImage } = subscribeAndCreateImage();

        publicationImage.activate();
        publicationImage.deactivate();

        doWorkUntil(() => nanoClock.nanoTime() >= imageLivenessTimeoutNs() / 2);

        const heartbeatCounter = clientHeartbeatCounter(spyCountersManager);
        heartbeatCounter.setRelease(epochClock.time());

        doWorkUntil(() => nanoClock.nanoTime() >= imageLivenessTimeoutNs() + 1000);

        const subTwoId = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);

        doWorkUntilComplete();

        const inOrder = new InOrder(mockClientProxy);
        inOrder.verify(mockClientProxy.onSubscriptionReady, 1, subOneId, expect.any(Number));
        inOrder.verify(
            mockClientProxy.onAvailableImage,
            1,
            publicationImage.correlationId(),
            STREAM_ID_1,
            SESSION_ID,
            expect.any(Number),
            expect.any(Number),
            expect.any(String),
            expect.any(String),
        );
        inOrder.verify(
            mockClientProxy.onUnavailableImage,
            1,
            publicationImage.correlationId(),
            subOneId,
            STREAM_ID_1,
            expect.any(String),
        );
        inOrder.verify(mockClientProxy.onSubscriptionReady, 1, subTwoId, expect.any(Number));
        inOrder.verifyNoMoreInteractions();
    });

    // IPC publications and subscriptions are not ported (spec section 3, D54): there is no IpcPublication
    it.skip('shouldBeAbleToAddSingleIpcPublication', () => {});
    it.skip('shouldBeAbleToAddIpcPublicationThenSubscription', () => {});
    it.skip('shouldBeAbleToAddThenRemoveTheAddIpcPublicationWithExistingSubscription', () => {});
    it.skip('shouldBeAbleToAddSubscriptionThenIpcPublication', () => {});
    it.skip('shouldBeAbleToAddAndRemoveIpcPublication', () => {});
    it.skip('shouldBeAbleToAddAndRemoveSubscriptionToIpcPublication', () => {});
    it.skip('shouldBeAbleToAddAndRemoveTwoIpcPublications', () => {});
    it.skip('shouldBeAbleToAddAndRemoveIpcPublicationAndSubscription', () => {});
    it.skip('shouldTimeoutIpcPublication', () => {});
    it.skip('shouldNotTimeoutIpcPublicationWithKeepalive', () => {});

    // Spy subscriptions are not ported (spec section 3, D54): there is no SpySubscriptionLink
    it.skip('shouldBeAbleToAddSingleSpy', () => {});
    it.skip('shouldBeAbleToAddNetworkPublicationThenSingleSpy', () => {});
    it.skip('shouldBeAbleToAddSingleSpyThenNetworkPublication', () => {});
    it.skip('shouldBeAbleToAddNetworkPublicationThenSingleSpyThenRemoveSpy', () => {});
    it.skip('shouldTimeoutSpy', () => {});
    it.skip('shouldNotTimeoutSpyWithKeepalive', () => {});
    it.skip('shouldTimeoutNetworkPublicationWithSpy', () => {});

    it('shouldOnlyCloseSendChannelEndpointOnceWithMultiplePublications', () => {
        const id1 = driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);
        const id2 = driverProxy.addPublication(CHANNEL_4000, STREAM_ID_2);
        driverProxy.removePublication(id1, false);
        driverProxy.removePublication(id2, false);

        doWorkUntil(() => PUBLICATION_LINGER_TIMEOUT_NS * 2 - nanoClock.nanoTime() <= 0);

        verifyTimes(1, senderProxy.closeSendChannelEndpoint, expect.anything());
    });

    it('shouldOnlyCloseReceiveChannelEndpointOnceWithMultipleSubscriptions', () => {
        const id1 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);
        const id2 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_2);
        driverProxy.removeSubscription(id1);
        driverProxy.removeSubscription(id2);

        doWorkUntil(() => CLIENT_LIVENESS_TIMEOUT_NS * 2 - nanoClock.nanoTime() <= 0);

        verifyTimes(1, receiverProxy.closeReceiveChannelEndpoint, expect.anything());
    });

    it('shouldErrorWhenConflictingUnreliableSubscriptionAdded', () => {
        driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);
        doWorkUntilComplete();

        const id2 = driverProxy.addSubscription(CHANNEL_4000 + '|reliable=false', STREAM_ID_1);
        doWorkUntilComplete();

        verify(mockClientProxy.onError, id2, expect.anything(), expect.any(String));
    });

    it('shouldErrorWhenConflictingUnreliableSessionSpecificSubscriptionAdded', () => {
        driverProxy.addSubscription(CHANNEL_4000 + '|session-id=1024', STREAM_ID_1);
        doWorkUntilComplete();

        const id2 = driverProxy.addSubscription(CHANNEL_4000 + '|session-id=1024|reliable=false', STREAM_ID_1);
        doWorkUntilComplete();

        verify(mockClientProxy.onError, id2, expect.anything(), expect.any(String));
    });

    it('shouldNotErrorWhenConflictingUnreliableSessionSpecificSubscriptionAddedToDifferentSessions', () => {
        const id1 = driverProxy.addSubscription(CHANNEL_4000 + '|session-id=1024|reliable=true', STREAM_ID_1);
        doWorkUntilComplete();

        const id2 = driverProxy.addSubscription(CHANNEL_4000 + '|session-id=1025|reliable=false', STREAM_ID_1);
        doWorkUntilComplete();

        verify(mockClientProxy.onSubscriptionReady, id1, expect.any(Number));
        verify(mockClientProxy.onSubscriptionReady, id2, expect.any(Number));
    });

    it('shouldNotErrorWhenConflictingUnreliableSessionSpecificSubscriptionAddedToDifferentSessionsVsWildcard', () => {
        const id1 = driverProxy.addSubscription(CHANNEL_4000 + '|session-id=1024|reliable=false', STREAM_ID_1);
        doWorkUntilComplete();

        const id2 = driverProxy.addSubscription(CHANNEL_4000 + '|reliable=true', STREAM_ID_1);
        doWorkUntilComplete();

        const id3 = driverProxy.addSubscription(CHANNEL_4000 + '|session-id=1025|reliable=false', STREAM_ID_1);
        doWorkUntilComplete();

        verify(mockClientProxy.onSubscriptionReady, id1, expect.any(Number));
        verify(mockClientProxy.onSubscriptionReady, id2, expect.any(Number));
        verify(mockClientProxy.onSubscriptionReady, id3, expect.any(Number));
    });

    it('shouldErrorWhenConflictingDefaultReliableSubscriptionAdded', () => {
        driverProxy.addSubscription(CHANNEL_4000 + '|reliable=false', STREAM_ID_1);
        doWorkUntilComplete();

        const id2 = driverProxy.addSubscription(CHANNEL_4000, STREAM_ID_1);
        doWorkUntilComplete();

        verify(mockClientProxy.onError, id2, expect.anything(), expect.any(String));
    });

    it('shouldErrorWhenConflictingReliableSubscriptionAdded', () => {
        driverProxy.addSubscription(CHANNEL_4000 + '|reliable=false', STREAM_ID_1);
        doWorkUntilComplete();

        const id2 = driverProxy.addSubscription(CHANNEL_4000 + '|reliable=true', STREAM_ID_1);
        doWorkUntilComplete();

        verify(mockClientProxy.onError, id2, expect.anything(), expect.any(String));
    });

    // The counters API is not ported (plan decision 8): there is no ADD_COUNTER command
    it.skip('shouldAddSingleCounter', () => {});
    it.skip('shouldRemoveSingleCounter', () => {});
    it.skip('shouldRemoveCounterOnClientTimeout', () => {});
    it.skip('shouldNotRemoveCounterOnClientKeepalive', () => {});
    it.skip('shouldInformClientsOfRemovedCounter', () => {});

    it('shouldAddPublicationWithSessionId', () => {
        const sessionId = 4096;
        const sessionIdParam = '|' + CommonContext.SESSION_ID_PARAM_NAME + '=' + sessionId;
        driverProxy.addPublication(CHANNEL_4000 + sessionIdParam, STREAM_ID_1);

        doWorkUntilComplete();

        expect(newPublication().sessionId()).toBe(sessionId);
    });

    it('shouldAddExclusivePublicationWithSessionId', () => {
        const sessionId = 4096;
        const sessionIdParam = '|' + CommonContext.SESSION_ID_PARAM_NAME + '=' + sessionId;
        driverProxy.addExclusivePublication(CHANNEL_4000 + sessionIdParam, STREAM_ID_1);

        doWorkUntilComplete();

        expect(newPublication().sessionId()).toBe(sessionId);
    });

    it('shouldAddPublicationWithSameSessionId', () => {
        driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);
        doWorkUntilComplete();

        const sessionId = newPublication().sessionId();
        const sessionIdParam = '|' + CommonContext.SESSION_ID_PARAM_NAME + '=' + sessionId;
        driverProxy.addPublication(CHANNEL_4000 + sessionIdParam, STREAM_ID_1);
        doWorkUntilComplete();

        verifyTimes(
            2,
            mockClientProxy.onPublicationReady,
            expect.any(Number),
            expect.any(Number),
            STREAM_ID_1,
            sessionId,
            expect.any(String),
            expect.any(Number),
            expect.any(Number),
            false,
        );
    });

    it('shouldAddExclusivePublicationWithSameSessionId', () => {
        driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);
        doWorkUntilComplete();

        const sessionId = newPublication().sessionId();
        const sessionIdParam = '|' + CommonContext.SESSION_ID_PARAM_NAME + '=' + (sessionId + 1);
        driverProxy.addExclusivePublication(CHANNEL_4000 + sessionIdParam, STREAM_ID_1);
        doWorkUntilComplete();

        verify(
            mockClientProxy.onPublicationReady,
            expect.any(Number),
            expect.any(Number),
            STREAM_ID_1,
            sessionId,
            expect.any(String),
            expect.any(Number),
            expect.any(Number),
            false,
        );
        verify(
            mockClientProxy.onPublicationReady,
            expect.any(Number),
            expect.any(Number),
            STREAM_ID_1,
            sessionId + 1,
            expect.any(String),
            expect.any(Number),
            expect.any(Number),
            true,
        );
    });

    it('shouldErrorOnAddPublicationWithNonEqualSessionId', () => {
        driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);
        doWorkUntilComplete();

        const sessionIdParam = '|' + CommonContext.SESSION_ID_PARAM_NAME + '=' + (newPublication().sessionId() + 1);
        const correlationId = driverProxy.addPublication(CHANNEL_4000 + sessionIdParam, STREAM_ID_1);
        doWorkUntilComplete();

        verify(mockClientProxy.onError, correlationId, GENERIC_ERROR, expect.any(String));
        verify(mockErrorHandler.onError, expect.any(Error));
    });

    it('shouldErrorOnAddPublicationWithClashingSessionId', () => {
        driverProxy.addPublication(CHANNEL_4000, STREAM_ID_1);
        doWorkUntilComplete();

        const sessionIdParam = '|' + CommonContext.SESSION_ID_PARAM_NAME + '=' + newPublication().sessionId();
        const correlationId = driverProxy.addExclusivePublication(CHANNEL_4000 + sessionIdParam, STREAM_ID_1);
        doWorkUntilComplete();

        verify(mockClientProxy.onError, correlationId, INVALID_CHANNEL, expect.any(String));
        verify(mockErrorHandler.onError, expect.any(Error));
    });

    // IPC publications and subscriptions are not ported (spec section 3, D54)
    it.skip('shouldAddIpcPublicationThenSubscriptionWithSessionId', () => {});
    it.skip('shouldAddIpcSubscriptionThenPublicationWithSessionId', () => {});
    it.skip('shouldNotAddIpcPublicationThenSubscriptionWithDifferentSessionId', () => {});
    it.skip('shouldNotAddIpcSubscriptionThenPublicationWithDifferentSessionId', () => {});

    // Spy subscriptions are not ported (spec section 3, D54)
    it.skip('shouldAddNetworkPublicationThenSingleSpyWithSameSessionId', () => {});
    it.skip('shouldNotAddNetworkPublicationThenSingleSpyWithDifferentSessionId', () => {});
    it.skip('shouldAddSingleSpyThenNetworkPublicationWithSameSessionId', () => {});
    it.skip('shouldNotAddSingleSpyThenNetworkPublicationWithDifferentSessionId', () => {});

    it('shouldUseExistingChannelEndpointOnAddPublicationWithSameTagIdAndSameStreamId', () => {
        const id1 = driverProxy.addPublication(CHANNEL_4000_TAG_ID_1, STREAM_ID_1);
        const id2 = driverProxy.addPublication(CHANNEL_TAG_ID_1, STREAM_ID_1);

        doWorkUntilComplete();
        verifyNever(mockErrorHandler.onError, expect.anything());

        verify(senderProxy.registerSendChannelEndpoint, expect.anything());
        verify(senderProxy.newNetworkPublication, expect.anything());

        driverProxy.removePublication(id1, false);
        driverProxy.removePublication(id2, false);

        doWorkUntil(
            () => PUBLICATION_LINGER_TIMEOUT_NS * 2 + CLIENT_LIVENESS_TIMEOUT_NS * 2 - nanoClock.nanoTime() <= 0,
        );

        verify(senderProxy.closeSendChannelEndpoint, expect.anything());
    });

    it('shouldUseExistingChannelEndpointOnAddPublicationWithSameTagIdDifferentStreamId', () => {
        const id1 = driverProxy.addPublication(CHANNEL_4000_TAG_ID_1, STREAM_ID_1);
        const id2 = driverProxy.addPublication(CHANNEL_TAG_ID_1, STREAM_ID_2);

        doWorkUntilComplete();
        verifyNever(mockErrorHandler.onError, expect.anything());

        verify(senderProxy.registerSendChannelEndpoint, expect.anything());
        verifyTimes(2, senderProxy.newNetworkPublication, expect.anything());

        driverProxy.removePublication(id1, false);
        driverProxy.removePublication(id2, false);

        doWorkUntil(
            () => PUBLICATION_LINGER_TIMEOUT_NS * 2 + CLIENT_LIVENESS_TIMEOUT_NS * 2 - nanoClock.nanoTime() <= 0,
        );

        verify(senderProxy.closeSendChannelEndpoint, expect.anything());
    });

    it('shouldUseExistingChannelEndpointOnAddSubscriptionWithSameTagId', () => {
        const id1 = driverProxy.addSubscription(CHANNEL_4000_TAG_ID_1, STREAM_ID_1);
        const id2 = driverProxy.addSubscription(CHANNEL_TAG_ID_1, STREAM_ID_1);

        doWorkUntilComplete();
        verifyNever(mockErrorHandler.onError, expect.anything());

        verify(receiverProxy.registerReceiveChannelEndpoint, expect.anything());

        driverProxy.removeSubscription(id1);
        driverProxy.removeSubscription(id2);

        doWorkUntilComplete();

        verify(receiverProxy.closeReceiveChannelEndpoint, expect.anything());
    });

    it('shouldUseUniqueChannelEndpointOnAddSubscriptionWithNoDistinguishingCharacteristics', () => {
        const id1 = driverProxy.addSubscription(CHANNEL_SUB_CONTROL_MODE_MANUAL, STREAM_ID_1);
        const id2 = driverProxy.addSubscription(CHANNEL_SUB_CONTROL_MODE_MANUAL, STREAM_ID_1);

        doWorkUntilComplete();

        verifyTimes(2, receiverProxy.registerReceiveChannelEndpoint, expect.anything());

        driverProxy.removeSubscription(id1);
        driverProxy.removeSubscription(id2);

        doWorkUntilComplete();

        verifyTimes(2, receiverProxy.closeReceiveChannelEndpoint, expect.anything());

        verifyNever(mockErrorHandler.onError, expect.anything());
    });

    // Spy subscriptions are not ported (spec section 3, D54)
    it.skip('shouldBeAbleToAddNetworkPublicationThenSingleSpyWithTag', () => {});
    it.skip('shouldBeAbleToAddSingleSpyThenNetworkPublicationWithTag', () => {});

    it('shouldIncrementCounterOnConductorThresholdExceeded', () => {
        const maxCycleTime = spySystemCounters.get(CONDUCTOR_MAX_CYCLE_TIME);
        const thresholdExceeded = spySystemCounters.get(CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED);

        doWorkUntilComplete();
        nanoClock.advance(MILLISECONDS.toNanos(750));
        doWorkUntilComplete();
        nanoClock.advance(MILLISECONDS.toNanos(1000));
        doWorkUntilComplete();
        nanoClock.advance(MILLISECONDS.toNanos(500));
        doWorkUntilComplete();
        nanoClock.advance(MILLISECONDS.toNanos(600));
        doWorkUntilComplete();
        nanoClock.advance(MILLISECONDS.toNanos(601));
        doWorkUntilComplete();

        expect(maxCycleTime.get()).toBe(SECONDS.toNanos(1));
        expect(thresholdExceeded.get()).toBe(3);
    });

    it('shouldThrowExceptionWhenSendDestinationHasControlModeResponseSet', () => {
        driverConductor.onAddSendDestination(13, 'aeron:udp?control-mode=response', 19);

        doWorkUntilComplete();

        verify(
            mockClientProxy.onError,
            19,
            INVALID_CHANNEL,
            startsWith(
                'ERROR - destinations may not specify ' + MDC_CONTROL_MODE_PARAM_NAME + '=' + CONTROL_MODE_RESPONSE,
            ),
        );
    });

    it('shouldThrowExceptionWhenSendDestinationHasResponseCorrelationIdSet', () => {
        driverConductor.onAddSendDestination(4, 'aeron:udp?response-correlation-id=1234', 8);

        doWorkUntilComplete();

        verify(
            mockClientProxy.onError,
            8,
            INVALID_CHANNEL,
            startsWith('ERROR - destinations must not contain the key: ' + RESPONSE_CORRELATION_ID_PARAM_NAME),
        );
    });

    it('shouldThrowExceptionWhenRcvDestinationHasControlModeResponseSet', () => {
        driverConductor.onAddRcvDestination(5, 'aeron:udp?control-mode=response', 7);
        doWorkUntilComplete();
        verify(
            mockClientProxy.onError,
            7,
            INVALID_CHANNEL,
            startsWith(
                'ERROR - destinations may not specify ' + MDC_CONTROL_MODE_PARAM_NAME + '=' + CONTROL_MODE_RESPONSE,
            ),
        );
    });

    it('shouldThrowExceptionWhenRcvDestinationHasResponseCorrelationIdSet', () => {
        driverConductor.onAddRcvDestination(42, 'aeron:udp?endpoint=localhost:8080|response-correlation-id=1234', 1);
        doWorkUntilComplete();
        verify(
            mockClientProxy.onError,
            1,
            INVALID_CHANNEL,
            startsWith('ERROR - destinations must not contain the key: response-correlation-id'),
        );
    });

    // Java: the conductor calls cncByteBuffer.force() after consumerHeartbeatTime(NULL_VALUE). The CnC is a
    // SharedArrayBuffer with no file to force (spec D4, D56): only the first half of the order is checked.
    it('onCloseShouldCallForceOnTheCncByteBuffer', () => {
        const conductor = new DriverConductor(ctx.clone().cncByteBuffer(new SharedArrayBuffer(1024)));
        conductor.onStart();

        conductor.onClose();

        verify(toDriverCommands.consumerHeartbeatTime, Aeron.NULL_VALUE);
    });

    it.each([ERRORED, INITIALIZING, CLOSING])(
        'shouldSkipControlAddressReResolutionIfReceiveChannelEndpointIsNotActive %s',
        (endpointStatus) => {
            const endpoint = mock(ReceiveChannelEndpoint).mock;
            m(endpoint.status).mockReturnValue(endpointStatus);
            const udpChannel = mock(UdpChannel).mock;
            const address = InetSocketAddress.createUnresolved('some', 5555);

            driverConductor.onReResolveControl('$^#&*^$*$#^', udpChannel, endpoint, address);

            doWork();
            doWork();

            verifyNever(mockErrorHandler.onError, expect.anything());
        },
    );

    it.each([ERRORED, INITIALIZING, CLOSING])(
        'shouldNotNotifyReceiverOfControlAddressChangesIfReceiveChannelEndpointIsNotActiveWhenComplete %s',
        (finalEndpointStatus) => {
            const endpoint = mock(ReceiveChannelEndpoint).mock;
            m(endpoint.status).mockReturnValueOnce(ACTIVE).mockReturnValue(finalEndpointStatus);
            const udpChannel = mock(UdpChannel).mock;
            const address = InetSocketAddress.createUnresolved('some', 5555);

            driverConductor.onReResolveControl('127.0.0.1:5050', udpChannel, endpoint, address);

            doWork();
            doWork();

            verifyTimes(2, endpoint.status);
            verifyNever(mockErrorHandler.onError, expect.anything());
        },
    );

    it.each([ERRORED, INITIALIZING, ACTIVE, CLOSING])(
        'shouldLogControlAddressReResolutionErrorAlways %s',
        (finalEndpointStatus) => {
            const endpoint = mock(ReceiveChannelEndpoint).mock;
            m(endpoint.status).mockReturnValueOnce(ACTIVE).mockReturnValue(finalEndpointStatus);
            const udpChannel = mock(UdpChannel).mock;
            const address = InetSocketAddress.createUnresolved('some', 5555);
            const control = '$#^%*#(';

            driverConductor.onReResolveControl(control, udpChannel, endpoint, address);

            doWork();
            doWork();

            verify(endpoint.status);
            const onError = m(mockErrorHandler.onError);
            expect(onError).toHaveBeenCalledTimes(1);
            expect((onError.mock.calls[0]![0] as Error).message).toContain(control);
        },
    );

    it.each([ERRORED, INITIALIZING, CLOSING])(
        'shouldSkipEndpointAddressReResolutionIfSendChannelEndpointIsNotActive %s',
        (endpointStatus) => {
            const channelEndpoint = mock(SendChannelEndpoint).mock;
            m(channelEndpoint.status).mockReturnValue(endpointStatus);
            const address = InetSocketAddress.createUnresolved('some', 5555);

            driverConductor.onReResolveEndpoint('$^#&*^$*$#^', channelEndpoint, address);

            doWork();
            doWork();

            verifyNever(mockErrorHandler.onError, expect.anything());
        },
    );

    it.each([ERRORED, INITIALIZING, CLOSING])(
        'shouldNotNotifyReceiverOfEndpointAddressChangesIfSendChannelEndpointIsNotActiveWhenComplete %s',
        (finalEndpointStatus) => {
            const channelEndpoint = mock(SendChannelEndpoint).mock;
            m(channelEndpoint.status).mockReturnValueOnce(ACTIVE).mockReturnValue(finalEndpointStatus);
            const address = InetSocketAddress.createUnresolved('some', 5555);

            driverConductor.onReResolveEndpoint('127.0.0.1:5050', channelEndpoint, address);

            doWork();
            doWork();

            verifyTimes(2, channelEndpoint.status);
            verifyNever(mockErrorHandler.onError, expect.anything());
        },
    );

    it.each([ERRORED, INITIALIZING, ACTIVE, CLOSING])(
        'shouldLogEndpointAddressReResolutionErrorAlways %s',
        (finalEndpointStatus) => {
            const channelEndpoint = mock(SendChannelEndpoint).mock;
            m(channelEndpoint.status).mockReturnValueOnce(ACTIVE).mockReturnValue(finalEndpointStatus);
            const address = InetSocketAddress.createUnresolved('some', 5555);
            const endpoint = '$#^%*#(';

            driverConductor.onReResolveEndpoint(endpoint, channelEndpoint, address);

            doWork();
            doWork();

            verify(channelEndpoint.status);
            const onError = m(mockErrorHandler.onError);
            expect(onError).toHaveBeenCalledTimes(1);
            expect((onError.mock.calls[0]![0] as Error).message).toContain(endpoint);
        },
    );

    function feedbackContext(): MediaDriver.Context {
        return new MediaDriver.Context()
            .multicastFeedbackDelayGenerator(new OptimalMulticastDelayGenerator(10, 10))
            .unicastFeedbackDelayGenerator(new StaticDelayGenerator(10));
    }

    it('shouldInferFeedbackGeneratorBasedOnMulticastAddress', () => {
        const context = feedbackContext();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:24326');

        expect(DriverConductor.isMulticastSemantics(udpChannel, InferableBoolean.INFER, 0)).toBe(true);
        expect(DriverConductor.resolveDelayGenerator(context, udpChannel, true, true)).toBe(
            context.multicastFeedbackDelayGenerator(),
        );
    });

    it('shouldInferFeedbackGeneratorBasedOnUnicastAddress', () => {
        const context = feedbackContext();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=192.168.0.1:24326');

        expect(DriverConductor.isMulticastSemantics(udpChannel, InferableBoolean.INFER, 0)).toBe(false);
        expect(DriverConductor.resolveDelayGenerator(context, udpChannel, false, true)).toBe(
            context.unicastFeedbackDelayGenerator(),
        );
    });

    it('shouldFixMulticastFeedbackGeneratorBasedOnReceiverGroupConsideration', () => {
        const context = feedbackContext();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=192.168.0.1:24326');

        expect(DriverConductor.isMulticastSemantics(udpChannel, InferableBoolean.FORCE_TRUE, 0)).toBe(true);
        expect(DriverConductor.resolveDelayGenerator(context, udpChannel, true, true)).toBe(
            context.multicastFeedbackDelayGenerator(),
        );
    });

    it('shouldFixUnicastFeedbackGeneratorBasedOnReceiverGroupConsideration', () => {
        const context = feedbackContext();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=192.168.0.1:24326');

        expect(DriverConductor.isMulticastSemantics(udpChannel, InferableBoolean.FORCE_FALSE, 0)).toBe(false);
        expect(DriverConductor.resolveDelayGenerator(context, udpChannel, false, true)).toBe(
            context.unicastFeedbackDelayGenerator(),
        );
    });

    it('shouldInferFeedbackGeneratorBasedOnReceiverGroupFlag', () => {
        const context = feedbackContext();
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=192.168.0.1:24326');

        expect(
            DriverConductor.isMulticastSemantics(udpChannel, InferableBoolean.INFER, SetupFlyweight.GROUP_FLAG),
        ).toBe(true);
        expect(DriverConductor.resolveDelayGenerator(context, udpChannel, true, true)).toBe(
            context.multicastFeedbackDelayGenerator(),
        );
    });

    it('shouldCreateFeedbackGeneratorFromManualNakDelayConfiguration', () => {
        const context = feedbackContext().nakUnicastRetryDelayRatio(55);
        const udpChannel = UdpChannel.parse('aeron:udp?endpoint=192.168.0.1:24326|nak-delay=14ms');

        const feedbackDelayGenerator: FeedbackDelayGenerator = DriverConductor.resolveDelayGenerator(
            context,
            udpChannel,
            false,
            true,
        );
        expect(feedbackDelayGenerator).not.toBeNull();
        expect(feedbackDelayGenerator).toBeInstanceOf(StaticDelayGenerator);
        expect(feedbackDelayGenerator.generateDelayNs()).toBe(MILLISECONDS.toNanos(14));
        expect(feedbackDelayGenerator.retryDelayNs()).toBe(MILLISECONDS.toNanos(14 * 55));
    });

    it.each([
        'aeron:udp?endpoint=192.168.0.1:24326',
        'aeron:udp?endpoint=224.20.30.39:5555',
        'aeron:udp?endpoint=192.168.0.1:10000|nak-delay=14ms',
    ])('shouldUseZeroDelayFeedbackGeneratorIfSubscriptionIsUnreliable %s', (uri) => {
        const context = new MediaDriver.Context()
            .multicastFeedbackDelayGenerator(new OptimalMulticastDelayGenerator(123, 10))
            .unicastFeedbackDelayGenerator(new StaticDelayGenerator(321, 456));
        const udpChannel = UdpChannel.parse(uri);
        const isMulticastSemantics = DriverConductor.isMulticastSemantics(udpChannel, InferableBoolean.INFER, 0);

        const feedbackDelayGenerator = DriverConductor.resolveDelayGenerator(
            context,
            udpChannel,
            isMulticastSemantics,
            false,
        );

        expect(feedbackDelayGenerator).toBe(StaticDelayGenerator.ZERO_DELAY_GENERATOR);
        expect(feedbackDelayGenerator.generateDelayNs()).toBe(0);
        expect(feedbackDelayGenerator.retryDelayNs()).toBe(0);
    });

    const CLOSING_MESSAGE = 'WARN - SendChannelEndpoint found in CLOSING state, please retry';

    it('onAddSendDestinationShouldReturnResourceTemporaryUnavailableIfSendEndpointIsClosing0', () => {
        const correlationId = 3;
        const clientId = 1;
        const streamId = 444;
        const channel = 'aeron:udp?control=localhost:5555|control-mode=manual';
        driverConductor.onAddNetworkPublication(channel, streamId, correlationId, clientId, false);

        doWorkUntilComplete();

        const publication = newPublication();
        publication.channelEndpoint().indicateClosing();

        const destinationCorrelationId = 81;
        driverConductor.onAddSendDestination(
            publication.registrationId(),
            'aeron:udp?endpoint=localhost:8888',
            destinationCorrelationId,
        );

        doWorkUntilComplete();

        verifyNever(mockErrorHandler.onError, expect.anything());
        verify(
            mockClientProxy.onError,
            destinationCorrelationId,
            ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
            CLOSING_MESSAGE,
        );
    });

    it('onAddSendDestinationShouldReturnResourceTemporaryUnavailableIfSendEndpointIsClosing1', () => {
        const correlationId = 3;
        const clientId = 1;
        const streamId = 444;
        const channel = 'aeron:udp?control=localhost:5555|control-mode=manual';
        driverConductor.onAddNetworkPublication(channel, streamId, correlationId, clientId, false);

        doWorkUntilComplete();

        const publication = newPublication();

        const destinationCorrelationId = 99;
        driverConductor.onAddSendDestination(
            publication.registrationId(),
            'aeron:udp?endpoint=localhost:8888',
            destinationCorrelationId,
        );

        doWork();

        publication.channelEndpoint().indicateClosing(); // after resolution completed
        doWorkUntilComplete();

        verifyNever(mockErrorHandler.onError, expect.anything());
        verify(
            mockClientProxy.onError,
            destinationCorrelationId,
            ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
            CLOSING_MESSAGE,
        );
    });

    it('onRemoveSendDestinationShouldReturnResourceTemporaryUnavailableIfSendEndpointIsClosing0', () => {
        const correlationId = 3;
        const clientId = 1;
        const streamId = 444;
        const channel = 'aeron:udp?control=localhost:5555|control-mode=manual';
        driverConductor.onAddNetworkPublication(channel, streamId, correlationId, clientId, false);

        doWorkUntilComplete();

        const publication = newPublication();
        publication.channelEndpoint().indicateClosing();

        const destinationCorrelationId = 117;
        driverConductor.onRemoveSendDestination(
            publication.registrationId(),
            'aeron:udp?endpoint=localhost:8888',
            destinationCorrelationId,
        );

        doWorkUntilComplete();

        verifyNever(mockErrorHandler.onError, expect.anything());
        verify(
            mockClientProxy.onError,
            destinationCorrelationId,
            ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
            CLOSING_MESSAGE,
        );
    });

    it('onRemoveSendDestinationShouldReturnResourceTemporaryUnavailableIfSendEndpointIsClosing1', () => {
        const correlationId = 3;
        const clientId = 1;
        const streamId = 444;
        const channel = 'aeron:udp?control=localhost:5555|control-mode=manual';
        driverConductor.onAddNetworkPublication(channel, streamId, correlationId, clientId, false);

        doWorkUntilComplete();

        const publication = newPublication();

        const destinationCorrelationId = 117;
        driverConductor.onRemoveSendDestination(
            publication.registrationId(),
            'aeron:udp?endpoint=localhost:8888',
            destinationCorrelationId,
        );

        doWork();

        publication.channelEndpoint().indicateClosing(); // after resolution completed
        doWorkUntilComplete();

        verifyNever(mockErrorHandler.onError, expect.anything());
        verify(
            mockClientProxy.onError,
            destinationCorrelationId,
            ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
            CLOSING_MESSAGE,
        );
    });

    it('onRemoveSendDestinationShouldReturnResourceTemporaryUnavailableIfSendEndpointIsClosing2', () => {
        const correlationId = 3;
        const clientId = 1;
        const streamId = 444;
        const channel = 'aeron:udp?control=localhost:5555|control-mode=manual';
        driverConductor.onAddNetworkPublication(channel, streamId, correlationId, clientId, false);

        doWorkUntilComplete();

        const publication = newPublication();
        publication.channelEndpoint().indicateClosing();

        const destinationCorrelationId = 199999999;
        const destinationRegistrationId = 555;
        const exception = assertThrowsExactly(ControlProtocolException, () =>
            driverConductor.onRemoveSendDestination(
                publication.registrationId(),
                destinationRegistrationId,
                destinationCorrelationId,
            ),
        );
        expect(exception.errorCode()).toBe(ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE);
    });

    it('onAddNetworkPublicationShouldReturnResourceTemporaryUnavailableIfSendEndpointIsClosing0', () => {
        const correlationId = 3;
        const clientId = 1;
        const streamId = 444;
        const channel = 'aeron:udp?endpoint=localhost:7777';
        driverConductor.onAddNetworkPublication(channel, streamId, correlationId, clientId, false);

        doWorkUntilComplete();

        const publication = newPublication();
        publication.channelEndpoint().indicateClosing();

        const secondCorrelationId = 33333;
        driverConductor.onAddNetworkPublication(channel, streamId, secondCorrelationId, clientId, false);

        doWorkUntilComplete();

        verifyNever(mockErrorHandler.onError, expect.anything());
        verify(
            mockClientProxy.onError,
            secondCorrelationId,
            ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
            CLOSING_MESSAGE,
        );
    });

    it('onAddNetworkPublicationShouldReturnResourceTemporaryUnavailableIfSendEndpointIsClosing1', () => {
        const correlationId = -13;
        const clientId = 10;
        const streamId = 1000;
        const channel = 'aeron:udp?endpoint=localhost:5555';
        driverConductor.onAddNetworkPublication(channel, streamId, correlationId, clientId, true);

        doWorkUntilComplete();

        const publication = newPublication();

        const secondCorrelationId = 51;
        driverConductor.onAddNetworkPublication(channel, streamId, secondCorrelationId, clientId, true);

        // needs to cycles to get past log buffer creation in order to verify second state check
        doWork();
        doWork();

        publication.channelEndpoint().indicateClosing();
        doWorkUntilComplete();

        verifyNever(mockErrorHandler.onError, expect.anything());
        verify(
            mockClientProxy.onError,
            secondCorrelationId,
            ErrorCode.RESOURCE_TEMPORARILY_UNAVAILABLE,
            CLOSING_MESSAGE,
        );
    });

    /** The arguments of `onCreatePublicationImage` of the `createPublicationImage...` tests. */
    function imageRequest(mtuLength: number) {
        return {
            sessionId: 17,
            streamId: 100,
            initialTermId: 0,
            activeTermId: 4,
            termOffset: 128,
            termBufferLength: 1024 * 1024,
            mtuLength,
            transportIndex: 6,
            flags: 0,
        };
    }

    function mockEndpoint(status: number, channel: string): ReceiveChannelEndpoint {
        const endpoint = mock(ReceiveChannelEndpoint).mock;
        m(endpoint.status).mockReturnValue(status);
        const udpChannel = mock(UdpChannel).mock;
        m(udpChannel.channelUri).mockReturnValue(ChannelUri.parse(channel));
        m(endpoint.subscriptionUdpChannel).mockReturnValue(udpChannel);
        return endpoint;
    }

    function requestImage(request: ReturnType<typeof imageRequest>, endpoint: ReceiveChannelEndpoint): void {
        driverConductor.onCreatePublicationImage(
            request.sessionId,
            request.streamId,
            request.initialTermId,
            request.activeTermId,
            request.termOffset,
            request.termBufferLength,
            request.mtuLength,
            request.transportIndex,
            request.flags,
            mockAddress(),
            mockAddress(),
            endpoint,
        );
    }

    it('createPublicationImageShouldRemoveInProgressStreamInterestMarkerIfThereAreNoSubscribers', () => {
        const request = imageRequest(8 * 1024);
        const endpoint = mockEndpoint(ACTIVE, 'aeron:udp?endpoint=localhost:5555');
        const receiverSpies = new Map(Object.entries(receiverProxy).filter(([, v]) => typeof v === 'function')) as Map<
            string,
            AnyMock
        >;

        requestImage(request, endpoint);
        doWorkUntilComplete();

        verify(receiverProxy.removeInitInProgress, endpoint, request.sessionId, request.streamId);
        verify(nativeResourceAgentProxy.nativeResourceAgent, nativeResourceAgent);
        expectOnlyCalls(receiverSpies, { removeInitInProgress: 1 });
        expectOnlyCalls(nativeResourceAgentProxySpies, { nativeResourceAgent: 1 });
    });

    it('createPublicationImageShouldRemoveInProgressStreamInterestMarkerIfEndpointIsNotActive', () => {
        const request = imageRequest(8 * 1024);
        const channel = 'aeron:udp?endpoint=localhost:5555';
        const endpoint = mockEndpoint(CLOSING, channel);
        const receiverSpies = new Map(Object.entries(receiverProxy).filter(([, v]) => typeof v === 'function')) as Map<
            string,
            AnyMock
        >;
        const endpointSpies = new Map(Object.entries(endpoint).filter(([, v]) => typeof v === 'function')) as Map<
            string,
            AnyMock
        >;

        driverProxy.addSubscription(channel, request.streamId);
        doWorkUntilComplete();

        requestImage(request, endpoint);
        doWorkUntilComplete();

        verify(receiverProxy.removeInitInProgress, endpoint, request.sessionId, request.streamId);
        verify(receiverProxy.isApplyingBackpressure);
        verify(receiverProxy.receiver);
        verify(receiverProxy.registerReceiveChannelEndpoint, expect.any(ReceiveChannelEndpoint));
        verify(receiverProxy.addSubscription, expect.any(ReceiveChannelEndpoint), request.streamId);
        verify(endpoint.subscriptionUdpChannel);
        verify(endpoint.status);
        verify(nativeResourceAgentProxy.nativeResourceAgent, nativeResourceAgent);
        verify(nativeResourceAgentProxy.isApplyingBackpressure);
        verify(nativeResourceAgentProxy.parseChannel, expect.any(String), expect.any(Boolean));
        verify(offerOf(), expect.anything());
        expectOnlyCalls(receiverSpies, {
            removeInitInProgress: 1,
            isApplyingBackpressure: 1,
            receiver: 1,
            registerReceiveChannelEndpoint: 1,
            addSubscription: 1,
            closeReceiveChannelEndpoint: 0,
        });
        expectOnlyCalls(endpointSpies, { subscriptionUdpChannel: 1, status: 1 });
        expectOnlyCalls(nativeResourceAgentProxySpies, {
            nativeResourceAgent: 1,
            isApplyingBackpressure: 1,
            parseChannel: 1,
            offer: 1,
        });
        // the receive endpoint the subscription made is closed by the test
        receiveChannelEndpoint = m(receiverProxy.registerReceiveChannelEndpoint).mock
            .calls[0]![0] as ReceiveChannelEndpoint;
    });

    it('createPublicationImageShouldRemoveInProgressStreamInterestMarkerOnError', () => {
        const request = imageRequest(DataHeaderFlyweight.HEADER_LENGTH - 1);
        const endpoint = mockEndpoint(ACTIVE, 'aeron:udp?endpoint=localhost:5555');
        const receiverSpies = new Map(Object.entries(receiverProxy).filter(([, v]) => typeof v === 'function')) as Map<
            string,
            AnyMock
        >;

        requestImage(request, endpoint);
        doWorkUntilComplete();

        verify(receiverProxy.removeInitInProgress, endpoint, request.sessionId, request.streamId);
        const onError = m(mockErrorHandler.onError);
        expect(onError).toHaveBeenCalledTimes(1);
        const error = onError.mock.calls[0]![0] as Error;
        expect(error).toBeInstanceOf(ConfigurationException);
        expect(error.message).toBe(
            'ERROR - mtuLength=' + request.mtuLength + ' <= HEADER_LENGTH=' + DataHeaderFlyweight.HEADER_LENGTH,
        );
        verify(nativeResourceAgentProxy.nativeResourceAgent, nativeResourceAgent);
        expectOnlyCalls(receiverSpies, { removeInitInProgress: 1 });
        expect(m(mockErrorCounter.increment)).not.toHaveBeenCalled();
        expectOnlyCalls(nativeResourceAgentProxySpies, { nativeResourceAgent: 1 });
    });

    it('createPublicationImageShouldRemoveInProgressStreamInterestMarkerIfEndpointBecomesNonActive', () => {
        const sessionId = 42;
        const streamId = -666;
        const channel = 'aeron:udp?endpoint=localhost:4444';
        const receiverSpies = new Map(Object.entries(receiverProxy).filter(([, v]) => typeof v === 'function')) as Map<
            string,
            AnyMock
        >;

        driverProxy.addSubscription(channel, streamId);
        doWorkUntilComplete();

        const endpoint = registeredReceiveEndpoint();

        driverConductor.onCreatePublicationImage(
            sessionId,
            streamId,
            10,
            14,
            128,
            1024 * 1024,
            8 * 1024,
            6,
            0,
            mockAddress(),
            mockAddress(),
            endpoint,
        );
        doWork();

        endpoint.indicateClosing();
        doWorkUntilComplete();

        verify(receiverProxy.removeInitInProgress, endpoint, sessionId, streamId);
        verify(receiverProxy.isApplyingBackpressure);
        verify(receiverProxy.receiver);
        verify(receiverProxy.addSubscription, endpoint, streamId);
        verify(nativeResourceAgentProxy.nativeResourceAgent, nativeResourceAgent);
        verify(nativeResourceAgentProxy.isApplyingBackpressure);
        verify(nativeResourceAgentProxy.parseChannel, expect.any(String), expect.any(Boolean));
        verify(nativeResourceAgentProxy.newImageLog, expect.any(Number), expect.any(Number), expect.any(Boolean));
        verify(nativeResourceAgentProxy.freeLogBuffer, expect.anything());
        verifyTimes(3, offerOf(), expect.anything());
        expectOnlyCalls(receiverSpies, {
            removeInitInProgress: 1,
            isApplyingBackpressure: 1,
            receiver: 1,
            registerReceiveChannelEndpoint: 1,
            addSubscription: 1,
        });
        expectOnlyCalls(nativeResourceAgentProxySpies, {
            nativeResourceAgent: 1,
            isApplyingBackpressure: 1,
            parseChannel: 1,
            newImageLog: 1,
            freeLogBuffer: 1,
            offer: 3,
        });
    });
});
