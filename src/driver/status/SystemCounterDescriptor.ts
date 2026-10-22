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
// Port of io/aeron/driver/status/SystemCounterDescriptor.java @ 1.53.3
import { type AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { Int2ObjectHashMap } from '../../agrona/collections/Int2ObjectHashMap.js';
import { IllegalStateException } from '../../agrona/jdk.js';
import { Aeron } from '../../client/Aeron.js';
import { AeronCounters } from '../../client/AeronCounters.js';
import { MediaDriverVersion } from '../MediaDriverVersion.js';

/**
 * System-wide counters for monitoring. These are separate from counters used for position tracking on streams.
 */
export class SystemCounterDescriptor {
    private static nextOrdinal = 0;

    /**
     * Running total of bytes sent for data over UDP, excluding IP headers.
     */
    public static readonly BYTES_SENT: SystemCounterDescriptor = new SystemCounterDescriptor(
        'BYTES_SENT',
        AeronCounters.SYSTEM_COUNTER_ID_BYTES_SENT,
        'Bytes sent',
    );

    /**
     * Running total of bytes received for data over UDP, excluding IP headers.
     */
    public static readonly BYTES_RECEIVED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'BYTES_RECEIVED',
        AeronCounters.SYSTEM_COUNTER_ID_BYTES_RECEIVED,
        'Bytes received',
    );

    /**
     * Failed offers to the receiver proxy suggesting back-pressure.
     */
    public static readonly RECEIVER_PROXY_FAILS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'RECEIVER_PROXY_FAILS',
        AeronCounters.SYSTEM_COUNTER_ID_RECEIVER_PROXY_FAILS,
        'Failed offers to ReceiverProxy',
    );

    /**
     * Failed offers to the sender proxy suggesting back-pressure.
     */
    public static readonly SENDER_PROXY_FAILS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'SENDER_PROXY_FAILS',
        AeronCounters.SYSTEM_COUNTER_ID_SENDER_PROXY_FAILS,
        'Failed offers to SenderProxy',
    );

    /**
     * Failed offers to the driver conductor proxy suggesting back-pressure.
     */
    public static readonly CONDUCTOR_PROXY_FAILS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'CONDUCTOR_PROXY_FAILS',
        AeronCounters.SYSTEM_COUNTER_ID_CONDUCTOR_PROXY_FAILS,
        'Failed offers to DriverConductorProxy',
    );

    /**
     * Count of NAKs sent back to senders requesting re-transmits.
     */
    public static readonly NAK_MESSAGES_SENT: SystemCounterDescriptor = new SystemCounterDescriptor(
        'NAK_MESSAGES_SENT',
        AeronCounters.SYSTEM_COUNTER_ID_NAK_MESSAGES_SENT,
        'NAKs sent',
    );

    /**
     * Count of NAKs received from receivers requesting re-transmits.
     */
    public static readonly NAK_MESSAGES_RECEIVED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'NAK_MESSAGES_RECEIVED',
        AeronCounters.SYSTEM_COUNTER_ID_NAK_MESSAGES_RECEIVED,
        'NAKs received',
    );

    /**
     * Count of status messages sent back to senders for flow control.
     */
    public static readonly STATUS_MESSAGES_SENT: SystemCounterDescriptor = new SystemCounterDescriptor(
        'STATUS_MESSAGES_SENT',
        AeronCounters.SYSTEM_COUNTER_ID_STATUS_MESSAGES_SENT,
        'Status Messages sent',
    );

    /**
     * Count of status messages received from receivers for flow control.
     */
    public static readonly STATUS_MESSAGES_RECEIVED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'STATUS_MESSAGES_RECEIVED',
        AeronCounters.SYSTEM_COUNTER_ID_STATUS_MESSAGES_RECEIVED,
        'Status Messages received',
    );

    /**
     * Count of heartbeat data frames sent to indicate liveness in the absence of data to send.
     */
    public static readonly HEARTBEATS_SENT: SystemCounterDescriptor = new SystemCounterDescriptor(
        'HEARTBEATS_SENT',
        AeronCounters.SYSTEM_COUNTER_ID_HEARTBEATS_SENT,
        'Heartbeats sent',
    );

    /**
     * Count of heartbeat data frames received to indicate liveness in the absence of data to send.
     */
    public static readonly HEARTBEATS_RECEIVED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'HEARTBEATS_RECEIVED',
        AeronCounters.SYSTEM_COUNTER_ID_HEARTBEATS_RECEIVED,
        'Heartbeats received',
    );

    /**
     * Count of data packets re-transmitted as a result of NAKs.
     */
    public static readonly RETRANSMITS_SENT: SystemCounterDescriptor = new SystemCounterDescriptor(
        'RETRANSMITS_SENT',
        AeronCounters.SYSTEM_COUNTER_ID_RETRANSMITS_SENT,
        'Retransmits sent',
    );

    /**
     * Count of packets received which under-run the current flow control window for images.
     */
    public static readonly FLOW_CONTROL_UNDER_RUNS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'FLOW_CONTROL_UNDER_RUNS',
        AeronCounters.SYSTEM_COUNTER_ID_FLOW_CONTROL_UNDER_RUNS,
        'Flow control under runs',
    );

    /**
     * Count of packets received which over-run the current flow control window for images.
     */
    public static readonly FLOW_CONTROL_OVER_RUNS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'FLOW_CONTROL_OVER_RUNS',
        AeronCounters.SYSTEM_COUNTER_ID_FLOW_CONTROL_OVER_RUNS,
        'Flow control over runs',
    );

    /**
     * Count of invalid packets received.
     */
    public static readonly INVALID_PACKETS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'INVALID_PACKETS',
        AeronCounters.SYSTEM_COUNTER_ID_INVALID_PACKETS,
        'Invalid packets',
    );

    /**
     * Count of errors observed by the driver and an indication to read the distinct error log.
     */
    public static readonly ERRORS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'ERRORS',
        AeronCounters.SYSTEM_COUNTER_ID_ERRORS,
        'Errors: ' + AeronCounters.formatVersionInfo(MediaDriverVersion.VERSION, MediaDriverVersion.GIT_SHA),
    );

    /**
     * Count of socket send operation which resulted in less than the packet length being sent.
     */
    public static readonly SHORT_SENDS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'SHORT_SENDS',
        AeronCounters.SYSTEM_COUNTER_ID_SHORT_SENDS,
        'Short sends',
    );

    /**
     * Count of attempts to free log buffers no longer required by the driver which as still held by clients.
     */
    public static readonly FREE_FAILS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'FREE_FAILS',
        AeronCounters.SYSTEM_COUNTER_ID_FREE_FAILS,
        'Failed attempts to free log buffers',
    );

    /**
     * Count of the times a sender has entered the state of being back-pressured when it could have sent faster.
     */
    public static readonly SENDER_FLOW_CONTROL_LIMITS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'SENDER_FLOW_CONTROL_LIMITS',
        AeronCounters.SYSTEM_COUNTER_ID_SENDER_FLOW_CONTROL_LIMITS,
        'Sender flow control limits, i.e. back-pressure events',
    );

    /**
     * Count of the times a publication has been unblocked after a client failed to complete an offer within a timeout.
     */
    public static readonly UNBLOCKED_PUBLICATIONS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'UNBLOCKED_PUBLICATIONS',
        AeronCounters.SYSTEM_COUNTER_ID_UNBLOCKED_PUBLICATIONS,
        'Unblocked Publications',
    );

    /**
     * Count of the times a command has been unblocked after a client failed to complete an offer within a timeout.
     */
    public static readonly UNBLOCKED_COMMANDS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'UNBLOCKED_COMMANDS',
        AeronCounters.SYSTEM_COUNTER_ID_UNBLOCKED_COMMANDS,
        'Unblocked Control Commands',
    );

    /**
     * Count of the times the channel endpoint detected a possible TTL asymmetry between its config and new connection.
     */
    public static readonly POSSIBLE_TTL_ASYMMETRY: SystemCounterDescriptor = new SystemCounterDescriptor(
        'POSSIBLE_TTL_ASYMMETRY',
        AeronCounters.SYSTEM_COUNTER_ID_POSSIBLE_TTL_ASYMMETRY,
        'Possible TTL Asymmetry',
    );

    /**
     * Current status of the {@link org.agrona.concurrent.ControllableIdleStrategy} if configured.
     */
    public static readonly CONTROLLABLE_IDLE_STRATEGY: SystemCounterDescriptor = new SystemCounterDescriptor(
        'CONTROLLABLE_IDLE_STRATEGY',
        AeronCounters.SYSTEM_COUNTER_ID_CONTROLLABLE_IDLE_STRATEGY,
        'ControllableIdleStrategy status',
    );

    /**
     * Count of the times a loss gap has been filled when NAKs have been disabled.
     */
    public static readonly LOSS_GAP_FILLS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'LOSS_GAP_FILLS',
        AeronCounters.SYSTEM_COUNTER_ID_LOSS_GAP_FILLS,
        'Loss gap fills',
    );

    /**
     * Count of the Aeron clients that have timed out without a graceful close.
     */
    public static readonly CLIENT_TIMEOUTS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'CLIENT_TIMEOUTS',
        AeronCounters.SYSTEM_COUNTER_ID_CLIENT_TIMEOUTS,
        'Client liveness timeouts',
    );

    /**
     * Count of the times a connection endpoint has been re-resolved resulting in a change.
     */
    public static readonly RESOLUTION_CHANGES: SystemCounterDescriptor = new SystemCounterDescriptor(
        'RESOLUTION_CHANGES',
        AeronCounters.SYSTEM_COUNTER_ID_RESOLUTION_CHANGES,
        'Resolution changes',
    );

    /**
     * The maximum time spent by the conductor between work cycles.
     */
    public static readonly CONDUCTOR_MAX_CYCLE_TIME: SystemCounterDescriptor = new SystemCounterDescriptor(
        'CONDUCTOR_MAX_CYCLE_TIME',
        AeronCounters.SYSTEM_COUNTER_ID_CONDUCTOR_MAX_CYCLE_TIME,
        'Conductor max cycle time doing its work in ns',
    );

    /**
     * Count of the number of times the cycle time threshold has been exceeded by the conductor in its work cycle.
     */
    public static readonly CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED: SystemCounterDescriptor =
        new SystemCounterDescriptor(
            'CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED',
            AeronCounters.SYSTEM_COUNTER_ID_CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED,
            'Conductor work cycle exceeded threshold count',
        );

    /**
     * The maximum time spent by the sender between work cycles.
     */
    public static readonly SENDER_MAX_CYCLE_TIME: SystemCounterDescriptor = new SystemCounterDescriptor(
        'SENDER_MAX_CYCLE_TIME',
        AeronCounters.SYSTEM_COUNTER_ID_SENDER_MAX_CYCLE_TIME,
        'Sender max cycle time doing its work in ns',
    );

    /**
     * Count of the number of times the cycle time threshold has been exceeded by the sender in its work cycle.
     */
    public static readonly SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED',
        AeronCounters.SYSTEM_COUNTER_ID_SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED,
        'Sender work cycle exceeded threshold count',
    );

    /**
     * The maximum time spent by the receiver between work cycles.
     */
    public static readonly RECEIVER_MAX_CYCLE_TIME: SystemCounterDescriptor = new SystemCounterDescriptor(
        'RECEIVER_MAX_CYCLE_TIME',
        AeronCounters.SYSTEM_COUNTER_ID_RECEIVER_MAX_CYCLE_TIME,
        'Receiver max cycle time doing its work in ns',
    );

    /**
     * Count of the number of times the cycle time threshold has been exceeded by the receiver in its work cycle.
     */
    public static readonly RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED: SystemCounterDescriptor =
        new SystemCounterDescriptor(
            'RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED',
            AeronCounters.SYSTEM_COUNTER_ID_RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED,
            'Receiver work cycle exceeded threshold count',
        );

    /**
     * The maximum time spent by the NameResolver in one of its operations.
     *
     * @since 1.41.0
     */
    public static readonly NAME_RESOLVER_MAX_TIME: SystemCounterDescriptor = new SystemCounterDescriptor(
        'NAME_RESOLVER_MAX_TIME',
        AeronCounters.SYSTEM_COUNTER_ID_NAME_RESOLVER_MAX_TIME,
        'NameResolver max time in ns',
    );

    /**
     * Count of the number of times the time threshold has been exceeded by the NameResolver.
     *
     * @since 1.41.0
     */
    public static readonly NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED',
        AeronCounters.SYSTEM_COUNTER_ID_NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED,
        'NameResolver exceeded threshold count',
    );

    /**
     * The version of the media driver.
     *
     * @since 1.43.0
     */
    public static readonly AERON_VERSION: SystemCounterDescriptor = new SystemCounterDescriptor(
        'AERON_VERSION',
        AeronCounters.SYSTEM_COUNTER_ID_AERON_VERSION,
        'Aeron software: ' + AeronCounters.formatVersionInfo(MediaDriverVersion.VERSION, MediaDriverVersion.GIT_SHA),
    );

    /**
     * The total number of bytes currently mapped in log buffers, CnC file, and loss report.
     *
     * @since 1.44.0
     */
    public static readonly BYTES_CURRENTLY_MAPPED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'BYTES_CURRENTLY_MAPPED',
        AeronCounters.SYSTEM_COUNTER_ID_BYTES_CURRENTLY_MAPPED,
        'Bytes currently mapped',
    );

    /**
     * A minimum bound on the number of bytes re-transmitted as a result of NAKs.
     * <p>
     * MDC retransmits are only counted once; therefore, this is a minimum bound rather than the actual number
     * of retransmitted bytes. We may change this in the future.
     * <p>
     * Note that retransmitted bytes are not included in the {@link SystemCounterDescriptor#BYTES_SENT}
     * counter value. We may change this in the future.
     *
     * @since 1.45.0
     */
    public static readonly RETRANSMITTED_BYTES: SystemCounterDescriptor = new SystemCounterDescriptor(
        'RETRANSMITTED_BYTES',
        AeronCounters.SYSTEM_COUNTER_ID_RETRANSMITTED_BYTES,
        'Retransmitted bytes',
    );

    /**
     * A count of the number of times that the retransmit pool has been overflowed.
     *
     * @since 1.45.0
     */
    public static readonly RETRANSMIT_OVERFLOW: SystemCounterDescriptor = new SystemCounterDescriptor(
        'RETRANSMIT_OVERFLOW',
        AeronCounters.SYSTEM_COUNTER_ID_RETRANSMIT_OVERFLOW,
        'Retransmit Pool Overflow count',
    );

    /**
     * A count of the number of error frames received by this driver.
     *
     * @since 1.47.0
     */
    public static readonly ERROR_FRAMES_RECEIVED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'ERROR_FRAMES_RECEIVED',
        AeronCounters.SYSTEM_COUNTER_ID_ERROR_FRAMES_RECEIVED,
        'Error Frames received',
    );

    /**
     * A count of the number of error frames sent by this driver.
     *
     * @since 1.47.0
     */
    public static readonly ERROR_FRAMES_SENT: SystemCounterDescriptor = new SystemCounterDescriptor(
        'ERROR_FRAMES_SENT',
        AeronCounters.SYSTEM_COUNTER_ID_ERROR_FRAMES_SENT,
        'Error Frames sent',
    );

    /**
     * A count of the number of publications that have been revoked.
     *
     * @since 1.48.0
     */
    public static readonly PUBLICATIONS_REVOKED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'PUBLICATIONS_REVOKED',
        AeronCounters.SYSTEM_COUNTER_ID_PUBLICATIONS_REVOKED,
        'Publications Revoked',
    );

    /**
     * A count of the number of publication images that have been revoked.
     *
     * @since 1.48.0
     */
    public static readonly PUBLICATION_IMAGES_REVOKED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'PUBLICATION_IMAGES_REVOKED',
        AeronCounters.SYSTEM_COUNTER_ID_PUBLICATION_IMAGES_REVOKED,
        'Publication Images Revoked',
    );

    /**
     * A count of the number of images that have been rejected.
     *
     * @since 1.48.0
     */
    public static readonly IMAGES_REJECTED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'IMAGES_REJECTED',
        AeronCounters.SYSTEM_COUNTER_ID_IMAGES_REJECTED,
        'Images rejected',
    );

    /**
     * The semantic version of the control protocol between clients and media driver.
     *
     * @since 1.49.0
     */
    public static readonly CONTROL_PROTOCOL_VERSION: SystemCounterDescriptor = new SystemCounterDescriptor(
        'CONTROL_PROTOCOL_VERSION',
        AeronCounters.SYSTEM_COUNTER_ID_CONTROL_PROTOCOL_VERSION,
        'Control protocol version',
    );

    /**
     * Count of status messages received from receivers for flow control.
     *
     * @since 1.51.0
     */
    public static readonly STATUS_MESSAGES_REJECTED: SystemCounterDescriptor = new SystemCounterDescriptor(
        'STATUS_MESSAGES_REJECTED',
        AeronCounters.SYSTEM_COUNTER_ID_STATUS_MESSAGES_REJECTED,
        'Status Messages rejected',
    );

    /**
     * Failed offers to the native resource agent proxy suggesting back-pressure.
     *
     * @since 1.51.0
     */
    public static readonly NATIVE_RESOURCE_AGENT_PROXY_FAILS: SystemCounterDescriptor = new SystemCounterDescriptor(
        'NATIVE_RESOURCE_AGENT_PROXY_FAILS',
        AeronCounters.SYSTEM_COUNTER_ID_NATIVE_RESOURCE_AGENT_PROXY_FAILS,
        'Failed offers to NativeResourceAgentProxy',
    );

    /**
     * All system counters have the same type id, i.e. system counters are the same type. Other types can exist.
     */
    public static readonly SYSTEM_COUNTER_TYPE_ID = AeronCounters.DRIVER_SYSTEM_COUNTER_TYPE_ID;

    private static readonly DESCRIPTOR_BY_ID_MAP = new Int2ObjectHashMap<SystemCounterDescriptor>();

    private readonly _name: string;
    private readonly _ordinal: number;
    private readonly _id: number;
    private readonly _label: string;

    private constructor(name: string, id: number, label: string) {
        this._name = name;
        this._ordinal = SystemCounterDescriptor.nextOrdinal++;
        this._id = id;
        this._label = label;
    }

    /**
     * The constants of the enum in ordinal order.
     *
     * @return a new array of the constants.
     */
    public static values(): SystemCounterDescriptor[] {
        return [
            SystemCounterDescriptor.BYTES_SENT,
            SystemCounterDescriptor.BYTES_RECEIVED,
            SystemCounterDescriptor.RECEIVER_PROXY_FAILS,
            SystemCounterDescriptor.SENDER_PROXY_FAILS,
            SystemCounterDescriptor.CONDUCTOR_PROXY_FAILS,
            SystemCounterDescriptor.NAK_MESSAGES_SENT,
            SystemCounterDescriptor.NAK_MESSAGES_RECEIVED,
            SystemCounterDescriptor.STATUS_MESSAGES_SENT,
            SystemCounterDescriptor.STATUS_MESSAGES_RECEIVED,
            SystemCounterDescriptor.HEARTBEATS_SENT,
            SystemCounterDescriptor.HEARTBEATS_RECEIVED,
            SystemCounterDescriptor.RETRANSMITS_SENT,
            SystemCounterDescriptor.FLOW_CONTROL_UNDER_RUNS,
            SystemCounterDescriptor.FLOW_CONTROL_OVER_RUNS,
            SystemCounterDescriptor.INVALID_PACKETS,
            SystemCounterDescriptor.ERRORS,
            SystemCounterDescriptor.SHORT_SENDS,
            SystemCounterDescriptor.FREE_FAILS,
            SystemCounterDescriptor.SENDER_FLOW_CONTROL_LIMITS,
            SystemCounterDescriptor.UNBLOCKED_PUBLICATIONS,
            SystemCounterDescriptor.UNBLOCKED_COMMANDS,
            SystemCounterDescriptor.POSSIBLE_TTL_ASYMMETRY,
            SystemCounterDescriptor.CONTROLLABLE_IDLE_STRATEGY,
            SystemCounterDescriptor.LOSS_GAP_FILLS,
            SystemCounterDescriptor.CLIENT_TIMEOUTS,
            SystemCounterDescriptor.RESOLUTION_CHANGES,
            SystemCounterDescriptor.CONDUCTOR_MAX_CYCLE_TIME,
            SystemCounterDescriptor.CONDUCTOR_CYCLE_TIME_THRESHOLD_EXCEEDED,
            SystemCounterDescriptor.SENDER_MAX_CYCLE_TIME,
            SystemCounterDescriptor.SENDER_CYCLE_TIME_THRESHOLD_EXCEEDED,
            SystemCounterDescriptor.RECEIVER_MAX_CYCLE_TIME,
            SystemCounterDescriptor.RECEIVER_CYCLE_TIME_THRESHOLD_EXCEEDED,
            SystemCounterDescriptor.NAME_RESOLVER_MAX_TIME,
            SystemCounterDescriptor.NAME_RESOLVER_TIME_THRESHOLD_EXCEEDED,
            SystemCounterDescriptor.AERON_VERSION,
            SystemCounterDescriptor.BYTES_CURRENTLY_MAPPED,
            SystemCounterDescriptor.RETRANSMITTED_BYTES,
            SystemCounterDescriptor.RETRANSMIT_OVERFLOW,
            SystemCounterDescriptor.ERROR_FRAMES_RECEIVED,
            SystemCounterDescriptor.ERROR_FRAMES_SENT,
            SystemCounterDescriptor.PUBLICATIONS_REVOKED,
            SystemCounterDescriptor.PUBLICATION_IMAGES_REVOKED,
            SystemCounterDescriptor.IMAGES_REJECTED,
            SystemCounterDescriptor.CONTROL_PROTOCOL_VERSION,
            SystemCounterDescriptor.STATUS_MESSAGES_REJECTED,
            SystemCounterDescriptor.NATIVE_RESOURCE_AGENT_PROXY_FAILS,
        ];
    }

    /**
     * Get the {@link SystemCounterDescriptor} for a given id. It is Java's static {@code get(int)}; the instance
     * method {@code get} of {@link SystemCounters} is a different class.
     *
     * @param id for the descriptor.
     * @return the descriptor if found otherwise null.
     */
    public static get(id: number): SystemCounterDescriptor | null {
        return SystemCounterDescriptor.DESCRIPTOR_BY_ID_MAP.get(id);
    }

    public name(): string {
        return this._name;
    }

    public ordinal(): number {
        return this._ordinal;
    }

    public toString(): string {
        return this._name;
    }

    /**
     * The unique identity for the system counter.
     *
     * @return the unique identity for the system counter.
     */
    public id(): number {
        return this._id;
    }

    /**
     * The human-readable label to identify a system counter.
     *
     * @return the human-readable label to identify a system counter.
     */
    public label(): string {
        return this._label;
    }

    /**
     * Create a new counter for the enumerated descriptor.
     *
     * @param countersManager for managing the underlying storage.
     * @return a new counter for the enumerated descriptor.
     */
    public newCounter(countersManager: CountersManager): AtomicCounter {
        const id = this._id;
        const counter = countersManager.newCounter(
            this._label,
            SystemCounterDescriptor.SYSTEM_COUNTER_TYPE_ID,
            (buffer) => buffer.putInt(0, id),
        );
        countersManager.setCounterRegistrationId(counter.id(), id);
        countersManager.setCounterOwnerId(counter.id(), Aeron.NULL_VALUE);
        return counter;
    }

    static {
        for (const descriptor of SystemCounterDescriptor.values()) {
            const other = SystemCounterDescriptor.DESCRIPTOR_BY_ID_MAP.put(descriptor.id(), descriptor);
            if (null !== other) {
                throw new IllegalStateException(descriptor.toString() + ' uses the same id as ' + other.toString());
            }
        }
    }
}
