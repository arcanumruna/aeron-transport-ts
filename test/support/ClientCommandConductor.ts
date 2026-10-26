// `mock(DriverConductor.class)` for the members that `ClientCommandAdapter` calls: a hand fake of the narrow
// `ClientCommandConductor` interface (the conductor is ported by T18). Each member is a `vi.fn` that does nothing;
// `notAcceptingClientCommands` answers `false`, as a Mockito mock does.
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ClientCommandConductor } from '../../src/driver/ClientCommandAdapter.js';

type Loose = (...args: never[]) => unknown;

export type FakeConductor = ClientCommandConductor & {
    [K in keyof ClientCommandConductor]: Mock<Loose> & ClientCommandConductor[K];
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
