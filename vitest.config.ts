import { defineConfig } from 'vitest/config';

// The ported Aeron system tests (phase 3, D115) use the fixed ports and multicast groups of the Java tests (`localhost:24325`,
// `224.20.30.39:24326`, ...). Two of them at once would bind one port or see each other's multicast receivers (a flow control
// test counts the receivers of its group), so they run one file at a time in a project of their own. The rest run in parallel
// and use free ports.
const SERIAL_PORT_TESTS = [
    'test/extra/driver/media/UdpChannelTransportMulticastExtraTest.test.ts',
    'test/system/ChannelEndpointStatusTest.test.ts',
    'test/system/MaxFlowControlStrategySystemTest.test.ts',
    'test/system/MdsAndMdcInteractionTest.test.ts',
    'test/system/MinFlowControlSystemTest.test.ts',
    'test/system/MultiDestinationCastTest.test.ts',
    'test/system/MultiDestinationCastWithoutSpyExtraTest.test.ts',
    'test/system/MultiDestinationSubscriptionTest.test.ts',
    'test/system/MultiDriverTest.test.ts',
    'test/system/MultipleMulticastsSubscriptionsTest.test.ts',
    'test/system/MulticastProbeTest.test.ts',
    'test/system/PubAndSubTest.test.ts',
    'test/system/TaggedFlowControlSystemTest.test.ts',
];

const common = {
    // test/interop needs the Aeron C build: it has its own config and script (`npm run test:interop`)
    exclude: ['test/scripts/fixtures/**', 'test/interop/**', 'node_modules/**'],
    testTimeout: 10_000,
};

export default defineConfig({
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'parallel',
                    include: ['test/**/*.test.ts'],
                    ...common,
                    exclude: [...common.exclude, ...SERIAL_PORT_TESTS],
                },
            },
            {
                extends: true,
                test: {
                    name: 'serial-ports',
                    include: SERIAL_PORT_TESTS,
                    ...common,
                    fileParallelism: false,
                },
            },
        ],
    },
});
