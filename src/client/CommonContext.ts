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
import { CloseHelper } from '../agrona/CloseHelper.js';
import type { ErrorHandler } from '../agrona/ErrorHandler.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import { LoggingErrorHandler } from '../agrona/concurrent/errors/LoggingErrorHandler.js';
import type { DistinctErrorLog } from '../agrona/concurrent/errors/DistinctErrorLog.js';
import { Boolean, Long, NumberFormatException, TimeUnit } from '../agrona/jdk.js';
import { System, type AutoCloseable } from '../agrona/jdkLang.js';
import { SystemErr, SystemOut, type PrintStream } from '../agrona/jdkThrowable.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { Aeron } from './Aeron.js';
import { ConcurrentConcludeException } from './exceptions/ConcurrentConcludeException.js';

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
 * The static constants, and the instance members that `MediaDriver.Context` needs (T7b: `conclude`, `close`, `clone`,
 * `driverTimeoutMs`, the counters buffers, `enableExperimentalFeatures`, `checkDebugTimeout` and the error handler
 * set-up) are ported so far (see `docs/mapping.md`, "Not ported"); the task that ports `Aeron.Context` adds the rest,
 * in Java order. The fluent setters return `this`, which is the covariant override of Java's subclasses.
 */
export class CommonContext implements AutoCloseable {
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
     * Timeout in which the driver is expected to respond or heartbeat, from the {@link DRIVER_TIMEOUT_PROP_NAME}
     * system property (`Long.getLong`) or {@link DEFAULT_DRIVER_TIMEOUT_MS}.
     */
    public static readonly DRIVER_TIMEOUT_MS: number = Long.getLong(
        CommonContext.DRIVER_TIMEOUT_PROP_NAME,
        CommonContext.DEFAULT_DRIVER_TIMEOUT_MS,
    );

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

    /**
     * Should the configuration be printed on start?
     *
     * @return true if the {@link PRINT_CONFIGURATION_ON_START_PROP_NAME} system property is "true".
     */
    public static shouldPrintConfigurationOnStart(): boolean {
        return 'true' === System.getProperty(CommonContext.PRINT_CONFIGURATION_ON_START_PROP_NAME);
    }

    /**
     * The logger for errors that cannot be recorded in the error log, from the {@link FALLBACK_LOGGER_PROP_NAME}
     * system property: "stdout", "no_op", or (the default) "stderr".
     *
     * @return the fallback logger.
     */
    public static fallbackLogger(): PrintStream {
        const fallbackLoggerName = System.getProperty(CommonContext.FALLBACK_LOGGER_PROP_NAME, 'stderr');
        switch (fallbackLoggerName) {
            case 'stdout':
                return SystemOut;
            case 'no_op':
                return NO_OP_LOGGER;
            default:
                return SystemErr;
        }
    }

    private _isConcluded = false;
    private _driverTimeoutMs: number = CommonContext.DRIVER_TIMEOUT_MS;
    private _countersMetaDataBuffer: UnsafeBuffer | null = null;
    private _countersValuesBuffer: UnsafeBuffer | null = null;
    private _enableExperimentalFeatures: boolean = Boolean.getBoolean(
        CommonContext.ENABLE_EXPERIMENTAL_FEATURES_PROP_NAME,
    );

    /**
     * Perform a shallow copy of the object.
     *
     * @return a shallow copy of the object.
     */
    public clone(): this {
        return Object.assign(Object.create(Object.getPrototypeOf(this) as object) as this, this);
    }

    /**
     * This method is used to conclude the context, so it cannot be changed after. Calling it twice throws a
     * {@link ConcurrentConcludeException}.
     * <p>
     * The Aeron directory and the CnC file it resolves are not ported (spec D4: the CnC is a `SharedArrayBuffer`).
     *
     * @return this for a fluent API.
     */
    public conclude(): this {
        if (this._isConcluded) {
            throw new ConcurrentConcludeException();
        }
        this._isConcluded = true;

        return this;
    }

    /**
     * Has the context had the {@link conclude} method called.
     *
     * @return true of the {@link conclude} method has been called.
     */
    public isConcluded(): boolean {
        return this._isConcluded;
    }

    /**
     * The buffer in which the counters' metadata are kept.
     *
     * @return The buffer wrapping the metadata, or null if it has not been set.
     */
    public countersMetaDataBuffer(): UnsafeBuffer | null;
    /**
     * Set the buffer in which the counters' metadata are kept.
     *
     * @param countersMetaDataBuffer The new counters metadata buffer.
     * @return this for a fluent API.
     */
    public countersMetaDataBuffer(countersMetaDataBuffer: UnsafeBuffer | null): this;
    public countersMetaDataBuffer(countersMetaDataBuffer?: UnsafeBuffer | null): UnsafeBuffer | null | this {
        if (undefined === countersMetaDataBuffer) {
            return this._countersMetaDataBuffer;
        }

        this._countersMetaDataBuffer = countersMetaDataBuffer;
        return this;
    }

    /**
     * The buffer in which the counters' values are kept.
     *
     * @return The buffer wrapping the values, or null if it has not been set.
     */
    public countersValuesBuffer(): UnsafeBuffer | null;
    /**
     * Set the buffer in which the counters' values are kept.
     *
     * @param countersValuesBuffer The new counters values buffer.
     * @return this for a fluent API.
     */
    public countersValuesBuffer(countersValuesBuffer: UnsafeBuffer | null): this;
    public countersValuesBuffer(countersValuesBuffer?: UnsafeBuffer | null): UnsafeBuffer | null | this {
        if (undefined === countersValuesBuffer) {
            return this._countersValuesBuffer;
        }

        this._countersValuesBuffer = countersValuesBuffer;
        return this;
    }

    /**
     * Set the amount of time, in milliseconds, that this process will wait to determine if a driver is alive.
     *
     * @param driverTimeoutMs Number of milliseconds.
     * @return this for a fluent API.
     */
    public driverTimeoutMs(driverTimeoutMs: number): this;
    /**
     * Get the amount of time, in milliseconds, that this process will wait to determine if a driver is alive, as
     * adjusted by {@link checkDebugTimeout}.
     *
     * @return the timeout in milliseconds.
     */
    public driverTimeoutMs(): number;
    public driverTimeoutMs(driverTimeoutMs?: number): number | this {
        if (undefined === driverTimeoutMs) {
            return CommonContext.checkDebugTimeout(this._driverTimeoutMs, TimeUnit.MILLISECONDS);
        }

        this._driverTimeoutMs = driverTimeoutMs;
        return this;
    }

    /**
     * Are experimental features enabled?
     *
     * @return true if experimental features are enabled.
     */
    public enableExperimentalFeatures(): boolean;
    /**
     * Set whether experimental features are enabled.
     *
     * @param enableExperimentalFeatures true to enable them.
     * @return this for a fluent API.
     */
    public enableExperimentalFeatures(enableExperimentalFeatures: boolean): this;
    public enableExperimentalFeatures(enableExperimentalFeatures?: boolean): boolean | this {
        if (undefined === enableExperimentalFeatures) {
            return this._enableExperimentalFeatures;
        }

        this._enableExperimentalFeatures = enableExperimentalFeatures;
        return this;
    }

    /**
     * Get the value of a timeout, replaced by the {@link DEBUG_TIMEOUT_PROP_NAME} duration (times `factor`) if that
     * system property is set and a debugger is attached ({@link SystemUtil.isDebuggerAttached}).
     * <p>
     * Java prints a "Using debug timeout" message the first time each calling method is replaced; this port does not
     * (a JS stack has no stable method name to key it by).
     *
     * @param timeout  the timeout value to use unless a debug timeout is in effect.
     * @param timeUnit of the `timeout` and of the result.
     * @param factor   to scale the debug timeout, 1.0 by default.
     * @return the timeout value to use.
     */
    public static checkDebugTimeout(timeout: number, timeUnit: TimeUnit, factor = 1.0): number {
        const debugTimeoutString = System.getProperty(CommonContext.DEBUG_TIMEOUT_PROP_NAME);
        if (null === debugTimeoutString || !SystemUtil.isDebuggerAttached()) {
            return timeout;
        }

        try {
            const debugTimeoutNs = Math.min(
                Long.MAX_VALUE,
                Math.trunc(
                    factor * SystemUtil.parseDuration(CommonContext.DEBUG_TIMEOUT_PROP_NAME, debugTimeoutString),
                ),
            );

            return timeUnit.convert(debugTimeoutNs, TimeUnit.NANOSECONDS);
        } catch (ex) {
            if (ex instanceof NumberFormatException) {
                return timeout;
            }
            throw ex;
        }
    }

    /**
     * Close the context: nothing to release here, the subclasses override it.
     */
    public close(): void {}

    /**
     * Set up the error handler: a {@link LoggingErrorHandler} that records in the error log and overflows to the
     * fallback stream, which also calls the user's error handler if there is one.
     *
     * @param userErrorHandler  the handler of the application, or null.
     * @param errorLog          to record the errors in.
     * @param fallbackErrorStream for errors the log cannot hold; the {@link fallbackLogger} by default.
     * @return the error handler to use.
     */
    public static setupErrorHandler(
        userErrorHandler: ErrorHandler | null,
        errorLog: DistinctErrorLog,
        fallbackErrorStream: PrintStream = CommonContext.fallbackLogger(),
    ): ErrorHandler {
        const loggingErrorHandler = new LoggingErrorHandler(errorLog, fallbackErrorStream);
        if (null === userErrorHandler) {
            return loggingErrorHandler;
        } else {
            return new ErrorHandlerWrapper(loggingErrorHandler, userErrorHandler);
        }
    }
}

/**
 * `CommonContext.NO_OP_LOGGER`: a stream that drops every line.
 */
const NO_OP_LOGGER: PrintStream = {
    println(_line: string): void {},
};

/**
 * `CommonContext.ErrorHandlerWrapper`: records in the error log, then calls the user's handler.
 */
class ErrorHandlerWrapper implements ErrorHandler, AutoCloseable {
    private readonly loggingErrorHandler: LoggingErrorHandler;
    private readonly userErrorHandler: ErrorHandler;

    public constructor(loggingErrorHandler: LoggingErrorHandler, userErrorHandler: ErrorHandler) {
        this.loggingErrorHandler = loggingErrorHandler;
        this.userErrorHandler = userErrorHandler;
    }

    public close(): void {
        this.loggingErrorHandler.close();
        if (isAutoCloseable(this.userErrorHandler)) {
            CloseHelper.quietClose(this.userErrorHandler);
        }
    }

    public onError(throwable: Error): void {
        this.loggingErrorHandler.onError(throwable);
        this.userErrorHandler.onError(throwable);
    }
}

function isAutoCloseable(value: unknown): value is AutoCloseable {
    return typeof (value as AutoCloseable | null)?.close === 'function';
}

type InferableBooleanType = InferableBoolean;

// Declaration merging: `CommonContext.InferableBoolean` is a type as well as a value, as the nested Java enum is.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CommonContext {
    export type InferableBoolean = InferableBooleanType;
}
