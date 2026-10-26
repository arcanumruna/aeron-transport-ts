// Fakes for the types that later tasks port (spec D24): the part of `DriverConductorProxy` that `NetworkPublication`
// calls, and the members of `NetworkPublication` that the channel endpoint calls (`mock(NetworkPublication.class)`).
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';
import type { NetworkPublication } from '../../src/driver/NetworkPublication.js';
import { newFakeConductorProxy, type FakeConductorProxy } from './ConductorProxyFake.js';

/** The members of a publication that a `SendChannelEndpoint` calls. */
export type EndpointPublication = Pick<
    NetworkPublication,
    | 'sessionId'
    | 'streamId'
    | 'termBufferLength'
    | 'isValidStatusMessage'
    | 'timeOfLastStatusMessageNs'
    | 'triggerSendSetupFrame'
    | 'onStatusMessage'
    | 'onError'
    | 'onNak'
    | 'onRttMeasurement'
    | 'responseCorrelationId'
>;

/** A fake publication is a `NetworkPublication` as far as the endpoint calls it (Mockito: `mock(NetworkPublication.class)`). */
export function asNetworkPublication(publication: EndpointPublication): NetworkPublication {
    return publication as unknown as NetworkPublication;
}

/**
 * `when(mock.member()).thenReturn(value)` for a member that has overloads (`vi.mocked` types only the last one, which
 * is the setter of a flyweight member).
 */
export function whenReturn(member: unknown, value: unknown): void {
    vi.mocked(member as () => unknown).mockReturnValue(value);
}

/** `mock(DriverConductorProxy.class)` as far as `NetworkPublication`, the `Sender` and the endpoints call it. */
export type ConductorProxyFake = FakeConductorProxy & {
    responseConnected: Mock<DriverConductorProxy['responseConnected']>;
    onPublicationError: Mock<DriverConductorProxy['onPublicationError']>;
    sendChannelEndpointClosed: Mock<DriverConductorProxy['sendChannelEndpointClosed']>;
};

export function mockConductorProxy(): ConductorProxyFake {
    const fake = newFakeConductorProxy() as unknown as Record<string, unknown>;
    fake['responseConnected'] = vi.fn<DriverConductorProxy['responseConnected']>();
    fake['onPublicationError'] = vi.fn<DriverConductorProxy['onPublicationError']>();
    fake['sendChannelEndpointClosed'] = vi.fn<DriverConductorProxy['sendChannelEndpointClosed']>();
    return fake as unknown as ConductorProxyFake;
}
