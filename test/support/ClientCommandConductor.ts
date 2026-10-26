// `mock(DriverConductor.class)` for the members that `ClientCommandAdapter` calls: a hand fake of those members of the
// `DriverConductor`. Each member is a `vi.fn` that does nothing; `notAcceptingClientCommands` answers `false`, as a
// Mockito mock does. The fake is typed as the conductor class (the members the adapter does not call are absent).
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { DriverConductor } from '../../src/driver/DriverConductor.js';

type Loose = (...args: never[]) => unknown;

/** The members of the conductor that the `ClientCommandAdapter` calls (formerly the interface `ClientCommandConductor`). */
export type AdapterMember =
    | 'notAcceptingClientCommands'
    | 'onAddIpcPublication'
    | 'onAddNetworkPublication'
    | 'onRemovePublication'
    | 'onAddIpcSubscription'
    | 'onAddSpySubscription'
    | 'onAddNetworkSubscription'
    | 'onRemoveSubscription'
    | 'onAddSendDestination'
    | 'onRemoveSendDestination'
    | 'onAddRcvDestination'
    | 'onRemoveRcvDestination'
    | 'onClientKeepalive'
    | 'onClientClose'
    | 'onTerminateDriver'
    | 'onRejectImage';

export type ClientCommandConductor = Pick<DriverConductor, AdapterMember>;

export type FakeConductor = DriverConductor & {
    [K in AdapterMember]: Mock<Loose> & DriverConductor[K];
};

export function fakeConductor(): FakeConductor {
    return {
        notAcceptingClientCommands: vi.fn<() => boolean>(() => false),
        onAddIpcPublication: vi.fn(),
        onAddNetworkPublication: vi.fn(),
        onRemovePublication: vi.fn(),
        onAddIpcSubscription: vi.fn(),
        onAddSpySubscription: vi.fn(),
        onAddNetworkSubscription: vi.fn(),
        onRemoveSubscription: vi.fn(),
        onAddSendDestination: vi.fn(),
        onRemoveSendDestination: vi.fn(),
        onAddRcvDestination: vi.fn(),
        onRemoveRcvDestination: vi.fn(),
        onClientKeepalive: vi.fn(),
        onClientClose: vi.fn(),
        onTerminateDriver: vi.fn(),
        onRejectImage: vi.fn(),
    } as unknown as FakeConductor;
}

/** A hand fake with some members of the conductor, as the conductor: the class has private members. */
export function asConductor(fake: object): DriverConductor {
    return fake as unknown as DriverConductor;
}
