// Not in Aeron: the T7b classes against Java's literal values and edge cases. `Configuration` constants and readers,
// `MediaDriver.Context` (conclude, close, the CnC, the counters, the error handler, the threading modes),
// `CommonContext` instance members, `ThreadingMode.valueOf`, `PublicationParams`, `SubscriptionParams` and
// `BroadcastBufferDescriptor`. Each test names the mutation of the port that turns it red.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AsciiNumberFormatException } from '../../../src/agrona/AsciiNumberFormatException.js';
import { BackoffIdleStrategy } from '../../../src/agrona/concurrent/BackoffIdleStrategy.js';
import { BusySpinIdleStrategy } from '../../../src/agrona/concurrent/BusySpinIdleStrategy.js';
import { BroadcastBufferDescriptor } from '../../../src/agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { ControllableIdleStrategy } from '../../../src/agrona/concurrent/ControllableIdleStrategy.js';
import { DistinctErrorLog } from '../../../src/agrona/concurrent/errors/DistinctErrorLog.js';
import { ErrorLogReader } from '../../../src/agrona/concurrent/errors/ErrorLogReader.js';
import { NoOpIdleStrategy } from '../../../src/agrona/concurrent/NoOpIdleStrategy.js';
import { SleepingIdleStrategy } from '../../../src/agrona/concurrent/SleepingIdleStrategy.js';
import { SleepingMillisIdleStrategy } from '../../../src/agrona/concurrent/SleepingMillisIdleStrategy.js';
import { ConcurrentCountersManager } from '../../../src/agrona/concurrent/status/ConcurrentCountersManager.js';
import { CountersManager } from '../../../src/agrona/concurrent/status/CountersManager.js';
import { UnsafeBufferStatusIndicator } from '../../../src/agrona/concurrent/status/UnsafeBufferStatusIndicator.js';
import { UnsafeBuffer } from '../../../src/agrona/concurrent/UnsafeBuffer.js';
import { YieldingIdleStrategy } from '../../../src/agrona/concurrent/YieldingIdleStrategy.js';
import {
    ClassNotFoundException,
    IllegalArgumentException,
    IllegalStateException,
    Integer,
    Long,
    RuntimeException,
    TimeUnit,
} from '../../../src/agrona/jdk.js';
import { StandardCharsets, System } from '../../../src/agrona/jdkLang.js';
import type { PrintStream } from '../../../src/agrona/jdkThrowable.js';
import { SemanticVersion } from '../../../src/agrona/SemanticVersion.js';
import { Aeron } from '../../../src/client/Aeron.js';
import { ChannelUri } from '../../../src/client/ChannelUri.js';
import { CncFileDescriptor } from '../../../src/client/CncFileDescriptor.js';
import { CommonContext, InferableBoolean } from '../../../src/client/CommonContext.js';
import { ControlProtocolEvents } from '../../../src/client/command/ControlProtocolEvents.js';
import { ConcurrentConcludeException } from '../../../src/client/exceptions/ConcurrentConcludeException.js';
import { ConfigurationException } from '../../../src/client/exceptions/ConfigurationException.js';
import { LogBufferDescriptor } from '../../../src/client/logbuffer/LogBufferDescriptor.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { InvalidChannelException } from '../../../src/driver/exceptions/InvalidChannelException.js';
import { InetSocketAddress } from '../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';
import { MediaDriverVersion } from '../../../src/driver/MediaDriverVersion.js';
import {
    PublicationParams,
    type DriverConductor,
    type PublicationLike,
    type RawLogMetaData as RawLog,
} from '../../../src/driver/PublicationParams.js';
import { SystemCounterDescriptor } from '../../../src/driver/status/SystemCounterDescriptor.js';
import { SubscriptionParams } from '../../../src/driver/SubscriptionParams.js';
import { ThreadingMode } from '../../../src/driver/ThreadingMode.js';
import { assertThrows, assertThrowsExactly } from '../../support/Assertions.js';

const Context = MediaDriver.Context;
type Context = MediaDriver.Context;

/** Properties set by a test, reset after it as the Java tests do. */
const PROPS: string[] = [];
function setProperty(name: string, value: string): void {
    PROPS.push(name);
    System.setProperty(name, value);
}

afterEach(() => {
    for (const name of PROPS.splice(0)) {
        System.clearProperty(name);
    }
});

describe('ConfigurationExtraTest', () => {
    it.each([
        ['FILE_PAGE_SIZE_DEFAULT', 4096],
        ['TERM_BUFFER_LENGTH_DEFAULT', 16 * 1024 * 1024],
        ['TERM_BUFFER_IPC_LENGTH_DEFAULT', 64 * 1024 * 1024],
        ['LOW_FILE_STORE_WARNING_THRESHOLD_DEFAULT', 167772160],
        ['CONDUCTOR_BUFFER_LENGTH_DEFAULT', 1048576 + 768],
        ['TO_CLIENTS_BUFFER_LENGTH_DEFAULT', 1048576 + 128],
        ['COUNTERS_VALUES_BUFFER_LENGTH_DEFAULT', 8388608],
        ['COUNTERS_VALUES_BUFFER_LENGTH_MIN', 1048576],
        ['COUNTERS_VALUES_BUFFER_LENGTH_MAX', 524288000],
        ['ERROR_BUFFER_LENGTH_DEFAULT', 4194304],
        ['LOSS_REPORT_BUFFER_LENGTH_DEFAULT', 1048576],
        ['INITIAL_WINDOW_LENGTH_DEFAULT', 131072],
        ['STATUS_MESSAGE_TIMEOUT_DEFAULT_NS', 200_000_000],
        ['SEND_TO_STATUS_POLL_RATIO_DEFAULT', 6],
        ['RESOURCE_FREE_LIMIT_DEFAULT', 1],
        ['SOCKET_RCVBUF_LENGTH_DEFAULT', 131072],
        ['SOCKET_SNDBUF_LENGTH_DEFAULT', 0],
        ['SOCKET_MULTICAST_TTL_DEFAULT', 0],
        ['PUBLICATION_LINGER_DEFAULT_NS', 5_000_000_000],
        ['CLIENT_LIVENESS_TIMEOUT_DEFAULT_NS', 10_000_000_000],
        ['IMAGE_LIVENESS_TIMEOUT_DEFAULT_NS', 10_000_000_000],
        ['PUBLICATION_UNBLOCK_TIMEOUT_DEFAULT_NS', 15_000_000_000],
        ['PUBLICATION_CONNECTION_TIMEOUT_DEFAULT_NS', 5_000_000_000],
        ['IDLE_MAX_SPINS', 10],
        ['IDLE_MAX_YIELDS', 20],
        ['IDLE_MIN_PARK_NS', 1000],
        ['IDLE_MAX_PARK_NS', 1_000_000],
        ['MAX_UDP_PAYLOAD_LENGTH', 65504],
        ['MTU_LENGTH_DEFAULT', 1408],
        ['IPC_MTU_LENGTH_DEFAULT', 1408],
        ['DEFAULT_TIMER_INTERVAL_NS', 1_000_000_000],
        ['DEFAULT_COUNTER_FREE_TO_REUSE_TIMEOUT_NS', 1_000_000_000],
        ['PUBLICATION_RESERVED_SESSION_ID_LOW_DEFAULT', -1],
        ['PUBLICATION_RESERVED_SESSION_ID_HIGH_DEFAULT', 1000],
        ['COMMAND_DRAIN_LIMIT', 1],
        ['CMD_QUEUE_CAPACITY', 1024],
        ['PENDING_SETUPS_TIMEOUT_NS', 1_000_000_000],
        ['PUBLICATION_SETUP_TIMEOUT_NS', 100_000_000],
        ['PUBLICATION_HEARTBEAT_TIMEOUT_NS', 100_000_000],
        ['NAK_MULTICAST_GROUP_SIZE_DEFAULT', 10],
        ['NAK_MAX_BACKOFF_DEFAULT_NS', 10_000_000],
        ['NAK_UNICAST_DELAY_MIN_VALUE_NS', 1000],
        ['NAK_UNICAST_DELAY_DEFAULT_NS', 1000],
        ['NAK_UNICAST_RETRY_DELAY_RATIO_DEFAULT', 100],
        ['RETRANSMIT_UNICAST_DELAY_DEFAULT_NS', 0],
        ['RETRANSMIT_UNICAST_LINGER_DEFAULT_NS', 10_000_000],
        ['UNTETHERED_WINDOW_LIMIT_TIMEOUT_DEFAULT_NS', 5_000_000_000],
        ['UNTETHERED_RESTING_TIMEOUT_DEFAULT_NS', 10_000_000_000],
        ['MAX_RESEND_DEFAULT', 16],
        ['MAX_RESEND_MAX', 256],
        ['FLOW_CONTROL_RECEIVER_TIMEOUT_DEFAULT_NS', 5_000_000_000],
        ['RE_RESOLUTION_CHECK_INTERVAL_DEFAULT_NS', 1_000_000_000],
        ['CONDUCTOR_CYCLE_THRESHOLD_DEFAULT_NS', 100_000_000],
        ['SENDER_CYCLE_THRESHOLD_DEFAULT_NS', 100_000_000],
        ['RECEIVER_CYCLE_THRESHOLD_DEFAULT_NS', 100_000_000],
        ['NAME_RESOLVER_THRESHOLD_DEFAULT_NS', 5_000_000_000],
        ['STREAM_SESSION_LIMIT_DEFAULT', Integer.MAX_VALUE],
        ['RESOLVER_NEIGHBOR_TIMEOUT_DEFAULT_NS', 10_000_000_000],
        ['RESOLVER_SELF_RESOLUTION_INTERVAL_DEFAULT_NS', 1_000_000_000],
        ['RESOLVER_NEIGHBOR_RESOLUTION_INTERVAL_DEFAULT_NS', 2_000_000_000],
        ['RESOLVER_BOOTSTRAP_NEIGHBOR_RESOLUTION_INTERVAL_DEFAULT_NS', 10_000_000_000],
    ] as [keyof typeof Configuration, number][])("%s is Java's %i", (name, expected) => {
        // mutation: a default is mistyped, or a TimeUnit conversion uses the wrong unit
        expect(Configuration[name]).toBe(expected);
    });

    it.each([
        ['DIR_WARN_IF_EXISTS_PROP_NAME', 'aeron.dir.warn.if.exists'],
        ['TERM_BUFFER_SPARSE_FILE_PROP_NAME', 'aeron.term.buffer.sparse.file'],
        ['GROUP_RECEIVER_CONSIDERATION_PROP_NAME', 'aeron.receiver.group.consideration'],
        ['MTU_LENGTH_PROP_NAME', 'aeron.mtu.length'],
        ['IPC_MTU_LENGTH_PROP_NAME', 'aeron.ipc.mtu.length'],
        ['THREADING_MODE_PROP_NAME', 'aeron.threading.mode'],
        ['TIMER_INTERVAL_PROP_NAME', 'aeron.timer.interval'],
        ['SOCKET_RCVBUF_LENGTH_PROP_NAME', 'aeron.socket.so_rcvbuf'],
        ['UNICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME', 'aeron.unicast.FlowControl.supplier'],
        ['MULTICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME', 'aeron.multicast.FlowControl.supplier'],
        ['CONGESTION_CONTROL_STRATEGY_SUPPLIER_PROP_NAME', 'aeron.CongestionControl.supplier'],
        ['SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME', 'aeron.SendChannelEndpoint.supplier'],
        ['RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME', 'aeron.ReceiveChannelEndpoint.supplier'],
        ['TERMINATION_VALIDATOR_PROP_NAME', 'aeron.driver.termination.validator'],
        ['SM_APPLICATION_SPECIFIC_FEEDBACK_PROP_NAME', 'aeron.flow.control.sm.applicationSpecificFeedback'],
        ['NATIVE_RESOURCE_AGENT_IDLE_STRATEGY_PROP_NAME', 'aeron.driver.native.resource.agent.idle.strategy'],
        ['RESOLVER_INTERFACE_PROP_NAME', 'aeron.driver.resolver.interface'],
        ['SENDER_IDLE_STRATEGY_PROP_NAME', 'aeron.sender.idle.strategy'],
        ['SHARED_NETWORK_IDLE_STRATEGY_PROP_NAME', 'aeron.sharednetwork.idle.strategy'],
    ] as [keyof typeof Configuration, string][])("%s is Java's %s", (name, expected) => {
        expect(Configuration[name]).toBe(expected);
    });

    it('theClassNameDefaultsAreJavasStrings', () => {
        expect(Configuration.UNICAST_FLOW_CONTROL_STRATEGY_DEFAULT).toBe('io.aeron.driver.UnicastFlowControl');
        expect(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_DEFAULT).toBe('io.aeron.driver.MaxMulticastFlowControl');
        expect(Configuration.UNICAST_FLOW_CONTROL_STRATEGY).toBe('io.aeron.driver.UnicastFlowControl');
        expect(Configuration.CONTROLLABLE_IDLE_STRATEGY).toBe('org.agrona.concurrent.ControllableIdleStrategy');
        expect(Configuration.SENDER_IDLE_STRATEGY_DEFAULT).toBe('org.agrona.concurrent.BackoffIdleStrategy');
    });

    it('theBufferDefaultsAreTheRingAndBroadcastTrailersAdded', () => {
        // mutation: the trailer lengths are mixed up (ring 768, broadcast 128)
        expect(Configuration.CONDUCTOR_BUFFER_LENGTH_DEFAULT - 1048576).toBe(768);
        expect(Configuration.TO_CLIENTS_BUFFER_LENGTH_DEFAULT - 1048576).toBe(128);
    });

    it.each([
        ['conductorBufferLength', 'aeron.conductor.buffer.length', '2m', 2 * 1024 * 1024],
        ['toClientsBufferLength', 'aeron.clients.buffer.length', '2m', 2 * 1024 * 1024],
        ['counterValuesBufferLength', 'aeron.counters.buffer.length', '2m', 2 * 1024 * 1024],
        ['errorBufferLength', 'aeron.error.buffer.length', '5m', 5 * 1024 * 1024],
        ['termBufferLength', 'aeron.term.buffer.length', '64k', 65536],
        ['ipcTermBufferLength', 'aeron.ipc.term.buffer.length', '64k', 65536],
        ['initialWindowLength', 'aeron.rcv.initial.window.length', '16k', 16384],
        ['socketSndbufLength', 'aeron.socket.so_sndbuf', '8k', 8192],
        ['socketRcvbufLength', 'aeron.socket.so_rcvbuf', '8k', 8192],
        ['mtuLength', 'aeron.mtu.length', '4096', 4096],
        ['ipcMtuLength', 'aeron.ipc.mtu.length', '4k', 4096],
        ['filePageSize', 'aeron.file.page.size', '8k', 8192],
        ['lossReportBufferLength', 'aeron.loss.report.buffer.length', '2m', 2 * 1024 * 1024],
        ['publicationTermWindowLength', 'aeron.publication.term.window.length', '8k', 8192],
        ['ipcPublicationTermWindowLength', 'aeron.ipc.publication.term.window.length', '8k', 8192],
        ['lowStorageWarningThreshold', 'aeron.low.file.store.warning.threshold', '1g', 1073741824],
        ['nakUnicastRetryDelayRatio', 'aeron.nak.unicast.retry.delay.ratio', '3', 3],
        ['nakUnicastDelayNs', 'aeron.nak.unicast.delay', '2ms', 2_000_000],
        ['nakMulticastMaxBackoffNs', 'aeron.nak.multicast.max.backoff', '3ms', 3_000_000],
        ['timerIntervalNs', 'aeron.timer.interval', '2s', 2_000_000_000],
        ['statusMessageTimeoutNs', 'aeron.rcv.status.message.timeout', '100ms', 100_000_000],
        ['counterFreeToReuseTimeoutNs', 'aeron.counters.free.to.reuse.timeout', '3s', 3_000_000_000],
        ['clientLivenessTimeoutNs', 'aeron.client.liveness.timeout', '3s', 3_000_000_000],
        ['imageLivenessTimeoutNs', 'aeron.image.liveness.timeout', '3s', 3_000_000_000],
        ['publicationUnblockTimeoutNs', 'aeron.publication.unblock.timeout', '30s', 30_000_000_000],
        ['publicationConnectionTimeoutNs', 'aeron.publication.connection.timeout', '3s', 3_000_000_000],
        ['publicationLingerTimeoutNs', 'aeron.publication.linger.timeout', '3s', 3_000_000_000],
        ['retransmitUnicastDelayNs', 'aeron.retransmit.unicast.delay', '5us', 5000],
        ['retransmitUnicastLingerNs', 'aeron.retransmit.unicast.linger', '5us', 5000],
        ['untetheredWindowLimitTimeoutNs', 'aeron.untethered.window.limit.timeout', '7ms', 7_000_000],
        ['untetheredLingerTimeoutNs', 'aeron.untethered.linger.timeout', '8ms', 8_000_000],
        ['untetheredRestingTimeoutNs', 'aeron.untethered.resting.timeout', '9ms', 9_000_000],
        ['flowControlReceiverTimeoutNs', 'aeron.flow.control.receiver.timeout', '4s', 4_000_000_000],
        ['reResolutionCheckIntervalNs', 'aeron.driver.reresolution.check.interval', '3s', 3_000_000_000],
        ['conductorCycleThresholdNs', 'aeron.driver.conductor.cycle.threshold', '5ms', 5_000_000],
        ['senderCycleThresholdNs', 'aeron.driver.sender.cycle.threshold', '6ms', 6_000_000],
        ['receiverCycleThresholdNs', 'aeron.driver.receiver.cycle.threshold', '7ms', 7_000_000],
        ['nameResolverThresholdNs', 'aeron.name.resolver.threshold', '8ms', 8_000_000],
        ['resolverNeighborTimeoutNs', 'aeron.driver.resolver.neighbor.timeout', '9s', 9_000_000_000],
        ['resolverSelfResolutionIntervalNs', 'aeron.driver.resolver.self.resolution.interval', '2s', 2_000_000_000],
        [
            'resolverNeighborResolutionIntervalNs',
            'aeron.driver.resolver.neighbor.resolution.interval',
            '3s',
            3_000_000_000,
        ],
        [
            'resolverBootstrapNeighborResolutionIntervalNs',
            'aeron.driver.resolver.bootstrap.neighbor.resolution.interval',
            '4s',
            4_000_000_000,
        ],
    ] as [keyof typeof Configuration, string, string, number][])(
        '%s reads %s=%s as %i',
        (reader, property, text, expected) => {
            // mutation: the reader uses the wrong property name or the wrong parser (size or duration)
            const read = Configuration[reader] as () => number;
            const before = read();
            setProperty(property, text);
            expect(read()).toBe(expected);
            System.clearProperty(property);
            expect(read()).toBe(before);
        },
    );

    it.each([
        ['nakMulticastGroupSize', 'aeron.nak.multicast.group.size', '3', 3, 10],
        ['socketMulticastTtl', 'aeron.socket.multicast.ttl', '3', 3, 0],
        ['publicationReservedSessionIdLow', 'aeron.publication.reserved.session.id.low', '5', 5, -1],
        ['publicationReservedSessionIdHigh', 'aeron.publication.reserved.session.id.high', '5', 5, 1000],
        ['sendToStatusMessagePollRatio', 'aeron.send.to.status.poll.ratio', '9', 9, 6],
        ['resourceFreeLimit', 'aeron.driver.resource.free.limit', '9', 9, 1],
        ['flowControlGroupMinSize', 'aeron.flow.control.group.min.size', '2', 2, 0],
        ['unicastFlowControlRetransmitReceiverWindowMultiple', 'aeron.unicast.flow.control.rrwm', '2', 2, 16],
        ['multicastFlowControlRetransmitReceiverWindowMultiple', 'aeron.multicast.flow.control.rrwm', '2', 2, 4],
    ] as [keyof typeof Configuration, string, string, number, number][])(
        '%s reads %s=%s as %i (default %i)',
        (reader, property, text, expected, dflt) => {
            const read = Configuration[reader] as () => number;
            expect(read()).toBe(dflt);
            setProperty(property, text);
            expect(read()).toBe(expected);
        },
    );

    it.each([
        ['termBufferSparseFile', 'aeron.term.buffer.sparse.file', true],
        ['tetherSubscriptions', 'aeron.tether.subscriptions', true],
        ['reliableStream', 'aeron.reliable.stream', true],
        ['performStorageChecks', 'aeron.perform.storage.checks', true],
        ['spiesSimulateConnection', 'aeron.spies.simulate.connection', false],
        ['useWindowsHighResTimer', 'aeron.use.windows.high.res.timer', false],
        ['warnIfDirExists', 'aeron.dir.warn.if.exists', false],
        ['dirDeleteOnStart', 'aeron.dir.delete.on.start', false],
        ['dirDeleteOnShutdown', 'aeron.dir.delete.on.shutdown', false],
    ] as [keyof typeof Configuration, string, boolean][])('%s is %s unless %s is set', (reader, property, dflt) => {
        // mutation: the default of a boolean flips, or "TRUE" counts
        const read = Configuration[reader] as () => boolean;
        expect(read()).toBe(dflt);
        setProperty(property, 'true');
        expect(read()).toBe(true);
        setProperty(property, 'false');
        expect(read()).toBe(false);
        setProperty(property, 'TRUE');
        expect(read()).toBe(false);
    });

    it('rejoinStreamIgnoresCase', () => {
        // Java: "true".equalsIgnoreCase. mutation: the comparison is case sensitive
        expect(Configuration.rejoinStream()).toBe(true);
        setProperty(Configuration.REJOIN_STREAM_PROP_NAME, 'TRUE');
        expect(Configuration.rejoinStream()).toBe(true);
        setProperty(Configuration.REJOIN_STREAM_PROP_NAME, 'False');
        expect(Configuration.rejoinStream()).toBe(false);
    });

    it('maxResendIsClampedToOneAndMaxResendMax', () => {
        // mutation: the clamp is dropped, or min and max are swapped
        expect(Configuration.maxResend()).toBe(16);
        setProperty(Configuration.MAX_RESEND_PROP_NAME, '0');
        expect(Configuration.maxResend()).toBe(1);
        setProperty(Configuration.MAX_RESEND_PROP_NAME, '-5');
        expect(Configuration.maxResend()).toBe(1);
        setProperty(Configuration.MAX_RESEND_PROP_NAME, '300');
        expect(Configuration.maxResend()).toBe(256);
        setProperty(Configuration.MAX_RESEND_PROP_NAME, '20');
        expect(Configuration.maxResend()).toBe(20);
    });

    it('groupTagIsNullUnlessSetAndKeepsANegativeValue', () => {
        expect(Configuration.groupTag()).toBeNull();
        setProperty(Configuration.RECEIVER_GROUP_TAG_PROP_NAME, '-7');
        expect(Configuration.groupTag()).toBe(-7);
        setProperty(Configuration.RECEIVER_GROUP_TAG_PROP_NAME, 'x');
        expect(Configuration.groupTag()).toBeNull();
    });

    it('receiverGroupConsiderationParsesInferTrueAndAnythingElse', () => {
        expect(Configuration.receiverGroupConsideration()).toBe(InferableBoolean.INFER);
        setProperty(Configuration.GROUP_RECEIVER_CONSIDERATION_PROP_NAME, 'true');
        expect(Configuration.receiverGroupConsideration()).toBe(InferableBoolean.FORCE_TRUE);
        setProperty(Configuration.GROUP_RECEIVER_CONSIDERATION_PROP_NAME, 'false');
        expect(Configuration.receiverGroupConsideration()).toBe(InferableBoolean.FORCE_FALSE);
    });

    it('theStringPropertiesAreNullUntilSet', () => {
        expect(Configuration.resolverName()).toBeNull();
        expect(Configuration.resolverInterface()).toBeNull();
        expect(Configuration.resolverBootstrapNeighbor()).toBeNull();
        expect(Configuration.senderWildcardPortRange()).toBeNull();
        expect(Configuration.receiverWildcardPortRange()).toBeNull();
        setProperty(Configuration.SENDER_WILDCARD_PORT_RANGE_PROP_NAME, '1000 2000');
        expect(Configuration.senderWildcardPortRange()).toBe('1000 2000');
    });

    it('threadingModeDefaultsToDedicatedAndReadsTheName', () => {
        // mutation: the default is INVOKER, or the name is matched case-insensitively
        expect(Configuration.threadingMode()).toBe(ThreadingMode.DEDICATED);
        setProperty(Configuration.THREADING_MODE_PROP_NAME, 'INVOKER');
        expect(Configuration.threadingMode()).toBe(ThreadingMode.INVOKER);
        setProperty(Configuration.THREADING_MODE_PROP_NAME, 'invoker');
        const e = assertThrowsExactly(IllegalArgumentException, () => Configuration.threadingMode());
        expect(e.message).toBe('No enum constant io.aeron.driver.ThreadingMode.invoker');
    });

    it('applicationSpecificFeedbackIsEmptyUnlessSetAsHex', () => {
        expect(Configuration.applicationSpecificFeedback()).toEqual(new Uint8Array(0));
        setProperty(Configuration.SM_APPLICATION_SPECIFIC_FEEDBACK_PROP_NAME, '0102ff');
        expect(Configuration.applicationSpecificFeedback()).toEqual(new Uint8Array([1, 2, 255]));
    });

    it('streamSessionLimitDefaultsAndRejectsAnUnparsableValueWithAsciiNumberFormatException', () => {
        expect(Configuration.streamSessionLimit()).toBe(Integer.MAX_VALUE);
        setProperty(Configuration.STREAM_SESSION_LIMIT_PROP_NAME, '');
        expect(Configuration.streamSessionLimit()).toBe(Integer.MAX_VALUE);
        setProperty(Configuration.STREAM_SESSION_LIMIT_PROP_NAME, '12');
        expect(Configuration.streamSessionLimit()).toBe(12);
        setProperty(Configuration.STREAM_SESSION_LIMIT_PROP_NAME, 'abc');
        const e = assertThrowsExactly(AsciiNumberFormatException, () => Configuration.streamSessionLimit());
        expect(e.message).toBe('Property aeron.driver.stream.session.limit=abc is not a number');
    });

    it('producerAndReceiverWindowLengths', () => {
        expect(Configuration.producerWindowLength(65536, 0)).toBe(32768);
        expect(Configuration.producerWindowLength(65536, 4096)).toBe(4096);
        expect(Configuration.producerWindowLength(65536, 1 << 20)).toBe(32768);
        expect(Configuration.receiverWindowLength(65536, 4096)).toBe(4096);
        expect(Configuration.receiverWindowLength(65536, 1 << 20)).toBe(32768);
    });

    it('countersMetadataBufferLengthIsTheRatioOfMetadataToCounterLength', () => {
        expect(Configuration.countersMetadataBufferLength(1024 * 1024)).toBe(1024 * 1024 * 4);
    });

    it('sourceIdentityIsHostAndPort', () => {
        expect(Configuration.sourceIdentity(InetSocketAddress.createUnresolved('example.test', 4242))).toBe(
            'example.test:4242',
        );
    });

    it('validateMtuLengthChecksTheHeaderTheMaximumAndTheAlignmentInOrder', () => {
        // mutation: a bound is off by one, or the checks are reordered
        Configuration.validateMtuLength(1408);
        assertThrowsExactly(ConfigurationException, () => Configuration.validateMtuLength(32));
        expect(assertThrows(ConfigurationException, () => Configuration.validateMtuLength(32)).message).toBe(
            'ERROR - mtuLength=32 <= HEADER_LENGTH=32',
        );
        expect(assertThrows(ConfigurationException, () => Configuration.validateMtuLength(65505)).message).toBe(
            'ERROR - mtuLength=65505 > MAX_UDP_PAYLOAD_LENGTH=65504',
        );
        expect(assertThrows(ConfigurationException, () => Configuration.validateMtuLength(1000)).message).toBe(
            'ERROR - mtuLength=1000 is not a multiple of FRAME_ALIGNMENT=32',
        );
        Configuration.validateMtuLength(65504);
        Configuration.validateMtuLength(64);
    });

    it('validateInitialWindowLengthRejectsAnMtuAboveTheWindow', () => {
        Configuration.validateInitialWindowLength(1408, 1408);
        expect(
            assertThrows(ConfigurationException, () => Configuration.validateInitialWindowLength(1407, 1408)).message,
        ).toBe('ERROR - mtuLength=1408 > initialWindowLength=1407');
    });

    it('validatePageSizeChecksTheRangeAndThePowerOfTwo', () => {
        Configuration.validatePageSize(4096);
        Configuration.validatePageSize(1 << 30);
        expect(assertThrows(ConfigurationException, () => Configuration.validatePageSize(2048)).message).toBe(
            'ERROR - filePageSize less than min size of 4096: 2048',
        );
        expect(assertThrows(ConfigurationException, () => Configuration.validatePageSize((1 << 30) + 1)).message).toBe(
            'ERROR - filePageSize greater than max size of 1073741824: 1073741825',
        );
        expect(assertThrows(ConfigurationException, () => Configuration.validatePageSize(12288)).message).toBe(
            'ERROR - filePageSize not a power of 2: 12288',
        );
    });

    it('validateSessionIdRange', () => {
        Configuration.validateSessionIdRange(5, 5);
        Configuration.validateSessionIdRange(-1, 1000);
        Configuration.validateSessionIdRange(Integer.MIN_VALUE, -1);
        expect(assertThrows(ConfigurationException, () => Configuration.validateSessionIdRange(6, 5)).message).toBe(
            'ERROR - low session id value 6 must be <= high value 5',
        );
        // high - low = 2^32 - 1 > Integer.MAX_VALUE
        expect(
            assertThrows(ConfigurationException, () =>
                Configuration.validateSessionIdRange(Integer.MIN_VALUE, Integer.MAX_VALUE),
            ).message,
        ).toBe('ERROR - reserved session range too large');
        Configuration.validateSessionIdRange(-1, Integer.MAX_VALUE - 1);
        Configuration.validateSessionIdRange(0, Integer.MAX_VALUE);
        assertThrows(ConfigurationException, () => Configuration.validateSessionIdRange(-1, Integer.MAX_VALUE));
    });

    it('validateUnblockTimeoutAndValidateUntetheredTimeoutsMessages', () => {
        Configuration.validateUnblockTimeout(3, 2, 1);
        expect(assertThrows(ConfigurationException, () => Configuration.validateUnblockTimeout(2, 2, 1)).message).toBe(
            'ERROR - publicationUnblockTimeoutNs=2 <= clientLivenessTimeoutNs=2',
        );
        expect(assertThrows(ConfigurationException, () => Configuration.validateUnblockTimeout(3, 2, 2)).message).toBe(
            'ERROR - clientLivenessTimeoutNs=2 <= timerIntervalNs=2',
        );
        Configuration.validateUntetheredTimeouts(3, 3, 3, 2);
        Configuration.validateUntetheredTimeouts(3, Aeron.NULL_VALUE, 3, 2);
        expect(
            assertThrows(ConfigurationException, () => Configuration.validateUntetheredTimeouts(2, 3, 3, 2)).message,
        ).toBe('ERROR - untetheredWindowLimitTimeoutNs=2 <= timerIntervalNs=2');
        expect(
            assertThrows(ConfigurationException, () => Configuration.validateUntetheredTimeouts(3, 3, 2, 2)).message,
        ).toBe('ERROR - untetheredRestingTimeoutNs=2 <= timerIntervalNs=2');
        expect(
            assertThrows(ConfigurationException, () => Configuration.validateUntetheredTimeouts(3, 2, 3, 2)).message,
        ).toBe('ERROR - untetheredLingerTimeoutNs=2 <= timerIntervalNs=2');
    });

    it('validateValueRangeIsInclusiveAtBothEnds', () => {
        Configuration.validateValueRange(5, 5, 7, 'x');
        Configuration.validateValueRange(7, 5, 7, 'x');
        expect(assertThrows(ConfigurationException, () => Configuration.validateValueRange(4, 5, 7, 'x')).message).toBe(
            'ERROR - x less than min size of 5: 4',
        );
        expect(assertThrows(ConfigurationException, () => Configuration.validateValueRange(8, 5, 7, 'x')).message).toBe(
            'ERROR - x greater than max size of 7: 8',
        );
    });

    describe('agentIdleStrategy', () => {
        it.each([
            ['noop', NoOpIdleStrategy],
            ['org.agrona.concurrent.NoOpIdleStrategy', NoOpIdleStrategy],
            ['spin', BusySpinIdleStrategy],
            ['org.agrona.concurrent.BusySpinIdleStrategy', BusySpinIdleStrategy],
            ['yield', YieldingIdleStrategy],
            ['org.agrona.concurrent.YieldingIdleStrategy', YieldingIdleStrategy],
            ['sleep-ns', SleepingIdleStrategy],
            ['org.agrona.concurrent.SleepingIdleStrategy', SleepingIdleStrategy],
            ['sleep-ms', SleepingMillisIdleStrategy],
            ['org.agrona.concurrent.SleepingMillisIdleStrategy', SleepingMillisIdleStrategy],
            ['backoff', BackoffIdleStrategy],
            ['org.agrona.concurrent.BackoffIdleStrategy', BackoffIdleStrategy],
        ] as [string, new (...args: never[]) => object][])('%s', (name, type) => {
            // mutation: an alias or a class name falls through to the default case
            expect(Configuration.agentIdleStrategy(name, null)).toBeInstanceOf(type);
        });

        it('theStatelessStrategiesAreTheSingletonsAndTheOthersAreNew', () => {
            expect(Configuration.agentIdleStrategy('noop', null)).toBe(NoOpIdleStrategy.INSTANCE);
            expect(Configuration.agentIdleStrategy('spin', null)).toBe(BusySpinIdleStrategy.INSTANCE);
            expect(Configuration.agentIdleStrategy('yield', null)).toBe(YieldingIdleStrategy.INSTANCE);
            expect(Configuration.agentIdleStrategy('backoff', null)).not.toBe(
                Configuration.agentIdleStrategy('backoff', null),
            );
        });

        it('backoffUsesTheConfigurationParameters', () => {
            // mutation: the default Backoff constants of Agrona are used instead of IDLE_MAX_SPINS and the others
            expect(Configuration.agentIdleStrategy('backoff', null).toString()).toBe(
                new BackoffIdleStrategy(10, 20, 1000, 1_000_000).toString(),
            );
        });

        it('controllableSetsParkOnTheIndicatorAndNeedsOne', () => {
            const buffer = new UnsafeBuffer(new SharedArrayBuffer(1024));
            const indicator = new UnsafeBufferStatusIndicator(buffer, 3);
            indicator.setRelease(0);
            const strategy = Configuration.agentIdleStrategy('controllable', indicator);
            expect(strategy).toBeInstanceOf(ControllableIdleStrategy);
            expect(indicator.getVolatile()).toBe(ControllableIdleStrategy.PARK);
            expect(() => Configuration.agentIdleStrategy('controllable', null)).toThrow();
        });

        it('anUnknownNameIsAClassNotFoundExceptionWithTheName', () => {
            // Java loads the name with Class.forName; there is no class loader here
            const e = assertThrowsExactly(ClassNotFoundException, () =>
                Configuration.agentIdleStrategy('com.example.MyIdle', null),
            );
            expect(e.message).toBe('com.example.MyIdle');
        });

        it('theNamedStrategiesReadTheirPropertyAndFallBackToTheDefault', () => {
            expect(Configuration.senderIdleStrategy(null)).toBeInstanceOf(BackoffIdleStrategy);
            setProperty(Configuration.SENDER_IDLE_STRATEGY_PROP_NAME, 'noop');
            setProperty(Configuration.RECEIVER_IDLE_STRATEGY_PROP_NAME, 'spin');
            setProperty(Configuration.CONDUCTOR_IDLE_STRATEGY_PROP_NAME, 'yield');
            setProperty(Configuration.SHARED_NETWORK_IDLE_STRATEGY_PROP_NAME, 'sleep-ms');
            setProperty(Configuration.SHARED_IDLE_STRATEGY_PROP_NAME, 'sleep-ns');
            expect(Configuration.senderIdleStrategy(null)).toBeInstanceOf(NoOpIdleStrategy);
            expect(Configuration.receiverIdleStrategy(null)).toBeInstanceOf(BusySpinIdleStrategy);
            expect(Configuration.conductorIdleStrategy(null)).toBeInstanceOf(YieldingIdleStrategy);
            expect(Configuration.sharedNetworkIdleStrategy(null)).toBeInstanceOf(SleepingMillisIdleStrategy);
            expect(Configuration.sharedIdleStrategy(null)).toBeInstanceOf(SleepingIdleStrategy);
        });

        it('nativeResourceAgentIdleStrategyIsSleepingOneMillisecondByDefault', () => {
            const strategy = Configuration.nativeResourceAgentIdleStrategy(null);
            expect(strategy).toBeInstanceOf(SleepingIdleStrategy);
            expect(strategy.toString()).toContain('sleepPeriodNs=1000000');
            setProperty(Configuration.NATIVE_RESOURCE_AGENT_IDLE_STRATEGY_PROP_NAME, 'noop');
            expect(Configuration.nativeResourceAgentIdleStrategy(null)).toBe(NoOpIdleStrategy.INSTANCE);
            setProperty(Configuration.NATIVE_RESOURCE_AGENT_IDLE_STRATEGY_PROP_NAME, '');
            expect(Configuration.nativeResourceAgentIdleStrategy(null)).toBeInstanceOf(SleepingIdleStrategy);
        });
    });
});

describe('ThreadingModeValueOfExtraTest', () => {
    it.each(['INVOKER', 'SHARED', 'SHARED_NETWORK', 'DEDICATED'])(
        'valueOf(%s) is the constant of that name',
        (name) => {
            // mutation: valueOf returns by ordinal, or a fresh instance
            const mode = ThreadingMode.valueOf(name);
            expect(mode.name()).toBe(name);
            expect(ThreadingMode.values()).toContain(mode);
            expect(mode).toBe(ThreadingMode[name as 'INVOKER']);
        },
    );

    it.each([
        '',
        'invoker',
        'Invoker',
        ' INVOKER',
        'INVOKER ',
        'SHARED_NETWORK2',
        'dedicated',
        'NONE',
        'toString',
        'name',
    ])('valueOf("%s") throws IllegalArgumentException as Java does (issue #27)', (name) => {
        // mutation: it returns undefined or null, or matches case-insensitively, or finds an inherited property
        const e = assertThrowsExactly(IllegalArgumentException, () => ThreadingMode.valueOf(name));
        expect(e.message).toBe('No enum constant io.aeron.driver.ThreadingMode.' + name);
    });
});

describe('BroadcastBufferDescriptorExtraTest', () => {
    it('theTrailerLayoutIsAgronas', () => {
        expect(BroadcastBufferDescriptor.TAIL_INTENT_COUNTER_OFFSET).toBe(0);
        expect(BroadcastBufferDescriptor.TAIL_COUNTER_OFFSET).toBe(8);
        expect(BroadcastBufferDescriptor.LATEST_COUNTER_OFFSET).toBe(16);
        expect(BroadcastBufferDescriptor.TRAILER_LENGTH).toBe(128);
    });

    it.each([1, 2, 1024, 1 << 30])('checkCapacity(%i) accepts a power of two', (capacity) => {
        BroadcastBufferDescriptor.checkCapacity(capacity);
    });

    it.each([0, -1, 3, 1000, 1025, Integer.MIN_VALUE])('checkCapacity(%i) rejects anything else', (capacity) => {
        const e = assertThrowsExactly(IllegalStateException, () => BroadcastBufferDescriptor.checkCapacity(capacity));
        expect(e.message).toBe('capacity must be a positive power of 2 + TRAILER_LENGTH: capacity=' + capacity);
    });
});

describe('CommonContextExtraTest', () => {
    it('concludeTwiceIsAConcurrentConcludeException', () => {
        // mutation: the second conclude succeeds or throws a different type
        const ctx = new CommonContext();
        expect(ctx.isConcluded()).toBe(false);
        expect(ctx.conclude()).toBe(ctx);
        expect(ctx.isConcluded()).toBe(true);
        assertThrowsExactly(ConcurrentConcludeException, () => ctx.conclude());
    });

    it('theDriverTimeoutIsLongGetLongOfThePropertyOrTheDefault', () => {
        expect(CommonContext.DRIVER_TIMEOUT_MS).toBe(CommonContext.DEFAULT_DRIVER_TIMEOUT_MS);
        const ctx = new CommonContext();
        expect(ctx.driverTimeoutMs()).toBe(10_000);
        expect(ctx.driverTimeoutMs(123)).toBe(ctx);
        expect(ctx.driverTimeoutMs()).toBe(123);
    });

    it('cloneIsAShallowCopyOfTheSameClassThatDoesNotShareTheScalars', () => {
        // mutation: clone returns this, or a plain CommonContext
        const ctx = new Context().mtuLength(2048).nakMulticastGroupSize(3);
        const copy = ctx.clone();
        expect(copy).not.toBe(ctx);
        expect(copy).toBeInstanceOf(Context);
        expect(copy.mtuLength()).toBe(2048);
        copy.mtuLength(4096);
        expect(ctx.mtuLength()).toBe(2048);
        expect(copy.nakMulticastGroupSize()).toBe(3);
    });

    it('enableExperimentalFeaturesReadsTheProperty', () => {
        expect(new CommonContext().enableExperimentalFeatures()).toBe(false);
        setProperty(CommonContext.ENABLE_EXPERIMENTAL_FEATURES_PROP_NAME, 'TRUE');
        expect(new CommonContext().enableExperimentalFeatures()).toBe(true);
        expect(new CommonContext().enableExperimentalFeatures(false).enableExperimentalFeatures()).toBe(false);
    });

    it('checkDebugTimeoutReturnsTheTimeoutWithoutADebugger', () => {
        expect(CommonContext.checkDebugTimeout(5, TimeUnit.NANOSECONDS)).toBe(5);
        setProperty(CommonContext.DEBUG_TIMEOUT_PROP_NAME, '1h');
        // no inspector is attached to the test process
        expect(CommonContext.checkDebugTimeout(5, TimeUnit.NANOSECONDS, 1.5)).toBe(5);
    });

    it('shouldPrintConfigurationOnStartReadsTheProperty', () => {
        expect(CommonContext.shouldPrintConfigurationOnStart()).toBe(false);
        setProperty(CommonContext.PRINT_CONFIGURATION_ON_START_PROP_NAME, 'true');
        expect(CommonContext.shouldPrintConfigurationOnStart()).toBe(true);
    });

    it('fallbackLoggerIsStderrUnlessStdoutOrNoOp', () => {
        const spyErr = vi.spyOn(console, 'error').mockImplementation(() => {});
        const spyOut = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            CommonContext.fallbackLogger().println('e');
            expect(spyErr).toHaveBeenCalledWith('e');
            setProperty(CommonContext.FALLBACK_LOGGER_PROP_NAME, 'stdout');
            CommonContext.fallbackLogger().println('o');
            expect(spyOut).toHaveBeenCalledWith('o');
            setProperty(CommonContext.FALLBACK_LOGGER_PROP_NAME, 'no_op');
            CommonContext.fallbackLogger().println('n');
            expect(spyErr).toHaveBeenCalledTimes(1);
            expect(spyOut).toHaveBeenCalledTimes(1);
            setProperty(CommonContext.FALLBACK_LOGGER_PROP_NAME, 'whatever');
            CommonContext.fallbackLogger().println('e2');
            expect(spyErr).toHaveBeenCalledTimes(2);
        } finally {
            spyErr.mockRestore();
            spyOut.mockRestore();
        }
    });

    describe('setupErrorHandler', () => {
        function newLog(): DistinctErrorLog {
            const buffer = new UnsafeBuffer(new SharedArrayBuffer(64 * 1024));
            return new DistinctErrorLog(buffer, { time: () => 1 }, StandardCharsets.US_ASCII);
        }

        it('withoutAUserHandlerItIsTheLoggingHandlerThatRecordsInTheLog', () => {
            const log = newLog();
            const handler = CommonContext.setupErrorHandler(null, log);
            handler.onError(new RuntimeException('boom'));
            expect(ErrorLogReader.hasErrors(log.buffer())).toBe(true);
        });

        it('withAUserHandlerBothSeeEveryErrorInOrderAndCloseClosesTheLogger', () => {
            // mutation: the user handler is not called, or called first, or the logger is not closed
            const order: string[] = [];
            const fallback: PrintStream = { println: (line) => order.push('fallback:' + line.slice(0, 0)) };
            const log = newLog();
            const user = { onError: vi.fn((_: Error) => order.push('user')), close: vi.fn() };
            const handler = CommonContext.setupErrorHandler(user, log, fallback) as typeof user;
            handler.onError(new RuntimeException('boom'));
            expect(order).toEqual(['user']);
            expect(ErrorLogReader.hasErrors(log.buffer())).toBe(true);
            handler.close();
            expect(user.close).toHaveBeenCalledTimes(1);
            // after close the logging handler no longer records: it overflows to the fallback stream
            handler.onError(new RuntimeException('after close'));
            expect(order.some((s) => s.startsWith('fallback'))).toBe(true);
        });
    });
});

describe('MediaDriverContextExtraTest', () => {
    let context: Context;

    beforeEach(() => {
        context = new Context();
    });

    afterEach(() => {
        context.close();
    });

    it('everyDefaultComesFromConfiguration', () => {
        // mutation: a field is initialised from the wrong reader
        expect(context.mtuLength()).toBe(1408);
        expect(context.ipcMtuLength()).toBe(1408);
        expect(context.publicationTermBufferLength()).toBe(16 * 1024 * 1024);
        expect(context.ipcTermBufferLength()).toBe(64 * 1024 * 1024);
        expect(context.initialWindowLength()).toBe(131072);
        expect(context.filePageSize()).toBe(4096);
        expect(context.conductorBufferLength()).toBe(Configuration.CONDUCTOR_BUFFER_LENGTH_DEFAULT);
        expect(context.timerIntervalNs()).toBe(1_000_000_000);
        expect(context.clientLivenessTimeoutNs()).toBe(10_000_000_000);
        expect(context.publicationUnblockTimeoutNs()).toBe(15_000_000_000);
        expect(context.nakUnicastDelayNs()).toBe(1000);
        expect(context.nakUnicastRetryDelayRatio()).toBe(100);
        expect(context.maxResend()).toBe(16);
        expect(context.receiverGroupTag()).toBeNull();
        expect(context.receiverGroupConsideration()).toBe(InferableBoolean.INFER);
        expect(context.termBufferSparseFile()).toBe(true);
        expect(context.reliableStream()).toBe(true);
        expect(context.tetherSubscriptions()).toBe(true);
        expect(context.rejoinStream()).toBe(true);
        expect(context.spiesSimulateConnection()).toBe(false);
        expect(context.streamSessionLimit()).toBe(Integer.MAX_VALUE);
        expect(context.resolverName()).toBeNull();
        expect(context.useConcurrentCountersManager()).toBe(false);
        expect(context.isConcluded()).toBe(false);
    });

    it('everySetterReturnsTheContextAndTheGetterReturnsTheValue', () => {
        const same = context
            .mtuLength(2048)
            .ipcMtuLength(2048)
            .initialWindowLength(8192)
            .maxResend(7)
            .receiverGroupTag(-3)
            .flowControlGroupMinSize(2)
            .terminationHook(null)
            .printConfigurationOnStart(true)
            .resolverName('n')
            .tempBuffer(null);
        expect(same).toBe(context);
        expect(context.mtuLength()).toBe(2048);
        expect(context.maxResend()).toBe(7);
        expect(context.receiverGroupTag()).toBe(-3);
        expect(context.flowControlGroupMinSize()).toBe(2);
        expect(context.terminationHook()).toBeNull();
        expect(context.printConfigurationOnStart()).toBe(true);
        expect(context.resolverName()).toBe('n');
        context.receiverGroupTag(null);
        expect(context.receiverGroupTag()).toBeNull();
    });

    it('theClientLivenessAndUnblockTimeoutsGoThroughCheckDebugTimeout', () => {
        context.clientLivenessTimeoutNs(77).publicationUnblockTimeoutNs(88);
        expect(context.clientLivenessTimeoutNs()).toBe(77);
        expect(context.publicationUnblockTimeoutNs()).toBe(88);
    });

    it('concludeBuildsTheCncInOneSharedArrayBufferAlignedToTheFilePageSize', () => {
        // mutation: the length is not aligned, or the buffer is not shared, or a section length is wrong
        context.conclude();
        const cnc = context.cncByteBuffer()!;
        expect(cnc).toBeInstanceOf(SharedArrayBuffer);
        const expected =
            CncFileDescriptor.META_DATA_LENGTH +
            Configuration.CONDUCTOR_BUFFER_LENGTH_DEFAULT +
            Configuration.TO_CLIENTS_BUFFER_LENGTH_DEFAULT +
            Configuration.COUNTERS_VALUES_BUFFER_LENGTH_DEFAULT * 5 +
            Configuration.ERROR_BUFFER_LENGTH_DEFAULT;
        expect(cnc.byteLength).toBe(Math.ceil(expected / 4096) * 4096);
        const meta = CncFileDescriptor.createMetaDataBuffer(cnc);
        expect(meta.getInt(CncFileDescriptor.CNC_VERSION_FIELD_OFFSET)).toBe(CncFileDescriptor.CNC_VERSION);
        expect(meta.getInt(CncFileDescriptor.TO_DRIVER_BUFFER_LENGTH_FIELD_OFFSET)).toBe(
            Configuration.CONDUCTOR_BUFFER_LENGTH_DEFAULT,
        );
        expect(meta.getInt(CncFileDescriptor.TO_CLIENTS_BUFFER_LENGTH_FIELD_OFFSET)).toBe(
            Configuration.TO_CLIENTS_BUFFER_LENGTH_DEFAULT,
        );
        expect(meta.getInt(CncFileDescriptor.COUNTERS_VALUES_BUFFER_LENGTH_FIELD_OFFSET)).toBe(
            Configuration.COUNTERS_VALUES_BUFFER_LENGTH_DEFAULT,
        );
        expect(meta.getInt(CncFileDescriptor.COUNTERS_METADATA_BUFFER_LENGTH_FIELD_OFFSET)).toBe(
            Configuration.COUNTERS_VALUES_BUFFER_LENGTH_DEFAULT * 4,
        );
        expect(meta.getInt(CncFileDescriptor.ERROR_LOG_BUFFER_LENGTH_FIELD_OFFSET)).toBe(
            Configuration.ERROR_BUFFER_LENGTH_DEFAULT,
        );
        expect(meta.getLong(CncFileDescriptor.CLIENT_LIVENESS_TIMEOUT_FIELD_OFFSET)).toBe(10_000_000_000);
        expect(meta.getLong(CncFileDescriptor.PID_FIELD_OFFSET)).toBe(process.pid);
        expect(meta.getInt(CncFileDescriptor.FILE_PAGE_SIZE_FIELD_OFFSET)).toBe(4096);
        expect(Math.abs(meta.getLong(CncFileDescriptor.START_TIMESTAMP_FIELD_OFFSET) - Date.now())).toBeLessThan(
            10_000,
        );
    });

    it('theCncVersionIsTheLastThingWritten', () => {
        // mutation: signalCncReady is called before the counters and the ring buffer are set up (a client could see a
        // half-built CnC). The version is 0 until conclude returns; here we check it is set after, and that a failed
        // conclude leaves it unset.
        context.conclude();
        expect(
            CncFileDescriptor.createMetaDataBuffer(context.cncByteBuffer()!).getIntVolatile(
                CncFileDescriptor.CNC_VERSION_FIELD_OFFSET,
            ),
        ).toBe(CncFileDescriptor.CNC_VERSION);
        const failing = new Context().nakUnicastDelayNs(5000000000).nakUnicastRetryDelayRatio(1000000000000);
        try {
            expect(() => failing.conclude()).toThrow();
            expect(failing.cncByteBuffer()).toBeNull();
        } finally {
            failing.close();
        }
    });

    it('concludeSetsEveryNullPropertyAndLeavesTheExplicitOnesAlone', () => {
        const epoch = { time: () => 42 };
        const customIdle = new BackoffIdleStrategy();
        context.epochClock(epoch).threadingMode(ThreadingMode.DEDICATED).conductorIdleStrategy(customIdle);
        context.conclude();
        expect(context.epochClock()).toBe(epoch);
        expect(context.conductorIdleStrategy()).toBe(customIdle);
        expect(context.nanoClock()).not.toBeNull();
        expect(context.cachedEpochClock()).not.toBeNull();
        expect(context.cachedNanoClock()).not.toBeNull();
        expect(context.senderCachedNanoClock()).not.toBeNull();
        expect(context.receiverCachedNanoClock()).not.toBeNull();
        expect(context.tempBuffer()).not.toBeNull();
        expect(context.applicationSpecificFeedback()).toEqual(new Uint8Array(0));
        expect(context.nameResolver()).not.toBeNull();
        expect(context.channelReceiveTimestampClock()).not.toBeNull();
        expect(context.channelSendTimestampClock()).not.toBeNull();
        expect(context.errorLog()).not.toBeNull();
        expect(context.errorHandler()).not.toBeNull();
        expect(context.countedErrorHandler()).not.toBeNull();
        expect(context.countersManager()).toBeInstanceOf(CountersManager);
        expect(context.countersManager()).not.toBeInstanceOf(ConcurrentCountersManager);
        expect(context.systemCounters()).not.toBeNull();
        expect(context.toDriverCommands()).not.toBeNull();
        expect(context.conductorDutyCycleTracker()).not.toBeNull();
        expect(context.senderDutyCycleTracker()).not.toBeNull();
        expect(context.receiverDutyCycleTracker()).not.toBeNull();
        expect(context.nameResolverTimeTracker()).not.toBeNull();
        // the CnC start time comes from the explicit epoch clock
        expect(
            CncFileDescriptor.createMetaDataBuffer(context.cncByteBuffer()!).getLong(
                CncFileDescriptor.START_TIMESTAMP_FIELD_OFFSET,
            ),
        ).toBe(42);
        expect(context.toDriverCommands()!.consumerHeartbeatTime()).toBe(42);
    });

    it('useConcurrentCountersManagerSelectsTheConcurrentManager', () => {
        context.useConcurrentCountersManager(true).conclude();
        expect(context.countersManager()).toBeInstanceOf(ConcurrentCountersManager);
    });

    it('concludeFillsTheVersionCountersAndTheLabelsOfTheCycleTimeCounters', () => {
        // mutation: a label suffix, a version or a counter is wrong
        context.threadingMode(ThreadingMode.INVOKER).conclude();
        const counters = context.systemCounters()!;
        expect(counters.get(SystemCounterDescriptor.AERON_VERSION).get()).toBe(
            SemanticVersion.compose(
                MediaDriverVersion.MAJOR_VERSION,
                MediaDriverVersion.MINOR_VERSION,
                MediaDriverVersion.PATCH_VERSION,
            ),
        );
        expect(counters.get(SystemCounterDescriptor.CONTROL_PROTOCOL_VERSION).get()).toBe(
            ControlProtocolEvents.CONTROL_PROTOCOL_SEMANTIC_VERSION,
        );
        expect(counters.get(SystemCounterDescriptor.CONDUCTOR_MAX_CYCLE_TIME).label()).toMatch(/: INVOKER$/);
        expect(counters.get(SystemCounterDescriptor.CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED).label()).toMatch(
            /: threshold=100ms INVOKER$/,
        );
        expect(counters.get(SystemCounterDescriptor.SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED).label()).toMatch(
            /: threshold=100ms INVOKER$/,
        );
        expect(counters.get(SystemCounterDescriptor.RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED).label()).toMatch(
            /: threshold=100ms INVOKER$/,
        );
        expect(counters.get(SystemCounterDescriptor.NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED).label()).toMatch(
            /: threshold=5s$/,
        );
        expect(counters.get(SystemCounterDescriptor.BYTES_CURRENTLY_MAPPED).get()).toBe(
            context.cncByteBuffer()!.byteLength,
        );
    });

    it('theToDriverRingBufferIsOverTheToDriverSectionAndTheCorrelationIdWasAllocatedOnce', () => {
        context.conclude();
        const ring = context.toDriverCommands()!;
        expect(ring.capacity()).toBe(1024 * 1024);
        // conclude took the first correlation id (0); the next is 1
        expect(ring.nextCorrelationId()).toBe(1);
    });

    describe('idle strategies by threading mode', () => {
        it.each([
            [ThreadingMode.INVOKER, [], ['conductor', 'sender', 'receiver', 'sharedNetwork', 'shared']],
            [ThreadingMode.SHARED, ['shared'], ['conductor', 'sender', 'receiver', 'sharedNetwork']],
            [ThreadingMode.SHARED_NETWORK, ['conductor', 'sharedNetwork'], ['sender', 'receiver', 'shared']],
            [ThreadingMode.DEDICATED, ['conductor', 'sender', 'receiver'], ['sharedNetwork', 'shared']],
        ] as [ThreadingMode, string[], string[]][])('%s', (mode, set, unset) => {
            // mutation: a mode creates the strategies of another mode
            context.threadingMode(mode).conclude();
            const strategies: Record<string, unknown> = {
                conductor: context.conductorIdleStrategy(),
                sender: context.senderIdleStrategy(),
                receiver: context.receiverIdleStrategy(),
                sharedNetwork: context.sharedNetworkIdleStrategy(),
                shared: context.sharedIdleStrategy(),
            };
            for (const name of set) {
                expect(strategies[name], name).not.toBeNull();
            }
            for (const name of unset) {
                expect(strategies[name], name).toBeNull();
            }
        });
    });

    it('closeIsIdempotentClosesTheCountedErrorHandlerAndTheErrorCounter', () => {
        // mutation: close twice throws, or the counted handler is left open, or the ERRORS counter is left open
        context.conclude();
        const counted = context.countedErrorHandler()!;
        const errors = context.systemCounters()!.get(SystemCounterDescriptor.ERRORS);
        expect(counted.isClosed()).toBe(false);
        expect(errors.isClosed()).toBe(false);
        context.close();
        expect(counted.isClosed()).toBe(true);
        expect(errors.isClosed()).toBe(true);
        expect(context.cncByteBuffer()).toBeNull();
        context.close();
    });

    it('closeWithoutConcludeAndAfterAFailedConcludeIsSafe', () => {
        context.close();
        const failing = new Context().conductorBufferLength(7);
        assertThrows(ConfigurationException, () => failing.conclude());
        failing.close();
    });

    it('concludeTwiceIsAConcurrentConcludeExceptionAndKeepsTheFirstCnc', () => {
        context.conclude();
        const cnc = context.cncByteBuffer();
        assertThrowsExactly(ConcurrentConcludeException, () => context.conclude());
        expect(context.cncByteBuffer()).toBe(cnc);
    });

    it('anApplicationSpecificFeedbackOfEightBytesIsTheReceiverGroupTag', () => {
        context.applicationSpecificFeedback(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]));
        context.conclude();
        expect(context.receiverGroupTag()).toBe(1);
    });

    it('anApplicationSpecificFeedbackOfAnotherLengthIsRejected', () => {
        context.applicationSpecificFeedback(new Uint8Array(3));
        const e = assertThrowsExactly(IllegalArgumentException, () => context.conclude());
        expect(e.message).toBe('applicationSpecificFeedback length must be equal to 8 bytes: length=3');
    });

    it('anExplicitReceiverGroupTagWinsOverTheFeedback', () => {
        context.receiverGroupTag(5).applicationSpecificFeedback(new Uint8Array(3));
        context.conclude();
        expect(context.receiverGroupTag()).toBe(5);
    });

    it('anEmptyResolverNameWithAnInterfaceIsRejectedBeforeAnythingIsAllocated', () => {
        context.resolverInterface('127.0.0.1');
        assertThrowsExactly(ConfigurationException, () => context.conclude());
        expect(context.cncByteBuffer()).toBeNull();
        expect(context.countersManager()).toBeNull();
    });

    it('aNonEmptyResolverNameWithAnInterfaceConcludes', () => {
        context.resolverInterface('127.0.0.1').resolverName('x');
        context.conclude();
        expect(context.nameResolver()).not.toBeNull();
    });

    it.each([
        ['mtuLength', 32, 'mtuLength=32 <= HEADER_LENGTH=32'],
        ['ipcMtuLength', 65505, 'mtuLength=65505 > MAX_UDP_PAYLOAD_LENGTH=65504'],
        ['filePageSize', 6144, 'filePageSize not a power of 2: 6144'],
        ['filePageSize', 2048, 'filePageSize less than min size of 4096: 2048'],
        ['initialWindowLength', 1024, 'mtuLength=1408 > initialWindowLength=1024'],
        ['publicationReservedSessionIdLow', 2000, 'low session id value 2000 must be <= high value 1000'],
        [
            'publicationUnblockTimeoutNs',
            10_000_000_000,
            'publicationUnblockTimeoutNs=10000000000 <= clientLivenessTimeoutNs=10000000000',
        ],
        ['clientLivenessTimeoutNs', 1_000_000_000, 'clientLivenessTimeoutNs=1000000000 <= timerIntervalNs=1000000000'],
        [
            'untetheredWindowLimitTimeoutNs',
            1_000_000_000,
            'untetheredWindowLimitTimeoutNs=1000000000 <= timerIntervalNs=1000000000',
        ],
        [
            'untetheredRestingTimeoutNs',
            1_000_000_000,
            'untetheredRestingTimeoutNs=1000000000 <= timerIntervalNs=1000000000',
        ],
        [
            'untetheredLingerTimeoutNs',
            1_000_000_000,
            'untetheredLingerTimeoutNs=1000000000 <= timerIntervalNs=1000000000',
        ],
        [
            'unicastFlowControlRetransmitReceiverWindowMultiple',
            0,
            'unicastFlowControlRetransmitReceiverWindowMultiple less than min size of 1: 0',
        ],
        [
            'multicastFlowControlRetransmitReceiverWindowMultiple',
            0,
            'multicastFControlRetransmitReceiverWindowMultiple less than min size of 1: 0',
        ],
    ] as [string, number, string][])('concludeRejects %s=%i with "%s"', (setter, value, message) => {
        // mutation: a validation of Context.conclude is dropped or reordered with another one
        (context as unknown as Record<string, (v: number) => Context>)[setter]!(value);
        const e = assertThrowsExactly(ConfigurationException, () => context.conclude());
        expect(e.message).toBe('ERROR - ' + message);
    });

    it('anInvalidTermBufferLengthIsRejectedByLogBufferDescriptor', () => {
        context.publicationTermBufferLength(1000);
        assertThrows(IllegalStateException, () => context.conclude());
        const ipc = new Context().ipcTermBufferLength(3 * 65536);
        try {
            assertThrows(IllegalStateException, () => ipc.conclude());
        } finally {
            ipc.close();
        }
    });

    it('theCncLengthBoundIsEnforced', () => {
        // 500 MiB of counter values need 5x that for the CnC: above Integer.MAX_VALUE
        context.counterValuesBufferLength(Configuration.COUNTERS_VALUES_BUFFER_LENGTH_MAX);
        const e = assertThrowsExactly(ConfigurationException, () => context.conclude());
        expect(e.message).toBe(
            'ERROR - CnC file length greater than max size of 2147483647: ' +
                Math.ceil(
                    (CncFileDescriptor.META_DATA_LENGTH +
                        Configuration.CONDUCTOR_BUFFER_LENGTH_DEFAULT +
                        Configuration.TO_CLIENTS_BUFFER_LENGTH_DEFAULT +
                        Configuration.COUNTERS_VALUES_BUFFER_LENGTH_MAX * 5 +
                        Configuration.ERROR_BUFFER_LENGTH_DEFAULT) /
                        4096,
                ) *
                    4096,
        );
        expect(context.cncByteBuffer()).toBeNull();
    });

    it('printConfigurationOnStartPrintsToStringAfterConclude', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            context.printConfigurationOnStart(true).conclude();
            expect(spy).toHaveBeenCalledTimes(1);
            const text = spy.mock.calls[0]![0] as string;
            expect(text).toContain('MediaDriver.Context\n{');
            expect(text).toContain('\n    isConcluded=true');
        } finally {
            spy.mockRestore();
        }
    });

    it('toStringHasJavasShapeAndLeavesOutTheOmittedMembers', () => {
        const text = context.toString();
        expect(
            text.startsWith(
                'MediaDriver.Context\n{\n    isConcluded=false\n    isClosed=false\n    cncVersion=0.2.0\n',
            ),
        ).toBe(true);
        expect(text.endsWith('\n    maxResend=16\n}')).toBe(true);
        expect(text).toContain("\n    resolverName='null'");
        expect(text).toContain('\n    applicationSpecificFeedback=null');
        expect(text).toContain('\n    multicastFControlRetransmitReceiverWindowMultiple=4');
        expect(text).not.toContain('aeronDirectory');
        expect(text).not.toContain('ThreadFactory');
    });

    it('theMediaDriverContextIsAlsoReachableAsMediaDriverDotContext', () => {
        expect(MediaDriver.Context).toBe(Context);
        expect(new MediaDriver.Context()).toBeInstanceOf(CommonContext);
    });

    it('theLongsStayExactAtTheBoundsOfTheValidation', () => {
        context.nakUnicastDelayNs(Long.MAX_VALUE).nakUnicastRetryDelayRatio(1);
        context.conclude();
        expect(context.nakUnicastDelayNs()).toBe(Long.MAX_VALUE);
    });
});

describe('PublicationParamsExtraTest', () => {
    let ctx: Context;
    const noConductor = (): DriverConductor => ({
        findNetworkPublicationByTag: () => null,
        findIpcPublicationByTag: () => null,
        nextAvailableSessionId: () => 7,
    });

    beforeEach(() => {
        ctx = new Context();
    });

    function params(uri: string, conductor: DriverConductor = noConductor(), streamId = 1) {
        const channelUri = ChannelUri.parse(uri);
        return PublicationParams.getPublicationParams(channelUri, ctx, conductor, streamId, channelUri.media());
    }

    it('defaultsComeFromTheContextForUdpAndIpc', () => {
        const udp = params('aeron:udp?endpoint=localhost:5555');
        expect(udp.termLength).toBe(16 * 1024 * 1024);
        expect(udp.mtuLength).toBe(1408);
        expect(udp.sessionId).toBe(7);
        expect(udp.hasPosition).toBe(false);
        expect(udp.termOffset).toBe(0);
        expect(udp.termId).toBe(udp.initialTermId);
        expect(udp.entityTag).toBe(ChannelUri.INVALID_TAG);
        expect(udp.responseCorrelationId).toBe(Aeron.NULL_VALUE);
        expect(udp.isResponse).toBe(false);
        expect(udp.publicationWindowLength).toBe(8 * 1024 * 1024);
        const ipc = params('aeron:ipc');
        expect(ipc.termLength).toBe(64 * 1024 * 1024);
        expect(ipc.publicationWindowLength).toBe(32 * 1024 * 1024);
    });

    it('theCompletePositionSetIsReadAndAnIncompleteOneIsRejected', () => {
        const ok = params(
            'aeron:udp?endpoint=localhost:5555|term-length=64k|init-term-id=10|term-id=12|term-offset=4096',
        );
        expect(ok.hasPosition).toBe(true);
        expect([ok.initialTermId, ok.termId, ok.termOffset]).toEqual([10, 12, 4096]);
        const e = assertThrowsExactly(InvalidChannelException, () =>
            params('aeron:udp?endpoint=localhost:5555|init-term-id=10|term-id=12'),
        );
        expect(e.message).toContain('params must be used as a complete set: init-term-id term-id term-offset channel=');
    });

    it.each([
        ['term-offset=65537', 'term-offset=65537 > term-length=65536'],
        ['term-offset=-32', 'term-offset=-32 out of range'],
        ['term-offset=33', 'term-offset=33 must be a multiple of FRAME_ALIGNMENT'],
    ])('thePositionSetWith %s is rejected with %s', (offset, message) => {
        const e = assertThrowsExactly(InvalidChannelException, () =>
            params('aeron:udp?endpoint=localhost:5555|term-length=64k|init-term-id=10|term-id=12|' + offset),
        );
        expect(e.message).toContain(message);
    });

    it('aTermIdMoreThan2To31AheadOfTheInitialTermIdIsRejected', () => {
        // mutation: the difference is not wrapped to an int
        const e = assertThrowsExactly(InvalidChannelException, () =>
            params('aeron:udp?endpoint=localhost:5555|init-term-id=-1|term-id=2147483647|term-offset=0'),
        );
        expect(e.message).toContain('difference greater than 2^31 - 1: init-term-id=-1 when term-id=2147483647');
        const ok = params(
            'aeron:udp?endpoint=localhost:5555|init-term-id=2147483647|term-id=-2147483648|term-offset=0',
        );
        expect(ok.hasPosition).toBe(true);
    });

    it.each([
        ['response-correlation-id=prototype', -2],
        ['response-correlation-id=-1', -1],
        ['response-correlation-id=0', 0],
        ['response-correlation-id=1234567890123', 1234567890123],
    ])('%s parses to %i', (param, expected) => {
        expect(params('aeron:udp?endpoint=localhost:5555|' + param).responseCorrelationId).toBe(expected);
    });

    it.each(['-2', 'abc', '9223372036854775807', '99999999999999999999'])(
        'response-correlation-id=%s is an InvalidChannelException',
        (value) => {
            // a value Java accepts but a number cannot hold (2^63 - 1) is rejected, not thrown as a RangeError (D5)
            const e = assertThrows(InvalidChannelException, () =>
                params('aeron:udp?endpoint=localhost:5555|response-correlation-id=' + value),
            );
            expect(e.message).toContain(
                'invalid response-correlation-id, must be a number greater than or equal to -1',
            );
        },
    );

    it('isResponseFollowsTheControlMode', () => {
        expect(params('aeron:udp?control=localhost:5555|control-mode=response').isResponse).toBe(true);
    });

    describe('entity tag', () => {
        it('aTagIsReadAsALong', () => {
            expect(params('aeron:udp?endpoint=localhost:5555|tags=1,1234567890123').entityTag).toBe(1234567890123);
        });

        it('theReservedTagIsRejected', () => {
            const e = assertThrowsExactly(InvalidChannelException, () =>
                params('aeron:udp?endpoint=localhost:5555|tags=1,-1'),
            );
            expect(e.message).toContain('-1 tag is reserved: channel=');
        });

        it.each(['abc', '9223372036854775807'])('the tag %s is not a number a number can hold', (tag) => {
            const e = assertThrowsExactly(InvalidChannelException, () =>
                params('aeron:udp?endpoint=localhost:5555|tags=1,' + tag),
            );
            expect(e.message).toBe('ERROR - invalid entity tag, must be a number');
        });

        it('aTagInUseByANetworkOrIpcPublicationIsRejectedWithItsChannel', () => {
            const used: PublicationLike = {
                sessionId: () => 1,
                mtuLength: () => 1,
                termBufferLength: () => 1,
                channel: () => 'aeron:udp?endpoint=other:1',
            };
            const net = { ...noConductor(), findNetworkPublicationByTag: () => used };
            const e1 = assertThrowsExactly(InvalidChannelException, () =>
                params('aeron:udp?endpoint=localhost:5555|tags=1,5', net),
            );
            expect(e1.message).toContain(
                '5 entityTag already in use: existingChannel=aeron:udp?endpoint=other:1 channel=',
            );
            const ipc = { ...noConductor(), findIpcPublicationByTag: () => used };
            const e2 = assertThrowsExactly(InvalidChannelException, () =>
                params('aeron:udp?endpoint=localhost:5555|tags=1,5', ipc),
            );
            expect(e2.message).toContain(
                '5 entityTag already in use: existingChannel=aeron:udp?endpoint=other:1 channel=',
            );
        });
    });

    describe('session id tags', () => {
        it('aTagBeyondTheSafeRangeIsAnInvalidTagNotARangeError', () => {
            // Java accepts a long tag; D5 cannot hold it. mutation: the LongOverflowError escapes
            const e = assertThrowsExactly(InvalidChannelException, () =>
                params('aeron:udp?endpoint=localhost:5555|session-id=tag:9223372036854775807'),
            );
            expect(e.message).toContain('session-id=tag:9223372036854775807 has an invalid tag: channel=');
        });

        it('anExplicitTermLengthOrMtuMustMatchTheReferencedPublication', () => {
            const pub: PublicationLike = {
                sessionId: () => 9,
                mtuLength: () => 1408,
                termBufferLength: () => 65536,
                channel: () => '',
            };
            const conductor = { ...noConductor(), findNetworkPublicationByTag: () => pub };
            const ok = params('aeron:udp?endpoint=localhost:5555|session-id=tag:3|term-length=64k|mtu=1408', conductor);
            expect(ok.isSessionIdTagged).toBe(true);
            expect([ok.sessionId, ok.termLength, ok.mtuLength]).toEqual([9, 65536, 1408]);
            const e1 = assertThrowsExactly(InvalidChannelException, () =>
                params('aeron:udp?endpoint=localhost:5555|session-id=tag:3|term-length=128k', conductor),
            );
            expect(e1.message).toContain('term-length=131072 does not match session-id tag value: channel=');
            const e2 = assertThrowsExactly(InvalidChannelException, () =>
                params('aeron:udp?endpoint=localhost:5555|session-id=tag:3|mtu=1440', conductor),
            );
            expect(e2.message).toContain('mtu=1440 does not match session-id tag value: channel=');
        });
    });

    it('anMtuAboveTheMaxMessageLengthOfTheTermIsRejected', () => {
        // the max message length of a 64k term is 8192
        const e = assertThrowsExactly(InvalidChannelException, () =>
            params('aeron:udp?endpoint=localhost:5555|term-length=64k|mtu=16384'),
        );
        expect(e.message).toContain(
            'MTU greater than max message length for term length: mtu=16384 maxMessageLength=8192 termLength=65536 channel=',
        );
        expect(params('aeron:udp?endpoint=localhost:5555|term-length=64k|mtu=8192').mtuLength).toBe(8192);
    });

    it('anInvalidMtuOrTermLengthIsRejectedByTheValidators', () => {
        assertThrows(ConfigurationException, () => params('aeron:udp?endpoint=localhost:5555|mtu=1000'));
        assertThrows(IllegalStateException, () => params('aeron:udp?endpoint=localhost:5555|term-length=1000'));
    });

    describe('confirmMatch', () => {
        const rawLog = (mtu: number, termLength: number): RawLog => {
            const meta = new UnsafeBuffer(new Uint8Array(LogBufferDescriptor.LOG_META_DATA_LENGTH));
            LogBufferDescriptor.mtuLength(meta, mtu);
            return { metaData: () => meta, termLength: () => termLength };
        };

        it('aChannelWithoutTheParametersNeverMismatches', () => {
            const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:5555');
            const p = params('aeron:udp?endpoint=localhost:5555');
            PublicationParams.confirmMatch(uri, p, rawLog(1, 1), 99, 'ch', 98, 97, 96);
        });

        it('aChannelWhoseParametersAllMatchIsAccepted', () => {
            const text =
                'aeron:udp?endpoint=localhost:5555|mtu=1408|term-length=64k|session-id=11|init-term-id=5|term-id=6|term-offset=64';
            PublicationParams.confirmMatch(
                ChannelUri.parse(text),
                params(text),
                rawLog(1408, 65536),
                11,
                'ch',
                5,
                6,
                64,
            );
        });

        // [uri parameters, name, existing sessionId, mtu, termLength, initialTermId, termId, termOffset, existing, requested]
        it.each([
            ['mtu=1408', 'mtu', 1440, 65536, 11, 5, 6, 64, '1440', '1408'],
            ['term-length=64k', 'term-length', 1408, 131072, 11, 5, 6, 64, '131072', '65536'],
            ['session-id=11', 'session-id', 1408, 65536, 12, 5, 6, 64, '12', '11'],
            ['init-term-id=5|term-id=6|term-offset=64', 'init-term-id', 1408, 65536, 11, 4, 6, 64, '4', '5'],
            ['init-term-id=5|term-id=6|term-offset=64', 'term-id', 1408, 65536, 11, 5, 7, 64, '7', '6'],
            ['init-term-id=5|term-id=6|term-offset=64', 'term-offset', 1408, 65536, 11, 5, 6, 96, '96', '64'],
        ])(
            'a mismatch of %s names %s',
            (
                param,
                name,
                existingMtu,
                existingTermLength,
                sessionId,
                initialTermId,
                termId,
                termOffset,
                existing,
                requested,
            ) => {
                // mutation: a comparison is dropped, or the existing and requested values are swapped
                const uri = ChannelUri.parse('aeron:udp?endpoint=localhost:5555|' + param);
                const p = params('aeron:udp?endpoint=localhost:5555|' + param);
                const log = rawLog(existingMtu as number, existingTermLength as number);
                const e = assertThrowsExactly(IllegalStateException, () =>
                    PublicationParams.confirmMatch(
                        uri,
                        p,
                        log,
                        sessionId as number,
                        'existing',
                        initialTermId as number,
                        termId as number,
                        termOffset as number,
                    ),
                );
                expect(e.message).toBe(
                    "existing publication has different '" +
                        name +
                        "': existing=" +
                        existing +
                        ' requested=' +
                        requested +
                        ' existingChannel=existing channel=' +
                        uri.toString(),
                );
            },
        );

        it('validateSpiesSimulateConnectionComparesAndFormats', () => {
            const p = params('aeron:ipc?ssc=true');
            PublicationParams.validateSpiesSimulateConnection(p, true, 'c', 'e');
            const e = assertThrowsExactly(IllegalStateException, () =>
                PublicationParams.validateSpiesSimulateConnection(p, false, 'c', 'e'),
            );
            expect(e.message).toBe(
                'existing publication has different spiesSimulateConnection: existing=false requested=true existingChannel=e channel=c',
            );
        });
    });

    it('toStringIsJavasShape', () => {
        const p = params('aeron:ipc?term-length=1m');
        expect(p.toString()).toMatch(
            /^PublicationParams\{lingerTimeoutNs=5000000000, entityTag=-1, termLength=1048576, /,
        );
        expect(p.toString()).toMatch(/, maxResend=16, publicationWindowLength=524288\}$/);
    });
});

describe('SubscriptionParamsExtraTest', () => {
    let ctx: Context;

    beforeEach(() => {
        ctx = new Context();
    });

    function params(uri: string, publisherTermBufferLength = 0) {
        return SubscriptionParams.getSubscriptionParams(ChannelUri.parse(uri), ctx, publisherTermBufferLength);
    }

    it('defaultsComeFromTheContext', () => {
        const p = params('aeron:udp?endpoint=localhost:5555');
        expect(p.hasSessionId).toBe(false);
        expect(p.hasJoinPosition).toBe(false);
        expect(p.isReliable).toBe(true);
        expect(p.isRejoin).toBe(true);
        expect(p.isTether).toBe(true);
        expect(p.isSparse).toBe(true);
        expect(p.isResponse).toBe(false);
        expect(p.group).toBe(InferableBoolean.INFER);
        expect(p.receiverWindowLength).toBe(131072);
        expect(p.untetheredWindowLimitTimeoutNs).toBe(5_000_000_000);
        expect(p.untetheredLingerTimeoutNs).toBe(5_000_000_000);
        expect(p.untetheredRestingTimeoutNs).toBe(10_000_000_000);
    });

    it('theUriOverridesTheContext', () => {
        ctx.reliableStream(true).rejoinStream(true).tetherSubscriptions(true).termBufferSparseFile(true);
        const p = params(
            'aeron:udp?endpoint=localhost:5555|reliable=false|rejoin=false|tether=false|sparse=false|group=true|' +
                'session-id=-5|rcv-wnd=64k|untethered-window-limit-timeout=1ms|untethered-linger-timeout=2ms|' +
                'untethered-resting-timeout=3ms|control-mode=response',
        );
        expect(p.isReliable).toBe(false);
        expect(p.isRejoin).toBe(false);
        expect(p.isTether).toBe(false);
        expect(p.isSparse).toBe(false);
        expect(p.group).toBe(InferableBoolean.FORCE_TRUE);
        expect(p.sessionId).toBe(-5);
        expect(p.hasSessionId).toBe(true);
        expect(p.receiverWindowLength).toBe(65536);
        expect(p.untetheredWindowLimitTimeoutNs).toBe(1_000_000);
        expect(p.untetheredLingerTimeoutNs).toBe(2_000_000);
        expect(p.untetheredRestingTimeoutNs).toBe(3_000_000);
        expect(p.isResponse).toBe(true);
    });

    it('theReceiverWindowIsAtMostHalfThePublisherTermOrTheContextTerm', () => {
        // mutation: the term used is not the publisher's when it is non zero
        expect(params('aeron:udp?endpoint=localhost:5555|rcv-wnd=1m', 65536).receiverWindowLength).toBe(32768);
        expect(params('aeron:udp?endpoint=localhost:5555|rcv-wnd=1m', 0).receiverWindowLength).toBe(1048576);
        ctx.ipcTermBufferLength(65536);
        expect(params('aeron:ipc?rcv-wnd=1m').receiverWindowLength).toBe(32768);
    });

    it('theJoinPositionNeedsAllThreeAndIsValidated', () => {
        const ok = params('aeron:udp?endpoint=localhost:5555|init-term-id=1|term-id=3|term-offset=64');
        expect(ok.hasJoinPosition).toBe(true);
        expect([ok.initialTermId, ok.termId, ok.termOffset]).toEqual([1, 3, 64]);
        const e = assertThrowsExactly(IllegalArgumentException, () => params('aeron:udp?endpoint=a:1|term-id=3'));
        expect(e.message).toContain('params must be used as a complete set: init-term-id term-id term-offset channel=');
        assertThrowsExactly(IllegalArgumentException, () =>
            params('aeron:udp?endpoint=a:1|init-term-id=1|term-id=3|term-offset=-32'),
        );
        assertThrowsExactly(IllegalArgumentException, () =>
            params('aeron:udp?endpoint=a:1|init-term-id=1|term-id=3|term-offset=33'),
        );
        assertThrowsExactly(IllegalArgumentException, () =>
            params('aeron:udp?endpoint=a:1|init-term-id=1|term-id=3|term-offset=1073741856'),
        );
        const d = assertThrowsExactly(IllegalStateException, () =>
            params('aeron:udp?endpoint=a:1|init-term-id=-1|term-id=2147483647|term-offset=0'),
        );
        expect(d.message).toContain('difference greater than 2^31 - 1: init-term-id=-1 when term-id=2147483647');
    });

    it('aSessionIdThatIsNotAnIntegerIsANumberFormatException', () => {
        assertThrows(Error, () => params('aeron:udp?endpoint=a:1|session-id=abc'));
        assertThrows(Error, () => params('aeron:udp?endpoint=a:1|session-id=2147483648'));
    });

    it('toStringIsJavasShape', () => {
        const text = params('aeron:ipc').toString();
        expect(text.startsWith('SubscriptionParams\n{\n    initialTermId=0\n    termId=0\n')).toBe(true);
        expect(
            text.endsWith('\n    untetheredRestingTimeoutNs=10000000000\n    untetheredLingerTimeoutNs=5000000000\n}'),
        ).toBe(true);
    });
});
