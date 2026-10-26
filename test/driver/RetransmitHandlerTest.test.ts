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
// Port of io/aeron/driver/RetransmitHandlerTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../src/agrona/concurrent/status/AtomicCounter.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { HeaderWriter } from '../../src/client/logbuffer/HeaderWriter.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermRebuilder } from '../../src/client/logbuffer/TermRebuilder.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import type { FeedbackDelayGenerator } from '../../src/driver/FeedbackDelayGenerator.js';
import type { FlowControl } from '../../src/driver/FlowControl.js';
import { RetransmitHandler } from '../../src/driver/RetransmitHandler.js';
import type { RetransmitSender } from '../../src/driver/RetransmitSender.js';
import { StaticDelayGenerator } from '../../src/driver/StaticDelayGenerator.js';

const { align } = BitUtil;
const { FRAME_ALIGNMENT, frameLengthOrdered } = FrameDescriptor;
const { HEADER_LENGTH } = DataHeaderFlyweight;

const MTU_LENGTH = 1024;
const TERM_BUFFER_LENGTH = LogBufferDescriptor.TERM_MIN_LENGTH;
const DATA = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const MESSAGE_LENGTH = DataHeaderFlyweight.HEADER_LENGTH + DATA.length;
const ALIGNED_FRAME_LENGTH = align(MESSAGE_LENGTH, FrameDescriptor.FRAME_ALIGNMENT);
const TWO_MESSAGE_FRAME_LENGTH = 2 * align(MESSAGE_LENGTH, FrameDescriptor.FRAME_ALIGNMENT);
const SESSION_ID = 0x5e55101d;
const STREAM_ID = 0x5400e;
const TERM_ID = 0x7f003355;

/** `TimeUnit.MILLISECONDS.toNanos`. */
function ms(millis: number): number {
    return millis * 1_000_000;
}

const DELAY_GENERATOR: FeedbackDelayGenerator = new StaticDelayGenerator(ms(20));
const ZERO_DELAY_GENERATOR: FeedbackDelayGenerator = new StaticDelayGenerator(ms(0));
const LINGER_GENERATOR: FeedbackDelayGenerator = new StaticDelayGenerator(ms(40));

/** The `consumers()` method source: a frame is added by sending it or by receiving it. */
const CREATOR_NAMES = ['addSentDataFrame', 'addReceivedDataFrame'];

function offsetOfFrame(index: number): number {
    return index * ALIGNED_FRAME_LENGTH;
}

/** `verify(sender, times(n)).resend(termId, termOffset, length)`. */
function verifyTimes(
    sender: { resend: Mock<RetransmitSender['resend']> },
    n: number,
    termId: number,
    termOffset: number,
    length: number,
): void {
    expect(
        sender.resend.mock.calls.filter((c) => c[0] === termId && c[1] === termOffset && c[2] === length).length,
    ).toBe(n);
}

describe('RetransmitHandlerTest', () => {
    let termBuffer: UnsafeBuffer;
    let metaDataBuffer: UnsafeBuffer;
    let rcvBuffer: UnsafeBuffer;
    let dataHeader: DataHeaderFlyweight;
    let headerWriter: HeaderWriter;

    let currentTime: number;

    let sender: { resend: Mock<RetransmitSender['resend']> };
    let fcMock: { maxRetransmissionLength: Mock<FlowControl['maxRetransmissionLength']> };
    let fc: FlowControl;
    let retransmitOverflow: { increment: Mock<() => number> };

    let handler: RetransmitHandler;

    function newRetransmitHandler(delayGenerator: FeedbackDelayGenerator): RetransmitHandler {
        return new RetransmitHandler(
            { nanoTime: () => currentTime },
            delayGenerator,
            LINGER_GENERATOR,
            true,
            16,
            retransmitOverflow as unknown as AtomicCounter,
        );
    }

    beforeEach(() => {
        termBuffer = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH));
        metaDataBuffer = new UnsafeBuffer(new ArrayBuffer(LogBufferDescriptor.LOG_META_DATA_LENGTH));
        rcvBuffer = new UnsafeBuffer(new ArrayBuffer(MESSAGE_LENGTH));
        dataHeader = new DataHeaderFlyweight();
        headerWriter = HeaderWriter.newInstance(DataHeaderFlyweight.createDefaultHeader(0, 0, 0));
        currentTime = 0;

        sender = { resend: vi.fn<RetransmitSender['resend']>() };
        fcMock = { maxRetransmissionLength: vi.fn<FlowControl['maxRetransmissionLength']>() };
        fc = fcMock as unknown as FlowControl;
        retransmitOverflow = { increment: vi.fn<() => number>(() => 0) };
        handler = newRetransmitHandler(DELAY_GENERATOR);

        LogBufferDescriptor.rawTail(metaDataBuffer, 0, LogBufferDescriptor.packTail(TERM_ID, 0));
        fcMock.maxRetransmissionLength.mockImplementation(returnResendLength);
    });

    /** `returnResendLength`: `invocation.getArgument(1)`, the length of the NAK. */
    function returnResendLength(_termOffset: number, resendLength: number): number {
        return resendLength;
    }

    /** `clampResendLengthTo`. */
    function clampResendLengthTo(length: number): () => number {
        return () => length;
    }

    function newZeroDelayRetransmitHandler(): RetransmitHandler {
        return newRetransmitHandler(ZERO_DELAY_GENERATOR);
    }

    function addSentDataFrame(): void {
        rcvBuffer.putBytes(0, DATA);

        const frameLength = DATA.length + HEADER_LENGTH;
        const alignedLength = align(frameLength, FRAME_ALIGNMENT);
        const rawTail = LogBufferDescriptor.packTail(TERM_ID, alignedLength);

        LogBufferDescriptor.rawTail(metaDataBuffer, 0, rawTail);

        headerWriter.write(termBuffer, 0, frameLength, TERM_ID);
        termBuffer.putBytes(HEADER_LENGTH, rcvBuffer, 0, DATA.length);

        frameLengthOrdered(termBuffer, 0, frameLength);
    }

    function addReceivedDataFrame(msgNum: number): void {
        dataHeader.wrap(rcvBuffer);

        dataHeader
            .termId(TERM_ID)
            .streamId(STREAM_ID)
            .sessionId(SESSION_ID)
            .termOffset(offsetOfFrame(msgNum))
            .frameLength(MESSAGE_LENGTH)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .version(HeaderFlyweight.CURRENT_VERSION);

        rcvBuffer.putBytes(dataHeader.dataOffset(), DATA);

        TermRebuilder.insert(termBuffer, offsetOfFrame(msgNum), rcvBuffer, MESSAGE_LENGTH);
    }

    function creatorFor(name: string): (msgNum: number) => void {
        return 'addSentDataFrame' === name ? () => addSentDataFrame() : (i) => addReceivedDataFrame(i);
    }

    function createTermBuffer(creator: (msgNum: number) => void, num: number): void {
        for (let i = 0; i < num; i++) {
            creator(i);
        }
    }

    it.each(CREATOR_NAMES)('shouldRetransmitOnNak %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);

        verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH);
    });

    it.each(CREATOR_NAMES)('shouldClampRetransmitViaFlowControlOnNak %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        const expectedResendLength = 32;
        fcMock.maxRetransmissionLength.mockImplementation(clampResendLengthTo(expectedResendLength));

        createTermBuffer(creator, 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);

        verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), expectedResendLength);
    });

    it.each(CREATOR_NAMES)('shouldNotRetransmitOnNakWhileInLinger %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(40);
        handler.processTimeouts(currentTime, sender);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);

        verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH);
    });

    it.each(CREATOR_NAMES)(
        'shouldNotRetransmitOnNakWhileInLingerWithDifferentOffsetByContainedWithinExistingRetransmit %s',
        (creatorName) => {
            const creator = creatorFor(creatorName);
            createTermBuffer(creator, 5);
            handler.onNak(
                TERM_ID,
                offsetOfFrame(0),
                TWO_MESSAGE_FRAME_LENGTH,
                TERM_BUFFER_LENGTH,
                MTU_LENGTH,
                fc,
                sender,
            );
            currentTime = ms(40);
            handler.processTimeouts(currentTime, sender);
            handler.onNak(TERM_ID, offsetOfFrame(1), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
            currentTime = ms(100);
            handler.processTimeouts(currentTime, sender);

            expect(sender.resend.mock.calls.filter((c) => c[0] === TERM_ID).length).toBe(1);
        },
    );

    it.each(CREATOR_NAMES)('shouldRetransmitOnNakAfterLinger %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(40);
        handler.processTimeouts(currentTime, sender);
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(200);
        handler.processTimeouts(currentTime, sender);

        verifyTimes(sender, 2, TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH);
    });

    it.each(CREATOR_NAMES)('shouldRetransmitOnMultipleNaks %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        handler.onNak(TERM_ID, offsetOfFrame(1), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);

        // inOrder.verify(sender).resend(...) twice: both calls, in this order
        expect(sender.resend.mock.calls).toEqual([
            [TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH],
            [TERM_ID, offsetOfFrame(1), ALIGNED_FRAME_LENGTH],
        ]);
    });

    it.each(CREATOR_NAMES)('shouldRetransmitOnNakOverMessageLength %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 10);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH * 5, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);

        verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH * 5);
    });

    it.each(CREATOR_NAMES)('shouldRetransmitOnNakOverMtuLength %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        const numFramesPerMtu = MTU_LENGTH / ALIGNED_FRAME_LENGTH;
        createTermBuffer(creator, numFramesPerMtu * 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), MTU_LENGTH * 2, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);

        verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), MTU_LENGTH * 2);
    });

    it.each(CREATOR_NAMES)(
        'shouldNotRetransmitOnNakWhileInLingerWithDifferentOffsetButOffsetInRangeOfExistingNak %s',
        (creatorName) => {
            const creator = creatorFor(creatorName);
            createTermBuffer(creator, 5);
            handler.onNak(
                TERM_ID,
                offsetOfFrame(0),
                TWO_MESSAGE_FRAME_LENGTH,
                TERM_BUFFER_LENGTH,
                MTU_LENGTH,
                fc,
                sender,
            );
            currentTime = ms(40);
            handler.processTimeouts(currentTime, sender);
            handler.onNak(
                TERM_ID,
                offsetOfFrame(1),
                TWO_MESSAGE_FRAME_LENGTH,
                TERM_BUFFER_LENGTH,
                MTU_LENGTH,
                fc,
                sender,
            );
            currentTime = ms(100);
            handler.processTimeouts(currentTime, sender);

            verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), TWO_MESSAGE_FRAME_LENGTH);
            verifyTimes(sender, 0, TERM_ID, offsetOfFrame(1), TWO_MESSAGE_FRAME_LENGTH);
        },
    );

    it.each(CREATOR_NAMES)(
        'shouldRetransmitOnNakWhileInLingerWithDifferentOffsetButJustOutsideRangeOfExistingNak %s',
        (creatorName) => {
            const creator = creatorFor(creatorName);
            createTermBuffer(creator, 5);
            handler.onNak(
                TERM_ID,
                offsetOfFrame(0),
                TWO_MESSAGE_FRAME_LENGTH,
                TERM_BUFFER_LENGTH,
                MTU_LENGTH,
                fc,
                sender,
            );
            currentTime = ms(40);
            handler.processTimeouts(currentTime, sender);
            handler.onNak(
                TERM_ID,
                offsetOfFrame(2),
                TWO_MESSAGE_FRAME_LENGTH,
                TERM_BUFFER_LENGTH,
                MTU_LENGTH,
                fc,
                sender,
            );
            currentTime = ms(100);
            handler.processTimeouts(currentTime, sender);

            verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), TWO_MESSAGE_FRAME_LENGTH);
            verifyTimes(sender, 1, TERM_ID, offsetOfFrame(2), TWO_MESSAGE_FRAME_LENGTH);
        },
    );

    it.each(CREATOR_NAMES)('shouldStopRetransmitOnRetransmitReception %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        handler.onRetransmitReceived(TERM_ID, offsetOfFrame(0));
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);

        expect(sender.resend).not.toHaveBeenCalled();
    });

    it.each(CREATOR_NAMES)('shouldStopOneRetransmitOnRetransmitReception %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        handler.onNak(TERM_ID, offsetOfFrame(1), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        handler.onRetransmitReceived(TERM_ID, offsetOfFrame(0));
        currentTime = ms(100);
        handler.processTimeouts(currentTime, sender);

        verifyTimes(sender, 1, TERM_ID, offsetOfFrame(1), ALIGNED_FRAME_LENGTH);
    });

    it.each(CREATOR_NAMES)('shouldImmediateRetransmitOnNak %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler = newZeroDelayRetransmitHandler();

        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);

        verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH);
    });

    it.each(CREATOR_NAMES)('shouldGoIntoLingerOnImmediateRetransmit %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler = newZeroDelayRetransmitHandler();

        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);
        currentTime = ms(40);
        handler.processTimeouts(currentTime, sender);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);

        verifyTimes(sender, 1, TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH);
    });

    it.each(CREATOR_NAMES)('shouldOnlyRetransmitOnNakWhenConfiguredTo %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        handler.onNak(TERM_ID, offsetOfFrame(0), ALIGNED_FRAME_LENGTH, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);

        expect(sender.resend).not.toHaveBeenCalled();
    });

    it.each(CREATOR_NAMES)('shouldIncrementOverflowCounter %s', (creatorName) => {
        const creator = creatorFor(creatorName);
        createTermBuffer(creator, 5);
        const termLength = 128 * 1024;

        for (let i = 0; i < 16; i++) {
            const termOffset = offsetOfFrame(i * 64);
            handler.onNak(TERM_ID, termOffset, ALIGNED_FRAME_LENGTH, termLength, MTU_LENGTH, fc, sender);
        }

        handler.onNak(TERM_ID, offsetOfFrame(16 * 64), ALIGNED_FRAME_LENGTH, termLength, MTU_LENGTH, fc, sender);

        expect(retransmitOverflow.increment).toHaveBeenCalledTimes(1);
    });

    it('shouldIgnoreEmptyNak', () => {
        handler = newZeroDelayRetransmitHandler();

        handler.onNak(TERM_ID, 0, 0, TERM_BUFFER_LENGTH, MTU_LENGTH, fc, sender);

        expect(sender.resend).not.toHaveBeenCalled();
    });
});
