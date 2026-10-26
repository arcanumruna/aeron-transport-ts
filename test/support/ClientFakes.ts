// Fakes for the types that T19 ports (spec D80, D83): the `ClientConductor` and the `LogBuffers` as far as `Publication`,
// `Image` and `Subscription` call them (Mockito: `mock(ClientConductor.class)`, `mock(LogBuffers.class)`), with the
// `vi.fn` members that the ported tests stub and verify. Each fake is a hand-written object with some members of the
// real class; `asConductor` and `asLogBuffers` hand it to a constructor as the class (the class has private members).
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { UnsafeBuffer } from '../../src/agrona/concurrent/UnsafeBuffer.js';
import type { CountersReader } from '../../src/agrona/concurrent/status/CountersReader.js';
import type { ClientConductor } from '../../src/client/ClientConductor.js';
import type { LogBuffers } from '../../src/client/LogBuffers.js';

/** The members of the real `LogBuffers` that the tests of `Publication` and `Image` stub. */
export type LogBuffersMember = 'metaDataBuffer' | 'termLength' | 'duplicateTermBuffers' | 'fileChannel';

/** `mock(LogBuffers.class)` with the calls that the tests of `Publication` and `Image` stub. */
export type FakeLogBuffers = {
    [K in LogBuffersMember]: Mock<LogBuffers[K]>;
};

/** A fake with some members of the real `LogBuffers`, as the `LogBuffers`. */
export function asLogBuffers(fake: Pick<LogBuffers, LogBuffersMember>): LogBuffers {
    return fake as unknown as LogBuffers;
}

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

export type PublicationConductorMember =
    | 'removePublication'
    | 'channelStatus'
    | 'countersReader'
    | 'addDestination'
    | 'removeDestination'
    | 'asyncAddDestination'
    | 'asyncRemoveDestination';

export type SubscriptionConductorMember =
    | 'removeSubscription'
    | 'channelStatus'
    | 'countersReader'
    | 'addRcvDestination'
    | 'removeRcvDestination'
    | 'asyncAddRcvDestination'
    | 'asyncRemoveRcvDestination'
    | 'closeImages'
    | 'releaseLogBuffers'
    | 'rejectImage';

/** `mock(ClientConductor.class)` as far as `Publication` calls it; a mock answers 0 and does nothing. */
export type FakePublicationConductor = {
    [K in PublicationConductorMember]: Mock<ClientConductor[K]>;
};

/** A fake with some members of the real `ClientConductor`, as the `ClientConductor`. */
export function asConductor(fake: Partial<Record<keyof ClientConductor, unknown>>): ClientConductor {
    return fake as unknown as ClientConductor;
}

export function newFakePublicationConductor(): FakePublicationConductor {
    return {
        removePublication: vi.fn(),
        channelStatus: vi.fn(() => 0),
        countersReader: vi.fn(() => null as unknown as CountersReader),
        addDestination: vi.fn(),
        removeDestination: vi.fn(),
        asyncAddDestination: vi.fn(() => 0),
        asyncRemoveDestination: vi.fn(() => 0),
    } as unknown as FakePublicationConductor;
}

/** `mock(ClientConductor.class)` as far as `Subscription` calls it; a mock answers 0 and does nothing. */
export type FakeSubscriptionConductor = {
    [K in SubscriptionConductorMember]: Mock<ClientConductor[K]>;
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
    } as unknown as FakeSubscriptionConductor;
}
