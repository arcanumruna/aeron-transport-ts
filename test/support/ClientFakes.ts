// Fakes for the types that T19 ports (spec D80): the `ClientConductor` and the `LogBuffers` as far as `Publication`,
// `Image` and `Subscription` call them (Mockito: `mock(ClientConductor.class)`, `mock(LogBuffers.class)`), with the
// `vi.fn` members that the ported tests stub and verify.
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import type { ImageLogBuffers } from '../../src/client/Image.js';
import type { PublicationClientConductor, PublicationLogBuffers } from '../../src/client/Publication.js';
import type { SubscriptionClientConductor } from '../../src/client/Subscription.js';

/** `mock(LogBuffers.class)` with the three calls that the tests of `Publication` and `Image` stub. */
export type FakeLogBuffers = {
    [K in keyof (PublicationLogBuffers & ImageLogBuffers)]: Mock<(PublicationLogBuffers & ImageLogBuffers)[K]>;
};

/**
 * `when(logBuffers.duplicateTermBuffers()).thenReturn(termBuffers)`, `when(logBuffers.termLength())
 * .thenReturn(termLength)` and `when(logBuffers.metaDataBuffer()).thenReturn(metaDataBuffer)`. `fileChannel()` answers
 * `null`, as a mock does.
 */
export function newFakeLogBuffers(
    termBuffers: UnsafeBuffer[],
    termLength: number,
    metaDataBuffer: UnsafeBuffer,
): FakeLogBuffers {
    return {
        duplicateTermBuffers: vi.fn(() => termBuffers),
        termLength: vi.fn(() => termLength),
        metaDataBuffer: vi.fn(() => metaDataBuffer),
        fileChannel: vi.fn(() => null),
    };
}

/** `mock(ClientConductor.class)` as far as `Publication` calls it; a mock answers 0 and does nothing. */
export type FakePublicationConductor = {
    [K in keyof PublicationClientConductor]: Mock<PublicationClientConductor[K]>;
};

export function newFakePublicationConductor(): FakePublicationConductor {
    return {
        removePublication: vi.fn(),
        channelStatus: vi.fn(() => 0),
        countersReader: vi.fn(() => null as unknown as CountersReader),
        addDestination: vi.fn(),
        removeDestination: vi.fn(),
        asyncAddDestination: vi.fn(() => 0),
        asyncRemoveDestination: vi.fn(() => 0),
    };
}

/** `mock(ClientConductor.class)` as far as `Subscription` calls it; a mock answers 0 and does nothing. */
export type FakeSubscriptionConductor = {
    [K in keyof SubscriptionClientConductor]: Mock<SubscriptionClientConductor[K]>;
};

export function newFakeSubscriptionConductor(): FakeSubscriptionConductor {
    return {
        removeSubscription: vi.fn(),
        channelStatus: vi.fn(() => 0),
        countersReader: vi.fn(() => null as unknown as CountersReader),
        addRcvDestination: vi.fn(),
        removeRcvDestination: vi.fn(),
        asyncAddRcvDestination: vi.fn(() => 0),
        asyncRemoveRcvDestination: vi.fn(() => 0),
        closeImages: vi.fn(),
        releaseLogBuffers: vi.fn(),
        rejectImage: vi.fn(),
    };
}
