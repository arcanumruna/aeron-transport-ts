// Extra tests of phase 3 T3 (port-only): the static registry that stands for `Class.forName` (spec D25, D118) for the
// flow control strategies and suppliers, the preferred strategy, and the module graph: any flow control module can be
// the first one imported (a cycle through the `extends` of a strategy would be a `ReferenceError` for some orders).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClassNotFoundException } from '../../../src/agrona/jdk.js';
import { System } from '../../../src/agrona/jdkLang.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { DefaultMulticastFlowControlSupplier } from '../../../src/driver/DefaultMulticastFlowControlSupplier.js';
import { DefaultUnicastFlowControlSupplier } from '../../../src/driver/DefaultUnicastFlowControlSupplier.js';
import { FlowControlRegistry } from '../../../src/driver/FlowControlRegistry.js';
import { MaxMulticastFlowControl } from '../../../src/driver/MaxMulticastFlowControl.js';
import { MaxMulticastFlowControlSupplier } from '../../../src/driver/MaxMulticastFlowControlSupplier.js';
import { UdpChannel } from '../../../src/driver/media/UdpChannel.js';
import { MinMulticastFlowControl } from '../../../src/driver/MinMulticastFlowControl.js';
import { MinMulticastFlowControlSupplier } from '../../../src/driver/MinMulticastFlowControlSupplier.js';
import { PreferredMulticastFlowControl } from '../../../src/driver/PreferredMulticastFlowControl.js';
import { PreferredMulticastFlowControlSupplier } from '../../../src/driver/PreferredMulticastFlowControlSupplier.js';
import { TaggedMulticastFlowControl } from '../../../src/driver/TaggedMulticastFlowControl.js';
import { TaggedMulticastFlowControlSupplier } from '../../../src/driver/TaggedMulticastFlowControlSupplier.js';
import { UnicastFlowControl } from '../../../src/driver/UnicastFlowControl.js';
import { assertThrows } from '../../support/Assertions.js';

const CHANNEL = UdpChannel.parse('aeron:udp?endpoint=224.20.30.39:54326|interface=localhost');

const STRATEGIES: [string, new () => object][] = [
    ['io.aeron.driver.MaxMulticastFlowControl', MaxMulticastFlowControl],
    ['io.aeron.driver.MinMulticastFlowControl', MinMulticastFlowControl],
    ['io.aeron.driver.TaggedMulticastFlowControl', TaggedMulticastFlowControl],
    ['io.aeron.driver.PreferredMulticastFlowControl', PreferredMulticastFlowControl],
    ['io.aeron.driver.UnicastFlowControl', UnicastFlowControl],
];

const SUPPLIERS: [string, new () => object, new () => object][] = [
    ['io.aeron.driver.DefaultUnicastFlowControlSupplier', DefaultUnicastFlowControlSupplier, UnicastFlowControl],
    [
        'io.aeron.driver.DefaultMulticastFlowControlSupplier',
        DefaultMulticastFlowControlSupplier,
        MaxMulticastFlowControl,
    ],
    ['io.aeron.driver.MaxMulticastFlowControlSupplier', MaxMulticastFlowControlSupplier, MaxMulticastFlowControl],
    ['io.aeron.driver.MinMulticastFlowControlSupplier', MinMulticastFlowControlSupplier, MinMulticastFlowControl],
    [
        'io.aeron.driver.TaggedMulticastFlowControlSupplier',
        TaggedMulticastFlowControlSupplier,
        TaggedMulticastFlowControl,
    ],
    [
        'io.aeron.driver.PreferredMulticastFlowControlSupplier',
        PreferredMulticastFlowControlSupplier,
        PreferredMulticastFlowControl,
    ],
];

afterEach(() => {
    System.clearProperty(Configuration.UNICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME);
    System.clearProperty(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME);
    System.clearProperty(Configuration.UNICAST_FLOW_CONTROL_STRATEGY_PROP_NAME);
    System.clearProperty(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_PROP_NAME);
    vi.resetModules();
});

describe('FlowControlRegistryExtraTest', () => {
    it.each(STRATEGIES)('the registry gives a new %s for its class name', (name, type) => {
        const first = FlowControlRegistry.newFlowControl(name);

        expect(first.constructor).toBe(type);
        expect(FlowControlRegistry.newFlowControl(name)).not.toBe(first);
    });

    it.each(SUPPLIERS)('the registry gives a new %s for its class name', (name, type) => {
        expect(FlowControlRegistry.newFlowControlSupplier(name).constructor).toBe(type);
    });

    it.each(['', 'x.Y', 'io.aeron.driver.AbstractMinMulticastFlowControl', 'MaxMulticastFlowControl'])(
        'the registry refuses the class name %j with a ClassNotFoundException carrying the name',
        (name) => {
            const strategy = assertThrows(ClassNotFoundException, () => FlowControlRegistry.newFlowControl(name));
            const supplier = assertThrows(ClassNotFoundException, () =>
                FlowControlRegistry.newFlowControlSupplier(name),
            );

            expect(strategy.message).toContain(name);
            expect(supplier.message).toContain(name);
        },
    );

    it.each(SUPPLIERS)('the supplier properties accept the class name %s', (name, type) => {
        System.setProperty(Configuration.UNICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME, name);
        System.setProperty(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME, name);

        expect(Configuration.unicastFlowControlSupplier().constructor).toBe(type);
        expect(Configuration.multicastFlowControlSupplier().constructor).toBe(type);
    });

    it('the suppliers give the strategy of their class', () => {
        for (const [name, , strategy] of SUPPLIERS.slice(2)) {
            expect(FlowControlRegistry.newFlowControlSupplier(name).newInstance(CHANNEL, 1, 2).constructor).toBe(
                strategy,
            );
        }
    });

    it.each(STRATEGIES.filter(([name]) => !name.endsWith('UnicastFlowControl')))(
        'the default multicast supplier gives %s when the property names it',
        async (name, type) => {
            vi.resetModules();
            const { System: FreshSystem } = await import('../../../src/agrona/jdkLang.js');
            FreshSystem.setProperty(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_PROP_NAME, name);
            const { DefaultMulticastFlowControlSupplier: Fresh } =
                await import('../../../src/driver/DefaultMulticastFlowControlSupplier.js');
            const { UdpChannel: FreshChannel } = await import('../../../src/driver/media/UdpChannel.js');

            const flowControl = new Fresh().newInstance(
                FreshChannel.parse('aeron:udp?endpoint=224.20.30.39:54326|interface=localhost'),
                1,
                2,
            );

            expect(flowControl.constructor.name).toBe(type.name);
            expect(new Fresh().toString()).toBe('DefaultMulticastFlowControlSupplier{flowControlClass=' + name + '}');
        },
    );

    it('the default suppliers refuse a strategy class name that is not registered', async () => {
        vi.resetModules();
        const { System: FreshSystem } = await import('../../../src/agrona/jdkLang.js');
        FreshSystem.setProperty(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_PROP_NAME, 'x.Y');
        FreshSystem.setProperty(Configuration.UNICAST_FLOW_CONTROL_STRATEGY_PROP_NAME, 'x.Z');
        const multicast = await import('../../../src/driver/DefaultMulticastFlowControlSupplier.js');
        const unicast = await import('../../../src/driver/DefaultUnicastFlowControlSupplier.js');
        const { UdpChannel: FreshChannel } = await import('../../../src/driver/media/UdpChannel.js');
        const { ClassNotFoundException: Fresh } = await import('../../../src/agrona/jdk.js');
        const channel = FreshChannel.parse('aeron:udp?endpoint=224.20.30.39:54326|interface=localhost');

        expect(() => new multicast.DefaultMulticastFlowControlSupplier().newInstance(channel, 1, 2)).toThrowError(
            Fresh,
        );
        expect(() => new unicast.DefaultUnicastFlowControlSupplier().newInstance(channel, 1, 2)).toThrowError(Fresh);
    });

    it('the default unicast supplier gives a registered strategy when the property names it', async () => {
        vi.resetModules();
        const { System: FreshSystem } = await import('../../../src/agrona/jdkLang.js');
        FreshSystem.setProperty(
            Configuration.UNICAST_FLOW_CONTROL_STRATEGY_PROP_NAME,
            'io.aeron.driver.MaxMulticastFlowControl',
        );
        const { DefaultUnicastFlowControlSupplier: Fresh } =
            await import('../../../src/driver/DefaultUnicastFlowControlSupplier.js');
        const { UdpChannel: FreshChannel } = await import('../../../src/driver/media/UdpChannel.js');

        const flowControl = new Fresh().newInstance(FreshChannel.parse('aeron:udp?endpoint=localhost:5555'), 1, 2);

        expect(flowControl.constructor.name).toBe('MaxMulticastFlowControl');
    });
});

describe('PreferredMulticastFlowControl', () => {
    it('is a TaggedMulticastFlowControl with the ASF constants of Java', () => {
        expect(new PreferredMulticastFlowControl()).toBeInstanceOf(TaggedMulticastFlowControl);
        expect(PreferredMulticastFlowControl.PREFERRED_ASF_PROP_NAME).toBe('aeron.PreferredMulticastFlowControl.asf');
        expect(PreferredMulticastFlowControl.PREFERRED_ASF_DEFAULT).toBe('FFFFFFFFFFFFFFFF');
        expect(PreferredMulticastFlowControl.PREFERRED_ASF).toBe('FFFFFFFFFFFFFFFF');
        expect([...PreferredMulticastFlowControl.PREFERRED_ASF_BYTES]).toEqual([-1, -1, -1, -1, -1, -1, -1, -1]);
    });

    it('PREFERRED_ASF_BYTES are the signed bytes of the property, read when the module loads', async () => {
        vi.resetModules();
        const { System: FreshSystem } = await import('../../../src/agrona/jdkLang.js');
        FreshSystem.setProperty('aeron.PreferredMulticastFlowControl.asf', '7F80010203040506');
        const { PreferredMulticastFlowControl: Fresh } =
            await import('../../../src/driver/PreferredMulticastFlowControl.js');

        expect(Fresh.PREFERRED_ASF).toBe('7F80010203040506');
        expect([...Fresh.PREFERRED_ASF_BYTES]).toEqual([0x7f, -128, 1, 2, 3, 4, 5, 6]);
    });
});

describe('the module graph of the flow control', () => {
    const MODULES: [string, () => Promise<unknown>][] = [
        ['AbstractMinMulticastFlowControl', () => import('../../../src/driver/AbstractMinMulticastFlowControl.js')],
        ['MinMulticastFlowControl', () => import('../../../src/driver/MinMulticastFlowControl.js')],
        ['MinMulticastFlowControlSupplier', () => import('../../../src/driver/MinMulticastFlowControlSupplier.js')],
        ['TaggedMulticastFlowControl', () => import('../../../src/driver/TaggedMulticastFlowControl.js')],
        [
            'TaggedMulticastFlowControlSupplier',
            () => import('../../../src/driver/TaggedMulticastFlowControlSupplier.js'),
        ],
        ['PreferredMulticastFlowControl', () => import('../../../src/driver/PreferredMulticastFlowControl.js')],
        [
            'PreferredMulticastFlowControlSupplier',
            () => import('../../../src/driver/PreferredMulticastFlowControlSupplier.js'),
        ],
        ['PreferredMulticastFlowControlAsf', () => import('../../../src/driver/PreferredMulticastFlowControlAsf.js')],
        ['MaxMulticastFlowControl', () => import('../../../src/driver/MaxMulticastFlowControl.js')],
        ['MaxMulticastFlowControlSupplier', () => import('../../../src/driver/MaxMulticastFlowControlSupplier.js')],
        ['UnicastFlowControl', () => import('../../../src/driver/UnicastFlowControl.js')],
        [
            'DefaultMulticastFlowControlSupplier',
            () => import('../../../src/driver/DefaultMulticastFlowControlSupplier.js'),
        ],
        ['DefaultUnicastFlowControlSupplier', () => import('../../../src/driver/DefaultUnicastFlowControlSupplier.js')],
        ['FlowControl', () => import('../../../src/driver/FlowControl.js')],
        ['FlowControlRegistry', () => import('../../../src/driver/FlowControlRegistry.js')],
        ['Configuration', () => import('../../../src/driver/Configuration.js')],
        ['MediaDriver', () => import('../../../src/driver/MediaDriver.js')],
    ];

    it.each(MODULES)('%s can be the first module imported', async (_name, importModule) => {
        vi.resetModules();

        await expect(importModule()).resolves.toBeDefined();
    });
});
