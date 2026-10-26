// The producer side of a log, as far as the tests of the sender need it. Since T20 it is a real `ConcurrentPublication`
// over the log: `offer` and `tryClaim` are the publication's, with the appends, the padding frame at the end of the term
// and the `rotateLog` of Java, with a position limit that never back pressures and a conductor that is a fake (spec D80),
// and a rotation (`ADMIN_ACTION`) is retried as a caller does. `initialiseLog` is what the conductor does to the meta
// data of a new log (`DriverConductor.initialiseLogMetadata` and `initialiseTailWithTermId`).
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import { IllegalArgumentException, Long } from '../../src/agrona/jdk.js';
import { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { BufferClaim } from '../../src/client/logbuffer/BufferClaim.js';
import { FrameDescriptor } from '../../src/client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import { Publication } from '../../src/client/Publication.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { asConductor, asLogBuffers, newFakeLogBuffers, newFakePublicationConductor } from './ClientFakes.js';
import { MockPosition } from './MockPosition.js';

const { HEADER_LENGTH } = DataHeaderFlyweight;
const { PARTITION_COUNT, indexByTermCount, initialiseTailWithTermId } = LogBufferDescriptor;
const { ADMIN_ACTION, MAX_POSITION_EXCEEDED } = Publication;

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
    private readonly publication: ConcurrentPublication;
    private readonly source = new UnsafeBuffer();

    public constructor(
        rawLog: RawLog,
        private readonly start: LogStart,
    ) {
        this.termLength = rawLog.termLength();
        this.maxPayloadLength = start.mtuLength - HEADER_LENGTH;
        this.maxMessageLength = FrameDescriptor.computeMaxMessageLength(this.termLength);
        TestLogProducer.initialiseLog(rawLog, start);
        LogBufferDescriptor.storeDefaultFrameHeader(
            rawLog.metaData(),
            DataHeaderFlyweight.createDefaultHeader(start.sessionId, start.streamId, start.initialTermId),
        );
        const limit = new MockPosition();
        limit.value = Long.MAX_VALUE;
        this.publication = new ConcurrentPublication(
            asConductor(newFakePublicationConductor()),
            'aeron:udp?endpoint=localhost:40124',
            start.streamId,
            start.sessionId,
            limit,
            -1,
            asLogBuffers(newFakeLogBuffers(rawLog.termBuffers(), this.termLength, rawLog.metaData())),
            0,
            0,
        );
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
        return this.publication.position();
    }

    /**
     * `Publication.offer`: an unfragmented frame when the message fits in one frame, otherwise fragments, all in one
     * claim of the tail.
     *
     * @return the position after the message.
     */
    public offer(message: Uint8Array): number {
        this.source.wrap(message);
        for (let attempt = 0; attempt < 8; attempt++) {
            const position = this.publication.offer(this.source, 0, message.length);
            if (ADMIN_ACTION !== position) {
                return TestLogProducer.checked(position);
            }
        }

        throw new Error('the log did not rotate');
    }

    /**
     * `Publication.tryClaim`: claim a frame, to write and `commit()` or `abort()`.
     *
     * @return the claim and the position after it.
     */
    public tryClaim(length: number): { claim: BufferClaim; position: number } {
        const claim = new BufferClaim();
        for (let attempt = 0; attempt < 8; attempt++) {
            const position = this.publication.tryClaim(length, claim);
            if (ADMIN_ACTION !== position) {
                return { claim, position: TestLogProducer.checked(position) };
            }
        }

        throw new Error('the log did not rotate');
    }

    private static checked(position: number): number {
        if (MAX_POSITION_EXCEEDED === position) {
            throw new Error('MAX_POSITION_EXCEEDED');
        }
        if (position < 0) {
            throw new IllegalArgumentException('the offer failed: ' + Publication.errorString(position));
        }

        return position;
    }
}
