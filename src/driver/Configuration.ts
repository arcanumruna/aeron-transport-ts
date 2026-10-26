/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of io/aeron/driver/Configuration.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import { AsciiNumberFormatException } from '../agrona/AsciiNumberFormatException.js';
import { ArrayUtil } from '../agrona/collections/ArrayUtil.js';
import { BackoffIdleStrategy } from '../agrona/concurrent/BackoffIdleStrategy.js';
import { BusySpinIdleStrategy } from '../agrona/concurrent/BusySpinIdleStrategy.js';
import { ControllableIdleStrategy } from '../agrona/concurrent/ControllableIdleStrategy.js';
import type { IdleStrategy } from '../agrona/concurrent/IdleStrategy.js';
import { NoOpIdleStrategy } from '../agrona/concurrent/NoOpIdleStrategy.js';
import { SleepingIdleStrategy } from '../agrona/concurrent/SleepingIdleStrategy.js';
import { SleepingMillisIdleStrategy } from '../agrona/concurrent/SleepingMillisIdleStrategy.js';
import { YieldingIdleStrategy } from '../agrona/concurrent/YieldingIdleStrategy.js';
import { BroadcastBufferDescriptor } from '../agrona/concurrent/broadcast/BroadcastBufferDescriptor.js';
import { RingBufferDescriptor } from '../agrona/concurrent/ringbuffer/RingBufferDescriptor.js';
import { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import type { StatusIndicator } from '../agrona/concurrent/status/StatusIndicator.js';
import { ByteOrder, ClassNotFoundException, Integer, Long, NumberFormatException, TimeUnit } from '../agrona/jdk.js';
import { requireNonNull, System } from '../agrona/jdkLang.js';
import { SystemErr } from '../agrona/jdkThrowable.js';
import { LangUtil } from '../agrona/LangUtil.js';
import { Strings } from '../agrona/Strings.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { Aeron } from '../client/Aeron.js';
import { CommonContext, type InferableBoolean } from '../client/CommonContext.js';
import { ConfigurationException } from '../client/exceptions/ConfigurationException.js';
import type { MediaDriverContext } from './MediaDriver.js';
import { FrameDescriptor } from '../client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { DataHeaderFlyweight } from '../client/protocol/DataHeaderFlyweight.js';
import type { InetSocketAddress } from './jdkNet.js';
import { DefaultCongestionControlSupplier } from './DefaultCongestionControlSupplier.js';
import { DefaultDenyTerminationValidator } from './DefaultDenyTerminationValidator.js';
import { DefaultMulticastFlowControlSupplier } from './DefaultMulticastFlowControlSupplier.js';
import { DefaultUnicastFlowControlSupplier } from './DefaultUnicastFlowControlSupplier.js';
import { FlowControlRegistry } from './FlowControlRegistry.js';
import { ReceiverWindow } from './ReceiverWindow.js';
import { PreferredMulticastFlowControlAsf } from './PreferredMulticastFlowControlAsf.js';
import { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import type { CongestionControlSupplier } from './CongestionControlSupplier.js';
import type { FlowControlSupplier } from './FlowControlSupplier.js';
import type { TerminationValidator } from './TerminationValidator.js';
import { DefaultReceiveChannelEndpointSupplier } from './DefaultReceiveChannelEndpointSupplier.js';
import { DefaultSendChannelEndpointSupplier } from './DefaultSendChannelEndpointSupplier.js';
import { DebugReceiveChannelEndpointSupplier } from './ext/DebugReceiveChannelEndpointSupplier.js';
import { DebugSendChannelEndpointSupplier } from './ext/DebugSendChannelEndpointSupplier.js';
import type { ReceiveChannelEndpointSupplier } from './ReceiveChannelEndpointSupplier.js';
import type { SendChannelEndpointSupplier } from './SendChannelEndpointSupplier.js';
import { ThreadingMode } from './ThreadingMode.js';

/**
 * Configuration options for the {@link MediaDriver} and its components, with their defaults and the readers of the
 * system properties that set them.
 * <p>
 * Every PROP_NAME and DEFAULT constant is ported; see `docs/mapping.md` for the members that differ.
 */
export class Configuration {
    private constructor() {}

    /**
     * Warn if the Aeron directory exists.
     */
    public static readonly DIR_WARN_IF_EXISTS_PROP_NAME: string = 'aeron.dir.warn.if.exists';

    /**
     * Should the Media Driver attempt to immediately delete the directory {@link CommonContext#AERON_DIR_PROP_NAME}
     * on start if it exists before performing any additional checks.
     */
    public static readonly DIR_DELETE_ON_START_PROP_NAME: string = 'aeron.dir.delete.on.start';

    /**
     * Should driver attempt to delete {@link CommonContext#AERON_DIR_PROP_NAME} on shutdown.
     */
    public static readonly DIR_DELETE_ON_SHUTDOWN_PROP_NAME: string = 'aeron.dir.delete.on.shutdown';

    /**
     * Should high resolution timer be used on Windows.
     */
    public static readonly USE_WINDOWS_HIGH_RES_TIMER_PROP_NAME: string = 'aeron.use.windows.high.res.timer';

    /**
     * Property name for default boolean value for if subscriptions should have a tether for local flow control.
     */
    public static readonly TETHER_SUBSCRIPTIONS_PROP_NAME: string = 'aeron.tether.subscriptions';

    /**
     * Property name for default boolean value for if a stream is reliable. True to NAK, false to gap fill.
     */
    public static readonly RELIABLE_STREAM_PROP_NAME: string = 'aeron.reliable.stream';

    /**
     * Property name for boolean value if term buffers should be created sparse.
     */
    public static readonly TERM_BUFFER_SPARSE_FILE_PROP_NAME: string = 'aeron.term.buffer.sparse.file';

    /**
     * Property name for default boolean value for if subscriptions should be considered a group member or individual.
     */
    public static readonly GROUP_RECEIVER_CONSIDERATION_PROP_NAME: string = 'aeron.receiver.group.consideration';

    /**
     * Property name for page size to align all files to.
     */
    public static readonly FILE_PAGE_SIZE_PROP_NAME: string = 'aeron.file.page.size';

    /**
     * Default page size for alignment of all files.
     */
    public static readonly FILE_PAGE_SIZE_DEFAULT: number = 4 * 1024;

    /**
     * Property name for boolean value for if storage checks should be performed when allocating files.
     */
    public static readonly PERFORM_STORAGE_CHECKS_PROP_NAME: string = 'aeron.perform.storage.checks';

    /**
     * Length (in bytes) of the log buffers for UDP publication terms.
     */
    public static readonly TERM_BUFFER_LENGTH_PROP_NAME: string = 'aeron.term.buffer.length';

    /**
     * Default term buffer length.
     */
    public static readonly TERM_BUFFER_LENGTH_DEFAULT: number = 16 * 1024 * 1024;

    /**
     * Length (in bytes) of the log buffers for IPC publication terms.
     */
    public static readonly IPC_TERM_BUFFER_LENGTH_PROP_NAME: string = 'aeron.ipc.term.buffer.length';

    /**
     * Default IPC term buffer length.
     */
    public static readonly TERM_BUFFER_IPC_LENGTH_DEFAULT: number = 64 * 1024 * 1024;

    /**
     * Property name low file storage warning threshold in bytes.
     */
    public static readonly LOW_FILE_STORE_WARNING_THRESHOLD_PROP_NAME: string =
        'aeron.low.file.store.warning.threshold';

    /**
     * Default value in bytes for low file storage warning threshold.
     */
    public static readonly LOW_FILE_STORE_WARNING_THRESHOLD_DEFAULT: number =
        Configuration.TERM_BUFFER_LENGTH_DEFAULT * 10;

    /**
     * Length (in bytes) of the conductor buffer for control commands from the clients to the media driver conductor.
     */
    public static readonly CONDUCTOR_BUFFER_LENGTH_PROP_NAME: string = 'aeron.conductor.buffer.length';

    /**
     * Default buffer length for conductor buffers between the client and the media driver conductor.
     */
    public static readonly CONDUCTOR_BUFFER_LENGTH_DEFAULT: number = 1024 * 1024 + RingBufferDescriptor.TRAILER_LENGTH;

    /**
     * Length (in bytes) of the broadcast buffers from the media driver to the clients.
     */
    public static readonly TO_CLIENTS_BUFFER_LENGTH_PROP_NAME: string = 'aeron.clients.buffer.length';

    /**
     * Default buffer length for broadcast buffers from the media driver and the clients.
     */
    public static readonly TO_CLIENTS_BUFFER_LENGTH_DEFAULT: number =
        1024 * 1024 + BroadcastBufferDescriptor.TRAILER_LENGTH;

    /**
     * Property name for length of the buffer for the counters.
     * <p>
     * Each counter uses {@link org.agrona.concurrent.status.CountersReader#COUNTER_LENGTH} bytes.
     */
    public static readonly COUNTERS_VALUES_BUFFER_LENGTH_PROP_NAME: string = 'aeron.counters.buffer.length';

    /**
     * Default length of the buffer for the counters file.
     */
    public static readonly COUNTERS_VALUES_BUFFER_LENGTH_DEFAULT: number = 8 * 1024 * 1024;

    /**
     * Minimum counters buffer length.
     */
    public static readonly COUNTERS_VALUES_BUFFER_LENGTH_MIN: number = 1024 * 1024;

    /**
     * Maximum counters buffer length.
     */
    public static readonly COUNTERS_VALUES_BUFFER_LENGTH_MAX: number = 500 * 1024 * 1024;

    /**
     * Property name for length of the memory mapped buffer for the distinct error log.
     */
    public static readonly ERROR_BUFFER_LENGTH_PROP_NAME: string = 'aeron.error.buffer.length';

    /**
     * Default buffer length for the error buffer for the media driver.
     */
    public static readonly ERROR_BUFFER_LENGTH_DEFAULT: number = 4 * 1024 * 1024;

    /**
     * Property name for length of the memory mapped buffer for the {@link io.aeron.driver.reports.LossReport}.
     */
    public static readonly LOSS_REPORT_BUFFER_LENGTH_PROP_NAME: string = 'aeron.loss.report.buffer.length';

    /**
     * Default buffer length for the {@link io.aeron.driver.reports.LossReport}.
     */
    public static readonly LOSS_REPORT_BUFFER_LENGTH_DEFAULT: number = 1024 * 1024;

    /**
     * Property name for length of the initial window which must be sufficient for Bandwidth Delay Product (BDP).
     */
    public static readonly INITIAL_WINDOW_LENGTH_PROP_NAME: string = 'aeron.rcv.initial.window.length';

    /**
     * Default initial window length for flow control sender to receiver purposes. This assumes a system free of pauses.
     * <p>
     * Length of Initial Window:
     * <p>
     * RTT (LAN) = 100 usec
     * Throughput = 10 Gbps
     * <p>
     * Buffer = Throughput * RTT
     * Buffer = (10 * 1000 * 1000 * 1000 / 8) * 0.0001 = 125000
     * Round to 128 KB
     */
    public static readonly INITIAL_WINDOW_LENGTH_DEFAULT: number = ReceiverWindow.INITIAL_WINDOW_LENGTH_DEFAULT;

    /**
     * Status message timeout in nanoseconds after which one will be sent when data flow has not triggered one.
     */
    public static readonly STATUS_MESSAGE_TIMEOUT_PROP_NAME: string = 'aeron.rcv.status.message.timeout';

    /**
     * Max timeout between Status messages (SM)s.
     */
    public static readonly STATUS_MESSAGE_TIMEOUT_DEFAULT_NS: number = TimeUnit.MILLISECONDS.toNanos(200);

    /**
     * Property name for ratio of sending data to polling status messages in the {@link Sender}.
     */
    public static readonly SEND_TO_STATUS_POLL_RATIO_PROP_NAME: string = 'aeron.send.to.status.poll.ratio';

    /**
     * The ratio for sending data to polling status messages in the Sender. This may be reduced for smaller windows.
     */
    public static readonly SEND_TO_STATUS_POLL_RATIO_DEFAULT: number = 6;

    /**
     * Property name for the limit of the number of driver managed resources that can be freed in a single duty cycle.
     */
    public static readonly RESOURCE_FREE_LIMIT_PROP_NAME: string = 'aeron.driver.resource.free.limit';

    /**
     * Default value for the limit of the number of driver managed resources that can be freed in a single duty cycle.
     */
    public static readonly RESOURCE_FREE_LIMIT_DEFAULT: number = 1;

    /**
     * Property name for SO_RCVBUF setting on UDP sockets which must be sufficient for Bandwidth Delay Product (BDP).
     */
    public static readonly SOCKET_RCVBUF_LENGTH_PROP_NAME: string = 'aeron.socket.so_rcvbuf';

    /**
     * Default SO_RCVBUF length.
     */
    public static readonly SOCKET_RCVBUF_LENGTH_DEFAULT: number = 128 * 1024;

    /**
     * Property name for SO_SNDBUF setting on UDP sockets which must be sufficient for Bandwidth Delay Product (BDP).
     */
    public static readonly SOCKET_SNDBUF_LENGTH_PROP_NAME: string = 'aeron.socket.so_sndbuf';

    /**
     * Default SO_SNDBUF length.
     */
    public static readonly SOCKET_SNDBUF_LENGTH_DEFAULT: number = 0;

    /**
     * Property name for IP_MULTICAST_TTL setting on UDP sockets.
     */
    public static readonly SOCKET_MULTICAST_TTL_PROP_NAME: string = 'aeron.socket.multicast.ttl';

    /**
     * Multicast TTL value, 0 means use OS default.
     */
    public static readonly SOCKET_MULTICAST_TTL_DEFAULT: number = 0;

    /**
     * Property name for linger timeout after draining on {@link Publication}s so they can respond to NAKs.
     */
    public static readonly PUBLICATION_LINGER_PROP_NAME: string = 'aeron.publication.linger.timeout';

    /**
     * Default time for {@link Publication}s to linger after draining and before cleanup in nanoseconds.
     */
    public static readonly PUBLICATION_LINGER_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(5);

    /**
     * Property name for {@link Aeron} client liveness timeout after which it is considered not alive.
     */
    public static readonly CLIENT_LIVENESS_TIMEOUT_PROP_NAME: string = 'aeron.client.liveness.timeout';

    /**
     * Default timeout for client liveness timeout after which it is considered not alive.
     */
    public static readonly CLIENT_LIVENESS_TIMEOUT_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(10);

    /**
     * {@link Image} liveness timeout for how long it stays active without heartbeats or lingers around after being
     * drained.
     */
    public static readonly IMAGE_LIVENESS_TIMEOUT_PROP_NAME: string = 'aeron.image.liveness.timeout';

    /**
     * Default timeout for {@link Image} liveness timeout.
     */
    public static readonly IMAGE_LIVENESS_TIMEOUT_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(10);

    /**
     * Property name for window limit on {@link Publication} side by which the publisher can get ahead of consumers.
     */
    public static readonly PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME: string = 'aeron.publication.term.window.length';

    /**
     * Property name for window limit for IPC publications.
     */
    public static readonly IPC_PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME: string =
        'aeron.ipc.publication.term.window.length';

    /**
     * {@link Publication} unblock timeout due to client crash or untimely commit.
     * <p>
     * A publication can become blocked if the client crashes while publishing or if
     * {@link io.aeron.Publication#tryClaim(int, BufferClaim)} is used without following up by calling
     * {@link BufferClaim#commit()} or {@link BufferClaim#abort()}.
     */
    public static readonly PUBLICATION_UNBLOCK_TIMEOUT_PROP_NAME: string = 'aeron.publication.unblock.timeout';

    /**
     * Timeout for {@link Publication} unblock in nanoseconds.
     */
    public static readonly PUBLICATION_UNBLOCK_TIMEOUT_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(15);

    /**
     * Property name for {@link Publication} timeout due to lack of status messages which indicate a connection.
     */
    public static readonly PUBLICATION_CONNECTION_TIMEOUT_PROP_NAME: string = 'aeron.publication.connection.timeout';

    /**
     * Timeout for {@link Publication} connection timeout in nanoseconds.
     */
    public static readonly PUBLICATION_CONNECTION_TIMEOUT_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(5);

    /**
     * Property name for if spy subscriptions simulate a connection to a network publication.
     * <p>
     * If true then this will override the min group size of the min and tagged flow control strategies.
     */
    public static readonly SPIES_SIMULATE_CONNECTION_PROP_NAME: string = 'aeron.spies.simulate.connection';

    /**
     * Default idle strategy for agents.
     */
    private static readonly DEFAULT_IDLE_STRATEGY: string = 'org.agrona.concurrent.BackoffIdleStrategy';

    /**
     * Spin on no activity before backing off to yielding.
     */
    public static readonly IDLE_MAX_SPINS: number = 10;

    /**
     * Yield the thread so others can run before backing off to parking.
     */
    public static readonly IDLE_MAX_YIELDS: number = 20;

    /**
     * Park for the minimum period of time which is typically 50-55 microseconds on 64-bit non-virtualised Linux.
     * You will typically get 50-55 microseconds plus the number of nanoseconds requested if a core is available.
     * On Windows expect to wait for at least 16ms or 1ms if the high-res timers are enabled.
     */
    public static readonly IDLE_MIN_PARK_NS: number = 1000;

    /**
     * Maximum back-off park time which doubles on each interval stepping up from the min park idle.
     */
    public static readonly IDLE_MAX_PARK_NS: number = TimeUnit.MILLISECONDS.toNanos(1);

    /**
     * {@link IdleStrategy} to be used when mode can be controlled via a counter.
     */
    public static readonly CONTROLLABLE_IDLE_STRATEGY: string = 'org.agrona.concurrent.ControllableIdleStrategy';

    /**
     * Property name for {@link IdleStrategy} to be employed by {@link Sender} for {@link ThreadingMode#DEDICATED}.
     */
    public static readonly SENDER_IDLE_STRATEGY_PROP_NAME: string = 'aeron.sender.idle.strategy';

    /**
     * Default idle strategy for the sender thread.
     */
    public static readonly SENDER_IDLE_STRATEGY_DEFAULT: string = Configuration.DEFAULT_IDLE_STRATEGY;

    /**
     * Property name for {@link IdleStrategy} to be employed by {@link Receiver} for {@link ThreadingMode#DEDICATED}.
     */
    public static readonly RECEIVER_IDLE_STRATEGY_PROP_NAME: string = 'aeron.receiver.idle.strategy';

    /**
     * Default idle strategy for the receiver thread.
     */
    public static readonly RECEIVER_IDLE_STRATEGY_DEFAULT: string = Configuration.DEFAULT_IDLE_STRATEGY;

    /**
     * Property name for {@link IdleStrategy} to be employed by {@link DriverConductor} for
     * {@link ThreadingMode#DEDICATED} and {@link ThreadingMode#SHARED_NETWORK}.
     */
    public static readonly CONDUCTOR_IDLE_STRATEGY_PROP_NAME: string = 'aeron.conductor.idle.strategy';

    /**
     * Default idle strategy for the conductor thread.
     */
    public static readonly CONDUCTOR_IDLE_STRATEGY_DEFAULT: string = Configuration.DEFAULT_IDLE_STRATEGY;

    /**
     * Property name for {@link IdleStrategy} to be employed by {@link Sender} and {@link Receiver} for
     * {@link ThreadingMode#SHARED_NETWORK}.
     */
    public static readonly SHARED_NETWORK_IDLE_STRATEGY_PROP_NAME: string = 'aeron.sharednetwork.idle.strategy';

    /**
     * Default idle strategy for the shared network thread.
     */
    public static readonly SHARED_NETWORK_IDLE_STRATEGY_DEFAULT: string = Configuration.DEFAULT_IDLE_STRATEGY;

    /**
     * Property name for {@link IdleStrategy} to be employed by {@link Sender}, {@link Receiver},
     * and {@link DriverConductor} for {@link ThreadingMode#SHARED}.
     */
    public static readonly SHARED_IDLE_STRATEGY_PROP_NAME: string = 'aeron.shared.idle.strategy';

    /**
     * Default idle strategy for the shared thread.
     */
    public static readonly SHARED_IDLE_STRATEGY_DEFAULT: string = Configuration.DEFAULT_IDLE_STRATEGY;

    /**
     * Property name for {@link FlowControl} to be employed for unicast channels.
     */
    public static readonly UNICAST_FLOW_CONTROL_STRATEGY_PROP_NAME: string = 'aeron.unicast.flow.control.strategy';

    /**
     * Default flow control strategy for unicast.
     */
    public static readonly UNICAST_FLOW_CONTROL_STRATEGY_DEFAULT: string = 'io.aeron.driver.UnicastFlowControl';

    /**
     * {@link FlowControl} to be employed for unicast channels.
     */
    public static readonly UNICAST_FLOW_CONTROL_STRATEGY: string = System.getProperty(
        Configuration.UNICAST_FLOW_CONTROL_STRATEGY_PROP_NAME,
        Configuration.UNICAST_FLOW_CONTROL_STRATEGY_DEFAULT,
    );

    /**
     * Property name for {@link FlowControl} to be employed for multicast channels.
     */
    public static readonly MULTICAST_FLOW_CONTROL_STRATEGY_PROP_NAME: string = 'aeron.multicast.flow.control.strategy';

    /**
     *  Default flow control strategy for multicast.
     */
    public static readonly MULTICAST_FLOW_CONTROL_STRATEGY_DEFAULT: string = 'io.aeron.driver.MaxMulticastFlowControl';

    /**
     * {@link FlowControl} to be employed for multicast channels.
     */
    public static readonly MULTICAST_FLOW_CONTROL_STRATEGY: string = System.getProperty(
        Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_PROP_NAME,
        Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_DEFAULT,
    );

    /**
     * Property name for {@link FlowControlSupplier} to be employed for unicast channels.
     */
    public static readonly UNICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME: string =
        'aeron.unicast.FlowControl.supplier';

    /**
     * Property name for {@link FlowControlSupplier} to be employed for unicast channels.
     */
    public static readonly MULTICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME: string =
        'aeron.multicast.FlowControl.supplier';

    /**
     * Maximum UDP datagram payload size for IPv4. Jumbo datagrams from IPv6 are not supported.
     * <p>
     * Max length is 65,507 bytes as 65,535 minus 8 byte UDP header then minus 20 byte IP header.
     * Then round down to the nearest multiple of {@link FrameDescriptor#FRAME_ALIGNMENT} giving 65,504.
     */
    public static readonly MAX_UDP_PAYLOAD_LENGTH: number = 65504;

    /**
     * Length of the maximum transmission unit of the media driver's protocol. If this is greater
     * than the network MTU for UDP then the packet will be fragmented and can amplify the impact of loss.
     */
    public static readonly MTU_LENGTH_PROP_NAME: string = 'aeron.mtu.length';

    /**
     * The default is conservative to avoid fragmentation on IPv4 or IPv6 over Ethernet with PPPoE header,
     * or for clouds such as Google, Azure, and AWS.
     * <p>
     * On networks that suffer little congestion then a larger value can be used to reduce syscall costs.
     */
    public static readonly MTU_LENGTH_DEFAULT: number = 1408;

    /**
     * Length of the maximum transmission unit of the media driver's protocol for IPC. This can be larger than the
     * UDP version but if recorded replay needs to be considered.
     */
    public static readonly IPC_MTU_LENGTH_PROP_NAME: string = 'aeron.ipc.mtu.length';

    /**
     * Default mtu length for IPC publications.
     */
    public static readonly IPC_MTU_LENGTH_DEFAULT: number = Configuration.MTU_LENGTH_DEFAULT;

    /**
     * {@link ThreadingMode} to be used by the Aeron {@link MediaDriver}.
     */
    public static readonly THREADING_MODE_PROP_NAME: string = 'aeron.threading.mode';

    /**
     * Interval between checks for timers and timeouts.
     */
    public static readonly TIMER_INTERVAL_PROP_NAME: string = 'aeron.timer.interval';

    /**
     * Default interval between checks for timers and timeouts.
     */
    public static readonly DEFAULT_TIMER_INTERVAL_NS: number = TimeUnit.SECONDS.toNanos(1);

    /**
     * Timeout between a counter being freed and being available to be reused.
     */
    public static readonly COUNTER_FREE_TO_REUSE_TIMEOUT_PROP_NAME: string = 'aeron.counters.free.to.reuse.timeout';

    /**
     * Default timeout between a counter being freed and being available to be reused.
     */
    public static readonly DEFAULT_COUNTER_FREE_TO_REUSE_TIMEOUT_NS: number = TimeUnit.SECONDS.toNanos(1);

    /**
     * Property name for {@link SendChannelEndpointSupplier}.
     */
    public static readonly SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME: string = 'aeron.SendChannelEndpoint.supplier';

    /**
     * Property name for {@link ReceiveChannelEndpointSupplier}.
     */
    public static readonly RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME: string =
        'aeron.ReceiveChannelEndpoint.supplier';

    /**
     * Property name for Application Specific Feedback added to Status Messages by the driver for flow control.
     * <p>
     * Replaced by {@link #RECEIVER_GROUP_TAG_PROP_NAME}.
     */
    public static readonly SM_APPLICATION_SPECIFIC_FEEDBACK_PROP_NAME: string =
        'aeron.flow.control.sm.applicationSpecificFeedback';

    /**
     * Property name for {@link CongestionControlSupplier} to be employed for receivers.
     */
    public static readonly CONGESTION_CONTROL_STRATEGY_SUPPLIER_PROP_NAME: string = 'aeron.CongestionControl.supplier';

    /**
     * Property name for low end of the publication reserved session-id range which will not be automatically assigned.
     */
    public static readonly PUBLICATION_RESERVED_SESSION_ID_LOW_PROP_NAME: string =
        'aeron.publication.reserved.session.id.low';

    /**
     * Low-end of the publication reserved session-id range which will not be automatically assigned.
     */
    public static readonly PUBLICATION_RESERVED_SESSION_ID_LOW_DEFAULT: number = -1;

    /**
     * High-end of the publication reserved session-id range which will not be automatically assigned.
     */
    public static readonly PUBLICATION_RESERVED_SESSION_ID_HIGH_PROP_NAME: string =
        'aeron.publication.reserved.session.id.high';

    /**
     * High-end of the publication reserved session-id range which will not be automatically assigned.
     */
    public static readonly PUBLICATION_RESERVED_SESSION_ID_HIGH_DEFAULT: number = 1000;

    /**
     * Limit for the number of commands drained in one operation.
     */
    public static readonly COMMAND_DRAIN_LIMIT: number = 1;

    /**
     * Capacity for the command queues used between driver agents.
     */
    public static readonly CMD_QUEUE_CAPACITY: number = 1024;

    /**
     * Timeout on cleaning up pending SETUP message state on subscriber.
     */
    public static readonly PENDING_SETUPS_TIMEOUT_NS: number = TimeUnit.MILLISECONDS.toNanos(1000);

    /**
     * Timeout between SETUP messages for publications during initial setup phase.
     */
    public static readonly PUBLICATION_SETUP_TIMEOUT_NS: number = TimeUnit.MILLISECONDS.toNanos(100);

    /**
     * Timeout between heartbeats for publications.
     */
    public static readonly PUBLICATION_HEARTBEAT_TIMEOUT_NS: number = TimeUnit.MILLISECONDS.toNanos(100);

    /**
     * Expected size of multicast receiver groups property name.
     */
    public static readonly NAK_MULTICAST_GROUP_SIZE_PROP_NAME: string = 'aeron.nak.multicast.group.size';

    /**
     * Default multicast receiver group size estimate for NAK delay randomisation.
     */
    public static readonly NAK_MULTICAST_GROUP_SIZE_DEFAULT: number = 10;

    /**
     * Max backoff time for multicast NAK delay randomisation in nanoseconds.
     */
    public static readonly NAK_MULTICAST_MAX_BACKOFF_PROP_NAME: string = 'aeron.nak.multicast.max.backoff';

    /**
     * Default max backoff for NAK delay randomisation in nanoseconds.
     */
    public static readonly NAK_MAX_BACKOFF_DEFAULT_NS: number = TimeUnit.MILLISECONDS.toNanos(10);

    /**
     * Unicast NAK delay in nanoseconds property name.
     */
    public static readonly NAK_UNICAST_DELAY_PROP_NAME: string = 'aeron.nak.unicast.delay';

    /**
     * Minimum supported value for {@link #NAK_UNICAST_DELAY_PROP_NAME} which is {@code 1us} (one microsecond).
     */
    public static readonly NAK_UNICAST_DELAY_MIN_VALUE_NS: number = 1000;

    /**
     * Default Unicast NAK delay in nanoseconds.
     */
    public static readonly NAK_UNICAST_DELAY_DEFAULT_NS: number = Configuration.NAK_UNICAST_DELAY_MIN_VALUE_NS;

    /**
     * Unicast NAK retry delay ratio property name.
     */
    public static readonly NAK_UNICAST_RETRY_DELAY_RATIO_PROP_NAME: string = 'aeron.nak.unicast.retry.delay.ratio';

    /**
     * Default Unicast NAK retry delay ratio.
     */
    public static readonly NAK_UNICAST_RETRY_DELAY_RATIO_DEFAULT: number = 100;

    /**
     * Property for setting how long to delay before sending a retransmit after receiving a NAK.
     */
    public static readonly RETRANSMIT_UNICAST_DELAY_PROP_NAME: string = 'aeron.retransmit.unicast.delay';

    /**
     * Default delay before retransmission of data for unicast in nanoseconds.
     */
    public static readonly RETRANSMIT_UNICAST_DELAY_DEFAULT_NS: number = TimeUnit.NANOSECONDS.toNanos(0);

    /**
     * Property for setting how long to linger after delay on a NAK before responding to another NAK.
     */
    public static readonly RETRANSMIT_UNICAST_LINGER_PROP_NAME: string = 'aeron.retransmit.unicast.linger';

    /**
     * Default delay for linger for unicast in nanoseconds.
     */
    public static readonly RETRANSMIT_UNICAST_LINGER_DEFAULT_NS: number = TimeUnit.MILLISECONDS.toNanos(10);

    /**
     * Property name of the timeout for when an untethered subscription that is outside the window limit will
     * participate in local flow control.
     */
    public static readonly UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME: string = 'aeron.untethered.window.limit.timeout';

    /**
     * Default timeout for when an untethered subscription that is outside the window limit will participate in
     * local flow control.
     */
    public static readonly UNTETHERED_WINDOW_LIMIT_TIMEOUT_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(5);

    /**
     * Property name of the timeout for when an untethered subscription is resting after not being able to keep up
     * before it is allowed to rejoin a stream.
     */
    public static readonly UNTETHERED_RESTING_TIMEOUT_PROP_NAME: string = 'aeron.untethered.resting.timeout';

    /**
     * Default timeout for when an untethered subscription is resting after not being able to keep up
     * before it is allowed to rejoin a stream.
     */
    public static readonly UNTETHERED_RESTING_TIMEOUT_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(10);

    /**
     * Property name of the timeout for an untethered subscription to stay in the linger state.
     */
    public static readonly UNTETHERED_LINGER_TIMEOUT_PROP_NAME: string = 'aeron.untethered.linger.timeout';

    /**
     * Property name of the max number of active retransmissions tracked for udp streams with group semantics.
     */
    public static readonly MAX_RESEND_PROP_NAME: string = 'aeron.max.resend';

    /**
     * Default max number of active retransmissions per connected stream udp stream with group semantics.
     */
    public static readonly MAX_RESEND_DEFAULT: number = 16;

    /**
     * Maximum value for the active retransmissions per connected stream udp stream with group semantics.
     */
    public static readonly MAX_RESEND_MAX: number = 256;

    /**
     * Property name for the class used to validate if a driver should terminate based on token.
     */
    public static readonly TERMINATION_VALIDATOR_PROP_NAME: string = 'aeron.driver.termination.validator';

    /**
     * Property name for default boolean value for if a stream can be rejoined. True to allow stream rejoin.
     */
    public static readonly REJOIN_STREAM_PROP_NAME: string = 'aeron.rejoin.stream';

    /**
     * Property name for default group tag (gtag) to send in all Status Messages.
     */
    public static readonly RECEIVER_GROUP_TAG_PROP_NAME: string = 'aeron.receiver.group.tag';

    /**
     * Property name for default group tag (gtag) used by the tagged flow control strategy to group receivers.
     */
    public static readonly FLOW_CONTROL_GROUP_TAG_PROP_NAME: string = 'aeron.flow.control.group.tag';

    /**
     * Property name for default minimum group size used by flow control strategies to determine connectivity.
     */
    public static readonly FLOW_CONTROL_GROUP_MIN_SIZE_PROP_NAME: string = 'aeron.flow.control.group.min.size';

    /**
     * Property name for flow control timeout after which with no status messages the receiver is considered gone.
     */
    public static readonly FLOW_CONTROL_RECEIVER_TIMEOUT_PROP_NAME: string = 'aeron.flow.control.receiver.timeout';

    /**
     * Default value for the receiver timeout used to determine if the receiver should still be monitored for
     * flow control purposes.
     */
    public static readonly FLOW_CONTROL_RECEIVER_TIMEOUT_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(5);

    /**
     * Property name for default retransmit receiver window multiple used by the unicast flow control strategy.
     */
    public static readonly UNICAST_FLOW_CONTROL_RETRANSMIT_RECEIVER_WINDOW_MULTIPLE_PROP_NAME: string =
        'aeron.unicast.flow.control.rrwm';

    /**
     * Property name for default retransmit receiver window multiple used by multicast flow control strategies.
     */
    public static readonly MULTICAST_FLOW_CONTROL_RETRANSMIT_RECEIVER_WINDOW_MULTIPLE_PROP_NAME: string =
        'aeron.multicast.flow.control.rrwm';

    /**
     * Property name for resolver name of the Media Driver used in name resolution.
     */
    public static readonly RESOLVER_NAME_PROP_NAME: string = 'aeron.driver.resolver.name';

    /**
     * Property name for resolver interface to which network connections are made.
     *
     * @see #RESOLVER_BOOTSTRAP_NEIGHBOR_PROP_NAME
     */
    public static readonly RESOLVER_INTERFACE_PROP_NAME: string = 'aeron.driver.resolver.interface';

    /**
     * Property name for resolver bootstrap neighbors for which it can bootstrap naming, format is comma separated list
     * of {@code hostname:port} pairs.
     *
     * @see #RESOLVER_INTERFACE_PROP_NAME
     */
    public static readonly RESOLVER_BOOTSTRAP_NEIGHBOR_PROP_NAME: string = 'aeron.driver.resolver.bootstrap.neighbor';

    /**
     * Property name for re-resolution check interval for resolving names to IP address.
     */
    public static readonly RE_RESOLUTION_CHECK_INTERVAL_PROP_NAME: string = 'aeron.driver.reresolution.check.interval';

    /**
     * Default value for the re-resolution check interval.
     */
    public static readonly RE_RESOLUTION_CHECK_INTERVAL_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(1);

    /**
     * Property name for threshold value for the conductor work cycle threshold to track for being exceeded.
     */
    public static readonly CONDUCTOR_CYCLE_THRESHOLD_PROP_NAME: string = 'aeron.driver.conductor.cycle.threshold';

    /**
     * Default threshold value for the conductor work cycle threshold to track for being exceeded.
     */
    public static readonly CONDUCTOR_CYCLE_THRESHOLD_DEFAULT_NS: number = TimeUnit.MILLISECONDS.toNanos(100);

    /**
     * Property name for threshold value for the sender work cycle threshold to track for being exceeded.
     */
    public static readonly SENDER_CYCLE_THRESHOLD_PROP_NAME: string = 'aeron.driver.sender.cycle.threshold';

    /**
     * Default threshold value for the sender work cycle threshold to track for being exceeded.
     */
    public static readonly SENDER_CYCLE_THRESHOLD_DEFAULT_NS: number = TimeUnit.MILLISECONDS.toNanos(100);

    /**
     * Property name for threshold value for the receiver work cycle threshold to track for being exceeded.
     */
    public static readonly RECEIVER_CYCLE_THRESHOLD_PROP_NAME: string = 'aeron.driver.receiver.cycle.threshold';

    /**
     * Default threshold value for the receiver work cycle threshold to track for being exceeded.
     */
    public static readonly RECEIVER_CYCLE_THRESHOLD_DEFAULT_NS: number = TimeUnit.MILLISECONDS.toNanos(100);

    /**
     * Property name for threshold value for the name resolution threshold to track for being exceeded.
     */
    public static readonly NAME_RESOLVER_THRESHOLD_PROP_NAME: string = 'aeron.name.resolver.threshold';

    /**
     * Default threshold value for the name resolution threshold to track for being exceeded.
     */
    public static readonly NAME_RESOLVER_THRESHOLD_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(5);

    /**
     * Property name for wildcard port range for the Sender.
     */
    public static readonly SENDER_WILDCARD_PORT_RANGE_PROP_NAME: string = 'aeron.sender.wildcard.port.range';

    /**
     * Property name for wildcard port range for the Receiver.
     */
    public static readonly RECEIVER_WILDCARD_PORT_RANGE_PROP_NAME: string = 'aeron.receiver.wildcard.port.range';

    /**
     * Property name to configure idle strategy for {@code NativeResourceAgent}. Defaults to {@code sleep-ns} strategy
     * with one-millisecond sleep time.
     *
     * @since 1.52.0
     */
    public static readonly NATIVE_RESOURCE_AGENT_IDLE_STRATEGY_PROP_NAME: string =
        'aeron.driver.native.resource.agent.idle.strategy';

    /**
     * Property name to set a limit on the number sessions allowed per stream on a subscription.
     */
    public static readonly STREAM_SESSION_LIMIT_PROP_NAME: string = 'aeron.driver.stream.session.limit';

    /**
     * Default number of sessions allowed per stream on a subscription. Default is to be effectively unlimited.
     */
    public static readonly STREAM_SESSION_LIMIT_DEFAULT: number = Integer.MAX_VALUE;

    /**
     * Property name for time to wait before removing a neighbor entry from the cache if an update for that neighbor has
     * not been received.
     */
    public static readonly RESOLVER_NEIGHBOR_TIMEOUT_PROP_NAME: string = 'aeron.driver.resolver.neighbor.timeout';

    /**
     * Default time to wait before removing a neighbor entry from the cache if an update for that neighbor has not
     * been received.
     */
    public static readonly RESOLVER_NEIGHBOR_TIMEOUT_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(10);

    /**
     * Property name for the interval between sending name to address messages for this driver to its neighbors.
     */
    public static readonly RESOLVER_SELF_RESOLUTION_INTERVAL_PROP_NAME: string =
        'aeron.driver.resolver.self.resolution.interval';

    /**
     * Default interval between sending name to address messages for this driver to its neighbors.
     */
    public static readonly RESOLVER_SELF_RESOLUTION_INTERVAL_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(1);

    /**
     * Property name for the interval between sending name to address messages for all known neighbors.
     */
    public static readonly RESOLVER_NEIGHBOR_RESOLUTION_INTERVAL_PROP_NAME: string =
        'aeron.driver.resolver.neighbor.resolution.interval';

    /**
     * Default interval between sending name to address messages for all known neighbors.
     */
    public static readonly RESOLVER_NEIGHBOR_RESOLUTION_INTERVAL_DEFAULT_NS: number = TimeUnit.SECONDS.toNanos(2);

    /**
     * Property name for the interval between resolutions of bootstrap neighbors that are not active.
     */
    public static readonly RESOLVER_BOOTSTRAP_NEIGHBOR_RESOLUTION_INTERVAL_PROP_NAME: string =
        'aeron.driver.resolver.bootstrap.neighbor.resolution.interval';

    /**
     * Default interval between resolutions of bootstrap neighbors that are not active.
     */
    public static readonly RESOLVER_BOOTSTRAP_NEIGHBOR_RESOLUTION_INTERVAL_DEFAULT_NS: number =
        TimeUnit.SECONDS.toNanos(10);

    /**
     * {@link Executor} that run tasks on the caller thread.
     */
    public static readonly CALLER_RUNS_TASK_EXECUTOR: (command: () => void) => void = (command) => {
        command();
    };

    /**
     * Should the high-resolution timer be used when running on Windows.
     *
     * @return true if the high-resolution timer be used when running on Windows.
     * @see #USE_WINDOWS_HIGH_RES_TIMER_PROP_NAME
     */
    public static useWindowsHighResTimer(): boolean {
        return 'true' === System.getProperty(Configuration.USE_WINDOWS_HIGH_RES_TIMER_PROP_NAME);
    }

    /**
     * Should a warning be printed if the aeron directory exist when starting.
     *
     * @return true if a warning be printed if the aeron directory exist when starting.
     * @see #DIR_WARN_IF_EXISTS_PROP_NAME
     */
    public static warnIfDirExists(): boolean {
        return 'true' === System.getProperty(Configuration.DIR_WARN_IF_EXISTS_PROP_NAME);
    }

    /**
     * Should driver attempt to an immediate forced delete of {@link CommonContext#AERON_DIR_PROP_NAME} on start
     * if it exists.
     *
     * @return true if the aeron directory be deleted on start without checking if active.
     * @see #DIR_DELETE_ON_START_PROP_NAME
     */
    public static dirDeleteOnStart(): boolean {
        return 'true' === System.getProperty(Configuration.DIR_DELETE_ON_START_PROP_NAME);
    }

    /**
     * Should driver attempt to delete {@link CommonContext#AERON_DIR_PROP_NAME} on shutdown.
     *
     * @return true if driver should attempt to delete {@link CommonContext#AERON_DIR_PROP_NAME} on shutdown.
     * @see #DIR_DELETE_ON_SHUTDOWN_PROP_NAME
     */
    public static dirDeleteOnShutdown(): boolean {
        return 'true' === System.getProperty(Configuration.DIR_DELETE_ON_SHUTDOWN_PROP_NAME);
    }

    /**
     * Should term buffers be created as sparse files. This can save space at the expense of latency when required.
     *
     * @return true if term buffers should be created as sparse files.
     * @see #TERM_BUFFER_SPARSE_FILE_PROP_NAME
     */
    public static termBufferSparseFile(): boolean {
        return 'true' === System.getProperty(Configuration.TERM_BUFFER_SPARSE_FILE_PROP_NAME, 'true');
    }

    /**
     * Default for if subscriptions should be tethered.
     *
     * @return true if the default subscriptions should be tethered.
     * @see #TETHER_SUBSCRIPTIONS_PROP_NAME
     */
    public static tetherSubscriptions(): boolean {
        return 'true' === System.getProperty(Configuration.TETHER_SUBSCRIPTIONS_PROP_NAME, 'true');
    }

    /**
     * Default boolean value for if a stream is reliable. True to NAK, false to gap fill.
     *
     * @return true if NAK is default or false to gap fill.
     * @see #RELIABLE_STREAM_PROP_NAME
     */
    public static reliableStream(): boolean {
        return 'true' === System.getProperty(Configuration.RELIABLE_STREAM_PROP_NAME, 'true');
    }

    /**
     * Should storage checks should be performed before allocating files.
     *
     * @return true of storage checks should be performed before allocating files.
     * @see #PERFORM_STORAGE_CHECKS_PROP_NAME
     */
    public static performStorageChecks(): boolean {
        return 'true' === System.getProperty(Configuration.PERFORM_STORAGE_CHECKS_PROP_NAME, 'true');
    }

    /**
     * Should spy subscriptions simulate a connection to a network publication.
     * <p>
     * If true then this will override the min group size of the min and tagged flow control strategies.
     *
     * @return true if spy subscriptions should simulate a connection to a network publication.
     * @see #SPIES_SIMULATE_CONNECTION_PROP_NAME
     */
    public static spiesSimulateConnection(): boolean {
        return 'true' === System.getProperty(Configuration.SPIES_SIMULATE_CONNECTION_PROP_NAME, 'false');
    }

    /**
     * Should subscriptions should be considered a group member or individual connection, e.g. multicast vs unicast.
     *
     * @return FORCE_TRUE if subscriptions should be considered a group member or false if individual.
     * @see #GROUP_RECEIVER_CONSIDERATION_PROP_NAME
     */
    public static receiverGroupConsideration(): InferableBoolean {
        return CommonContext.InferableBoolean.parse(
            System.getProperty(Configuration.GROUP_RECEIVER_CONSIDERATION_PROP_NAME),
        );
    }

    /**
     * Length (in bytes) of the conductor buffer for control commands from the clients to the media driver conductor.
     *
     * @return length (in bytes) of the conductor buffer for control commands from the clients to the media driver.
     * @see #CONDUCTOR_BUFFER_LENGTH_PROP_NAME
     */
    public static conductorBufferLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.CONDUCTOR_BUFFER_LENGTH_PROP_NAME,
            Configuration.CONDUCTOR_BUFFER_LENGTH_DEFAULT,
        );
    }

    /**
     * Length (in bytes) of the broadcast buffers from the media driver to the clients.
     *
     * @return length (in bytes) of the broadcast buffers from the media driver to the clients.
     * @see #TO_CLIENTS_BUFFER_LENGTH_PROP_NAME
     */
    public static toClientsBufferLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.TO_CLIENTS_BUFFER_LENGTH_PROP_NAME,
            Configuration.TO_CLIENTS_BUFFER_LENGTH_DEFAULT,
        );
    }

    /**
     * Length of the buffer for the counters.
     * <p>
     * Each counter uses {@link org.agrona.concurrent.status.CountersReader#COUNTER_LENGTH} bytes.
     *
     * @return Length of the buffer for the counters.
     * @see #COUNTERS_VALUES_BUFFER_LENGTH_PROP_NAME
     */
    public static counterValuesBufferLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.COUNTERS_VALUES_BUFFER_LENGTH_PROP_NAME,
            Configuration.COUNTERS_VALUES_BUFFER_LENGTH_DEFAULT,
        );
    }

    /**
     * Length of the memory mapped buffer for the distinct error log.
     *
     * @return length of the memory mapped buffer for the distinct error log.
     */
    public static errorBufferLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.ERROR_BUFFER_LENGTH_PROP_NAME,
            Configuration.ERROR_BUFFER_LENGTH_DEFAULT,
        );
    }

    /**
     * Expected size of typical multicast receiver groups.
     *
     * @return expected size of typical multicast receiver groups.
     * @see #NAK_MULTICAST_GROUP_SIZE_PROP_NAME
     */
    public static nakMulticastGroupSize(): number {
        return Integer.getInteger(
            Configuration.NAK_MULTICAST_GROUP_SIZE_PROP_NAME,
            Configuration.NAK_MULTICAST_GROUP_SIZE_DEFAULT,
        );
    }

    /**
     * Max backoff time for multicast NAK delay randomisation in nanoseconds.
     *
     * @return max backoff time for multicast NAK delay randomisation in nanoseconds.
     * @see #NAK_MULTICAST_MAX_BACKOFF_PROP_NAME
     */
    public static nakMulticastMaxBackoffNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.NAK_MULTICAST_MAX_BACKOFF_PROP_NAME,
            Configuration.NAK_MAX_BACKOFF_DEFAULT_NS,
        );
    }

    /**
     * Unicast NAK delay in nanoseconds.
     *
     * @return unicast NAK delay in nanoseconds.
     * @see #NAK_UNICAST_DELAY_PROP_NAME
     */
    public static nakUnicastDelayNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.NAK_UNICAST_DELAY_PROP_NAME,
            Configuration.NAK_UNICAST_DELAY_DEFAULT_NS,
        );
    }

    /**
     * Unicast NAK retry delay ratio.
     *
     * @return unicast NAK delay in nanoseconds.
     * @see #NAK_UNICAST_DELAY_PROP_NAME
     */
    public static nakUnicastRetryDelayRatio(): number {
        return SystemUtil.getSizeAsLong(
            Configuration.NAK_UNICAST_RETRY_DELAY_RATIO_PROP_NAME,
            Configuration.NAK_UNICAST_RETRY_DELAY_RATIO_DEFAULT,
        );
    }

    /**
     * Interval between checks for timers and timeouts.
     *
     * @return interval between checks for timers and timeouts.
     * @see #TIMER_INTERVAL_PROP_NAME
     */
    public static timerIntervalNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.TIMER_INTERVAL_PROP_NAME,
            Configuration.DEFAULT_TIMER_INTERVAL_NS,
        );
    }

    /**
     * Low file storage warning threshold in bytes for when performing storage checks.
     *
     * @return Low file storage warning threshold for when performing storage checks.
     * @see #LOW_FILE_STORE_WARNING_THRESHOLD_PROP_NAME
     * @see #PERFORM_STORAGE_CHECKS_PROP_NAME
     */
    public static lowStorageWarningThreshold(): number {
        return SystemUtil.getSizeAsLong(
            Configuration.LOW_FILE_STORE_WARNING_THRESHOLD_PROP_NAME,
            Configuration.LOW_FILE_STORE_WARNING_THRESHOLD_DEFAULT,
        );
    }

    /**
     * The window limit on UDP {@link Publication} side by which the publisher can get ahead of consumers.
     *
     * @return window limit on UDP {@link Publication} side by which the publisher can get ahead of consumers.
     * @see #PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME
     */
    public static publicationTermWindowLength(): number {
        return SystemUtil.getSizeAsInt(Configuration.PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME, 0);
    }

    /**
     * The window limit on IPC {@link Publication} side by which the publisher can get ahead of consumers.
     *
     * @return window limit on IPC {@link Publication} side by which the publisher can get ahead of consumers.
     * @see #IPC_PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME
     */
    public static ipcPublicationTermWindowLength(): number {
        return SystemUtil.getSizeAsInt(Configuration.IPC_PUBLICATION_TERM_WINDOW_LENGTH_PROP_NAME, 0);
    }

    /**
     * The timeout for when an untethered subscription that is outside the window limit will participate in local
     * flow control.
     *
     * @return the timeout for when an untethered subscription that is outside the window limit will be included.
     * @see #UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME
     * @see #UNTETHERED_RESTING_TIMEOUT_PROP_NAME
     * @see #TETHER_SUBSCRIPTIONS_PROP_NAME
     */
    public static untetheredWindowLimitTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME,
            Configuration.UNTETHERED_WINDOW_LIMIT_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * The timeout for an untethered subscription to remain in the linger state.
     *
     * @return the timeout for an untethered subscription to remain in the linger state.
     * @see #UNTETHERED_LINGER_TIMEOUT_PROP_NAME
     * @since 1.48.0
     */
    public static untetheredLingerTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(Configuration.UNTETHERED_LINGER_TIMEOUT_PROP_NAME, Aeron.NULL_VALUE);
    }

    /**
     * The timeout for when an untethered subscription is resting after not being able to keep up before it is allowed
     * to rejoin a stream.
     *
     * @return The timeout for when an untethered subscription is resting before rejoining a stream.
     * @see #UNTETHERED_RESTING_TIMEOUT_PROP_NAME
     * @see #UNTETHERED_WINDOW_LIMIT_TIMEOUT_PROP_NAME
     * @see #TETHER_SUBSCRIPTIONS_PROP_NAME
     */
    public static untetheredRestingTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.UNTETHERED_RESTING_TIMEOUT_PROP_NAME,
            Configuration.UNTETHERED_RESTING_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * Max number of active retransmissions tracked for udp streams with group semantics.
     *
     * @return max retransmits
     * @see #MAX_RESEND_PROP_NAME
     */
    public static maxResend(): number {
        return Math.min(
            Math.max(Integer.getInteger(Configuration.MAX_RESEND_PROP_NAME, Configuration.MAX_RESEND_DEFAULT), 1),
            Configuration.MAX_RESEND_MAX,
        );
    }

    /**
     * Default boolean value for if a stream can be rejoined. True to allow stream rejoin, false to not.
     *
     * @return boolean value for if a stream can be rejoined. True to allow stream rejoin, false to not.
     * @see #REJOIN_STREAM_PROP_NAME
     */
    public static rejoinStream(): boolean {
        return 'true' === System.getProperty(Configuration.REJOIN_STREAM_PROP_NAME, 'true').toLowerCase();
    }

    /**
     * Default group tag (gtag) to send in all Status Messages. If not provided then no gtag is sent.
     *
     * @return Default group tag (gtag) to send in all Status Messages.
     * @see #RECEIVER_GROUP_TAG_PROP_NAME
     */
    public static groupTag(): number | null {
        return Long.getLong(Configuration.RECEIVER_GROUP_TAG_PROP_NAME, null);
    }

    /**
     * Default group tag (gtag) used by the tagged flow control strategy to group receivers. The default is the legacy
     * ASF of {@link PreferredMulticastFlowControlAsf.PREFERRED_ASF_PROP_NAME}, read as a little-endian long.
     *
     * @return group tag (gtag) used by the tagged flow control strategy to group receivers.
     * @see #FLOW_CONTROL_GROUP_TAG_PROP_NAME
     */
    public static flowControlGroupTag(): number {
        const propertyValue = System.getProperty(
            PreferredMulticastFlowControlAsf.PREFERRED_ASF_PROP_NAME,
            PreferredMulticastFlowControlAsf.PREFERRED_ASF_DEFAULT,
        );
        const legacyAsfValue = new UnsafeBuffer(BitUtil.fromHex(propertyValue)).getLong(0, ByteOrder.LITTLE_ENDIAN);

        return Long.getLong(Configuration.FLOW_CONTROL_GROUP_TAG_PROP_NAME, legacyAsfValue);
    }

    /**
     * Default minimum group size used by flow control strategies to determine connectivity.
     *
     * @return default minimum group size used by flow control strategies to determine connectivity.
     * @see #FLOW_CONTROL_GROUP_MIN_SIZE_PROP_NAME
     */
    public static flowControlGroupMinSize(): number {
        return Integer.getInteger(Configuration.FLOW_CONTROL_GROUP_MIN_SIZE_PROP_NAME, 0);
    }

    /**
     * Flow control timeout after which with no status messages the receiver is considered gone.
     *
     * @return flow control timeout after which with no status messages the receiver is considered gone.
     * @see #FLOW_CONTROL_RECEIVER_TIMEOUT_PROP_NAME
     */
    public static flowControlReceiverTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.FLOW_CONTROL_RECEIVER_TIMEOUT_PROP_NAME,
            Configuration.FLOW_CONTROL_RECEIVER_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * Retransmit receiver window multiple used by the unicast flow control strategy to determine the maximum
     * amount of data to retransmit.
     *
     * @return multiple.
     */
    public static unicastFlowControlRetransmitReceiverWindowMultiple(): number {
        return Integer.getInteger(Configuration.UNICAST_FLOW_CONTROL_RETRANSMIT_RECEIVER_WINDOW_MULTIPLE_PROP_NAME, 16);
    }

    /**
     * Retransmit receiver window multiple used by multicast flow control strategies to determine the maximum
     * amount of data to retransmit.
     *
     * @return multiple.
     */
    public static multicastFlowControlRetransmitReceiverWindowMultiple(): number {
        return Integer.getInteger(
            Configuration.MULTICAST_FLOW_CONTROL_RETRANSMIT_RECEIVER_WINDOW_MULTIPLE_PROP_NAME,
            4,
        );
    }

    /**
     * Resolver name of the Media Driver used in name resolution.
     *
     * @return resolver name of the Media Driver used in name resolution.
     * @see #RESOLVER_NAME_PROP_NAME
     */
    public static resolverName(): string {
        return System.getProperty(Configuration.RESOLVER_NAME_PROP_NAME);
    }

    /**
     * Property name for resolver interface to which network connections are made, format is hostname:port.
     *
     * @return resolver interface to which network connections are made, format is hostname:port.
     * @see #RESOLVER_INTERFACE_PROP_NAME
     */
    public static resolverInterface(): string {
        return System.getProperty(Configuration.RESOLVER_INTERFACE_PROP_NAME);
    }

    /**
     * Resolver bootstrap neighbor for which it can bootstrap naming, format is hostname:port.
     *
     * @return resolver bootstrap neighbor for which it can bootstrap naming, format is hostname:port.
     * @see #RESOLVER_BOOTSTRAP_NEIGHBOR_PROP_NAME
     * @see #RESOLVER_INTERFACE_PROP_NAME
     */
    public static resolverBootstrapNeighbor(): string {
        return System.getProperty(Configuration.RESOLVER_BOOTSTRAP_NEIGHBOR_PROP_NAME);
    }

    /**
     * Resolve configuration for time to wait before removing a neighbor entry from the cache if an update for that
     * neighbor has not been received.
     *
     * @return time to wait before removing a neighbor entry from the cache if an update for that * neighbor has not
     * been received.
     * @see #RESOLVER_NEIGHBOR_TIMEOUT_DEFAULT_NS
     * @see #RESOLVER_NEIGHBOR_TIMEOUT_PROP_NAME
     */
    public static resolverNeighborTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.RESOLVER_NEIGHBOR_TIMEOUT_PROP_NAME,
            Configuration.RESOLVER_NEIGHBOR_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * Resolve configuration for the interval between sending name to address messages for this driver to its neighbors.
     *
     * @return interval between sending name to address messages for this driver to its neighbors.
     * @see #RESOLVER_SELF_RESOLUTION_INTERVAL_DEFAULT_NS
     * @see #RESOLVER_SELF_RESOLUTION_INTERVAL_PROP_NAME
     */
    public static resolverSelfResolutionIntervalNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.RESOLVER_SELF_RESOLUTION_INTERVAL_PROP_NAME,
            Configuration.RESOLVER_SELF_RESOLUTION_INTERVAL_DEFAULT_NS,
        );
    }

    /**
     * Resolve configuration for the interval between sending name to address messages for all known neighbors.
     *
     * @return interval between sending name to address messages for all known neighbors.
     * @see #RESOLVER_NEIGHBOR_RESOLUTION_INTERVAL_DEFAULT_NS
     * @see #RESOLVER_NEIGHBOR_RESOLUTION_INTERVAL_PROP_NAME
     */
    public static resolverNeighborResolutionIntervalNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.RESOLVER_NEIGHBOR_RESOLUTION_INTERVAL_PROP_NAME,
            Configuration.RESOLVER_NEIGHBOR_RESOLUTION_INTERVAL_DEFAULT_NS,
        );
    }

    /**
     * Resolve configuration for the interval between resolutions of bootstrap neighbors that are not active.
     *
     * @return interval between sending name to address messages for all known neighbors.
     * @see #RESOLVER_BOOTSTRAP_NEIGHBOR_RESOLUTION_INTERVAL_DEFAULT_NS
     * @see #RESOLVER_BOOTSTRAP_NEIGHBOR_RESOLUTION_INTERVAL_PROP_NAME
     */
    public static resolverBootstrapNeighborResolutionIntervalNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.RESOLVER_BOOTSTRAP_NEIGHBOR_RESOLUTION_INTERVAL_PROP_NAME,
            Configuration.RESOLVER_BOOTSTRAP_NEIGHBOR_RESOLUTION_INTERVAL_DEFAULT_NS,
        );
    }

    /**
     * Re-resolution check interval for resolving names to IP address when they may have changed.
     *
     * @return re-resolution check interval for resolving names to IP address when they may have changed.
     * @see #RE_RESOLUTION_CHECK_INTERVAL_PROP_NAME
     */
    public static reResolutionCheckIntervalNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.RE_RESOLUTION_CHECK_INTERVAL_PROP_NAME,
            Configuration.RE_RESOLUTION_CHECK_INTERVAL_DEFAULT_NS,
        );
    }

    /**
     * How far ahead a producer can get from a consumer position.
     *
     * @param termBufferLength        for when default is not set and considering an appropriate minimum.
     * @param defaultTermWindowLength to take priority.
     * @return the length to be used for the producer window.
     */
    public static producerWindowLength(termBufferLength: number, defaultTermWindowLength: number): number {
        let termWindowLength = termBufferLength >> 1;

        if (0 !== defaultTermWindowLength) {
            termWindowLength = Math.min(defaultTermWindowLength, termWindowLength);
        }

        return termWindowLength;
    }

    /**
     * Length to be used for the receiver window taking into account initial window length and term buffer length.
     *
     * @param termBufferLength    for the publication image.
     * @param initialWindowLength set for the channel.
     * @return the length to be used for the receiver window.
     */
    public static receiverWindowLength(termBufferLength: number, initialWindowLength: number): number {
        return ReceiverWindow.receiverWindowLength(termBufferLength, initialWindowLength);
    }

    /**
     * Length (in bytes) of the log buffers for UDP publication terms.
     *
     * @return length (in bytes) of the log buffers for UDP publication terms.
     * @see #TERM_BUFFER_LENGTH_PROP_NAME
     */
    public static termBufferLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.TERM_BUFFER_LENGTH_PROP_NAME,
            Configuration.TERM_BUFFER_LENGTH_DEFAULT,
        );
    }

    /**
     * Length (in bytes) of the log buffers for IPC publication terms.
     *
     * @return length (in bytes) of the log buffers for IPC publication terms.
     * @see #IPC_TERM_BUFFER_LENGTH_PROP_NAME
     */
    public static ipcTermBufferLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.IPC_TERM_BUFFER_LENGTH_PROP_NAME,
            Configuration.TERM_BUFFER_IPC_LENGTH_DEFAULT,
        );
    }

    /**
     * Length of the initial window which must be sufficient for Bandwidth Delay Product (BDP).
     *
     * @return length of the initial window which must be sufficient for Bandwidth Delay Product (BDP).
     * @see #INITIAL_WINDOW_LENGTH_PROP_NAME
     */
    public static initialWindowLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.INITIAL_WINDOW_LENGTH_PROP_NAME,
            Configuration.INITIAL_WINDOW_LENGTH_DEFAULT,
        );
    }

    /**
     * SO_SNDBUF setting on UDP sockets which must be sufficient for Bandwidth Delay Product (BDP).
     *
     * @return SO_SNDBUF setting on UDP sockets which must be sufficient for Bandwidth Delay Product (BDP).
     * @see #SOCKET_SNDBUF_LENGTH_PROP_NAME
     */
    public static socketSndbufLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.SOCKET_SNDBUF_LENGTH_PROP_NAME,
            Configuration.SOCKET_SNDBUF_LENGTH_DEFAULT,
        );
    }

    /**
     * SO_RCVBUF setting on UDP sockets which must be sufficient for Bandwidth Delay Product (BDP).
     *
     * @return SO_RCVBUF setting on UDP sockets which must be sufficient for Bandwidth Delay Product (BDP).
     * @see #SOCKET_RCVBUF_LENGTH_PROP_NAME
     */
    public static socketRcvbufLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.SOCKET_RCVBUF_LENGTH_PROP_NAME,
            Configuration.SOCKET_RCVBUF_LENGTH_DEFAULT,
        );
    }

    /**
     * Length of the maximum transmission unit of the media driver's protocol. If this is greater
     * than the network MTU for UDP then the packet will be fragmented and can amplify the impact of loss.
     *
     * @return length of the maximum transmission unit of the media driver's protocol.
     * @see #MTU_LENGTH_PROP_NAME
     */
    public static mtuLength(): number {
        return SystemUtil.getSizeAsInt(Configuration.MTU_LENGTH_PROP_NAME, Configuration.MTU_LENGTH_DEFAULT);
    }

    /**
     * Length of the maximum transmission unit of the media driver's protocol for IPC. This can be larger than the
     * UDP version but if recorded replay needs to be considered.
     *
     * @return length of the maximum transmission unit of the media driver's protocol for IPC.
     * @see #IPC_MTU_LENGTH_PROP_NAME
     */
    public static ipcMtuLength(): number {
        return SystemUtil.getSizeAsInt(Configuration.IPC_MTU_LENGTH_PROP_NAME, Configuration.IPC_MTU_LENGTH_DEFAULT);
    }

    /**
     * IP_MULTICAST_TTL setting on UDP sockets.
     *
     * @return IP_MULTICAST_TTL setting on UDP sockets.
     * @see #SOCKET_MULTICAST_TTL_PROP_NAME
     */
    public static socketMulticastTtl(): number {
        return Integer.getInteger(
            Configuration.SOCKET_MULTICAST_TTL_PROP_NAME,
            Configuration.SOCKET_MULTICAST_TTL_DEFAULT,
        );
    }

    /**
     * Page size in bytes to align all files to. The file system must support the requested size.
     *
     * @return page size in bytes to align all files to.
     * @see #FILE_PAGE_SIZE_PROP_NAME
     */
    public static filePageSize(): number {
        return SystemUtil.getSizeAsInt(Configuration.FILE_PAGE_SIZE_PROP_NAME, Configuration.FILE_PAGE_SIZE_DEFAULT);
    }

    /**
     * Low-end of the publication reserved session-id range which will not be automatically assigned.
     *
     * @return low-end of the publication reserved session-id range which will not be automatically assigned.
     * @see #PUBLICATION_RESERVED_SESSION_ID_LOW_PROP_NAME
     */
    public static publicationReservedSessionIdLow(): number {
        return Integer.getInteger(
            Configuration.PUBLICATION_RESERVED_SESSION_ID_LOW_PROP_NAME,
            Configuration.PUBLICATION_RESERVED_SESSION_ID_LOW_DEFAULT,
        );
    }

    /**
     * High-end of the publication reserved session-id range which will not be automatically assigned.
     *
     * @return high-end of the publication reserved session-id range which will not be automatically assigned.
     * @see #PUBLICATION_RESERVED_SESSION_ID_HIGH_PROP_NAME
     */
    public static publicationReservedSessionIdHigh(): number {
        return Integer.getInteger(
            Configuration.PUBLICATION_RESERVED_SESSION_ID_HIGH_PROP_NAME,
            Configuration.PUBLICATION_RESERVED_SESSION_ID_HIGH_DEFAULT,
        );
    }

    /**
     * Status message timeout in nanoseconds after which one will be sent when data flow has not triggered one.
     *
     * @return status message timeout in nanoseconds after which one will be sent.
     * @see #STATUS_MESSAGE_TIMEOUT_PROP_NAME
     */
    public static statusMessageTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.STATUS_MESSAGE_TIMEOUT_PROP_NAME,
            Configuration.STATUS_MESSAGE_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * Ratio of sending data to polling status messages in the {@link Sender}.
     *
     * @return ratio of sending data to polling status messages in the {@link Sender}.
     * @see #SEND_TO_STATUS_POLL_RATIO_PROP_NAME
     */
    public static sendToStatusMessagePollRatio(): number {
        return Integer.getInteger(
            Configuration.SEND_TO_STATUS_POLL_RATIO_PROP_NAME,
            Configuration.SEND_TO_STATUS_POLL_RATIO_DEFAULT,
        );
    }

    /**
     * Limit the number of driver managed resources that can be freed in the same duty cycle.
     *
     * @return limit of the number of resources.
     * @see #RESOURCE_FREE_LIMIT_PROP_NAME
     * @see #RESOURCE_FREE_LIMIT_DEFAULT
     */
    public static resourceFreeLimit(): number {
        return Integer.getInteger(
            Configuration.RESOURCE_FREE_LIMIT_PROP_NAME,
            Configuration.RESOURCE_FREE_LIMIT_DEFAULT,
        );
    }

    /**
     * Timeout between a counter being freed and being available to be reused.
     *
     * @return timeout between a counter being freed and being available to be reused.
     * @see #COUNTER_FREE_TO_REUSE_TIMEOUT_PROP_NAME
     */
    public static counterFreeToReuseTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.COUNTER_FREE_TO_REUSE_TIMEOUT_PROP_NAME,
            Configuration.DEFAULT_COUNTER_FREE_TO_REUSE_TIMEOUT_NS,
        );
    }

    /**
     * {@link Aeron} client liveness timeout after which it is considered not alive.
     *
     * @return {@link Aeron} client liveness timeout after which it is considered not alive.
     * @see #CLIENT_LIVENESS_TIMEOUT_PROP_NAME
     */
    public static clientLivenessTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.CLIENT_LIVENESS_TIMEOUT_PROP_NAME,
            Configuration.CLIENT_LIVENESS_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * {@link Image} liveness timeout for how long it stays active without heartbeats or lingers around after being
     * drained.
     *
     * @return {@link Image} liveness timeout for how long it stays active without heartbeats or lingers around after
     * being drained.
     * @see #IMAGE_LIVENESS_TIMEOUT_PROP_NAME
     */
    public static imageLivenessTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.IMAGE_LIVENESS_TIMEOUT_PROP_NAME,
            Configuration.IMAGE_LIVENESS_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * {@link Publication} unblock timeout due to client crash or untimely commit.
     * <p>
     * A publication can become blocked if the client crashes while publishing or if
     * {@link io.aeron.Publication#tryClaim(int, BufferClaim)} is used without following up by calling
     * {@link BufferClaim#commit()} or {@link BufferClaim#abort()}.
     *
     * @return {@link Publication} unblock timeout due to client crash or untimely commit.
     * @see #PUBLICATION_UNBLOCK_TIMEOUT_PROP_NAME
     */
    public static publicationUnblockTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.PUBLICATION_UNBLOCK_TIMEOUT_PROP_NAME,
            Configuration.PUBLICATION_UNBLOCK_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * {@link Publication} timeout due to lack of status messages which indicate a connection.
     *
     * @return {@link Publication} timeout due to lack of status messages which indicate a connection.
     * @see #PUBLICATION_CONNECTION_TIMEOUT_PROP_NAME
     */
    public static publicationConnectionTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.PUBLICATION_CONNECTION_TIMEOUT_PROP_NAME,
            Configuration.PUBLICATION_CONNECTION_TIMEOUT_DEFAULT_NS,
        );
    }

    /**
     * Linger timeout after draining on {@link Publication}s so they can respond to NAKs.
     *
     * @return linger timeout after draining on {@link Publication}s so they can respond to NAKs.
     * @see #PUBLICATION_LINGER_PROP_NAME
     */
    public static publicationLingerTimeoutNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.PUBLICATION_LINGER_PROP_NAME,
            Configuration.PUBLICATION_LINGER_DEFAULT_NS,
        );
    }

    /**
     * Setting how long to delay before sending a retransmit after receiving a NAK.
     *
     * @return setting how long to delay before sending a retransmit after receiving a NAK.
     * @see #RETRANSMIT_UNICAST_DELAY_PROP_NAME
     */
    public static retransmitUnicastDelayNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.RETRANSMIT_UNICAST_DELAY_PROP_NAME,
            Configuration.RETRANSMIT_UNICAST_DELAY_DEFAULT_NS,
        );
    }

    /**
     * Setting how long to linger after delay on a NAK before responding to another NAK.
     *
     * @return setting how long to linger after delay on a NAK before responding to another NAK.
     * @see #RETRANSMIT_UNICAST_LINGER_PROP_NAME
     */
    public static retransmitUnicastLingerNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.RETRANSMIT_UNICAST_LINGER_PROP_NAME,
            Configuration.RETRANSMIT_UNICAST_LINGER_DEFAULT_NS,
        );
    }

    /**
     * Length of the memory mapped buffer for the {@link io.aeron.driver.reports.LossReport}.
     *
     * @return length of the memory mapped buffer for the {@link io.aeron.driver.reports.LossReport}.
     * @see #LOSS_REPORT_BUFFER_LENGTH_PROP_NAME
     */
    public static lossReportBufferLength(): number {
        return SystemUtil.getSizeAsInt(
            Configuration.LOSS_REPORT_BUFFER_LENGTH_PROP_NAME,
            Configuration.LOSS_REPORT_BUFFER_LENGTH_DEFAULT,
        );
    }

    /**
     * {@link ThreadingMode} to be used by the Aeron {@link MediaDriver}. This allows for CPU resource to be traded
     * against throughput and latency.
     *
     * @return {@link ThreadingMode} to be used by the Aeron {@link MediaDriver}.
     * @see #THREADING_MODE_PROP_NAME
     */
    public static threadingMode(): ThreadingMode {
        const propertyValue = System.getProperty(Configuration.THREADING_MODE_PROP_NAME);
        if (null === propertyValue) {
            return ThreadingMode.DEDICATED;
        }

        return ThreadingMode.valueOf(propertyValue);
    }

    /**
     * Get threshold value for the conductor work cycle threshold to track for being exceeded.
     *
     * @return threshold value in nanoseconds.
     */
    public static conductorCycleThresholdNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.CONDUCTOR_CYCLE_THRESHOLD_PROP_NAME,
            Configuration.CONDUCTOR_CYCLE_THRESHOLD_DEFAULT_NS,
        );
    }

    /**
     * Get threshold value for the sender work cycle threshold to track for being exceeded.
     *
     * @return threshold value in nanoseconds.
     */
    public static senderCycleThresholdNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.SENDER_CYCLE_THRESHOLD_PROP_NAME,
            Configuration.SENDER_CYCLE_THRESHOLD_DEFAULT_NS,
        );
    }

    /**
     * Get threshold value for the receiver work cycle threshold to track for being exceeded.
     *
     * @return threshold value in nanoseconds.
     */
    public static receiverCycleThresholdNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.RECEIVER_CYCLE_THRESHOLD_PROP_NAME,
            Configuration.RECEIVER_CYCLE_THRESHOLD_DEFAULT_NS,
        );
    }

    /**
     * Get threshold value for the name resolution time threshold to track for being exceeded.
     *
     * @return threshold value in nanoseconds.
     */
    public static nameResolverThresholdNs(): number {
        return SystemUtil.getDurationInNanos(
            Configuration.NAME_RESOLVER_THRESHOLD_PROP_NAME,
            Configuration.NAME_RESOLVER_THRESHOLD_DEFAULT_NS,
        );
    }

    /**
     * Get wildcard port range in use for the Sender.
     *
     * @return port range as string with the format "low high"
     */
    public static senderWildcardPortRange(): string {
        return System.getProperty(Configuration.SENDER_WILDCARD_PORT_RANGE_PROP_NAME);
    }

    /**
     * Get wildcard port range in use for the Receiver.
     *
     * @return port range as string with the format "low high"
     */
    public static receiverWildcardPortRange(): string {
        return System.getProperty(Configuration.RECEIVER_WILDCARD_PORT_RANGE_PROP_NAME);
    }

    /**
     * {@return {@link IdleStrategy} to be employed by the async executor when enabled.}
     *
     * @param controllableStatus to allow control of {@link ControllableIdleStrategy}, which can be null if not used.
     * @see #NATIVE_RESOURCE_AGENT_IDLE_STRATEGY_PROP_NAME
     * @since 1.51.0
     */
    public static nativeResourceAgentIdleStrategy(controllableStatus: StatusIndicator | null): IdleStrategy {
        const idleStategyName = System.getProperty(Configuration.NATIVE_RESOURCE_AGENT_IDLE_STRATEGY_PROP_NAME);
        if (Strings.isEmpty(idleStategyName)) {
            return new SleepingIdleStrategy(TimeUnit.MILLISECONDS.toNanos(1));
        }

        return Configuration.agentIdleStrategy(idleStategyName, controllableStatus);
    }

    /**
     * Get the {@link IdleStrategy} that should be applied to {@link org.agrona.concurrent.Agent}s.
     *
     * @param strategyName       of the class to be created.
     * @param controllableStatus status indicator for what the strategy should do.
     * @return the newly created IdleStrategy.
     */
    public static agentIdleStrategy(strategyName: string, controllableStatus: StatusIndicator | null): IdleStrategy {
        switch (strategyName) {
            case NoOpIdleStrategy.ALIAS:
            case 'org.agrona.concurrent.NoOpIdleStrategy':
                return NoOpIdleStrategy.INSTANCE;

            case BusySpinIdleStrategy.ALIAS:
            case 'org.agrona.concurrent.BusySpinIdleStrategy':
                return BusySpinIdleStrategy.INSTANCE;

            case YieldingIdleStrategy.ALIAS:
            case 'org.agrona.concurrent.YieldingIdleStrategy':
                return YieldingIdleStrategy.INSTANCE;

            case SleepingIdleStrategy.ALIAS:
            case 'org.agrona.concurrent.SleepingIdleStrategy':
                return new SleepingIdleStrategy();

            case SleepingMillisIdleStrategy.ALIAS:
            case 'org.agrona.concurrent.SleepingMillisIdleStrategy':
                return new SleepingMillisIdleStrategy();

            case BackoffIdleStrategy.ALIAS:
            case 'org.agrona.concurrent.BackoffIdleStrategy':
                return new BackoffIdleStrategy(
                    Configuration.IDLE_MAX_SPINS,
                    Configuration.IDLE_MAX_YIELDS,
                    Configuration.IDLE_MIN_PARK_NS,
                    Configuration.IDLE_MAX_PARK_NS,
                );

            case ControllableIdleStrategy.ALIAS:
            case 'org.agrona.concurrent.ControllableIdleStrategy': {
                const status = requireNonNull(controllableStatus);
                status.setRelease(ControllableIdleStrategy.PARK);
                return new ControllableIdleStrategy(status);
            }

            default:
                // Java loads any other name with `Class.forName(strategyName).getConstructor().newInstance()`; a JS
                // port has no class loader, so a name that is not one of the above is a `ClassNotFoundException`.
                return LangUtil.rethrowUnchecked(new ClassNotFoundException(strategyName));
        }
    }

    /**
     * {@link IdleStrategy} to be employed by {@link Sender} for {@link ThreadingMode#DEDICATED}.
     *
     * @param controllableStatus to allow control of {@link ControllableIdleStrategy}, which can be null if not used.
     * @return {@link IdleStrategy} to be employed by {@link Sender} for {@link ThreadingMode#DEDICATED}.
     * @see #SENDER_IDLE_STRATEGY_PROP_NAME
     */
    public static senderIdleStrategy(controllableStatus: StatusIndicator | null): IdleStrategy {
        return Configuration.agentIdleStrategy(
            System.getProperty(
                Configuration.SENDER_IDLE_STRATEGY_PROP_NAME,
                Configuration.SENDER_IDLE_STRATEGY_DEFAULT,
            ),
            controllableStatus,
        );
    }

    /**
     * {@link IdleStrategy} to be employed by {@link Receiver} for {@link ThreadingMode#DEDICATED}.
     *
     * @param controllableStatus to allow control of {@link ControllableIdleStrategy}, which can be null if not used.
     * @return {@link IdleStrategy} to be employed by {@link Receiver} for {@link ThreadingMode#DEDICATED}.
     * @see #RECEIVER_IDLE_STRATEGY_PROP_NAME
     */
    public static receiverIdleStrategy(controllableStatus: StatusIndicator | null): IdleStrategy {
        return Configuration.agentIdleStrategy(
            System.getProperty(
                Configuration.RECEIVER_IDLE_STRATEGY_PROP_NAME,
                Configuration.RECEIVER_IDLE_STRATEGY_DEFAULT,
            ),
            controllableStatus,
        );
    }

    /**
     * {@link IdleStrategy} to be employed by {@link DriverConductor} for {@link ThreadingMode#DEDICATED} and
     * {@link ThreadingMode#SHARED_NETWORK}.
     *
     * @param controllableStatus to allow control of {@link ControllableIdleStrategy}, which can be null if not used.
     * @return {@link IdleStrategy} to be employed by {@link DriverConductor} for {@link ThreadingMode#DEDICATED}
     * and {@link ThreadingMode#SHARED_NETWORK}..
     * @see #CONDUCTOR_IDLE_STRATEGY_PROP_NAME
     */
    public static conductorIdleStrategy(controllableStatus: StatusIndicator | null): IdleStrategy {
        return Configuration.agentIdleStrategy(
            System.getProperty(
                Configuration.CONDUCTOR_IDLE_STRATEGY_PROP_NAME,
                Configuration.CONDUCTOR_IDLE_STRATEGY_DEFAULT,
            ),
            controllableStatus,
        );
    }

    /**
     * {@link IdleStrategy} to be employed by {@link Sender} and {@link Receiver} for
     * {@link ThreadingMode#SHARED_NETWORK}.
     *
     * @param controllableStatus to allow control of {@link ControllableIdleStrategy}, which can be null if not used.
     * @return {@link IdleStrategy} to be employed by {@link Sender} and {@link Receiver} for
     * {@link ThreadingMode#SHARED_NETWORK}.
     * @see #SHARED_NETWORK_IDLE_STRATEGY_PROP_NAME
     */
    public static sharedNetworkIdleStrategy(controllableStatus: StatusIndicator | null): IdleStrategy {
        return Configuration.agentIdleStrategy(
            System.getProperty(
                Configuration.SHARED_NETWORK_IDLE_STRATEGY_PROP_NAME,
                Configuration.SHARED_NETWORK_IDLE_STRATEGY_DEFAULT,
            ),
            controllableStatus,
        );
    }

    /**
     * {@link IdleStrategy} to be employed by {@link Sender}, {@link Receiver}, and {@link DriverConductor} for
     * {@link ThreadingMode#SHARED}.
     *
     * @param controllableStatus to allow control of {@link ControllableIdleStrategy}, which can be null if not used.
     * @return {@link IdleStrategy} to be employed by {@link Sender}, {@link Receiver}, and {@link DriverConductor} for
     * {@link ThreadingMode#SHARED}.
     * @see #SHARED_IDLE_STRATEGY_PROP_NAME
     */
    public static sharedIdleStrategy(controllableStatus: StatusIndicator | null): IdleStrategy {
        return Configuration.agentIdleStrategy(
            System.getProperty(
                Configuration.SHARED_IDLE_STRATEGY_PROP_NAME,
                Configuration.SHARED_IDLE_STRATEGY_DEFAULT,
            ),
            controllableStatus,
        );
    }

    /**
     * @return Application Specific Feedback added to Status Messages by the driver for flow control.
     * @see #SM_APPLICATION_SPECIFIC_FEEDBACK_PROP_NAME
     * @deprecated see {@link #groupTag()}.
     */
    public static applicationSpecificFeedback(): Uint8Array {
        const propertyValue = System.getProperty(Configuration.SM_APPLICATION_SPECIFIC_FEEDBACK_PROP_NAME);
        if (null === propertyValue) {
            return ArrayUtil.EMPTY_BYTE_ARRAY;
        }

        return BitUtil.fromHex(propertyValue);
    }

    /**
     * Get the supplier of {@link FlowControl}s which can be used for changing behavior of flow control for unicast
     * publications. There is no class loader (spec D25): any property value but the default is a
     * `ClassNotFoundException`.
     *
     * @return the {@link FlowControlSupplier}.
     */
    public static unicastFlowControlSupplier(): FlowControlSupplier {
        const className = System.getProperty(Configuration.UNICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME);
        if (null === className) {
            return new DefaultUnicastFlowControlSupplier();
        }

        return FlowControlRegistry.newFlowControlSupplier(className);
    }

    /**
     * Get the supplier of {@link FlowControl}s which can be used for changing behavior of flow control for multicast
     * publications. The class name of the property is looked up in the static registry of
     * {@link FlowControlRegistry} (spec D25, D118).
     *
     * @return the {@link FlowControlSupplier}.
     */
    public static multicastFlowControlSupplier(): FlowControlSupplier {
        const className = System.getProperty(Configuration.MULTICAST_FLOW_CONTROL_STRATEGY_SUPPLIER_PROP_NAME);
        if (null === className) {
            return new DefaultMulticastFlowControlSupplier();
        }

        return FlowControlRegistry.newFlowControlSupplier(className);
    }

    /**
     * Get the supplier of {@link CongestionControl} implementations which can be used for receivers.
     *
     * @return the {@link CongestionControlSupplier}
     */
    public static congestionControlSupplier(): CongestionControlSupplier {
        const className = System.getProperty(Configuration.CONGESTION_CONTROL_STRATEGY_SUPPLIER_PROP_NAME);
        if (null === className || 'io.aeron.driver.DefaultCongestionControlSupplier' === className) {
            return new DefaultCongestionControlSupplier();
        }

        return LangUtil.rethrowUnchecked(new ClassNotFoundException(className));
    }

    /**
     * Get the {@link TerminationValidator} implementations which can be used for validating a termination request
     * sent to the driver to ensure the client has the right to terminate a driver.
     *
     * @return the {@link TerminationValidator}
     */
    public static terminationValidator(): TerminationValidator {
        const className = System.getProperty(Configuration.TERMINATION_VALIDATOR_PROP_NAME);
        if (null === className || 'io.aeron.driver.DefaultDenyTerminationValidator' === className) {
            return new DefaultDenyTerminationValidator();
        }

        return LangUtil.rethrowUnchecked(new ClassNotFoundException(className));
    }

    /**
     * Get the supplier of {@link SendChannelEndpoint}s which can be used for debugging, monitoring, or modifying the
     * behaviour when sending to the channel.
     * <p>
     * There is no class loader (spec D25, D63): the property names the default supplier or the debug supplier of
     * `io.aeron.driver.ext`, and any other name is a `ClassNotFoundException`.
     *
     * @return the {@link SendChannelEndpointSupplier}.
     */
    public static sendChannelEndpointSupplier(): SendChannelEndpointSupplier {
        const className = System.getProperty(Configuration.SEND_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME);
        if (null === className || 'io.aeron.driver.DefaultSendChannelEndpointSupplier' === className) {
            return new DefaultSendChannelEndpointSupplier();
        }

        if ('io.aeron.driver.ext.DebugSendChannelEndpointSupplier' === className) {
            return new DebugSendChannelEndpointSupplier();
        }

        return LangUtil.rethrowUnchecked(new ClassNotFoundException(className));
    }

    /**
     * Get the supplier of {@link ReceiveChannelEndpoint}s which can be used for debugging, monitoring, or modifying the
     * behaviour when receiving from the channel.
     * <p>
     * There is no class loader (spec D25, D63): the property names the default supplier or the debug supplier of
     * `io.aeron.driver.ext`, and any other name is a `ClassNotFoundException`.
     *
     * @return the {@link ReceiveChannelEndpointSupplier}.
     */
    public static receiveChannelEndpointSupplier(): ReceiveChannelEndpointSupplier {
        const className = System.getProperty(Configuration.RECEIVE_CHANNEL_ENDPOINT_SUPPLIER_PROP_NAME);
        if (null === className || 'io.aeron.driver.DefaultReceiveChannelEndpointSupplier' === className) {
            return new DefaultReceiveChannelEndpointSupplier();
        }

        if ('io.aeron.driver.ext.DebugReceiveChannelEndpointSupplier' === className) {
            return new DebugReceiveChannelEndpointSupplier();
        }

        return LangUtil.rethrowUnchecked(new ClassNotFoundException(className));
    }

    /**
     * Get the configured limit for the number of streams per session.
     *
     * @return configured session limit
     * @throws AsciiNumberFormatException if the property referenced by {@link #STREAM_SESSION_LIMIT_PROP_NAME} is not
     *                                    a valid number
     */
    public static streamSessionLimit(): number {
        const streamSessionLimitString = System.getProperty(Configuration.STREAM_SESSION_LIMIT_PROP_NAME);

        try {
            return Strings.isEmpty(streamSessionLimitString)
                ? Configuration.STREAM_SESSION_LIMIT_DEFAULT
                : Integer.parseInt(streamSessionLimitString);
        } catch (ex) {
            if (!(ex instanceof NumberFormatException)) {
                throw ex;
            }
            throw new AsciiNumberFormatException(
                'Property ' +
                    Configuration.STREAM_SESSION_LIMIT_PROP_NAME +
                    '=' +
                    streamSessionLimitString +
                    ' is not a number',
            );
        }
    }

    /**
     * Validate that the initial window length is greater than MTU.
     *
     * @param initialWindowLength to be validated.
     * @param mtuLength           against which to validate.
     */
    public static validateInitialWindowLength(initialWindowLength: number, mtuLength: number): void {
        if (mtuLength > initialWindowLength) {
            throw new ConfigurationException(
                'mtuLength=' + mtuLength + ' > initialWindowLength=' + initialWindowLength,
            );
        }
    }

    /**
     * Validate that the MTU is an appropriate length. MTU lengths must be a multiple of
     * {@link FrameDescriptor#FRAME_ALIGNMENT}.
     *
     * @param mtuLength to be validated.
     * @throws ConfigurationException if the MTU length is not valid.
     */
    public static validateMtuLength(mtuLength: number): void {
        if (mtuLength <= DataHeaderFlyweight.HEADER_LENGTH) {
            throw new ConfigurationException(
                'mtuLength=' + mtuLength + ' <= HEADER_LENGTH=' + DataHeaderFlyweight.HEADER_LENGTH,
            );
        }

        if (mtuLength > Configuration.MAX_UDP_PAYLOAD_LENGTH) {
            throw new ConfigurationException(
                'mtuLength=' + mtuLength + ' > MAX_UDP_PAYLOAD_LENGTH=' + Configuration.MAX_UDP_PAYLOAD_LENGTH,
            );
        }

        if (!FrameDescriptor.isFrameAligned(mtuLength)) {
            throw new ConfigurationException(
                'mtuLength=' + mtuLength + ' is not a multiple of FRAME_ALIGNMENT=' + FrameDescriptor.FRAME_ALIGNMENT,
            );
        }
    }

    /**
     * Validate that the socket buffer lengths of the context fit the OS limits, the MTU and the initial window length.
     * A length above what the OS allows is a warning on `System.err`; an MTU above the send buffer, or an initial
     * window above the receive buffer, is an error.
     *
     * @param ctx the context to check.
     * @throws ConfigurationException if the MTU or the initial window do not fit the socket buffers.
     */
    public static validateSocketBufferLengths(ctx: MediaDriverContext): void {
        if (ctx.osMaxSocketSndbufLength() < ctx.socketSndbufLength()) {
            SystemErr.println(
                'WARNING: Could not set desired SO_SNDBUF, adjust OS to allow ' +
                    Configuration.SOCKET_SNDBUF_LENGTH_PROP_NAME +
                    ' attempted=' +
                    ctx.socketSndbufLength() +
                    ', actual=' +
                    ctx.osMaxSocketSndbufLength(),
            );
        }

        if (ctx.osMaxSocketRcvbufLength() < ctx.socketRcvbufLength()) {
            SystemErr.println(
                'WARNING: Could not set desired SO_RCVBUF, adjust OS to allow ' +
                    Configuration.SOCKET_RCVBUF_LENGTH_PROP_NAME +
                    ' attempted=' +
                    ctx.socketRcvbufLength() +
                    ', actual=' +
                    ctx.osMaxSocketRcvbufLength(),
            );
        }

        const soSndBuf = 0 === ctx.socketSndbufLength() ? ctx.osDefaultSocketSndbufLength() : ctx.socketSndbufLength();

        if (ctx.mtuLength() > soSndBuf) {
            throw new ConfigurationException(
                'mtuLength=' +
                    ctx.mtuLength() +
                    ' > SO_SNDBUF=' +
                    soSndBuf +
                    ', increase ' +
                    Configuration.SOCKET_SNDBUF_LENGTH_PROP_NAME +
                    ' to match MTU',
            );
        }

        const soRcvBuf = 0 === ctx.socketRcvbufLength() ? ctx.osDefaultSocketRcvbufLength() : ctx.socketRcvbufLength();

        if (ctx.initialWindowLength() > soRcvBuf) {
            throw new ConfigurationException(
                'initialWindowLength=' +
                    ctx.initialWindowLength() +
                    ' > SO_RCVBUF=' +
                    soRcvBuf +
                    ', increase ' +
                    Configuration.SOCKET_RCVBUF_LENGTH_PROP_NAME +
                    ' limits to match initialWindowLength',
            );
        }
    }

    /**
     * Validate that page size is valid and alignment is valid.
     *
     * @param pageSize to be checked.
     * @throws ConfigurationException if the size is not as expected.
     */
    public static validatePageSize(pageSize: number): void {
        Configuration.validateValueRange(
            pageSize,
            LogBufferDescriptor.PAGE_MIN_SIZE,
            LogBufferDescriptor.PAGE_MAX_SIZE,
            'filePageSize',
        );

        if (!BitUtil.isPowerOfTwo(pageSize)) {
            throw new ConfigurationException('filePageSize not a power of 2: ' + pageSize);
        }
    }

    /**
     * Validate the range of session ids based on a high and low value provided which accounts for the values wrapping.
     *
     * @param low  value in the range.
     * @param high value in the range.
     * @throws ConfigurationException if the values are not valid.
     */
    public static validateSessionIdRange(low: number, high: number): void {
        if (low > high) {
            throw new ConfigurationException('low session id value ' + low + ' must be <= high value ' + high);
        }

        if (Math.abs(high - low) > Integer.MAX_VALUE) {
            throw new ConfigurationException('reserved session range too large');
        }
    }

    /**
     * Compute the length of the {@link org.agrona.concurrent.status.CountersManager} metadata buffer based on the
     * length of the counters value buffer length.
     *
     * @param counterValuesBufferLength to compute the metadata buffer length from as a ratio.
     * @return the length that should be used for the metadata buffer for counters.
     */
    public static countersMetadataBufferLength(counterValuesBufferLength: number): number {
        return counterValuesBufferLength * (CountersReader.METADATA_LENGTH / CountersReader.COUNTER_LENGTH);
    }

    /**
     * Validate that the timeouts for unblocking publications from a client are valid.
     *
     * @param publicationUnblockTimeoutNs after which an uncommitted publication will be unblocked.
     * @param clientLivenessTimeoutNs     after which a client will be considered not alive.
     * @param timerIntervalNs             interval at which the driver will check timeouts.
     * @throws ConfigurationException if the values are not valid.
     */
    public static validateUnblockTimeout(
        publicationUnblockTimeoutNs: number,
        clientLivenessTimeoutNs: number,
        timerIntervalNs: number,
    ): void {
        if (publicationUnblockTimeoutNs <= clientLivenessTimeoutNs) {
            throw new ConfigurationException(
                'publicationUnblockTimeoutNs=' +
                    publicationUnblockTimeoutNs +
                    ' <= clientLivenessTimeoutNs=' +
                    clientLivenessTimeoutNs,
            );
        }

        if (clientLivenessTimeoutNs <= timerIntervalNs) {
            throw new ConfigurationException(
                'clientLivenessTimeoutNs=' + clientLivenessTimeoutNs + ' <= timerIntervalNs=' + timerIntervalNs,
            );
        }
    }

    /**
     * Validate that the timeouts for untethered subscriptions are greater than timer interval.
     *
     * @param untetheredWindowLimitTimeoutNs after which an active untethered subscription will be lingered.
     * @param untetheredLingerTimeoutNs      after which a lingering untethered subscription will transition to resting.
     * @param untetheredRestingTimeoutNs     after which a resting untethered subscription will become active again.
     * @param timerIntervalNs                interval at which the driver will check timeouts.
     * @throws ConfigurationException if the values are not valid.
     */
    public static validateUntetheredTimeouts(
        untetheredWindowLimitTimeoutNs: number,
        untetheredLingerTimeoutNs: number,
        untetheredRestingTimeoutNs: number,
        timerIntervalNs: number,
    ): void {
        if (untetheredWindowLimitTimeoutNs <= timerIntervalNs) {
            throw new ConfigurationException(
                'untetheredWindowLimitTimeoutNs=' +
                    untetheredWindowLimitTimeoutNs +
                    ' <= timerIntervalNs=' +
                    timerIntervalNs,
            );
        }

        if (untetheredRestingTimeoutNs <= timerIntervalNs) {
            throw new ConfigurationException(
                'untetheredRestingTimeoutNs=' + untetheredRestingTimeoutNs + ' <= timerIntervalNs=' + timerIntervalNs,
            );
        }

        if (Aeron.NULL_VALUE !== untetheredLingerTimeoutNs && untetheredLingerTimeoutNs <= timerIntervalNs) {
            throw new ConfigurationException(
                'untetheredLingerTimeoutNs=' + untetheredLingerTimeoutNs + ' <= timerIntervalNs=' + timerIntervalNs,
            );
        }
    }

    /**
     * Create a source identity for a given source address.
     *
     * @param srcAddress to be used for the identity.
     * @return a source identity string for a given address.
     */
    public static sourceIdentity(srcAddress: InetSocketAddress): string {
        return srcAddress.getHostString() + ':' + srcAddress.getPort();
    }

    public static validateValueRange(value: number, minValue: number, maxValue: number, name: string): void {
        if (value < minValue) {
            throw new ConfigurationException(name + ' less than min size of ' + minValue + ': ' + value);
        }

        if (value > maxValue) {
            throw new ConfigurationException(name + ' greater than max size of ' + maxValue + ': ' + value);
        }
    }
}
