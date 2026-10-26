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
// Port of io/aeron/ImageTest.java @ 1.53.3
import { isDeepStrictEqual } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { Integer, Long, RuntimeException } from '../../src/agrona/jdk.js';
import { Image } from '../../src/client/Image.js';
import { ControlledFragmentHandler } from '../../src/client/logbuffer/ControlledFragmentHandler.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { Header } from '../../src/client/logbuffer/Header.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermRebuilder } from '../../src/client/logbuffer/TermRebuilder.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import type { Subscription } from '../../src/client/Subscription.js';
import { Subscription as SubscriptionClass } from '../../src/client/Subscription.js';
import { newFakeLogBuffers } from '../support/ClientFakes.js';
import { AtomicLongPosition } from '../support/AtomicLongPosition.js';
import { expectInOrder } from '../support/InOrder.js';
import { mock } from '../support/Mockito.js';

const { Action } = ControlledFragmentHandler;
const { LOG_META_DATA_LENGTH, PARTITION_COUNT, computePosition, indexByTerm } = LogBufferDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { align } = BitUtil;

const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const POSITION_BITS_TO_SHIFT = LogBufferDescriptor.positionBitsToShift(TERM_BUFFER_LENGTH);
const DATA = new Uint8Array(36);
for (let i = 0; i < DATA.length; i++) {
    DATA[i] = i;
}

const CORRELATION_ID = 0xc044e1a;
const SESSION_ID = 0x5e55101d;
const STREAM_ID = 0xc400e;
const SOURCE_IDENTITY = 'ipc';
const INITIAL_TERM_ID = 0xee81d;
const MESSAGE_LENGTH = HEADER_LENGTH + DATA.length;
const ALIGNED_FRAME_LENGTH = align(MESSAGE_LENGTH, FrameDescriptor.FRAME_ALIGNMENT);

type Args = readonly unknown[];

/** The index of the one call of the spy with these arguments (Mockito's `verify(mock).m(args)`, `times(1)`). */
function verifyOnce(spy: Mock<(...args: never[]) => unknown>, ...expected: Args): number {
    const matching: number[] = [];
    spy.mock.calls.forEach((call, index) => {
        const actual = call as Args;
        if (
            actual.length === expected.length &&
            expected.every((e, i) =>
                'function' === typeof (e as { asymmetricMatch?: unknown } | null)?.asymmetricMatch
                    ? (e as { asymmetricMatch(other: unknown): boolean }).asymmetricMatch(actual[i])
                    : isDeepStrictEqual(e, actual[i]),
            )
        ) {
            matching.push(index);
        }
    });
    expect(matching, 'calls matching ' + String(expected)).toHaveLength(1);
    return matching[0] as number;
}

describe('ImageTest', () => {
    let rcvBuffer: UnsafeBuffer;
    let dataHeader: DataHeaderFlyweight;
    let mockFragmentHandler: { onFragment: Mock<FragmentHandler['onFragment']> };
    let mockControlledFragmentHandler: { onFragment: Mock<ControlledFragmentHandler['onFragment']> };
    let position: AtomicLongPosition;
    let setRelease: Mock<(value: number) => void>;
    let get: Mock<() => number>;
    let getVolatile: Mock<() => number>;
    let logBuffers: ReturnType<typeof newFakeLogBuffers>;
    let errorHandler: { onError: Mock<ErrorHandler['onError']> };
    let subscription: Subscription;
    let rejectImage: Mock<Subscription['rejectImage']>;
    let termBuffers: UnsafeBuffer[];

    const anyHeader = expect.any(Header);
    const anyUnsafeBuffer = expect.any(UnsafeBuffer);

    beforeEach(() => {
        rcvBuffer = new UnsafeBuffer(new ArrayBuffer(ALIGNED_FRAME_LENGTH));
        dataHeader = new DataHeaderFlyweight();
        mockFragmentHandler = { onFragment: vi.fn() };
        mockControlledFragmentHandler = { onFragment: vi.fn() };
        // spy(new AtomicLongPosition()): the calls go through
        position = new AtomicLongPosition();
        setRelease = vi.spyOn(position, 'setRelease') as unknown as Mock<(value: number) => void>;
        get = vi.spyOn(position, 'get') as unknown as Mock<() => number>;
        getVolatile = vi.spyOn(position, 'getVolatile') as unknown as Mock<() => number>;
        errorHandler = { onError: vi.fn() };
        const mockSubscription = mock(SubscriptionClass);
        subscription = mockSubscription.mock;
        rejectImage = subscription.rejectImage as unknown as Mock<Subscription['rejectImage']>;
        termBuffers = new Array<UnsafeBuffer>(PARTITION_COUNT);

        dataHeader.wrap(rcvBuffer);

        for (let i = 0; i < PARTITION_COUNT; i++) {
            termBuffers[i] = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH));
        }

        const logMetaDataBuffer = new UnsafeBuffer(new ArrayBuffer(LOG_META_DATA_LENGTH));

        logBuffers = newFakeLogBuffers(termBuffers, TERM_BUFFER_LENGTH, logMetaDataBuffer);
    });

    function createImage(): Image {
        return new Image(subscription, SESSION_ID, position, logBuffers, errorHandler, SOURCE_IDENTITY, CORRELATION_ID);
    }

    function insertDataFrame(activeTermId: number, termOffset: number): void {
        dataHeader
            .termId(INITIAL_TERM_ID)
            .streamId(STREAM_ID)
            .sessionId(SESSION_ID)
            .termOffset(termOffset)
            .frameLength(DATA.length + HEADER_LENGTH)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .version(HeaderFlyweight.CURRENT_VERSION);

        rcvBuffer.putBytes(dataHeader.dataOffset(), DATA);

        const activeIndex = indexByTerm(INITIAL_TERM_ID, activeTermId);
        TermRebuilder.insert(termBuffers[activeIndex]!, termOffset, rcvBuffer, ALIGNED_FRAME_LENGTH);
    }

    function insertPaddingFrame(activeTermId: number, termOffset: number): void {
        dataHeader
            .termId(INITIAL_TERM_ID)
            .streamId(STREAM_ID)
            .sessionId(SESSION_ID)
            .frameLength(TERM_BUFFER_LENGTH - termOffset)
            .headerType(HeaderFlyweight.HDR_TYPE_PAD)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .version(HeaderFlyweight.CURRENT_VERSION);

        const activeIndex = indexByTerm(INITIAL_TERM_ID, activeTermId);
        TermRebuilder.insert(termBuffers[activeIndex]!, termOffset, rcvBuffer, TERM_BUFFER_LENGTH - termOffset);
    }

    function offsetForFrame(index: number): number {
        return index * ALIGNED_FRAME_LENGTH;
    }

    /** `position.setRelease(initialPosition)` before the image is made, as the tests do. */
    function initialPositionAt(termId: number, termOffset: number): number {
        const initialPosition = computePosition(termId, termOffset, POSITION_BITS_TO_SHIFT, INITIAL_TERM_ID);
        position.setRelease(initialPosition);
        return initialPosition;
    }

    /** Mockito: `verify(handler).onFragment(any(UnsafeBuffer.class), eq(offset), eq(length), any(Header.class))`. */
    function verifyFragment(
        handler: { onFragment: Mock<(...args: never[]) => unknown> },
        offset: number,
        length: number,
    ): number {
        return verifyOnce(handler.onFragment, anyUnsafeBuffer, offset, length, anyHeader);
    }

    it('shouldHandleClosedImage', () => {
        const image = createImage();

        image.close();

        expect(image.isClosed()).toBe(true);
        expect(image.poll(mockFragmentHandler, Integer.MAX_VALUE)).toBe(0);
        expect(image.position()).toBe(0);
    });

    it('shouldReportCorrectPositionOnReception', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));

        const messages = image.poll(mockFragmentHandler, Integer.MAX_VALUE);
        expect(messages).toBe(1);

        verifyFragment(mockFragmentHandler, HEADER_LENGTH, DATA.length);

        expectInOrder(
            [setRelease, verifyOnce(setRelease, initialPosition)],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH)],
        );
    });

    it('shouldReportCorrectPositionOnReceptionWithNonZeroPositionInInitialTermId', () => {
        const initialMessageIndex = 5;
        const initialTermOffset = offsetForFrame(initialMessageIndex);
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, initialTermOffset);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(initialMessageIndex));

        const messages = image.poll(mockFragmentHandler, Integer.MAX_VALUE);
        expect(messages).toBe(1);

        verifyFragment(mockFragmentHandler, initialTermOffset + HEADER_LENGTH, DATA.length);

        expectInOrder(
            [setRelease, verifyOnce(setRelease, initialPosition)],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH)],
        );
    });

    it('shouldReportCorrectPositionOnReceptionWithNonZeroPositionInNonInitialTermId', () => {
        const activeTermId = INITIAL_TERM_ID + 1;
        const initialMessageIndex = 5;
        const initialTermOffset = offsetForFrame(initialMessageIndex);
        const initialPosition = initialPositionAt(activeTermId, initialTermOffset);
        const image = createImage();

        insertDataFrame(activeTermId, offsetForFrame(initialMessageIndex));

        const messages = image.poll(mockFragmentHandler, Integer.MAX_VALUE);
        expect(messages).toBe(1);

        verifyFragment(mockFragmentHandler, initialTermOffset + HEADER_LENGTH, DATA.length);

        expectInOrder(
            [setRelease, verifyOnce(setRelease, initialPosition)],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH)],
        );
    });

    it('shouldPollNoFragmentsToControlledFragmentHandler', () => {
        const image = createImage();
        const fragmentsRead = image.controlledPoll(mockControlledFragmentHandler, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(0);
        expect(setRelease).not.toHaveBeenCalled();
        expect(mockControlledFragmentHandler.onFragment).not.toHaveBeenCalled();
    });

    it('shouldPollOneFragmentToControlledFragmentHandlerOnContinue', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.CONTINUE);

        const fragmentsRead = image.controlledPoll(mockControlledFragmentHandler, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(1);

        expectInOrder(
            [
                mockControlledFragmentHandler.onFragment,
                verifyFragment(mockControlledFragmentHandler, HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH)],
        );
    });

    it('shouldUpdatePositionOnRethrownExceptionInControlledPoll', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));

        mockControlledFragmentHandler.onFragment.mockImplementation(() => {
            throw new RuntimeException();
        });

        errorHandler.onError.mockImplementation(() => {
            throw new RuntimeException();
        });

        let thrown = false;
        try {
            image.controlledPoll(mockControlledFragmentHandler, Integer.MAX_VALUE);
        } catch {
            thrown = true;
        }

        expect(thrown).toBe(true);
        expect(image.position()).toBe(initialPosition + ALIGNED_FRAME_LENGTH);

        verifyFragment(mockControlledFragmentHandler, HEADER_LENGTH, DATA.length);
    });

    it('shouldUpdatePositionOnRethrownExceptionInPoll', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));

        mockFragmentHandler.onFragment.mockImplementation(() => {
            throw new RuntimeException();
        });

        errorHandler.onError.mockImplementation(() => {
            throw new RuntimeException();
        });

        let thrown = false;
        try {
            image.poll(mockFragmentHandler, Integer.MAX_VALUE);
        } catch {
            thrown = true;
        }

        expect(thrown).toBe(true);
        expect(image.position()).toBe(initialPosition + ALIGNED_FRAME_LENGTH);

        verifyFragment(mockFragmentHandler, HEADER_LENGTH, DATA.length);
    });

    it('shouldNotPollOneFragmentToControlledFragmentHandlerOnAbort', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.ABORT);

        const fragmentsRead = image.controlledPoll(mockControlledFragmentHandler, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(0);
        expect(image.position()).toBe(initialPosition);

        verifyFragment(mockControlledFragmentHandler, HEADER_LENGTH, DATA.length);
    });

    it('shouldPollOneFragmentToControlledFragmentHandlerOnBreak', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.BREAK);

        const fragmentsRead = image.controlledPoll(mockControlledFragmentHandler, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(1);

        expectInOrder(
            [
                mockControlledFragmentHandler.onFragment,
                verifyFragment(mockControlledFragmentHandler, HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH)],
        );
    });

    it('shouldPollFragmentsToControlledFragmentHandlerOnCommit', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.COMMIT);

        const fragmentsRead = image.controlledPoll(mockControlledFragmentHandler, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(2);

        const onFragment = mockControlledFragmentHandler.onFragment;
        expectInOrder(
            [onFragment, verifyFragment(mockControlledFragmentHandler, HEADER_LENGTH, DATA.length)],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH)],
            [
                onFragment,
                verifyFragment(mockControlledFragmentHandler, ALIGNED_FRAME_LENGTH + HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH * 2)],
        );
    });

    it('shouldUpdatePositionToEndOfCommittedFragmentOnCommit', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(2));

        mockControlledFragmentHandler.onFragment
            .mockReturnValueOnce(Action.CONTINUE)
            .mockReturnValueOnce(Action.COMMIT)
            .mockReturnValue(Action.CONTINUE);

        const fragmentsRead = image.controlledPoll(mockControlledFragmentHandler, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(3);

        const onFragment = mockControlledFragmentHandler.onFragment;
        expectInOrder(
            // first fragment, continue
            [onFragment, verifyFragment(mockControlledFragmentHandler, HEADER_LENGTH, DATA.length)],
            // second fragment, commit
            [
                onFragment,
                verifyFragment(mockControlledFragmentHandler, ALIGNED_FRAME_LENGTH + HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH * 2)],
            // third fragment, continue, but position is updated because last
            [
                onFragment,
                verifyFragment(mockControlledFragmentHandler, 2 * ALIGNED_FRAME_LENGTH + HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH * 3)],
        );
    });

    it('shouldPollFragmentsToControlledFragmentHandlerOnContinue', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.CONTINUE);

        const fragmentsRead = image.controlledPoll(mockControlledFragmentHandler, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(2);

        const onFragment = mockControlledFragmentHandler.onFragment;
        expectInOrder(
            [onFragment, verifyFragment(mockControlledFragmentHandler, HEADER_LENGTH, DATA.length)],
            [
                onFragment,
                verifyFragment(mockControlledFragmentHandler, ALIGNED_FRAME_LENGTH + HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH * 2)],
        );
    });

    it('shouldPollNoFragmentsToBoundedControlledFragmentHandlerWithMaxPositionBeforeInitialPosition', () => {
        const initialPosition = computePosition(INITIAL_TERM_ID, 0, POSITION_BITS_TO_SHIFT, INITIAL_TERM_ID);
        const maxPosition = initialPosition - HEADER_LENGTH;
        position.setRelease(initialPosition);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.CONTINUE);

        const fragmentsRead = image.boundedControlledPoll(
            mockControlledFragmentHandler,
            maxPosition,
            Integer.MAX_VALUE,
        );

        expect(fragmentsRead).toBe(0);

        expect(position.get()).toBe(initialPosition);
        expect(mockControlledFragmentHandler.onFragment).not.toHaveBeenCalled();
    });

    it('shouldPollFragmentsToBoundedControlledFragmentHandlerWithInitialOffsetNotZero', () => {
        const initialPosition = computePosition(
            INITIAL_TERM_ID,
            offsetForFrame(1),
            POSITION_BITS_TO_SHIFT,
            INITIAL_TERM_ID,
        );
        const maxPosition = initialPosition + ALIGNED_FRAME_LENGTH;
        position.setRelease(initialPosition);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(2));

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.CONTINUE);

        const fragmentsRead = image.boundedControlledPoll(
            mockControlledFragmentHandler,
            maxPosition,
            Integer.MAX_VALUE,
        );

        expect(fragmentsRead).toBe(1);

        expect(position.get()).toBe(maxPosition);
        expect(mockControlledFragmentHandler.onFragment).toHaveBeenCalledTimes(1);
    });

    it('shouldPollFragmentsToBoundedControlledFragmentHandlerWithMaxPositionBeforeNextMessage', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const maxPosition = initialPosition + ALIGNED_FRAME_LENGTH;
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.CONTINUE);

        const fragmentsRead = image.boundedControlledPoll(
            mockControlledFragmentHandler,
            maxPosition,
            Integer.MAX_VALUE,
        );

        expect(fragmentsRead).toBe(1);

        expectInOrder(
            [
                mockControlledFragmentHandler.onFragment,
                verifyFragment(mockControlledFragmentHandler, HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH)],
        );
    });

    it('shouldPollFragmentsToBoundedFragmentHandlerWithMaxPositionBeforeNextMessage', () => {
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, 0);
        const maxPosition = initialPosition + ALIGNED_FRAME_LENGTH;
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));

        const fragmentsRead = image.boundedPoll(mockFragmentHandler, maxPosition, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(1);

        expectInOrder(
            [mockFragmentHandler.onFragment, verifyFragment(mockFragmentHandler, HEADER_LENGTH, DATA.length)],
            [setRelease, verifyOnce(setRelease, initialPosition + ALIGNED_FRAME_LENGTH)],
        );
    });

    it('shouldPollFragmentsToBoundedControlledFragmentHandlerWithMaxPositionAfterEndOfTerm', () => {
        const initialOffset = TERM_BUFFER_LENGTH - ALIGNED_FRAME_LENGTH * 2;
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, initialOffset);
        const maxPosition = initialPosition + TERM_BUFFER_LENGTH;
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, initialOffset);
        insertPaddingFrame(INITIAL_TERM_ID, initialOffset + ALIGNED_FRAME_LENGTH);

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.CONTINUE);

        const fragmentsRead = image.boundedControlledPoll(
            mockControlledFragmentHandler,
            maxPosition,
            Integer.MAX_VALUE,
        );

        expect(fragmentsRead).toBe(1);

        expectInOrder(
            [
                mockControlledFragmentHandler.onFragment,
                verifyFragment(mockControlledFragmentHandler, initialOffset + HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, TERM_BUFFER_LENGTH)],
        );
    });

    it('shouldPollFragmentsToBoundedControlledFragmentHandlerWithMaxPositionAboveIntMaxValue', () => {
        const initialOffset = TERM_BUFFER_LENGTH - ALIGNED_FRAME_LENGTH * 2;
        initialPositionAt(INITIAL_TERM_ID, initialOffset);
        const maxPosition = Integer.MAX_VALUE + 1000;
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, initialOffset);
        insertPaddingFrame(INITIAL_TERM_ID, initialOffset + ALIGNED_FRAME_LENGTH);

        mockControlledFragmentHandler.onFragment.mockReturnValue(Action.CONTINUE);

        const fragmentsRead = image.boundedControlledPoll(
            mockControlledFragmentHandler,
            maxPosition,
            Integer.MAX_VALUE,
        );

        expect(fragmentsRead).toBe(1);

        expectInOrder(
            [
                mockControlledFragmentHandler.onFragment,
                verifyFragment(mockControlledFragmentHandler, initialOffset + HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, TERM_BUFFER_LENGTH)],
        );
    });

    it('shouldPollFragmentsToBoundedFragmentHandlerWithMaxPositionAboveIntMaxValue', () => {
        const initialOffset = TERM_BUFFER_LENGTH - ALIGNED_FRAME_LENGTH * 2;
        initialPositionAt(INITIAL_TERM_ID, initialOffset);
        const maxPosition = Integer.MAX_VALUE + 1000;
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, initialOffset);
        insertPaddingFrame(INITIAL_TERM_ID, initialOffset + ALIGNED_FRAME_LENGTH);

        const fragmentsRead = image.boundedPoll(mockFragmentHandler, maxPosition, Integer.MAX_VALUE);

        expect(fragmentsRead).toBe(1);

        expectInOrder(
            [
                mockFragmentHandler.onFragment,
                verifyFragment(mockFragmentHandler, initialOffset + HEADER_LENGTH, DATA.length),
            ],
            [setRelease, verifyOnce(setRelease, TERM_BUFFER_LENGTH)],
        );
    });

    it('shouldRejectFragment', () => {
        const initialOffset = TERM_BUFFER_LENGTH - ALIGNED_FRAME_LENGTH * 2;
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, initialOffset);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, initialOffset);
        insertPaddingFrame(INITIAL_TERM_ID, initialOffset + ALIGNED_FRAME_LENGTH);

        expect(image.position()).toBe(initialPosition);

        const reason = 'this is frame is to be rejected';
        image.reject(reason);

        expect(rejectImage).toHaveBeenCalledTimes(1);
        expect(rejectImage).toHaveBeenCalledWith(image.correlationId(), image.position(), reason);
    });

    /**
     * `inOrder.verify(position, times(2)).get(); inOrder.verify(position).getVolatile();
     * inOrder.verifyNoMoreInteractions();`: two `get` (the constructor and the poll), then one `getVolatile` (the
     * close), and no call of the position after it.
     */
    function verifyGetTwiceThenGetVolatileThenNothing(): void {
        expect(get).toHaveBeenCalledTimes(2);
        expect(getVolatile).toHaveBeenCalledTimes(1);
        const getVolatileOrder = getVolatile.mock.invocationCallOrder[0]!;
        expect(get.mock.invocationCallOrder.every((order) => order < getVolatileOrder)).toBe(true);
        // the one setRelease is the test's own, before the image existed
        expect(setRelease).toHaveBeenCalledTimes(1);
        expect(setRelease.mock.invocationCallOrder[0]!).toBeLessThan(get.mock.invocationCallOrder[0]!);
    }

    it('shouldExitPollIfImageIsClosed', () => {
        initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(2));

        const messages = image.poll({ onFragment: () => image.close() }, Integer.MAX_VALUE);
        expect(messages).toBe(1);
        expect(image.isClosed()).toBe(true);

        verifyGetTwiceThenGetVolatileThenNothing();
    });

    it('shouldExitBoundedPollIfImageIsClosed', () => {
        initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(2));

        const messages = image.boundedPoll({ onFragment: () => image.close() }, Long.MAX_VALUE, Integer.MAX_VALUE);
        expect(messages).toBe(1);
        expect(image.isClosed()).toBe(true);

        verifyGetTwiceThenGetVolatileThenNothing();
    });

    it('shouldExitControlledPollIfImageIsClosed', () => {
        initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(2));

        const messages = image.controlledPoll(
            {
                onFragment: () => {
                    image.close();
                    return Action.CONTINUE;
                },
            },
            Integer.MAX_VALUE,
        );
        expect(messages).toBe(1);
        expect(image.isClosed()).toBe(true);

        verifyGetTwiceThenGetVolatileThenNothing();
    });

    it('shouldExitBoundedControlledPollIfImageIsClosed', () => {
        initialPositionAt(INITIAL_TERM_ID, 0);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(0));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(1));
        insertDataFrame(INITIAL_TERM_ID, offsetForFrame(2));

        const messages = image.boundedControlledPoll(
            {
                onFragment: () => {
                    image.close();
                    return Action.CONTINUE;
                },
            },
            Long.MAX_VALUE,
            Integer.MAX_VALUE,
        );
        expect(messages).toBe(1);
        expect(image.isClosed()).toBe(true);

        verifyGetTwiceThenGetVolatileThenNothing();
    });

    it('blockPollClampsBlockLengthLimitWithoutIntegerOverflow', () => {
        const frameOffset = ALIGNED_FRAME_LENGTH;
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, frameOffset);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, frameOffset);

        const handlerCallCount = [0];
        const receivedLength = [-1];
        const bytes = image.blockPoll(
            {
                onBlock: (_buf, _off, len) => {
                    handlerCallCount[0]!++;
                    receivedLength[0] = len;
                },
            },
            Integer.MAX_VALUE,
        );

        expect(bytes).toBe(ALIGNED_FRAME_LENGTH);
        expect(handlerCallCount[0]).toBe(1);
        expect(receivedLength[0]).toBe(ALIGNED_FRAME_LENGTH);
        expect(image.position()).toBe(initialPosition + ALIGNED_FRAME_LENGTH);
    });

    it('rawPollClampsBlockLengthLimitWithoutIntegerOverflow', () => {
        const frameOffset = ALIGNED_FRAME_LENGTH;
        const initialPosition = initialPositionAt(INITIAL_TERM_ID, frameOffset);
        const image = createImage();

        insertDataFrame(INITIAL_TERM_ID, frameOffset);

        const handlerCallCount = [0];
        const receivedLength = [-1];
        const bytes = image.rawPoll(
            {
                onBlock: (_fc, _fo, _buf, _to, len) => {
                    handlerCallCount[0]!++;
                    receivedLength[0] = len;
                },
            },
            Integer.MAX_VALUE,
        );

        expect(bytes).toBe(ALIGNED_FRAME_LENGTH);
        expect(handlerCallCount[0]).toBe(1);
        expect(receivedLength[0]).toBe(ALIGNED_FRAME_LENGTH);
        expect(image.position()).toBe(initialPosition + ALIGNED_FRAME_LENGTH);
    });
});
