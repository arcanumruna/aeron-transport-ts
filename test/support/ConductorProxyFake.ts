// `mock(DriverConductorProxy.class)` for the members the channel endpoints and the data packet dispatcher call: an
// object of the type `DriverConductorProxy` (T17) whose four members are `vi.fn` or do nothing. The class has private
// fields, so a fake is made by this module and typed as the class, with the members the tests use as `Mock`s.
import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { DriverConductorProxy } from '../../src/driver/DriverConductorProxy.js';

type Called = 'reResolveEndpoint' | 'reResolveControl' | 'responseSetup' | 'createPublicationImage';

export type FakeConductorProxy = DriverConductorProxy & {
    [K in Called]: Mock<DriverConductorProxy[K]>;
};

/** A proxy whose members record their calls (Mockito's `mock(DriverConductorProxy.class)`). */
export function newFakeConductorProxy(): FakeConductorProxy {
    return {
        reResolveEndpoint: vi.fn<DriverConductorProxy['reResolveEndpoint']>(),
        reResolveControl: vi.fn<DriverConductorProxy['reResolveControl']>(),
        responseSetup: vi.fn<DriverConductorProxy['responseSetup']>(),
        createPublicationImage: vi.fn<DriverConductorProxy['createPublicationImage']>(),
    } as unknown as FakeConductorProxy;
}

/** A proxy whose members do nothing and record nothing (a recording `vi.fn` allocates), for the allocation tests. */
export function newPlainConductorProxy(): DriverConductorProxy {
    return {
        reResolveEndpoint: () => {},
        reResolveControl: () => {},
        responseSetup: () => {},
        createPublicationImage: () => {},
    } as unknown as DriverConductorProxy;
}
