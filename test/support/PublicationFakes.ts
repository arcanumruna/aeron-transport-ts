// Fakes for the types that later tasks port (spec D24): the part of `DriverConductorProxy` that `NetworkPublication`
// calls, the members of `NetworkPublication` that the channel endpoint calls (`mock(NetworkPublication.class)`), and the
// members of `PublicationImage` and `Receiver` that the `DataPacketDispatcher` calls (T16).
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';
import type { NetworkPublication } from '../../src/driver/NetworkPublication.js';
import type { PublicationImage } from '../../src/driver/PublicationImage.js';
import type { Receiver } from '../../src/driver/Receiver.js';
import { newFakeConductorProxy, type FakeConductorProxy } from './ConductorProxyFake.js';
import type { Fake } from './Mockito.js';

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

/** The members of a `PublicationImage` that a `DataPacketDispatcher` calls. */
export type DispatcherImage = Pick<
    PublicationImage,
    | 'sessionId'
    | 'streamId'
    | 'correlationId'
    | 'isEndOfStream'
    | 'activate'
    | 'deactivate'
    | 'insertPacket'
    | 'addDestinationConnectionIfUnknown'
    | 'onRttMeasurement'
>;

/**
 * `mock(PublicationImage.class)` for the dispatcher: an object whose members are the spies of `Fake`, typed as the
 * class too (the class has private members, so a fake is made by a cast, as for `NetworkPublication`).
 */
export type ImageFake = Fake<DispatcherImage> & PublicationImage;

export function asImageFake(fake: Fake<DispatcherImage>): ImageFake {
    return fake as unknown as ImageFake;
}

/** The member of the `Receiver` that a `DataPacketDispatcher` calls. */
export type DispatcherReceiver = Pick<Receiver, 'addPendingSetupMessage'>;

/** `mock(Receiver.class)` for the dispatcher, as {@link ImageFake}. */
export type ReceiverFake = Fake<DispatcherReceiver> & Receiver;

export function asReceiverFake(fake: Fake<DispatcherReceiver>): ReceiverFake {
    return fake as unknown as ReceiverFake;
}

/** A hand-written image that implements the members of {@link DispatcherImage}, as the class (for the allocation tests and benches). */
export function asPublicationImage(image: DispatcherImage): PublicationImage {
    return image as unknown as PublicationImage;
}

/** A hand-written receiver that implements {@link DispatcherReceiver}, as the class. */
export function asReceiver(receiver: DispatcherReceiver): Receiver {
    return receiver as unknown as Receiver;
}
