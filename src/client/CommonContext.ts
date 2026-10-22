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
// Port of io/aeron/CommonContext.java @ 1.53.3
import { Aeron } from './Aeron.js';

/**
 * Condition to specify a triple state conditional of always override to be true, always override to be false,
 * or infer value. The nested Java enum `CommonContext.InferableBoolean`, also reachable as
 * `CommonContext.InferableBoolean`.
 */
export class InferableBoolean {
    private static nextOrdinal = 0;

    /**
     * Force the conditional to be false.
     */
    public static readonly FORCE_FALSE: InferableBoolean = new InferableBoolean('FORCE_FALSE');

    /**
     * Force the conditional to be true.
     */
    public static readonly FORCE_TRUE: InferableBoolean = new InferableBoolean('FORCE_TRUE');

    /**
     * Try to infer if true or false is most appropriate.
     */
    public static readonly INFER: InferableBoolean = new InferableBoolean('INFER');

    private readonly _name: string;
    private readonly _ordinal: number;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = InferableBoolean.nextOrdinal++;
    }

    public static values(): InferableBoolean[] {
        return [InferableBoolean.FORCE_FALSE, InferableBoolean.FORCE_TRUE, InferableBoolean.INFER];
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
     * Parse the string looking for `true`, `false`, or `infer`.
     *
     * @param value to be parsed.
     * @return {@link InferableBoolean} which matches the string.
     */
    public static parse(value: string | null | undefined): InferableBoolean {
        if (null === value || undefined === value || 'infer' === value) {
            return InferableBoolean.INFER;
        }

        return 'true' === value ? InferableBoolean.FORCE_TRUE : InferableBoolean.FORCE_FALSE;
    }
}

/**
 * This class provides the Media Driver and client with common configuration for the Aeron directory.
 * <p>
 * Only the static constants are ported so far (see `docs/mapping.md`, "Not ported"); phase 2 adds the rest, in Java
 * order.
 */
export class CommonContext {
    /**
     * The nested enum `CommonContext.InferableBoolean`.
     */
    public static readonly InferableBoolean = InferableBoolean;

    public static readonly PRINT_CONFIGURATION_ON_START_PROP_NAME: string = 'aeron.print.configuration';

    /**
     * Property name for driver timeout after which the driver is considered inactive.
     */
    public static readonly DRIVER_TIMEOUT_PROP_NAME: string = 'aeron.driver.timeout';

    /**
     * Property name for the timeout to use in debug mode. By default, this is not set and the configured
     * timeouts will be used. Setting this value adjusts timeouts to make debugging easier.
     */
    public static readonly DEBUG_TIMEOUT_PROP_NAME: string = 'aeron.debug.timeout';

    /**
     * Default timeout in which the driver is expected to respond or heartbeat.
     */
    public static readonly DEFAULT_DRIVER_TIMEOUT_MS: number = 10_000;

    /**
     * Value to represent a sessionId that is not to be used.
     */
    public static readonly NULL_SESSION_ID: number = Aeron.NULL_VALUE;

    /**
     * The top level Aeron directory used for communication between a Media Driver and client.
     */
    public static readonly AERON_DIR_PROP_NAME: string = 'aeron.dir';

    /**
     * Should new/experimental features be enabled.
     *
     * @since 1.44.0
     */
    public static readonly ENABLE_EXPERIMENTAL_FEATURES_PROP_NAME: string = 'aeron.enable.experimental.features';

    /**
     * Property name for a fallback PrintStream based logger when it is not possible to use the error logging
     * callback. Supported values are stdout, stderr, no_op (stderr is the default).
     */
    public static readonly FALLBACK_LOGGER_PROP_NAME: string = 'aeron.fallback.logger';

    /**
     * Configuration property for the driver event settings.
     */
    public static readonly EVENT_LOG: string = 'aeron.event.log';

    /**
     * Configuration property for the agnet class used for logging.
     */
    public static readonly EVENT_LOG_READER_CLASSNAME_PROP_NAME: string = 'aeron.event.log.reader.classname';

    /**
     * Default logging agent.
     */
    public static readonly EVENT_LOG_READER_CLASSNAME_DEFAULT: string = 'io.aeron.logging.CborLoggerReaderAgent';

    /**
     * Configuration property for the archive event settings.
     */
    public static readonly ARCHIVE_EVENT_LOG: string = 'aeron.event.archive.log';

    /**
     * Configuration property for the cluster event settings.
     */
    public static readonly CLUSTER_EVENT_LOG: string = 'aeron.event.cluster.log';

    /**
     * Media type used for IPC shared memory from Publication to Subscription channels.
     */
    public static readonly IPC_MEDIA: string = 'ipc';

    /**
     * Media type used for UDP sockets from Publication to Subscription channels.
     */
    public static readonly UDP_MEDIA: string = 'udp';

    /**
     * URI base used for IPC channels for Publications and Subscriptions.
     */
    public static readonly IPC_CHANNEL: string = 'aeron:ipc';

    /**
     * URI base used for UDP channels for Publications and Subscriptions.
     */
    public static readonly UDP_CHANNEL: string = 'aeron:udp';

    /**
     * URI used for Spy Subscriptions whereby an outgoing unicast or multicast publication can be spied on
     * by IPC without receiving it again via the network.
     */
    public static readonly SPY_PREFIX: string = 'aeron-spy:';

    /**
     * The address and port used for a UDP channel. For the publisher it is the socket to send to,
     * for the subscriber it is the socket to receive from.
     */
    public static readonly ENDPOINT_PARAM_NAME: string = 'endpoint';

    /**
     * The network interface via which the socket will be routed.
     */
    public static readonly INTERFACE_PARAM_NAME: string = 'interface';

    /**
     * Initial term id to be used when creating an ExclusivePublication.
     */
    public static readonly INITIAL_TERM_ID_PARAM_NAME: string = 'init-term-id';

    /**
     * Current term id to be used when creating an ExclusivePublication.
     */
    public static readonly TERM_ID_PARAM_NAME: string = 'term-id';

    /**
     * Current term offset to be used when creating an ExclusivePublication.
     */
    public static readonly TERM_OFFSET_PARAM_NAME: string = 'term-offset';

    /**
     * The param name to be used for the term length as a channel URI param.
     */
    public static readonly TERM_LENGTH_PARAM_NAME: string = 'term-length';

    /**
     * MTU length parameter name for using as a channel URI param. If this is greater than the network MTU for UDP
     * then the packet will be fragmented and can amplify the impact of loss.
     */
    public static readonly MTU_LENGTH_PARAM_NAME: string = 'mtu';

    /**
     * Time To Live param for a multicast datagram.
     */
    public static readonly TTL_PARAM_NAME: string = 'ttl';

    /**
     * The param for the control channel IP address and port for multi-destination-cast semantics.
     */
    public static readonly MDC_CONTROL_PARAM_NAME: string = 'control';

    /**
     * Key for the mode of control that such be used for multi-destination-cast semantics.
     */
    public static readonly MDC_CONTROL_MODE_PARAM_NAME: string = 'control-mode';

    /**
     * Valid value for MDC_CONTROL_MODE_PARAM_NAME when manual control is desired.
     */
    public static readonly MDC_CONTROL_MODE_MANUAL: string = 'manual';

    /**
     * Valid value for MDC_CONTROL_MODE_PARAM_NAME when dynamic control is desired. Default value.
     */
    public static readonly MDC_CONTROL_MODE_DYNAMIC: string = 'dynamic';

    /**
     * Valid value for MDC_CONTROL_MODE_PARAM_NAME when response control is desired.
     */
    public static readonly CONTROL_MODE_RESPONSE: string = 'response';

    /**
     * Key for the session id for a publication or restricted subscription.
     */
    public static readonly SESSION_ID_PARAM_NAME: string = 'session-id';

    /**
     * Key for timeout a publication to linger after draining in nanoseconds.
     */
    public static readonly LINGER_PARAM_NAME: string = 'linger';

    /**
     * Parameter name for channel URI param to indicate if a subscribed stream must be reliable or not.
     * Value is boolean with true to recover loss and false to gap fill.
     */
    public static readonly RELIABLE_STREAM_PARAM_NAME: string = 'reliable';

    /**
     * Key for the tags for a channel.
     */
    public static readonly TAGS_PARAM_NAME: string = 'tags';

    /**
     * Qualifier for a value which is a tag for reference. This prefix is use in the param value.
     */
    public static readonly TAG_PREFIX: string = 'tag:';

    /**
     * Parameter name for channel URI param to indicate if term buffers should be sparse. Value is boolean.
     */
    public static readonly SPARSE_PARAM_NAME: string = 'sparse';

    /**
     * Parameter name for channel URI param to indicate an alias for the given URI. Value not interpreted by Aeron.
     * <p>
     * This is a reserved application level param used to identify a particular channel for application purposes.
     */
    public static readonly ALIAS_PARAM_NAME: string = 'alias';

    /**
     * Parameter name for channel URI param to indicate if End of Stream (EOS) should be sent or not. Value is boolean.
     */
    public static readonly EOS_PARAM_NAME: string = 'eos';

    /**
     * Parameter name for channel URI param to indicate if a subscription should tether for local flow control.
     * Value is boolean. A tether only applies when there is more than one matching active subscription. If tether is
     * true then that subscription is included in flow control. If only one subscription then it tethers pace.
     */
    public static readonly TETHER_PARAM_NAME: string = 'tether';

    /**
     * Parameter name for channel URI param to indicate if a Subscription represents a group member or individual
     * from the perspective of message reception. This can inform loss handling and similar semantics.
     * <p>
     * When configuring a subscription for an MDC publication then should be added as this is effective multicast.
     *
     * @see MDC_CONTROL_MODE_PARAM_NAME
     * @see MDC_CONTROL_PARAM_NAME
     */
    public static readonly GROUP_PARAM_NAME: string = 'group';

    /**
     * Parameter name for Subscription URI param to indicate if Images that go unavailable should be allowed to
     * rejoin after a short cooldown or not.
     */
    public static readonly REJOIN_PARAM_NAME: string = 'rejoin';

    /**
     * Parameter name for Subscription URI param to indicate the congestion control algorithm to be used.
     * Options include `static` and `cubic`.
     */
    public static readonly CONGESTION_CONTROL_PARAM_NAME: string = 'cc';

    /**
     * Parameter name for Publication URI param to indicate the flow control strategy to be used.
     * Options include `min`, `max`, and `pref`.
     */
    public static readonly FLOW_CONTROL_PARAM_NAME: string = 'fc';

    /**
     * Parameter name for Subscription URI param to indicate the receiver tag to be sent in SMs.
     */
    public static readonly GROUP_TAG_PARAM_NAME: string = 'gtag';

    /**
     * Parameter name for Publication URI param to indicate whether spy subscriptions should simulate a connection.
     */
    public static readonly SPIES_SIMULATE_CONNECTION_PARAM_NAME: string = 'ssc';

    /**
     * Parameter name for the underlying OS socket send buffer length.
     */
    public static readonly SOCKET_SNDBUF_PARAM_NAME: string = 'so-sndbuf';

    /**
     * Parameter name for the underlying OS socket receive buffer length.
     */
    public static readonly SOCKET_RCVBUF_PARAM_NAME: string = 'so-rcvbuf';

    /**
     * Parameter name for the congestion control's initial receiver window length.
     */
    public static readonly RECEIVER_WINDOW_LENGTH_PARAM_NAME: string = 'rcv-wnd';

    /**
     * Parameter name of the offset for the media receive timestamp to be inserted into the incoming message on a
     * subscription. The special value of 'reserved' can be used to insert into the reserved value field. Media
     * receive timestamp is taken as the earliest possible point after the packet is received from the network. This
     * is only supported in the C media driver, the Java Media Driver will generate an error if used.
     */
    public static readonly MEDIA_RCV_TIMESTAMP_OFFSET_PARAM_NAME: string = 'media-rcv-ts-offset';

    /**
     * Parameter name of the offset for the channel receive timestamp to be inserted into the incoming message on a
     * subscription. The special value of 'reserved' can be used to insert into the reserved value field. Channel
     * receive timestamp is taken as soon a possible after the packet is received by Aeron receiver from the transport
     * bindings.
     */
    public static readonly CHANNEL_RECEIVE_TIMESTAMP_OFFSET_PARAM_NAME: string = 'channel-rcv-ts-offset';

    /**
     * Parameter name of the offset for the channel send timestamp to be inserted into the outgoing message
     * on a publication. The special value of 'reserved' can be used to insert into the reserved value
     * field. Channel send timestamp is taken shortly before passing the message over to the configured transport
     * bindings.
     */
    public static readonly CHANNEL_SEND_TIMESTAMP_OFFSET_PARAM_NAME: string = 'channel-snd-ts-offset';

    /**
     * Placeholder value to use in URIs to specify that a timestamp should be stored in the reserved value field.
     */
    public static readonly RESERVED_OFFSET: string = 'reserved';

    /**
     * Parameter name for the field that will be used to specify the response endpoint on a subscription and publication
     * used in a response "server".
     *
     * @since 1.44.0
     */
    public static readonly RESPONSE_ENDPOINT_PARAM_NAME: string = 'response-endpoint';

    /**
     * Parameter name for the field that will be used to specify the correlation id used on a publication to connect it
     * to a subscription's image in order to set up a response stream.
     *
     * @since 1.44.0
     */
    public static readonly RESPONSE_CORRELATION_ID_PARAM_NAME: string = 'response-correlation-id';

    /**
     * Placeholder value to use in response channels where the publication is to be pre-created to reserve and hold
     * onto the local port.
     */
    public static readonly PROTOTYPE_CORRELATION_ID: string = 'prototype';

    /**
     * Parameter name to set explicit NAK delay (e.g. `nak-delay=200ms`).
     *
     * @since 1.44.0
     */
    public static readonly NAK_DELAY_PARAM_NAME: string = 'nak-delay';

    /**
     * Parameter name to set explicit untethered window limit timeout, e.g. `untethered-window-limit-timeout=10s`.
     *
     * @since 1.45.0
     */
    public static readonly UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME: string = 'untethered-window-limit-timeout';

    /**
     * Parameter name to set explicit untethered linger timeout, e.g. `untethered-linger-timeout=10s`.
     *
     * @since 1.48.0
     */
    public static readonly UNTETHERED_LINGER_TIMEOUT_PARAM_NAME: string = 'untethered-linger-timeout';

    /**
     * Parameter name to set explicit untethered resting timeout, e.g. `untethered-resting-timeout=10s`.
     *
     * @since 1.45.0
     */
    public static readonly UNTETHERED_RESTING_TIMEOUT_PARAM_NAME: string = 'untethered-resting-timeout';

    /**
     * Parameter name to set the max number of outstanding active retransmits for a publication.
     *
     * @since 1.45.0
     */
    public static readonly MAX_RESEND_PARAM_NAME: string = 'max-resend';

    /**
     * Parameter name to set the stream id for the channel.
     *
     * @since 1.47.0
     */
    public static readonly STREAM_ID_PARAM_NAME: string = 'stream-id';

    /**
     * Parameter name for the publication window length, i.e. how far ahead can publication accept offers.
     *
     * @since 1.47.0
     */
    public static readonly PUBLICATION_WINDOW_LENGTH_PARAM_NAME: string = 'pub-wnd';

    /**
     * Property name to use to set the secure random algorithm to be used by the Aeron component.
     */
    public static readonly SECURE_RANDOM_ALGORITHM_PROP_NAME: string = 'aeron.secure.random.algorithm';

    /**
     * Property name to use to set the thread naming mode. Defaults to THREAD_NAMING_DEFAULT.
     */
    public static readonly THREAD_NAMING_PROP_NAME: string = 'aeron.thread.naming';

    /**
     * Value of THREAD_NAMING_PROP_NAME that preserves legacy thread names.
     */
    public static readonly THREAD_NAMING_CLASSIC: string = 'classic';

    /**
     * Value of THREAD_NAMING_PROP_NAME that uses new prefixed names.
     */
    public static readonly THREAD_NAMING_NEW: string = 'new';

    /**
     * Default value of THREAD_NAMING_PROP_NAME.
     */
    public static readonly THREAD_NAMING_DEFAULT: string = CommonContext.THREAD_NAMING_CLASSIC;

    /**
     * Event Buffer length system property name. If not set then output will default to {@link System#out}.
     */
    public static readonly EVENT_LOG_FILENAME_PROP_NAME: string = 'aeron.event.log.filename';

    /**
     * Event Buffer log file max length system property. If not set then {@link Long#MAX_VALUE} will be used.
     */
    public static readonly EVENT_LOG_FILE_MAX_LENGTH: string = 'aeron.event.log.file.max.length';

    /**
     * System property to toggle whether BinaryRenderer implementations render the remaining bytes
     * of fields that are not part of the header information.
     */
    public static readonly EVENT_LOG_RENDER_DATA_PROP_NAME: string = 'aeron.event.log.render.data';
}

type InferableBooleanType = InferableBoolean;

// Declaration merging: `CommonContext.InferableBoolean` is a type as well as a value, as the nested Java enum is.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CommonContext {
    export type InferableBoolean = InferableBooleanType;
}
