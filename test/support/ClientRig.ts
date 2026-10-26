// A publication and an image over the same log, as the client sees one stream: the term buffers and the meta data of
// the log (on an ArrayBuffer or a SharedArrayBuffer, spec D16), initialised as the conductor does
// (`TestLogProducer.initialiseLog`), a `ConcurrentPublication` or an `ExclusivePublication` over it with a limit that
// the test sets, and an `Image` of a `Subscription` whose subscriber position is a field. The conductor, the log buffers
// and the error handler are the fakes of `ClientFakes.ts` (spec D80), so a test of `Publication`, `Image` and
// `Subscription` runs them against each other on the real code of the log, with no driver.
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { ErrorHandler } from '../../src/agrona/ErrorHandler.js';
import { Long } from '../../src/agrona/jdk.js';
import { ConcurrentPublication } from '../../src/client/ConcurrentPublication.js';
import { ExclusivePublication } from '../../src/client/ExclusivePublication.js';
import { Image } from '../../src/client/Image.js';
import { LogBufferDescriptor } from '../../src/client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../../src/client/protocol/DataHeaderFlyweight.js';
import type { LogBuffers } from '../../src/client/LogBuffers.js';
import type { Publication } from '../../src/client/Publication.js';
import { Subscription } from '../../src/client/Subscription.js';
import type { RawLog } from '../../src/driver/buffer/RawLog.js';
import { ARRAY_BACKING } from './Backing.js';
import type { Backing } from './Backing.js';
import { AtomicLongPosition } from './AtomicLongPosition.js';
import { asConductor, asLogBuffers, newFakePublicationConductor, newFakeSubscriptionConductor } from './ClientFakes.js';
import type { FakePublicationConductor, FakeSubscriptionConductor } from './ClientFakes.js';
import { MockPosition } from './MockPosition.js';
import { TestLogProducer } from './TestLogProducer.js';

export interface ClientRigOptions {
    readonly backing?: Backing;
    readonly termLength?: number;
    readonly mtuLength?: number;
    readonly initialTermId?: number;
    readonly sessionId?: number;
    readonly streamId?: number;
    /** The term count (position / term length) at which the stream starts. */
    readonly termCount?: number;
    /** The term offset at which the stream starts, a multiple of 32. */
    readonly termOffset?: number;
    readonly exclusive?: boolean;
}

export class ClientRig {
    public static readonly CHANNEL = 'aeron:udp?endpoint=localhost:40124';
    public static readonly REGISTRATION_ID = 1000;
    public static readonly CORRELATION_ID = 2000;

    public readonly termLength: number;
    public readonly mtuLength: number;
    public readonly initialTermId: number;
    public readonly sessionId: number;
    public readonly streamId: number;
    public readonly rawLog: RawLog;
    /** Plain functions, not `vi.fn`: a spy records its calls, and the allocation tests run through these. */
    public readonly logBuffers: LogBuffers;
    public readonly publicationConductor: FakePublicationConductor;
    public readonly subscriptionConductor: FakeSubscriptionConductor;
    public readonly limit = new MockPosition();
    public readonly publication: Publication;
    public readonly subscriberPosition: AtomicLongPosition;
    public readonly errors: Error[] = [];
    public readonly errorHandler: ErrorHandler & { onError: Mock<(error: Error) => void> };
    public readonly subscription: Subscription;
    public readonly image: Image;
    public readonly startPosition: number;

    public constructor(options: ClientRigOptions = {}) {
        const backing = options.backing ?? ARRAY_BACKING;
        this.termLength = options.termLength ?? LogBufferDescriptor.TERM_MIN_LENGTH;
        this.mtuLength = options.mtuLength ?? 4096;
        this.initialTermId = options.initialTermId ?? 7;
        this.sessionId = options.sessionId ?? 42;
        this.streamId = options.streamId ?? 111;
        const termCount = options.termCount ?? 0;
        const termOffset = options.termOffset ?? 0;

        const termBuffers = [0, 1, 2].map((): UnsafeBuffer => new UnsafeBuffer(backing.arrayBuffer(this.termLength)));
        const metaData = new UnsafeBuffer(
            backing.aligned(LogBufferDescriptor.LOG_META_DATA_LENGTH, 64) as ArrayBuffer | SharedArrayBuffer,
        );
        this.rawLog = {
            termLength: () => this.termLength,
            termBuffers: () => termBuffers,
            metaData: () => metaData,
            fileName: () => 'stream.log',
            free: () => true,
            close: () => {},
        };
        TestLogProducer.initialiseLog(this.rawLog, {
            sessionId: this.sessionId,
            streamId: this.streamId,
            initialTermId: this.initialTermId,
            mtuLength: this.mtuLength,
            termCount,
            termOffset,
        });
        LogBufferDescriptor.storeDefaultFrameHeader(
            metaData,
            DataHeaderFlyweight.createDefaultHeader(this.sessionId, this.streamId, this.initialTermId),
        );
        LogBufferDescriptor.pageSize(metaData, 4096);
        // the conductor seeds the end of the stream with `Long.MAX_VALUE` (spec D12)
        LogBufferDescriptor.endOfStreamPosition(metaData, Long.MAX_VALUE);
        this.startPosition = LogBufferDescriptor.computePosition(
            (this.initialTermId + termCount) | 0,
            termOffset,
            LogBufferDescriptor.positionBitsToShift(this.termLength),
            this.initialTermId,
        );

        this.logBuffers = asLogBuffers({
            metaDataBuffer: () => metaData,
            termLength: () => this.termLength,
            duplicateTermBuffers: () => termBuffers,
            fileChannel: () => null,
        });
        this.publicationConductor = newFakePublicationConductor();
        this.subscriptionConductor = newFakeSubscriptionConductor();
        this.limit.value = Long.MAX_VALUE;

        const Class = options.exclusive ? ExclusivePublication : ConcurrentPublication;
        this.publication = new Class(
            asConductor(this.publicationConductor),
            ClientRig.CHANNEL,
            this.streamId,
            this.sessionId,
            this.limit,
            -1,
            this.logBuffers,
            ClientRig.REGISTRATION_ID,
            ClientRig.REGISTRATION_ID,
        );

        this.errorHandler = { onError: vi.fn((error: Error) => void this.errors.push(error)) };
        this.subscriberPosition = new AtomicLongPosition(0, this.startPosition);
        this.subscription = new Subscription(
            asConductor(this.subscriptionConductor),
            ClientRig.CHANNEL,
            this.streamId,
            ClientRig.REGISTRATION_ID,
            { onAvailableImage: () => {} },
            { onUnavailableImage: () => {} },
        );
        this.image = new Image(
            this.subscription,
            this.sessionId,
            this.subscriberPosition,
            this.logBuffers,
            this.errorHandler,
            'test',
            ClientRig.CORRELATION_ID,
        );
        this.subscription.addImage(this.image);
    }

    /**
     * What the driver does as the sender moves on (`NetworkPublication.cleanBuffer`): zero the term that the next
     * rotation of the log will use, which the reader has consumed. The publication writes over the frames of the
     * term before it, and a reader that ran into the old frames beyond the tail would read them as new ones. Call it
     * after the rotation (`ADMIN_ACTION`) or after the reader has caught up.
     */
    public cleanNextTerm(): void {
        const meta = this.rawLog.metaData();
        const next = LogBufferDescriptor.indexByTermCount(LogBufferDescriptor.activeTermCount(meta) + 1);
        const termBuffer = this.rawLog.termBuffers()[next] as UnsafeBuffer;
        termBuffer.setMemory(0, termBuffer.capacity(), 0);
    }
}
