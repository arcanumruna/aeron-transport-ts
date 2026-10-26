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
// Port of io/aeron/driver/LossDetectorTest.java @ 1.53.3
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { BitUtil } from '../../src/agrona/BitUtil.js';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { TermRebuilder } from '../../src/client/logbuffer/TermRebuilder.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { HeaderFlyweight } from '../../src/client/protocol/HeaderFlyweight.js';
import { LossDetector } from '../../src/driver/LossDetector.js';
import type { LossHandler } from '../../src/driver/LossHandler.js';
import { StaticDelayGenerator } from '../../src/driver/StaticDelayGenerator.js';

const { lossFound } = LossDetector;
const { TERM_MIN_LENGTH, computePosition } = LogBufferDescriptor;
const { align } = BitUtil;

const TERM_BUFFER_LENGTH = TERM_MIN_LENGTH;
const POSITION_BITS_TO_SHIFT = LogBufferDescriptor.positionBitsToShift(TERM_BUFFER_LENGTH);
const MASK = TERM_BUFFER_LENGTH - 1;

const DATA = new Uint8Array(36);
for (let i = 0; i < DATA.length; i++) {
    DATA[i] = i;
}

const MESSAGE_LENGTH = DataHeaderFlyweight.HEADER_LENGTH + DATA.length;
const ALIGNED_FRAME_LENGTH = align(MESSAGE_LENGTH, FrameDescriptor.FRAME_ALIGNMENT);
const SESSION_ID = 0x5e55101d;
const STREAM_ID = 0xc400e;
const TERM_ID = 0xee81d;
const ACTIVE_TERM_POSITION = computePosition(TERM_ID, 0, POSITION_BITS_TO_SHIFT, TERM_ID);

/** `TimeUnit.MILLISECONDS.toNanos`. */
function ms(millis: number): number {
    return millis * 1_000_000;
}

const DELAY_GENERATOR = new StaticDelayGenerator(ms(20));
const DELAY_GENERATOR_WITH_LONGER_RETRY = new StaticDelayGenerator(ms(20), ms(200));

type Gap = [number, number, number];
type Handler = { onGapDetected: Mock<LossHandler['onGapDetected']> };

function countOf(handler: Handler, gap: Gap): number {
    return handler.onGapDetected.mock.calls.filter((c) => c.every((v, i) => v === gap[i])).length;
}

/** `verify(lossHandler, times(n)).onGapDetected(...)`. */
function verifyTimes(handler: Handler, n: number, ...gap: Gap): void {
    expect(countOf(handler, gap)).toBe(n);
}

/** `verify(lossHandler, atLeast(n)).onGapDetected(...)`. */
function verifyAtLeast(handler: Handler, n: number, ...gap: Gap): void {
    expect(countOf(handler, gap)).toBeGreaterThanOrEqual(n);
}

/** `verifyNoMoreInteractions(lossHandler)` after the verifications of the test: exactly the calls it verified. */
function verifyNoMoreInteractions(handler: Handler, ...verified: Gap[]): void {
    expect(handler.onGapDetected.mock.calls).toEqual(verified);
}

/**
 * Mockito's `InOrder` for one mock: a verification matches the invocations after the last verified one, and with
 * `atLeast` or `times` consumes the matching chunk (all matches for `atLeast`, the first run for `times`).
 */
class InOrder {
    private cursor = -1;

    public constructor(private readonly handler: Handler) {}

    private matching(gap: Gap): number[] {
        const result: number[] = [];
        const calls = this.handler.onGapDetected.mock.calls;
        for (let i = this.cursor + 1; i < calls.length; i++) {
            if (calls[i]!.every((v, j) => v === gap[j])) {
                result.push(i);
            }
        }
        return result;
    }

    public verifyAtLeast(n: number, ...gap: Gap): void {
        const m = this.matching(gap);
        expect(m.length).toBeGreaterThanOrEqual(n);
        this.cursor = m[m.length - 1]!;
    }

    public verifyTimes(n: number, ...gap: Gap): void {
        const m = this.matching(gap);
        // the first chunk of consecutive matching invocations
        let chunk = 0;
        while (chunk < m.length && m[chunk] === m[0]! + chunk) {
            chunk++;
        }
        expect(chunk).toBe(n);
        this.cursor = m[chunk - 1]!;
    }

    public verifyNever(...gap: Gap): void {
        expect(this.matching(gap).length).toBe(0);
    }

    public verifyNoMoreInteractions(): void {
        expect(this.handler.onGapDetected.mock.calls.length).toBe(this.cursor + 1);
    }
}

describe('LossDetectorTest', () => {
    let termBuffer: UnsafeBuffer;
    let rcvBuffer: UnsafeBuffer;
    let dataHeader: DataHeaderFlyweight;

    let lossHandler: Handler;
    let lossDetector: LossDetector;
    let currentTimeNs: number;

    beforeEach(() => {
        termBuffer = new UnsafeBuffer(new ArrayBuffer(TERM_BUFFER_LENGTH));
        rcvBuffer = new UnsafeBuffer(new ArrayBuffer(MESSAGE_LENGTH));
        dataHeader = new DataHeaderFlyweight();
        dataHeader.wrap(rcvBuffer);
        lossHandler = { onGapDetected: vi.fn<LossHandler['onGapDetected']>() };
        lossDetector = new LossDetector(DELAY_GENERATOR, lossHandler);
        currentTimeNs = 0;
    });

    /** `lossDetector.scan(termBuffer, ..., currentTimeNs, MASK, POSITION_BITS_TO_SHIFT, TERM_ID)`. */
    function scan(rebuildPosition: number, hwmPosition: number): number {
        return lossDetector.scan(
            termBuffer,
            rebuildPosition,
            hwmPosition,
            currentTimeNs,
            MASK,
            POSITION_BITS_TO_SHIFT,
            TERM_ID,
        );
    }

    function getLossHandlerWithLongRetry(): LossDetector {
        return new LossDetector(DELAY_GENERATOR_WITH_LONGER_RETRY, lossHandler);
    }

    function insertDataFrame(offset: number, payload: Uint8Array = DATA): void {
        dataHeader
            .termId(TERM_ID)
            .streamId(STREAM_ID)
            .sessionId(SESSION_ID)
            .termOffset(offset)
            .frameLength(payload.length + DataHeaderFlyweight.HEADER_LENGTH)
            .headerType(HeaderFlyweight.HDR_TYPE_DATA)
            .flags(DataHeaderFlyweight.BEGIN_AND_END_FLAGS)
            .version(HeaderFlyweight.CURRENT_VERSION);

        rcvBuffer.putBytes(dataHeader.dataOffset(), payload);

        TermRebuilder.insert(termBuffer, offset, rcvBuffer, payload.length + DataHeaderFlyweight.HEADER_LENGTH);
    }

    function offsetOfMessage(index: number): number {
        return index * ALIGNED_FRAME_LENGTH;
    }

    it('shouldNotSendNakWhenBufferIsEmpty', () => {
        const rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION;

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(100);
        scan(rebuildPosition, hwmPosition);

        expect(lossHandler.onGapDetected).not.toHaveBeenCalled();
    });

    it('shouldNotNakIfNoMissingData', () => {
        const rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(1));
        insertDataFrame(offsetOfMessage(2));

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(40);
        scan(rebuildPosition, hwmPosition);

        expect(lossHandler.onGapDetected).not.toHaveBeenCalled();
    });

    it('shouldNakMissingData', () => {
        const rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(2));

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(40);
        scan(rebuildPosition, hwmPosition);

        verifyTimes(lossHandler, 1, TERM_ID, offsetOfMessage(1), ALIGNED_FRAME_LENGTH);
    });

    it('shouldRetransmitNakForMissingData', () => {
        const rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(2));

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(30);
        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(60);
        scan(rebuildPosition, hwmPosition);

        verifyAtLeast(lossHandler, 2, TERM_ID, offsetOfMessage(1), ALIGNED_FRAME_LENGTH);
    });

    it('shouldStopNakOnReceivingData', () => {
        let rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(2));

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(20);
        insertDataFrame(offsetOfMessage(1));
        rebuildPosition += ALIGNED_FRAME_LENGTH * 3;
        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(100);
        scan(rebuildPosition, hwmPosition);

        expect(lossHandler.onGapDetected).not.toHaveBeenCalled();
    });

    it('shouldHandleMoreThan2Gaps', () => {
        let rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 7;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(2));
        insertDataFrame(offsetOfMessage(4));
        insertDataFrame(offsetOfMessage(6));

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(40);
        scan(rebuildPosition, hwmPosition);
        insertDataFrame(offsetOfMessage(1));
        rebuildPosition += ALIGNED_FRAME_LENGTH * 3;
        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(80);
        scan(rebuildPosition, hwmPosition);

        const inOrder = new InOrder(lossHandler);
        inOrder.verifyAtLeast(1, TERM_ID, offsetOfMessage(1), ALIGNED_FRAME_LENGTH);
        inOrder.verifyAtLeast(1, TERM_ID, offsetOfMessage(3), ALIGNED_FRAME_LENGTH);
        inOrder.verifyNever(TERM_ID, offsetOfMessage(5), ALIGNED_FRAME_LENGTH);
    });

    it('shouldReplaceOldNakWithNewNak', () => {
        let rebuildPosition = ACTIVE_TERM_POSITION;
        let hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(2));

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(20);
        scan(rebuildPosition, hwmPosition);

        insertDataFrame(offsetOfMessage(4));
        insertDataFrame(offsetOfMessage(1));
        rebuildPosition += ALIGNED_FRAME_LENGTH * 3;
        hwmPosition = ALIGNED_FRAME_LENGTH * 5;

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(100);
        scan(rebuildPosition, hwmPosition);

        verifyAtLeast(lossHandler, 1, TERM_ID, offsetOfMessage(3), ALIGNED_FRAME_LENGTH);
    });

    it('shouldHandleLongerRetryDelay', () => {
        lossDetector = getLossHandlerWithLongRetry();

        const rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(2));

        scan(rebuildPosition, hwmPosition);
        expect(lossHandler.onGapDetected).not.toHaveBeenCalled();

        currentTimeNs = ms(40);
        scan(rebuildPosition, hwmPosition);

        verifyTimes(lossHandler, 1, TERM_ID, offsetOfMessage(1), ALIGNED_FRAME_LENGTH);

        currentTimeNs = ms(80);
        scan(rebuildPosition, hwmPosition);

        verifyNoMoreInteractions(lossHandler, [TERM_ID, offsetOfMessage(1), ALIGNED_FRAME_LENGTH]);

        currentTimeNs = ms(240);
        scan(rebuildPosition, hwmPosition);

        verifyTimes(lossHandler, 2, TERM_ID, offsetOfMessage(1), ALIGNED_FRAME_LENGTH);
    });

    it('shouldNotNakImmediatelyByDefault', () => {
        const rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(2));

        scan(rebuildPosition, hwmPosition);

        expect(lossHandler.onGapDetected).not.toHaveBeenCalled();
    });

    it('shouldOnlySendNaksOnceOnMultipleScans', () => {
        lossDetector = getLossHandlerWithLongRetry();

        const rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(0));
        insertDataFrame(offsetOfMessage(2));

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(40);
        scan(rebuildPosition, hwmPosition);
        scan(rebuildPosition, hwmPosition);

        verifyTimes(lossHandler, 1, TERM_ID, offsetOfMessage(1), ALIGNED_FRAME_LENGTH);
    });

    it('shouldHandleHwmGreaterThanCompletedBuffer', () => {
        lossDetector = getLossHandlerWithLongRetry();

        let rebuildPosition = ACTIVE_TERM_POSITION;
        const hwmPosition = ACTIVE_TERM_POSITION + TERM_BUFFER_LENGTH + ALIGNED_FRAME_LENGTH;

        insertDataFrame(offsetOfMessage(0));
        rebuildPosition += ALIGNED_FRAME_LENGTH;

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(40);
        scan(rebuildPosition, hwmPosition);

        verifyTimes(lossHandler, 1, TERM_ID, offsetOfMessage(1), TERM_BUFFER_LENGTH - rebuildPosition);
    });

    it('shouldHandleNonZeroInitialTermOffset', () => {
        lossDetector = getLossHandlerWithLongRetry();

        const rebuildPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;
        const hwmPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 5;

        insertDataFrame(offsetOfMessage(2));
        insertDataFrame(offsetOfMessage(4));

        scan(rebuildPosition, hwmPosition);
        currentTimeNs = ms(40);
        scan(rebuildPosition, hwmPosition);

        verifyTimes(lossHandler, 1, TERM_ID, offsetOfMessage(3), ALIGNED_FRAME_LENGTH);
        verifyNoMoreInteractions(lossHandler, [TERM_ID, offsetOfMessage(3), ALIGNED_FRAME_LENGTH]);
    });

    it('shouldDetectChangesInTheGapLength', () => {
        lossDetector = getLossHandlerWithLongRetry();

        const rebuildPosition = ACTIVE_TERM_POSITION + ALIGNED_FRAME_LENGTH * 3;

        insertDataFrame(offsetOfMessage(2));
        insertDataFrame(offsetOfMessage(5));

        expect(lossFound(scan(rebuildPosition, rebuildPosition + 32))).toBe(true);

        currentTimeNs = ms(100);
        expect(lossFound(scan(rebuildPosition, rebuildPosition + 32))).toBe(false);

        expect(lossFound(scan(rebuildPosition, rebuildPosition + 64))).toBe(true);

        currentTimeNs = ms(200);
        expect(lossFound(scan(rebuildPosition, rebuildPosition + 64))).toBe(false);

        currentTimeNs = ms(300);
        expect(lossFound(scan(rebuildPosition, rebuildPosition + ALIGNED_FRAME_LENGTH))).toBe(true);

        expect(lossFound(scan(rebuildPosition, rebuildPosition + ALIGNED_FRAME_LENGTH * 2))).toBe(true);

        currentTimeNs = ms(400);
        expect(lossFound(scan(rebuildPosition, rebuildPosition + ALIGNED_FRAME_LENGTH * 2))).toBe(false);

        insertDataFrame(offsetOfMessage(4));
        expect(lossFound(scan(rebuildPosition, rebuildPosition + ALIGNED_FRAME_LENGTH * 2))).toBe(true);

        currentTimeNs = ms(500);
        expect(lossFound(scan(rebuildPosition, rebuildPosition + ALIGNED_FRAME_LENGTH * 2))).toBe(false);

        expect(lossFound(scan(rebuildPosition, rebuildPosition + 64))).toBe(true);

        currentTimeNs = ms(600);
        expect(lossFound(scan(rebuildPosition, rebuildPosition + 64))).toBe(false);

        const inOrder = new InOrder(lossHandler);
        inOrder.verifyTimes(1, TERM_ID, offsetOfMessage(3), 32);
        inOrder.verifyTimes(1, TERM_ID, offsetOfMessage(3), 64);
        inOrder.verifyTimes(1, TERM_ID, offsetOfMessage(3), ALIGNED_FRAME_LENGTH * 2);
        inOrder.verifyTimes(1, TERM_ID, offsetOfMessage(3), ALIGNED_FRAME_LENGTH);
        inOrder.verifyTimes(1, TERM_ID, offsetOfMessage(3), 64);
        inOrder.verifyNoMoreInteractions();
    });
});
