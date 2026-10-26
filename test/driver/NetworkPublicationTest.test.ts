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
// Port of io/aeron/driver/NetworkPublicationTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { BufferUtil } from '../../src/agrona/BufferUtil.js';
import { CachedNanoClock } from '../../src/agrona/concurrent/CachedNanoClock.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import { CountersManager } from '../../src/agrona/concurrent/status/CountersManager.js';
import type { Position } from '../../src/agrona/concurrent/status/Position.js';
import { StandardCharsets } from '../../src/agrona/jdkLang.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { StatusMessageFlyweight } from '../../src/client/protocol/StatusMessageFlyweight.js';
import type { FlowControl } from '../../src/driver/FlowControl.js';
import { InetSocketAddress } from '../../src/driver/jdkNet.js';
import { MediaDriver } from '../../src/driver/MediaDriver.js';
import { NetworkPublication } from '../../src/driver/NetworkPublication.js';
import { NetworkPublicationThreadLocals } from '../../src/driver/NetworkPublicationThreadLocals.js';
import { PublicationParams } from '../../src/driver/PublicationParams.js';
import { RetransmitHandler } from '../../src/driver/RetransmitHandler.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { SendChannelEndpoint } from '../../src/driver/media/SendChannelEndpoint.js';
import { SystemCounters } from '../../src/driver/status/SystemCounters.js';
import { AtomicLongPosition } from '../support/AtomicLongPosition.js';
import { type Fake, mock } from '../support/Mockito.js';
import { mockConductorProxy, whenReturn } from '../support/PublicationFakes.js';

const {
    TERM_MIN_LENGTH,
    PARTITION_COUNT,
    LOG_META_DATA_LENGTH,
    termLength,
    mtuLength,
    initialTermId,
    initialiseTailWithTermId,
    isConnected,
} = LogBufferDescriptor;
const { CACHE_LINE_LENGTH } = BitUtil;

const REGISTRATION_ID = 42;
const PUBLICATION_WINDOW_LENGTH = TERM_MIN_LENGTH / 2;
const SESSION_ID = 8;
const STREAM_ID = 101;
const INITIAL_TERM_ID = 99;
const NETWORK_PUBLICATION_THREAD_LOCALS = new NetworkPublicationThreadLocals();
const TERM_BUFFERS: UnsafeBuffer[] = [];

for (let i = 0; i < PARTITION_COUNT; i++) {
    TERM_BUFFERS[i] = new UnsafeBuffer(BufferUtil.allocateDirectAligned(TERM_MIN_LENGTH, CACHE_LINE_LENGTH));
}

/** `mock(FlowControl.class)`: every member answers what a Mockito mock answers, `hasRequiredReceivers` is stubbed. */
function mockFlowControl(): Fake<FlowControl> {
    return {
        onStatusMessage: vi.fn<FlowControl['onStatusMessage']>(() => 0),
        onTriggerSendSetup: vi.fn<FlowControl['onTriggerSendSetup']>(),
        onSetup: vi.fn<FlowControl['onSetup']>(() => 0),
        onError: vi.fn<FlowControl['onError']>(),
        initialize: vi.fn<FlowControl['initialize']>(),
        onIdle: vi.fn<FlowControl['onIdle']>(() => 0),
        hasRequiredReceivers: vi.fn<FlowControl['hasRequiredReceivers']>(() => false),
        maxRetransmissionLength: vi.fn<FlowControl['maxRetransmissionLength']>(() => 0),
        close: vi.fn<FlowControl['close']>(),
    };
}

describe('NetworkPublicationTest', () => {
    const countersManager = new CountersManager(
        new UnsafeBuffer(BufferUtil.allocateDirectAligned(TERM_MIN_LENGTH, CACHE_LINE_LENGTH)),
        new UnsafeBuffer(BufferUtil.allocateDirectAligned(8192, CACHE_LINE_LENGTH)),
        StandardCharsets.US_ASCII,
    );
    const ctx = new MediaDriver.Context()
        .senderCachedNanoClock(new CachedNanoClock())
        .systemCounters(new SystemCounters(countersManager));
    const params = new PublicationParams();
    const sendChannelEndpoint = mock(SendChannelEndpoint).mock;
    const rawLog: Fake<RawLog> = {
        termLength: vi.fn<RawLog['termLength']>(),
        termBuffers: vi.fn<RawLog['termBuffers']>(),
        metaData: vi.fn<RawLog['metaData']>(),
        fileName: vi.fn<RawLog['fileName']>(),
        free: vi.fn<RawLog['free']>(),
        close: vi.fn<RawLog['close']>(),
    };
    const publisherPos: Position = new AtomicLongPosition();
    const publisherLimit: Position = new AtomicLongPosition();
    const senderPosition: Position = new AtomicLongPosition();
    const senderLimit: Position = new AtomicLongPosition();
    const senderBpe: AtomicCounter = countersManager.newCounter('snd-bpe');
    const senderNaksReceived: AtomicCounter = countersManager.newCounter('snd-naks-received');
    const flowControl = mockFlowControl();
    const retransmitHandler = mock(RetransmitHandler).mock;
    const statusMessageFlyweight = mock(StatusMessageFlyweight).mock;
    const inetSocketAddress = new InetSocketAddress('127.0.0.1', 40123);
    const driverConductorProxy = mockConductorProxy();

    beforeEach(() => {
        const metadataBuffer = new UnsafeBuffer(new Uint8Array(LOG_META_DATA_LENGTH));
        termLength(metadataBuffer, TERM_MIN_LENGTH);
        mtuLength(metadataBuffer, 8192);
        initialTermId(metadataBuffer, INITIAL_TERM_ID);
        initialiseTailWithTermId(metadataBuffer, 0, INITIAL_TERM_ID);
        for (let i = 1; i < PARTITION_COUNT; i++) {
            const expectedTermId = INITIAL_TERM_ID + i - PARTITION_COUNT;
            initialiseTailWithTermId(metadataBuffer, i, expectedTermId);
        }
        isConnected(metadataBuffer, true);

        rawLog.metaData.mockReturnValue(metadataBuffer);
        rawLog.termBuffers.mockReturnValue(TERM_BUFFERS);
        rawLog.termLength.mockReturnValue(TERM_MIN_LENGTH);

        for (const termBuffer of TERM_BUFFERS) {
            termBuffer.setMemory(0, termBuffer.capacity(), 0xff);
        }

        flowControl.hasRequiredReceivers.mockReturnValue(true);
        // Mockito answers 0 for the int and long members of a mock that is not stubbed
        whenReturn(statusMessageFlyweight.flags, 0);
        whenReturn(statusMessageFlyweight.receiverIdHigh, 0);
        whenReturn(statusMessageFlyweight.receiverIdLow, 0);
    });

    function newPublication(): NetworkPublication {
        return new NetworkPublication(
            REGISTRATION_ID,
            ctx,
            params,
            sendChannelEndpoint,
            rawLog,
            PUBLICATION_WINDOW_LENGTH,
            publisherPos,
            publisherLimit,
            senderPosition,
            senderLimit,
            senderBpe,
            senderNaksReceived,
            SESSION_ID,
            STREAM_ID,
            INITIAL_TERM_ID,
            flowControl,
            retransmitHandler,
            NETWORK_PUBLICATION_THREAD_LOCALS,
            true,
        );
    }

    it.each([0, 512, 7281770624])('shouldCleanLogBufferOneTermBehindMinSubPosition %s', (initialPosition) => {
        publisherPos.set(initialPosition);
        publisherLimit.set(initialPosition);
        senderPosition.set(initialPosition);
        senderLimit.set(initialPosition);

        const publication = newPublication();
        expect(publication.cleanPosition).toBe(initialPosition);
        const initialTermBasePosition = initialPosition - (initialPosition % TERM_MIN_LENGTH);

        // setup initial connection
        publication.onStatusMessage(statusMessageFlyweight, inetSocketAddress, driverConductorProxy);

        // first iteration: only pub-lmt is updated
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition);

        // consumer position didn't change -> no op
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition);

        // consumer position moved -> update limit
        senderPosition.set(initialPosition + 3072);
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + 3072 + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition);

        // consumer position moved -> update limit
        senderPosition.set(initialPosition + TERM_MIN_LENGTH / 8);
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + TERM_MIN_LENGTH / 8 + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition);

        // consumer position moved by an entire term -> nothing to clean yet
        senderPosition.set(initialPosition + TERM_MIN_LENGTH);
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + TERM_MIN_LENGTH + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition);

        // consumer position moved again => clean bytes within a first buffer
        senderPosition.set(initialPosition + TERM_MIN_LENGTH + 128);
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + TERM_MIN_LENGTH + 128 + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition + 128);

        // consumer position moved again => clean the entire first buffer
        senderPosition.set(initialPosition + 2 * TERM_MIN_LENGTH + 192);
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + 2 * TERM_MIN_LENGTH + 192 + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialTermBasePosition + TERM_MIN_LENGTH);

        // buffer clean trails snd-pos updates by one term
        senderPosition.set(initialPosition + 2 * TERM_MIN_LENGTH + 4096);
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + 2 * TERM_MIN_LENGTH + 4096 + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition + TERM_MIN_LENGTH + 4096);
    });

    it('pubLimitShouldNotCrossToThePreviousTermIfAnEntireTermIsDirty', () => {
        const initialPosition = TERM_MIN_LENGTH - 1440;
        publisherPos.set(initialPosition);
        publisherLimit.set(initialPosition);
        senderPosition.set(initialPosition);
        senderLimit.set(initialPosition);

        const publication = newPublication();
        expect(publication.cleanPosition).toBe(initialPosition);

        // setup initial connection
        publication.onStatusMessage(statusMessageFlyweight, inetSocketAddress, driverConductorProxy);

        // no buffer cleaning at first
        senderPosition.set(initialPosition + TERM_MIN_LENGTH - 128);
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + TERM_MIN_LENGTH - 128 + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition);

        // pub-lmt cannot be changed as clean position is at the start of a dirty term
        senderPosition.set(initialPosition + 2 * TERM_MIN_LENGTH);
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(initialPosition + TERM_MIN_LENGTH - 128 + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(TERM_MIN_LENGTH);

        // pub-lmt is allowed to update after clean position moves from the start of a dirty buffer
        publication.updatePublisherPositionAndLimit();
        expect(publisherLimit.get()).toBe(senderPosition.get() + PUBLICATION_WINDOW_LENGTH);
        expect(publication.cleanPosition).toBe(initialPosition + TERM_MIN_LENGTH);
    });

    it.each([0, TERM_MIN_LENGTH - PUBLICATION_WINDOW_LENGTH])(
        'pubLimitShouldNotCrossToTheDirtyTerm %s',
        (initialPosition) => {
            publisherPos.set(initialPosition);
            publisherLimit.set(initialPosition);
            senderPosition.set(initialPosition);
            senderLimit.set(initialPosition);

            const publication = newPublication();
            expect(publication.cleanPosition).toBe(initialPosition);

            // setup initial connection
            publication.onStatusMessage(statusMessageFlyweight, inetSocketAddress, driverConductorProxy);

            // initial position
            senderPosition.set(initialPosition + 256);
            publication.updatePublisherPositionAndLimit();
            expect(publisherLimit.get()).toBe(initialPosition + 256 + PUBLICATION_WINDOW_LENGTH);
            expect(publication.cleanPosition).toBe(initialPosition);

            // new pub-lmt intersects with the clean position
            senderPosition.set(initialPosition + 2 * TERM_MIN_LENGTH + PUBLICATION_WINDOW_LENGTH);
            publication.updatePublisherPositionAndLimit();
            expect(publisherLimit.get()).toBe(initialPosition + 256 + PUBLICATION_WINDOW_LENGTH);
            expect(publication.cleanPosition).toBe(TERM_MIN_LENGTH);

            // after cleanup pub-lmt can move again
            publication.updatePublisherPositionAndLimit();
            expect(publisherLimit.get()).toBe(initialPosition + 2 * TERM_MIN_LENGTH + 2 * PUBLICATION_WINDOW_LENGTH);
            expect(publication.cleanPosition).toBe(initialPosition + TERM_MIN_LENGTH + PUBLICATION_WINDOW_LENGTH);
        },
    );
});
