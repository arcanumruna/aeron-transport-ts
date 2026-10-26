// The producer side of a log, as far as the tests of the sender need it: what `ConcurrentPublication.offer` and
// `tryClaim` do to the term buffers (T20 ports the publications, `TermAppender` among them). One claim of the tail by a
// `getAndAddRawTailOffset` (phase 2 decision 5), the frames written with the `HeaderWriter` and published by the
// ordered store of their length, a padding frame and a `rotateLog` when the claim crosses the end of the term. It
// makes the logs that a publication makes, so a test of the sender, the retransmit or the cap runs on them.
import { BitUtil } from '../../src/agrona/BitUtil.js';
import type { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException } from '../../src/agrona/jdk.js';
import { BufferClaim } from '../../src/client/logbuffer/BufferClaim.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { HeaderWriter } from '../../src/client/logbuffer/HeaderWriter.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';

const { align, SIZE_OF_LONG } = BitUtil;
const { HEADER_LENGTH } = DataHeaderFlyweight;
const { FRAME_ALIGNMENT, frameLengthOrdered } = FrameDescriptor;
const {
    PARTITION_COUNT,
    TERM_TAIL_COUNTERS_OFFSET,
    activeTermCount,
    indexByTermCount,
    computePosition,
    getAndAddRawTailOffset,
    rotateLog,
    initialiseTailWithTermId,
} = LogBufferDescriptor;

export interface LogStart {
    readonly sessionId: number;
    readonly streamId: number;
    readonly initialTermId: number;
    readonly mtuLength: number;
    /** The term count (position / term length) of the first append. */
    readonly termCount?: number;
    /** The term offset of the first append, a multiple of 32. */
    readonly termOffset?: number;
}

export class TestLogProducer {
    public readonly termLength: number;
    public readonly maxPayloadLength: number;
    public readonly maxMessageLength: number;
    private readonly positionBitsToShift: number;
    private readonly metaData: UnsafeBuffer;
    private readonly termBuffers: UnsafeBuffer[];
    private readonly headerWriter: HeaderWriter;
    private readonly initialTermId: number;
    private readonly termIdHolder = new Int32Array(1);
    private readonly bufferClaim = new BufferClaim();

    public constructor(
        rawLog: RawLog,
        private readonly start: LogStart,
    ) {
        this.metaData = rawLog.metaData();
        this.termBuffers = rawLog.termBuffers();
        this.termLength = rawLog.termLength();
        this.initialTermId = start.initialTermId;
        this.positionBitsToShift = LogBufferDescriptor.positionBitsToShift(this.termLength);
        this.maxPayloadLength = start.mtuLength - HEADER_LENGTH;
        this.maxMessageLength = FrameDescriptor.computeMaxMessageLength(this.termLength);
        this.headerWriter = HeaderWriter.newInstance(
            DataHeaderFlyweight.createDefaultHeader(start.sessionId, start.streamId, start.initialTermId),
        );
        TestLogProducer.initialiseLog(rawLog, start);
    }

    /**
     * Initialise the meta data of a log, with the active term at `start.termCount` and `start.termOffset`, as the
     * conductor does for a new publication (`DriverConductor.initialiseLogMetadata` and `initialiseTailWithTermId`).
     */
    public static initialiseLog(rawLog: RawLog, start: LogStart): void {
        const meta = rawLog.metaData();
        const termCount = start.termCount ?? 0;
        const termOffset = start.termOffset ?? 0;
        const activeTermId = (start.initialTermId + termCount) | 0;
        const activeIndex = indexByTermCount(termCount);

        LogBufferDescriptor.termLength(meta, rawLog.termLength());
        LogBufferDescriptor.mtuLength(meta, start.mtuLength);
        LogBufferDescriptor.initialTermId(meta, start.initialTermId);
        LogBufferDescriptor.activeTermCount(meta, termCount);
        for (let i = 0; i < PARTITION_COUNT; i++) {
            // the partition after the active one holds the term id of the term before it, as rotateLog expects
            const behind = (i - activeIndex + PARTITION_COUNT) % PARTITION_COUNT;
            const termId = behind === 0 ? activeTermId : (activeTermId + behind - PARTITION_COUNT) | 0;
            initialiseTailWithTermId(meta, i, termId);
        }
        LogBufferDescriptor.rawTail(meta, activeIndex, LogBufferDescriptor.packTail(activeTermId, termOffset));
        LogBufferDescriptor.isConnected(meta, true);
    }

    /** The position of the producers: the position after the last append. */
    public position(): number {
        const count = activeTermCount(this.metaData);
        const index = indexByTermCount(count);
        const termId = LogBufferDescriptor.rawTailTermId(this.metaData, index);
        const termOffset = LogBufferDescriptor.rawTailTermOffset(this.metaData, index, this.termLength);

        return computePosition(termId, termOffset, this.positionBitsToShift, this.initialTermId);
    }

    /**
     * `Publication.offer`: an unfragmented frame when the message fits in one frame, otherwise fragments, all in one
     * claim of the tail.
     *
     * @return the position after the message.
     */
    public offer(message: Uint8Array): number {
        const length = message.length;
        if (length > this.maxMessageLength) {
            throw new IllegalArgumentException(
                'message length ' + length + ' > maxMessageLength=' + this.maxMessageLength,
            );
        }

        if (length <= this.maxPayloadLength) {
            const frameLength = length + HEADER_LENGTH;
            return this.append(align(frameLength, FRAME_ALIGNMENT), (termBuffer, termOffset, termId) => {
                this.headerWriter.write(termBuffer, termOffset, frameLength, termId);
                termBuffer.putBytes(termOffset + HEADER_LENGTH, message, 0, length);
                frameLengthOrdered(termBuffer, termOffset, frameLength);
            });
        }

        const framedLength = LogBufferDescriptor.computeFragmentedFrameLength(length, this.maxPayloadLength);
        return this.append(framedLength, (termBuffer, termOffset, termId) => {
            let flags = FrameDescriptor.BEGIN_FRAG_FLAG;
            let remaining = length;
            let frameOffset = termOffset;
            let sourceOffset = 0;
            do {
                const bytesToWrite = Math.min(remaining, this.maxPayloadLength);
                const frameLength = bytesToWrite + HEADER_LENGTH;
                const alignedLength = align(frameLength, FRAME_ALIGNMENT);

                this.headerWriter.write(termBuffer, frameOffset, frameLength, termId);
                termBuffer.putBytes(frameOffset + HEADER_LENGTH, message, sourceOffset, bytesToWrite);

                if (remaining <= this.maxPayloadLength) {
                    flags |= FrameDescriptor.END_FRAG_FLAG;
                }

                FrameDescriptor.frameFlags(termBuffer, frameOffset, flags & 0xff);
                frameLengthOrdered(termBuffer, frameOffset, frameLength);

                flags = 0;
                frameOffset += alignedLength;
                sourceOffset += bytesToWrite;
                remaining -= bytesToWrite;
            } while (remaining > 0);
        });
    }

    /**
     * `Publication.tryClaim`: claim a frame, to write and `commit()` or `abort()`.
     *
     * @return the claim and the position after it.
     */
    public tryClaim(length: number): { claim: BufferClaim; position: number } {
        if (length > this.maxPayloadLength) {
            throw new IllegalArgumentException('claim exceeds maxPayloadLength of ' + this.maxPayloadLength);
        }

        const frameLength = length + HEADER_LENGTH;
        const position = this.append(align(frameLength, FRAME_ALIGNMENT), (termBuffer, termOffset, termId) => {
            this.headerWriter.write(termBuffer, termOffset, frameLength, termId);
            this.bufferClaim.wrap(termBuffer, termOffset, frameLength);
        });

        return { claim: this.bufferClaim, position };
    }

    private append(
        alignedLength: number,
        write: (termBuffer: UnsafeBuffer, termOffset: number, termId: number) => void,
    ): number {
        for (let attempt = 0; attempt < 8; attempt++) {
            const termCount = activeTermCount(this.metaData);
            const index = indexByTermCount(termCount);
            const termLength = this.termLength;
            const unsignedOffset = getAndAddRawTailOffset(
                this.metaData,
                TERM_TAIL_COUNTERS_OFFSET + SIZE_OF_LONG * index,
                alignedLength,
                this.termIdHolder,
            );
            const termId = this.termIdHolder[0] as number;
            const termOffset = Math.min(unsignedOffset, termLength);
            const resultingOffset = termOffset + alignedLength;
            const termBuffer = this.termBuffers[index] as UnsafeBuffer;

            if (resultingOffset > termLength) {
                // the claim crosses the end of the term: pad what is left of it and rotate to the next
                if (termOffset < termLength) {
                    const paddingLength = termLength - termOffset;
                    this.headerWriter.write(termBuffer, termOffset, paddingLength, termId);
                    FrameDescriptor.frameType(termBuffer, termOffset, FrameDescriptor.PADDING_FRAME_TYPE);
                    frameLengthOrdered(termBuffer, termOffset, paddingLength);
                }
                rotateLog(this.metaData, termCount, termId);
                continue;
            }

            write(termBuffer, termOffset, termId);
            return computePosition(termId, resultingOffset, this.positionBitsToShift, this.initialTermId);
        }

        throw new Error('the log did not rotate');
    }
}
