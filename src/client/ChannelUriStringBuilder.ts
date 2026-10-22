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
// Port of io/aeron/ChannelUriStringBuilder.java @ 1.53.3
import { IllegalArgumentException, Integer, Long, NumberFormatException, longToNumber } from '../agrona/jdk.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { ChannelUri } from './ChannelUri.js';
import {
    FRAME_ALIGNMENT,
    TERM_MAX_LENGTH,
    checkTermLength,
    computeTermIdFromPosition,
    positionBitsToShift,
} from './ChannelUriLogBuffer.js';
import { CommonContext } from './CommonContext.js';

const {
    ALIAS_PARAM_NAME,
    CHANNEL_RECEIVE_TIMESTAMP_OFFSET_PARAM_NAME,
    CHANNEL_SEND_TIMESTAMP_OFFSET_PARAM_NAME,
    CONGESTION_CONTROL_PARAM_NAME,
    CONTROL_MODE_RESPONSE,
    ENDPOINT_PARAM_NAME,
    EOS_PARAM_NAME,
    FLOW_CONTROL_PARAM_NAME,
    GROUP_PARAM_NAME,
    GROUP_TAG_PARAM_NAME,
    INITIAL_TERM_ID_PARAM_NAME,
    INTERFACE_PARAM_NAME,
    LINGER_PARAM_NAME,
    MAX_RESEND_PARAM_NAME,
    MDC_CONTROL_MODE_DYNAMIC,
    MDC_CONTROL_MODE_MANUAL,
    MDC_CONTROL_MODE_PARAM_NAME,
    MDC_CONTROL_PARAM_NAME,
    MEDIA_RCV_TIMESTAMP_OFFSET_PARAM_NAME,
    MTU_LENGTH_PARAM_NAME,
    NAK_DELAY_PARAM_NAME,
    PROTOTYPE_CORRELATION_ID,
    PUBLICATION_WINDOW_LENGTH_PARAM_NAME,
    RECEIVER_WINDOW_LENGTH_PARAM_NAME,
    REJOIN_PARAM_NAME,
    RELIABLE_STREAM_PARAM_NAME,
    RESERVED_OFFSET,
    RESPONSE_CORRELATION_ID_PARAM_NAME,
    RESPONSE_ENDPOINT_PARAM_NAME,
    SESSION_ID_PARAM_NAME,
    SOCKET_RCVBUF_PARAM_NAME,
    SOCKET_SNDBUF_PARAM_NAME,
    SPARSE_PARAM_NAME,
    SPIES_SIMULATE_CONNECTION_PARAM_NAME,
    STREAM_ID_PARAM_NAME,
    TAGS_PARAM_NAME,
    TERM_ID_PARAM_NAME,
    TERM_LENGTH_PARAM_NAME,
    TERM_OFFSET_PARAM_NAME,
    TETHER_PARAM_NAME,
    TTL_PARAM_NAME,
    UNTETHERED_LINGER_TIMEOUT_PARAM_NAME,
    UNTETHERED_RESTING_TIMEOUT_PARAM_NAME,
    UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME,
} = CommonContext;

const SPY_QUALIFIER = ChannelUri.SPY_QUALIFIER;

/**
 * `Boolean.valueOf(String)`: true only for "true" in any case.
 */
function booleanValueOf(value: string): boolean {
    return value.toLowerCase() === 'true';
}

/**
 * `Long.parseLong(String)` as a `bigint`, so that the whole 64-bit range is checked: decimal ASCII digits with an
 * optional sign, within the range of a Java `long`.
 */
function parseLong(s: string): bigint {
    if (!/^[+-]?[0-9]+$/.test(s)) {
        throw new NumberFormatException('For input string: "' + s + '"');
    }

    const result = BigInt(s);
    if (result < -(2n ** 63n) || result > 2n ** 63n - 1n) {
        throw new NumberFormatException('For input string: "' + s + '"');
    }

    return result;
}

/**
 * Typesafe means of building a channel URI associated with a {@link Publication} or {@link Subscription}.
 * <p>
 * A Java `Integer` or `Long` that can be null is a `number | null` (a `long` is exact to +/-(2^53 - 1), spec D5), a
 * `Boolean` is a `boolean | null`. A getter and the setters of the same name are one method: called with no argument
 * it is the getter, with `null` it sets null.
 *
 * @see Aeron#addPublication(String, int)
 * @see Aeron#addSubscription(String, int)
 * @see ChannelUri
 */
export class ChannelUriStringBuilder {
    /**
     * Can be used when the likes of session-id wants to reference another entity such as a tagged publication.
     * <p>
     * For example {@code session-id=tag:777} where the publication uses {@code tags=777}.
     */
    public static readonly TAG_PREFIX: string = 'tag:';

    private _prefix: string | null = null;
    private _media: string | null = null;
    private _endpoint: string | null = null;
    private _networkInterface: string | null = null;
    private _controlEndpoint: string | null = null;
    private _controlMode: string | null = null;
    private _tags: string | null = null;
    private _alias: string | null = null;
    private _cc: string | null = null;
    private _fc: string | null = null;
    private _mediaReceiveTimestampOffset: string | null = null;
    private _channelReceiveTimestampOffset: string | null = null;
    private _channelSendTimestampOffset: string | null = null;
    private _responseCorrelationId: string | null = null;
    private _responseEndpoint: string | null = null;
    private _reliable: boolean | null = null;
    private _sparse: boolean | null = null;
    private _eos: boolean | null = null;
    private _tether: boolean | null = null;
    private _group: boolean | null = null;
    private _rejoin: boolean | null = null;
    private _ssc: boolean | null = null;
    private _ttl: number | null = null;
    private _mtu: number | null = null;
    private _termLength: number | null = null;
    private _initialTermId: number | null = null;
    private _termId: number | null = null;
    private _termOffset: number | null = null;
    private _socketSndbufLength: number | null = null;
    private _socketRcvbufLength: number | null = null;
    private _receiverWindowLength: number | null = null;
    private _maxResend: number | null = null;
    private _streamId: number | null = null;
    private _publicationWindowLength: number | null = null;
    private _sessionId: number | null = null;
    private _groupTag: number | null = null;
    private _linger: number | null = null;
    private _nakDelay: number | null = null;
    private _untetheredWindowLimitTimeoutNs: number | null = null;
    private _untetheredLingerTimeoutNs: number | null = null;
    private _untetheredRestingTimeoutNs: number | null = null;
    private _isSessionIdTagged = false;

    /**
     * Default constructor for the builder, or construct it from an existing URI or channel URI.
     *
     * @param initial URI, or channel URI, to take the initial values from.
     */
    public constructor(initial?: string | ChannelUri) {
        if (undefined === initial) {
            return;
        }

        const channelUri = typeof initial === 'string' ? ChannelUri.parse(initial) : initial;

        this._isSessionIdTagged = false;

        this.prefix(channelUri);
        this.media(channelUri);
        this.endpoint(channelUri);
        this.networkInterface(channelUri);
        this.controlEndpoint(channelUri);
        this.controlMode(channelUri);
        this.tags(channelUri);
        this.alias(channelUri);
        this.congestionControl(channelUri);
        this.flowControl(channelUri);
        this.reliable(channelUri);
        this.ttl(channelUri);
        this.mtu(channelUri);
        this.termLength(channelUri);
        this.initialTermId(channelUri);
        this.termId(channelUri);
        this.termOffset(channelUri);
        this.sessionId(channelUri);
        this.group(channelUri);
        this.linger(channelUri);
        this.sparse(channelUri);
        this.eos(channelUri);
        this.tether(channelUri);
        this.groupTag(channelUri);
        this.rejoin(channelUri);
        this.spiesSimulateConnection(channelUri);
        this.socketRcvbufLength(channelUri);
        this.socketSndbufLength(channelUri);
        this.receiverWindowLength(channelUri);
        this.mediaReceiveTimestampOffset(channelUri);
        this.channelReceiveTimestampOffset(channelUri);
        this.channelSendTimestampOffset(channelUri);
        this.responseEndpoint(channelUri);
        this.responseCorrelationId(channelUri);
        this.nakDelay(channelUri);
        this.untetheredWindowLimitTimeout(channelUri);
        this.untetheredLingerTimeout(channelUri);
        this.untetheredRestingTimeout(channelUri);
        this.maxResend(channelUri);
        this.streamId(channelUri);
        this.publicationWindowLength(channelUri);
    }

    /**
     * Clear out all the values thus resetting the builder.
     *
     * @return this for a fluent API.
     */
    public clear(): this {
        this._prefix = null;
        this._media = null;
        this._endpoint = null;
        this._networkInterface = null;
        this._controlEndpoint = null;
        this._controlMode = null;
        this._tags = null;
        this._alias = null;
        this._cc = null;
        this._fc = null;
        this._reliable = null;
        this._ttl = null;
        this._mtu = null;
        this._termLength = null;
        this._initialTermId = null;
        this._termId = null;
        this._termOffset = null;
        this._sessionId = null;
        this._groupTag = null;
        this._linger = null;
        this._sparse = null;
        this._eos = null;
        this._tether = null;
        this._group = null;
        this._rejoin = null;
        this._isSessionIdTagged = false;
        this._socketRcvbufLength = null;
        this._socketSndbufLength = null;
        this._receiverWindowLength = null;
        this._mediaReceiveTimestampOffset = null;
        this._channelReceiveTimestampOffset = null;
        this._channelSendTimestampOffset = null;
        this._responseEndpoint = null;
        this._responseCorrelationId = null;
        this._maxResend = null;
        this._streamId = null;
        this._publicationWindowLength = null;

        return this;
    }

    /**
     * Validates that the collection of parameters are valid together.
     *
     * @return this for a fluent API.
     * @throws IllegalArgumentException if the combination of parameters is not valid.
     */
    public validate(): this {
        if (null === this._media) {
            throw new IllegalArgumentException('media type is mandatory');
        }

        if (CommonContext.UDP_MEDIA === this._media && null === this._endpoint && null === this._controlEndpoint) {
            throw new IllegalArgumentException("either 'endpoint' or 'control' must be specified for UDP.");
        }

        const anyNonNull = null !== this._initialTermId || null !== this._termId || null !== this._termOffset;
        const anyNull = null === this._initialTermId || null === this._termId || null === this._termOffset;

        if (anyNonNull) {
            if (anyNull) {
                throw new IllegalArgumentException(
                    "either all or none of the parameters ['initialTermId', 'termId', 'termOffset'] must be provided",
                );
            }

            // int subtraction: wraps like Java
            if (((this._termId! - this._initialTermId!) | 0) < 0) {
                throw new IllegalArgumentException(
                    'difference greater than 2^31 - 1: termId=' +
                        this._termId! +
                        ' - initialTermId=' +
                        this._initialTermId!,
                );
            }

            if (null !== this._termLength && this._termOffset! > this._termLength) {
                throw new IllegalArgumentException(
                    'termOffset=' + this._termOffset! + ' > termLength=' + this._termLength,
                );
            }
        }

        return this;
    }

    /**
     * Set the prefix for taking an addition action such as spying on an outgoing publication, or copy it from a
     * channel URI, or get it.
     *
     * @param prefix to be applied to the URI before the {@link #SCHEME}.
     * @return this for a fluent API.
     */
    public prefix(): string | null;
    public prefix(prefix: string | null): this;
    public prefix(channelUri: ChannelUri): this;
    public prefix(prefix?: string | null | ChannelUri): string | null | this {
        if (undefined === prefix) {
            return this._prefix;
        }

        if (prefix instanceof ChannelUri) {
            return this.prefix(prefix.prefix());
        }

        if (null !== prefix && prefix.length !== 0 && prefix !== SPY_QUALIFIER) {
            throw new IllegalArgumentException('invalid prefix: ' + prefix);
        }

        this._prefix = prefix;
        return this;
    }

    /**
     * Set the media for a channel. This must be either {@link CommonContext#UDP_MEDIA} or
     * {@link CommonContext#IPC_MEDIA}. Or copy it from a channel URI, or get it.
     *
     * @param media for the channel.
     * @return this for a fluent API.
     * @throws IllegalArgumentException if media is not a valid value.
     */
    public media(): string | null;
    public media(media: string): this;
    public media(channelUri: ChannelUri): this;
    public media(media?: string | ChannelUri): string | null | this {
        if (undefined === media) {
            return this._media;
        }

        if (media instanceof ChannelUri) {
            return this.media(media.media());
        }

        switch (media) {
            case CommonContext.UDP_MEDIA:
            case CommonContext.IPC_MEDIA:
                break;

            default:
                throw new IllegalArgumentException('invalid media: ' + media);
        }

        this._media = media;
        return this;
    }

    /**
     * Set the endpoint address:port pairing for the channel, or copy it from a channel URI, or get it.
     *
     * @param endpoint address and port for the channel.
     * @return this for a fluent API.
     */
    public endpoint(): string | null;
    public endpoint(endpoint: string | null): this;
    public endpoint(channelUri: ChannelUri): this;
    public endpoint(endpoint?: string | null | ChannelUri): string | null | this {
        if (undefined === endpoint) {
            return this._endpoint;
        }

        if (endpoint instanceof ChannelUri) {
            return this.endpoint(endpoint.get(ENDPOINT_PARAM_NAME));
        }

        this._endpoint = endpoint;
        return this;
    }

    /**
     * Set the address of the local interface used for the channel, or copy it from a channel URI, or get it.
     *
     * @param networkInterface for the channel.
     * @return this for a fluent API.
     */
    public networkInterface(): string | null;
    public networkInterface(networkInterface: string | null): this;
    public networkInterface(channelUri: ChannelUri): this;
    public networkInterface(networkInterface?: string | null | ChannelUri): string | null | this {
        if (undefined === networkInterface) {
            return this._networkInterface;
        }

        if (networkInterface instanceof ChannelUri) {
            return this.networkInterface(networkInterface.get(INTERFACE_PARAM_NAME));
        }

        this._networkInterface = networkInterface;
        return this;
    }

    /**
     * Set the control address:port pairing for the channel, or copy it from a channel URI, or get it.
     *
     * @param controlEndpoint for the channel.
     * @return this for a fluent API.
     */
    public controlEndpoint(): string | null;
    public controlEndpoint(controlEndpoint: string | null): this;
    public controlEndpoint(channelUri: ChannelUri): this;
    public controlEndpoint(controlEndpoint?: string | null | ChannelUri): string | null | this {
        if (undefined === controlEndpoint) {
            return this._controlEndpoint;
        }

        if (controlEndpoint instanceof ChannelUri) {
            return this.controlEndpoint(controlEndpoint.get(MDC_CONTROL_PARAM_NAME));
        }

        this._controlEndpoint = controlEndpoint;
        return this;
    }

    /**
     * Set the control mode for multi-destination-cast channels, or copy it from a channel URI, or get it.
     *
     * @param controlMode for the channel.
     * @return this for a fluent API.
     * @throws IllegalArgumentException if the mode is not valid.
     */
    public controlMode(): string | null;
    public controlMode(controlMode: string | null): this;
    public controlMode(channelUri: ChannelUri): this;
    public controlMode(controlMode?: string | null | ChannelUri): string | null | this {
        if (undefined === controlMode) {
            return this._controlMode;
        }

        if (controlMode instanceof ChannelUri) {
            return this.controlMode(controlMode.get(MDC_CONTROL_MODE_PARAM_NAME));
        }

        if (
            null !== controlMode &&
            controlMode !== MDC_CONTROL_MODE_MANUAL &&
            controlMode !== MDC_CONTROL_MODE_DYNAMIC &&
            controlMode !== CONTROL_MODE_RESPONSE
        ) {
            throw new IllegalArgumentException('invalid control mode: ' + controlMode);
        }

        this._controlMode = controlMode;
        return this;
    }

    /**
     * Set the channel's reliable flag, or copy it from a channel URI, or get it.
     *
     * @param isReliable false if loss can be gap filled.
     * @return this for a fluent API.
     */
    public reliable(): boolean | null;
    public reliable(isReliable: boolean | null): this;
    public reliable(channelUri: ChannelUri): this;
    public reliable(isReliable?: boolean | null | ChannelUri): boolean | null | this {
        if (undefined === isReliable) {
            return this._reliable;
        }

        if (isReliable instanceof ChannelUri) {
            const reliableValue = isReliable.get(RELIABLE_STREAM_PARAM_NAME);
            if (null === reliableValue) {
                this._reliable = null;
                return this;
            } else {
                return this.reliable(booleanValueOf(reliableValue));
            }
        }

        this._reliable = isReliable;
        return this;
    }

    /**
     * Set the time to live for a multicast datagram, or copy it from a channel URI, or get it.
     *
     * @param ttl for the multicast datagram.
     * @return this for a fluent API.
     * @throws IllegalArgumentException if TTL is not in the range 0-255.
     */
    public ttl(): number | null;
    public ttl(ttl: number | null): this;
    public ttl(channelUri: ChannelUri): this;
    public ttl(ttl?: number | null | ChannelUri): number | null | this {
        if (undefined === ttl) {
            return this._ttl;
        }

        if (ttl instanceof ChannelUri) {
            const ttlValue = ttl.get(TTL_PARAM_NAME);
            if (null === ttlValue) {
                this._ttl = null;
                return this;
            } else {
                try {
                    return this.ttl(Integer.parseInt(ttlValue));
                } catch (ex) {
                    if (ex instanceof NumberFormatException) {
                        throw new IllegalArgumentException("'ttl' must be a value integer", { cause: ex });
                    }
                    throw ex;
                }
            }
        }

        if (null !== ttl && (ttl < 0 || ttl > 255)) {
            throw new IllegalArgumentException('TTL not in range 0-255: ' + ttl);
        }

        this._ttl = ttl;
        return this;
    }

    /**
     * Set the maximum transmission unit including Aeron header for a datagram payload, or copy it from a channel
     * URI, or get it.
     *
     * @param mtu the maximum transmission unit including Aeron header for a datagram payload.
     * @return this for a fluent API.
     * @throws IllegalArgumentException if the mtu is not valid.
     */
    public mtu(): number | null;
    public mtu(mtu: number | null): this;
    public mtu(channelUri: ChannelUri): this;
    public mtu(mtu?: number | null | ChannelUri): number | null | this {
        if (undefined === mtu) {
            return this._mtu;
        }

        if (mtu instanceof ChannelUri) {
            const mtuValue = mtu.get(MTU_LENGTH_PARAM_NAME);
            if (null === mtuValue) {
                this._mtu = null;
                return this;
            } else {
                const value = SystemUtil.parseSize(MTU_LENGTH_PARAM_NAME, mtuValue);
                if (value > Integer.MAX_VALUE) {
                    throw new IllegalArgumentException(MTU_LENGTH_PARAM_NAME + ' ' + value + ' > ' + Integer.MAX_VALUE);
                }

                return this.mtu(value | 0);
            }
        }

        if (null !== mtu) {
            if (mtu < 32 || mtu > 65504) {
                throw new IllegalArgumentException('MTU not in range 32-65504: ' + mtu);
            }

            if ((mtu & (FRAME_ALIGNMENT - 1)) !== 0) {
                throw new IllegalArgumentException('MTU not a multiple of FRAME_ALIGNMENT: mtu=' + mtu);
            }
        }

        this._mtu = mtu;
        return this;
    }

    /**
     * Set the length of buffer used for each term of the log, or copy it from a channel URI, or get it.
     *
     * @param termLength of the buffer used for each term of the log.
     * @return this for a fluent API.
     * @throws IllegalStateException if the term length is not valid.
     */
    public termLength(): number | null;
    public termLength(termLength: number | null): this;
    public termLength(channelUri: ChannelUri): this;
    public termLength(termLength?: number | null | ChannelUri): number | null | this {
        if (undefined === termLength) {
            return this._termLength;
        }

        if (termLength instanceof ChannelUri) {
            const termLengthValue = termLength.get(TERM_LENGTH_PARAM_NAME);
            if (null === termLengthValue) {
                this._termLength = null;
                return this;
            } else {
                const value = SystemUtil.parseSize(TERM_LENGTH_PARAM_NAME, termLengthValue);
                if (value > Integer.MAX_VALUE) {
                    throw new IllegalArgumentException(
                        'term length more than max length of ' + TERM_MAX_LENGTH + ': value=' + value,
                    );
                }

                return this.termLength(value | 0);
            }
        }

        if (null !== termLength) {
            checkTermLength(termLength);
        }

        this._termLength = termLength;
        return this;
    }

    /**
     * Set the initial term id at which a publication will start, or copy it from a channel URI, or get it.
     *
     * @param initialTermId the initial term id at which a publication will start.
     * @return this for a fluent API.
     */
    public initialTermId(): number | null;
    public initialTermId(initialTermId: number | null): this;
    public initialTermId(channelUri: ChannelUri): this;
    public initialTermId(initialTermId?: number | null | ChannelUri): number | null | this {
        if (undefined === initialTermId) {
            return this._initialTermId;
        }

        if (initialTermId instanceof ChannelUri) {
            const initialTermIdValue = initialTermId.get(INITIAL_TERM_ID_PARAM_NAME);
            if (null === initialTermIdValue) {
                this._initialTermId = null;
                return this;
            } else {
                try {
                    return this.initialTermId(Integer.parseInt(initialTermIdValue));
                } catch (ex) {
                    if (ex instanceof NumberFormatException) {
                        throw new IllegalArgumentException("'initial-term-id' must be a valid integer", { cause: ex });
                    }
                    throw ex;
                }
            }
        }

        this._initialTermId = initialTermId;
        return this;
    }

    /**
     * Set the current term id at which a publication will start, or copy it from a channel URI, or get it.
     *
     * @param termId the current term id at which a publication will start.
     * @return this for a fluent API.
     */
    public termId(): number | null;
    public termId(termId: number | null): this;
    public termId(channelUri: ChannelUri): this;
    public termId(termId?: number | null | ChannelUri): number | null | this {
        if (undefined === termId) {
            return this._termId;
        }

        if (termId instanceof ChannelUri) {
            const termIdValue = termId.get(TERM_ID_PARAM_NAME);
            if (null === termIdValue) {
                this._termId = null;
                return this;
            } else {
                try {
                    return this.termId(Integer.parseInt(termIdValue));
                } catch (ex) {
                    if (ex instanceof NumberFormatException) {
                        throw new IllegalArgumentException("'term-id' must be a valid integer", { cause: ex });
                    }
                    throw ex;
                }
            }
        }

        this._termId = termId;
        return this;
    }

    /**
     * Set the offset within a term at which a publication will start, or copy it from a channel URI, or get it.
     *
     * @param termOffset the offset within a term at which a publication will start.
     * @return this for a fluent API.
     */
    public termOffset(): number | null;
    public termOffset(termOffset: number | null): this;
    public termOffset(channelUri: ChannelUri): this;
    public termOffset(termOffset?: number | null | ChannelUri): number | null | this {
        if (undefined === termOffset) {
            return this._termOffset;
        }

        if (termOffset instanceof ChannelUri) {
            const termOffsetValue = termOffset.get(TERM_OFFSET_PARAM_NAME);
            if (null === termOffsetValue) {
                this._termOffset = null;
                return this;
            } else {
                try {
                    return this.termOffset(Integer.parseInt(termOffsetValue));
                } catch (ex) {
                    if (ex instanceof NumberFormatException) {
                        throw new IllegalArgumentException("'term-offset' must be a valid integer", { cause: ex });
                    }
                    throw ex;
                }
            }
        }

        if (null !== termOffset) {
            if (termOffset < 0 || termOffset > TERM_MAX_LENGTH) {
                throw new IllegalArgumentException('term offset not in range 0-1g: ' + termOffset);
            }

            if (0 !== (termOffset & (FRAME_ALIGNMENT - 1))) {
                throw new IllegalArgumentException('term offset not multiple of FRAME_ALIGNMENT: ' + termOffset);
            }
        }

        this._termOffset = termOffset;
        return this;
    }

    /**
     * Set the session id for a publication or restricted subscription, as an integer, as the string form of an
     * integer or a tag (<code>tag:</code> and the tag), or copy it from a channel URI. With no argument it gets the
     * session id as an int.
     *
     * @param sessionId for the publication or a restricted subscription.
     * @return this for a fluent API.
     * @deprecated the getter: use {@link #sessionId()} through the other accessors.
     */
    public sessionId(): number | null;
    public sessionId(sessionId: number | null): this;
    public sessionId(sessionIdStr: string | null): this;
    public sessionId(channelUri: ChannelUri): this;
    public sessionId(sessionId?: number | string | null | ChannelUri): number | null | this {
        if (undefined === sessionId) {
            return null !== this._sessionId ? this._sessionId | 0 : null;
        }

        if (sessionId instanceof ChannelUri) {
            return this.sessionId(sessionId.get(SESSION_ID_PARAM_NAME));
        }

        if (typeof sessionId === 'string') {
            if (ChannelUri.isTagged(sessionId)) {
                this.taggedSessionId(ChannelUri.getTag(sessionId));
            } else {
                this.isSessionIdTagged(false);
                try {
                    this.sessionId(Integer.parseInt(sessionId));
                } catch (ex) {
                    if (ex instanceof NumberFormatException) {
                        throw new IllegalArgumentException("'session-id' must be a valid integer", { cause: ex });
                    }
                    throw ex;
                }
            }

            return this;
        }

        this._sessionId = sessionId;
        return this;
    }

    /**
     * Set the session id for a publication or restricted subscription as a tag reference.
     *
     * @param sessionId the tag reference.
     * @return this for a fluent API.
     */
    public taggedSessionId(sessionId: number | null): this {
        this.isSessionIdTagged(true);
        this._sessionId = sessionId;
        return this;
    }

    /**
     * Set the time a network publication will linger in nanoseconds after being drained, or copy it from a channel
     * URI, or get it.
     *
     * @param lingerNs time for the publication after it is drained.
     * @return this for a fluent API.
     */
    public linger(): number | null;
    public linger(lingerNs: number | null): this;
    public linger(channelUri: ChannelUri): this;
    public linger(lingerNs?: number | null | ChannelUri): number | null | this {
        if (undefined === lingerNs) {
            return this._linger;
        }

        if (lingerNs instanceof ChannelUri) {
            const lingerValue = lingerNs.get(LINGER_PARAM_NAME);
            if (null === lingerValue) {
                this._linger = null;
                return this;
            } else {
                return this.linger(SystemUtil.parseDuration(LINGER_PARAM_NAME, lingerValue));
            }
        }

        this._linger = ChannelUriStringBuilder.requireNonNegative(lingerNs, LINGER_PARAM_NAME);
        return this;
    }

    /**
     * Set the Sparse connection semantics for a channel, or copy it from a channel URI, or get it.
     *
     * @param isSparse true if sparse.
     * @return this for a fluent API.
     */
    public sparse(): boolean | null;
    public sparse(isSparse: boolean | null): this;
    public sparse(channelUri: ChannelUri): this;
    public sparse(isSparse?: boolean | null | ChannelUri): boolean | null | this {
        if (undefined === isSparse) {
            return this._sparse;
        }

        if (isSparse instanceof ChannelUri) {
            const sparseValue = isSparse.get(SPARSE_PARAM_NAME);
            if (null === sparseValue) {
                this._sparse = null;
                return this;
            } else {
                return this.sparse(booleanValueOf(sparseValue));
            }
        }

        this._sparse = isSparse;
        return this;
    }

    /**
     * Set the Spy-to-publication end of stream flag, or copy it from a channel URI, or get it.
     *
     * @param eos true if end of stream is to be signalled.
     * @return this for a fluent API.
     */
    public eos(): boolean | null;
    public eos(eos: boolean | null): this;
    public eos(channelUri: ChannelUri): this;
    public eos(eos?: boolean | null | ChannelUri): boolean | null | this {
        if (undefined === eos) {
            return this._eos;
        }

        if (eos instanceof ChannelUri) {
            const eosValue = eos.get(EOS_PARAM_NAME);
            if (null === eosValue) {
                this._eos = null;
                return this;
            } else {
                return this.eos(booleanValueOf(eosValue));
            }
        }

        this._eos = eos;
        return this;
    }

    /**
     * Set the tether flag, or copy it from a channel URI, or get it.
     *
     * @param tether true if the subscription is tethered.
     * @return this for a fluent API.
     */
    public tether(): boolean | null;
    public tether(tether: boolean | null): this;
    public tether(channelUri: ChannelUri): this;
    public tether(tether?: boolean | null | ChannelUri): boolean | null | this {
        if (undefined === tether) {
            return this._tether;
        }

        if (tether instanceof ChannelUri) {
            const tetherValue = tether.get(TETHER_PARAM_NAME);
            if (null === tetherValue) {
                this._tether = null;
                return this;
            } else {
                return this.tether(booleanValueOf(tetherValue));
            }
        }

        this._tether = tether;
        return this;
    }

    /**
     * Set the group flag, or copy it from a channel URI, or get it.
     *
     * @param group true if the subscription is a member of a group.
     * @return this for a fluent API.
     */
    public group(): boolean | null;
    public group(group: boolean | null): this;
    public group(channelUri: ChannelUri): this;
    public group(group?: boolean | null | ChannelUri): boolean | null | this {
        if (undefined === group) {
            return this._group;
        }

        if (group instanceof ChannelUri) {
            const groupValue = group.get(GROUP_PARAM_NAME);
            if (null === groupValue) {
                this._group = null;
                return this;
            } else {
                return this.group(booleanValueOf(groupValue));
            }
        }

        this._group = group;
        return this;
    }

    /**
     * Set the tags for a channel used by a publication or subscription as the string <code>channel[,entity]</code>,
     * or as the channel tag and the optional entity (pub/sub) tag, or copy them from a channel URI, or get them.
     *
     * @param tags      for the channel, or the channel tag.
     * @param pubSubTag for the entity.
     * @return this for a fluent API.
     */
    public tags(): string | null;
    public tags(tags: string | null): this;
    public tags(channelUri: ChannelUri): this;
    public tags(channelTag: number | null, pubSubTag: number | null): this;
    public tags(tags?: string | number | null | ChannelUri, pubSubTag?: number | null): string | null | this {
        if (undefined === tags && undefined === pubSubTag) {
            return this._tags;
        }

        if (tags instanceof ChannelUri) {
            return this.tags(tags.get(TAGS_PARAM_NAME));
        }

        if (typeof tags === 'number' || undefined !== pubSubTag) {
            const channelTag = (tags ?? null) as number | null;
            if (null === channelTag && null !== (pubSubTag ?? null)) {
                throw new IllegalArgumentException('null == channelTag && null != pubSubTag');
            }

            if (null === channelTag) {
                return this.tags(null as string | null);
            }

            return this.tags(channelTag + (null !== (pubSubTag ?? null) ? ',' + pubSubTag : ''));
        }

        this._tags = tags as string | null;
        return this;
    }

    /**
     * Set the session id tag flag, or get it.
     *
     * @param isSessionIdTagged true if the session id is a tag reference.
     * @return this for a fluent API.
     */
    public isSessionIdTagged(): boolean;
    public isSessionIdTagged(isSessionIdTagged: boolean): this;
    public isSessionIdTagged(isSessionIdTagged?: boolean): boolean | this {
        if (undefined === isSessionIdTagged) {
            return this._isSessionIdTagged;
        }

        this._isSessionIdTagged = isSessionIdTagged;
        return this;
    }

    /**
     * Set the alias for a URI. Alias is a free-form string for informational purposes (e.g. in the event log). Or
     * copy it from a channel URI, or get it.
     *
     * @param alias for the URI.
     * @return this for a fluent API.
     */
    public alias(): string | null;
    public alias(alias: string | null): this;
    public alias(channelUri: ChannelUri): this;
    public alias(alias?: string | null | ChannelUri): string | null | this {
        if (undefined === alias) {
            return this._alias;
        }

        if (alias instanceof ChannelUri) {
            return this.alias(alias.get(ALIAS_PARAM_NAME));
        }

        this._alias = alias;
        return this;
    }

    /**
     * Set the congestion control algorithm to be used on a channel, or copy it from a channel URI, or get it.
     *
     * @param congestionControl for the channel.
     * @return this for a fluent API.
     */
    public congestionControl(): string | null;
    public congestionControl(congestionControl: string | null): this;
    public congestionControl(channelUri: ChannelUri): this;
    public congestionControl(congestionControl?: string | null | ChannelUri): string | null | this {
        if (undefined === congestionControl) {
            return this._cc;
        }

        if (congestionControl instanceof ChannelUri) {
            return this.congestionControl(congestionControl.get(CONGESTION_CONTROL_PARAM_NAME));
        }

        this._cc = congestionControl;
        return this;
    }

    /**
     * Set the flow control strategy to be used on a channel, or copy it from a channel URI, or get it.
     *
     * @param flowControl for the channel.
     * @return this for a fluent API.
     */
    public flowControl(): string | null;
    public flowControl(flowControl: string | null): this;
    public flowControl(channelUri: ChannelUri): this;
    public flowControl(flowControl?: string | null | ChannelUri): string | null | this {
        if (undefined === flowControl) {
            return this._fc;
        }

        if (flowControl instanceof ChannelUri) {
            return this.flowControl(flowControl.get(FLOW_CONTROL_PARAM_NAME));
        }

        this._fc = flowControl;
        return this;
    }

    /**
     * Set the tagged flow control strategy.
     *
     * @param groupTag     the receiver tag, or null.
     * @param minGroupSize the minimum group size, or null.
     * @param timeout      the receiver timeout, or null.
     * @return this for a fluent API.
     */
    public taggedFlowControl(groupTag: number | null, minGroupSize: number | null, timeout: string | null): this {
        let flowControlValue = 'tagged';

        if (null !== groupTag || null !== minGroupSize) {
            flowControlValue += ',g:';

            if (null !== groupTag) {
                flowControlValue += groupTag;
            }

            if (null !== minGroupSize) {
                flowControlValue += '/' + minGroupSize;
            }
        }

        if (null !== timeout) {
            flowControlValue += ',t:' + timeout;
        }

        return this.flowControl(flowControlValue);
    }

    /**
     * Set the min flow control strategy.
     *
     * @param minGroupSize the minimum group size, or null.
     * @param timeout      the receiver timeout, or null.
     * @return this for a fluent API.
     */
    public minFlowControl(minGroupSize: number | null, timeout: string | null): this {
        let flowControlValue = 'min';

        if (null !== minGroupSize) {
            flowControlValue += ',g:/' + minGroupSize;
        }

        if (null !== timeout) {
            flowControlValue += ',t:' + timeout;
        }

        return this.flowControl(flowControlValue);
    }

    /**
     * Set the group tag (gtag) to be sent in each Status Message, or copy it from a channel URI, or get it.
     *
     * @param groupTag the receiver tag.
     * @return this for a fluent API.
     */
    public groupTag(): number | null;
    public groupTag(groupTag: number | null): this;
    public groupTag(channelUri: ChannelUri): this;
    public groupTag(groupTag?: number | null | ChannelUri): number | null | this {
        if (undefined === groupTag) {
            return this._groupTag;
        }

        if (groupTag instanceof ChannelUri) {
            const groupTagValue = groupTag.get(GROUP_TAG_PARAM_NAME);
            if (null === groupTagValue) {
                this._groupTag = null;
                return this;
            } else {
                let value: bigint;
                try {
                    value = parseLong(groupTagValue);
                } catch (ex) {
                    if (ex instanceof NumberFormatException) {
                        throw new IllegalArgumentException("'gtag' must be a valid long value", { cause: ex });
                    }
                    throw ex;
                }

                // a long held in a number (spec D5): a RangeError outside +/-(2^53 - 1)
                return this.groupTag(longToNumber(value));
            }
        }

        this._groupTag = groupTag;
        return this;
    }

    /**
     * Set the rejoin flag, or copy it from a channel URI, or get it.
     *
     * @param rejoin true if the image should rejoin.
     * @return this for a fluent API.
     */
    public rejoin(): boolean | null;
    public rejoin(rejoin: boolean | null): this;
    public rejoin(channelUri: ChannelUri): this;
    public rejoin(rejoin?: boolean | null | ChannelUri): boolean | null | this {
        if (undefined === rejoin) {
            return this._rejoin;
        }

        if (rejoin instanceof ChannelUri) {
            const rejoinValue = rejoin.get(REJOIN_PARAM_NAME);
            if (null === rejoinValue) {
                this._rejoin = null;
                return this;
            } else {
                return this.rejoin(booleanValueOf(rejoinValue));
            }
        }

        this._rejoin = rejoin;
        return this;
    }

    /**
     * Set the spies-simulate-connection flag, or copy it from a channel URI, or get it.
     *
     * @param spiesSimulateConnection true if spies simulate a connection.
     * @return this for a fluent API.
     */
    public spiesSimulateConnection(): boolean | null;
    public spiesSimulateConnection(spiesSimulateConnection: boolean | null): this;
    public spiesSimulateConnection(channelUri: ChannelUri): this;
    public spiesSimulateConnection(spiesSimulateConnection?: boolean | null | ChannelUri): boolean | null | this {
        if (undefined === spiesSimulateConnection) {
            return this._ssc;
        }

        if (spiesSimulateConnection instanceof ChannelUri) {
            const sscValue = spiesSimulateConnection.get(SPIES_SIMULATE_CONNECTION_PARAM_NAME);
            if (null === sscValue) {
                this._ssc = null;
                return this;
            } else {
                return this.spiesSimulateConnection(booleanValueOf(sscValue));
            }
        }

        this._ssc = spiesSimulateConnection;
        return this;
    }

    /**
     * Initialise a channel for restarting a publication at a given position.
     *
     * @param position      at which the publication should be started.
     * @param initialTermId what which the stream would start.
     * @param termLength    for the stream.
     * @return this for a fluent API.
     * @throws IllegalArgumentException if the position is invalid.
     */
    public initialPosition(position: number, initialTermId: number, termLength: number): this {
        Long.checkSafe(position);
        if (position < 0) {
            throw new IllegalArgumentException('invalid position=' + position + ' < 0');
        }

        if (0 !== Long.and(position, FRAME_ALIGNMENT - 1)) {
            throw new IllegalArgumentException(
                'invalid position=' + position + ' does not have frame alignment=' + FRAME_ALIGNMENT,
            );
        }

        const bitsToShift = positionBitsToShift(termLength);

        this._initialTermId = initialTermId;
        this._termId = computeTermIdFromPosition(position, bitsToShift, initialTermId);
        this._termOffset = Long.and(position, termLength - 1) | 0;
        this._termLength = termLength;

        return this;
    }

    /**
     * Set the socket send buffer length, or copy it from a channel URI, or get it.
     *
     * @param socketSndbufLength for the channel.
     * @return this for a fluent API.
     */
    public socketSndbufLength(): number | null;
    public socketSndbufLength(socketSndbufLength: number | null): this;
    public socketSndbufLength(channelUri: ChannelUri): this;
    public socketSndbufLength(socketSndbufLength?: number | null | ChannelUri): number | null | this {
        if (undefined === socketSndbufLength) {
            return this._socketSndbufLength;
        }

        if (socketSndbufLength instanceof ChannelUri) {
            const valueStr = socketSndbufLength.get(SOCKET_SNDBUF_PARAM_NAME);
            if (null === valueStr) {
                this._socketSndbufLength = null;
                return this;
            } else {
                const value = SystemUtil.parseSize(SOCKET_SNDBUF_PARAM_NAME, valueStr);
                if (value > Integer.MAX_VALUE) {
                    throw new IllegalArgumentException('value exceeds maximum permitted: value=' + value);
                }

                return this.socketSndbufLength(value | 0);
            }
        }

        this._socketSndbufLength = ChannelUriStringBuilder.requireNonNegative(
            socketSndbufLength,
            SOCKET_SNDBUF_PARAM_NAME,
        );
        return this;
    }

    /**
     * Set the socket receive buffer length, or copy it from a channel URI, or get it.
     *
     * @param socketRcvbufLength for the channel.
     * @return this for a fluent API.
     */
    public socketRcvbufLength(): number | null;
    public socketRcvbufLength(socketRcvbufLength: number | null): this;
    public socketRcvbufLength(channelUri: ChannelUri): this;
    public socketRcvbufLength(socketRcvbufLength?: number | null | ChannelUri): number | null | this {
        if (undefined === socketRcvbufLength) {
            return this._socketRcvbufLength;
        }

        if (socketRcvbufLength instanceof ChannelUri) {
            const valueStr = socketRcvbufLength.get(SOCKET_RCVBUF_PARAM_NAME);
            if (null === valueStr) {
                this._socketRcvbufLength = null;
                return this;
            } else {
                const value = SystemUtil.parseSize(SOCKET_RCVBUF_PARAM_NAME, valueStr);
                if (value > Integer.MAX_VALUE) {
                    throw new IllegalArgumentException('value exceeds maximum permitted: value=' + value);
                }

                return this.socketRcvbufLength(value | 0);
            }
        }

        this._socketRcvbufLength = ChannelUriStringBuilder.requireNonNegative(
            socketRcvbufLength,
            SOCKET_RCVBUF_PARAM_NAME,
        );
        return this;
    }

    /**
     * Set the receiver window length, or copy it from a channel URI, or get it.
     *
     * @param receiverWindowLength for the channel.
     * @return this for a fluent API.
     */
    public receiverWindowLength(): number | null;
    public receiverWindowLength(receiverWindowLength: number | null): this;
    public receiverWindowLength(channelUri: ChannelUri): this;
    public receiverWindowLength(receiverWindowLength?: number | null | ChannelUri): number | null | this {
        if (undefined === receiverWindowLength) {
            return this._receiverWindowLength;
        }

        if (receiverWindowLength instanceof ChannelUri) {
            const valueStr = receiverWindowLength.get(RECEIVER_WINDOW_LENGTH_PARAM_NAME);
            if (null === valueStr) {
                this._receiverWindowLength = null;
                return this;
            } else {
                const value = SystemUtil.parseSize(RECEIVER_WINDOW_LENGTH_PARAM_NAME, valueStr);
                if (value > Integer.MAX_VALUE) {
                    throw new IllegalArgumentException('value exceeds maximum permitted: value=' + value);
                }

                return this.receiverWindowLength(value | 0);
            }
        }

        this._receiverWindowLength = ChannelUriStringBuilder.requireNonNegative(
            receiverWindowLength,
            RECEIVER_WINDOW_LENGTH_PARAM_NAME,
        );
        return this;
    }

    /**
     * Get the media receive timestamp offset, set it ("reserved" or a number) or copy it from a channel URI.
     *
     * @param timestampOffset for the media receive timestamp.
     * @return this for a fluent API.
     */
    public mediaReceiveTimestampOffset(): string | null;
    public mediaReceiveTimestampOffset(timestampOffset: string | null): this;
    public mediaReceiveTimestampOffset(channelUri: ChannelUri): this;
    public mediaReceiveTimestampOffset(timestampOffset?: string | null | ChannelUri): string | null | this {
        if (undefined === timestampOffset) {
            return this._mediaReceiveTimestampOffset;
        }

        if (timestampOffset instanceof ChannelUri) {
            return this.mediaReceiveTimestampOffset(timestampOffset.get(MEDIA_RCV_TIMESTAMP_OFFSET_PARAM_NAME));
        }

        if (null !== timestampOffset && RESERVED_OFFSET !== timestampOffset) {
            try {
                Integer.parseInt(timestampOffset);
            } catch (ex) {
                if (ex instanceof NumberFormatException) {
                    throw new IllegalArgumentException(
                        "mediaReceiveTimestampOffset must be a number or the value '" +
                            RESERVED_OFFSET +
                            "' found: " +
                            timestampOffset,
                    );
                }
                throw ex;
            }
        }

        this._mediaReceiveTimestampOffset = timestampOffset;
        return this;
    }

    /**
     * Get the channel receive timestamp offset, set it ("reserved" or a number) or copy it from a channel URI.
     *
     * @param timestampOffset for the channel receive timestamp.
     * @return this for a fluent API.
     */
    public channelReceiveTimestampOffset(): string | null;
    public channelReceiveTimestampOffset(timestampOffset: string | null): this;
    public channelReceiveTimestampOffset(channelUri: ChannelUri): this;
    public channelReceiveTimestampOffset(timestampOffset?: string | null | ChannelUri): string | null | this {
        if (undefined === timestampOffset) {
            return this._channelReceiveTimestampOffset;
        }

        if (timestampOffset instanceof ChannelUri) {
            return this.channelReceiveTimestampOffset(timestampOffset.get(CHANNEL_RECEIVE_TIMESTAMP_OFFSET_PARAM_NAME));
        }

        if (null !== timestampOffset && RESERVED_OFFSET !== timestampOffset) {
            try {
                Integer.parseInt(timestampOffset);
            } catch (ex) {
                if (ex instanceof NumberFormatException) {
                    throw new IllegalArgumentException(
                        "channelReceiveTimestampOffset must be a number or the value '" +
                            RESERVED_OFFSET +
                            "' found: " +
                            timestampOffset,
                    );
                }
                throw ex;
            }
        }

        this._channelReceiveTimestampOffset = timestampOffset;
        return this;
    }

    /**
     * Get the channel send timestamp offset, set it ("reserved" or a number) or copy it from a channel URI.
     *
     * @param timestampOffset for the channel send timestamp.
     * @return this for a fluent API.
     */
    public channelSendTimestampOffset(): string | null;
    public channelSendTimestampOffset(timestampOffset: string | null): this;
    public channelSendTimestampOffset(channelUri: ChannelUri): this;
    public channelSendTimestampOffset(timestampOffset?: string | null | ChannelUri): string | null | this {
        if (undefined === timestampOffset) {
            return this._channelSendTimestampOffset;
        }

        if (timestampOffset instanceof ChannelUri) {
            return this.channelSendTimestampOffset(timestampOffset.get(CHANNEL_SEND_TIMESTAMP_OFFSET_PARAM_NAME));
        }

        if (null !== timestampOffset && RESERVED_OFFSET !== timestampOffset) {
            try {
                Integer.parseInt(timestampOffset);
            } catch (ex) {
                if (ex instanceof NumberFormatException) {
                    throw new IllegalArgumentException(
                        "channelSendTimestampOffset must be a number or the value '" +
                            RESERVED_OFFSET +
                            "' found: " +
                            timestampOffset,
                    );
                }
                throw ex;
            }
        }

        this._channelSendTimestampOffset = timestampOffset;
        return this;
    }

    /**
     * Set the response endpoint, or copy it from a channel URI, or get it.
     *
     * @param responseEndpoint for the channel.
     * @return this for a fluent API.
     */
    public responseEndpoint(): string | null;
    public responseEndpoint(responseEndpoint: string | null): this;
    public responseEndpoint(channelUri: ChannelUri): this;
    public responseEndpoint(responseEndpoint?: string | null | ChannelUri): string | null | this {
        if (undefined === responseEndpoint) {
            return this._responseEndpoint;
        }

        if (responseEndpoint instanceof ChannelUri) {
            return this.responseEndpoint(responseEndpoint.get(RESPONSE_ENDPOINT_PARAM_NAME));
        }

        this._responseEndpoint = responseEndpoint;
        return this;
    }

    /**
     * Get the response correlation id, set it from a number or a string (a number of at least -1, or "prototype"),
     * or copy it from a channel URI (an absent value leaves the current one).
     *
     * @param responseCorrelationId for the channel.
     * @return this for a fluent API.
     */
    public responseCorrelationId(): string | null;
    public responseCorrelationId(responseCorrelationId: number): this;
    public responseCorrelationId(responseCorrelationId: string | null): this;
    public responseCorrelationId(channelUri: ChannelUri): this;
    public responseCorrelationId(responseCorrelationId?: number | string | null | ChannelUri): string | null | this {
        if (undefined === responseCorrelationId) {
            return this._responseCorrelationId;
        }

        if (responseCorrelationId instanceof ChannelUri) {
            const responseCorrelationIdString = responseCorrelationId.get(RESPONSE_CORRELATION_ID_PARAM_NAME);
            if (null !== responseCorrelationIdString) {
                this.responseCorrelationId(responseCorrelationIdString);
            }

            return this;
        }

        if (typeof responseCorrelationId === 'number') {
            this._responseCorrelationId = String(responseCorrelationId);
            return this;
        }

        if (null !== responseCorrelationId && PROTOTYPE_CORRELATION_ID !== responseCorrelationId) {
            try {
                if (parseLong(responseCorrelationId) < -1n) {
                    throw new NumberFormatException('responseCorrelationId must be positive');
                }
            } catch (ex) {
                if (ex instanceof NumberFormatException) {
                    throw new IllegalArgumentException(
                        "responseCorrelationId must be a number greater than or equal to -1, or the value '" +
                            PROTOTYPE_CORRELATION_ID +
                            "' found: " +
                            responseCorrelationId,
                    );
                }
                throw ex;
            }
        }

        this._responseCorrelationId = responseCorrelationId;
        return this;
    }

    /**
     * Set the NAK delay, as a duration string ("100us", "1ms", ...) or in nanoseconds, or copy it from a channel
     * URI, or get it.
     *
     * @param nakDelay for the channel.
     * @return this for a fluent API.
     */
    public nakDelay(): number | null;
    public nakDelay(nakDelay: string | null): this;
    public nakDelay(nakDelayNs: number): this;
    public nakDelay(channelUri: ChannelUri): this;
    public nakDelay(nakDelay?: string | number | null | ChannelUri): number | null | this {
        if (undefined === nakDelay) {
            return this._nakDelay;
        }

        if (nakDelay instanceof ChannelUri) {
            return this.nakDelay(nakDelay.get(NAK_DELAY_PARAM_NAME));
        }

        if (typeof nakDelay === 'number') {
            this._nakDelay = ChannelUriStringBuilder.requireNonNegative(nakDelay, NAK_DELAY_PARAM_NAME);
            return this;
        }

        this._nakDelay = null !== nakDelay ? SystemUtil.parseDuration(NAK_DELAY_PARAM_NAME, nakDelay) : null;
        return this;
    }

    /**
     * Set the untethered window limit timeout, as a duration string ("100us", "1ms", ...), or copy it from a channel
     * URI.
     *
     * @param timeout for the channel.
     * @return this for a fluent API.
     */
    public untetheredWindowLimitTimeout(timeout: string | null): this;
    public untetheredWindowLimitTimeout(channelUri: ChannelUri): this;
    public untetheredWindowLimitTimeout(timeout: string | null | ChannelUri): this {
        if (timeout instanceof ChannelUri) {
            this.untetheredWindowLimitTimeout(timeout.get(UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME));
            return this;
        }

        this._untetheredWindowLimitTimeoutNs =
            null !== timeout ? SystemUtil.parseDuration(UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME, timeout) : null;
        return this;
    }

    /**
     * Set the untethered window limit timeout in nanoseconds, or get it.
     *
     * @param timeout for the channel.
     * @return this for a fluent API.
     */
    public untetheredWindowLimitTimeoutNs(): number | null;
    public untetheredWindowLimitTimeoutNs(timeout: number | null): this;
    public untetheredWindowLimitTimeoutNs(timeout?: number | null): number | null | this {
        if (undefined === timeout) {
            return this._untetheredWindowLimitTimeoutNs;
        }

        this._untetheredWindowLimitTimeoutNs = ChannelUriStringBuilder.requireNonNegative(
            timeout,
            UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME,
        );
        return this;
    }

    /**
     * Set the untethered linger timeout, as a duration string ("100us", "1ms", ...), or copy it from a channel URI.
     *
     * @param timeout for the channel.
     * @return this for a fluent API.
     */
    public untetheredLingerTimeout(timeout: string | null): this;
    public untetheredLingerTimeout(channelUri: ChannelUri): this;
    public untetheredLingerTimeout(timeout: string | null | ChannelUri): this {
        if (timeout instanceof ChannelUri) {
            this.untetheredLingerTimeout(timeout.get(UNTETHERED_LINGER_TIMEOUT_PARAM_NAME));
            return this;
        }

        this._untetheredLingerTimeoutNs =
            null !== timeout ? SystemUtil.parseDuration(UNTETHERED_LINGER_TIMEOUT_PARAM_NAME, timeout) : null;
        return this;
    }

    /**
     * Set the untethered linger timeout in nanoseconds, or get it.
     *
     * @param timeout for the channel.
     * @return this for a fluent API.
     */
    public untetheredLingerTimeoutNs(): number | null;
    public untetheredLingerTimeoutNs(timeout: number | null): this;
    public untetheredLingerTimeoutNs(timeout?: number | null): number | null | this {
        if (undefined === timeout) {
            return this._untetheredLingerTimeoutNs;
        }

        this._untetheredLingerTimeoutNs = ChannelUriStringBuilder.requireNonNegative(
            timeout,
            UNTETHERED_LINGER_TIMEOUT_PARAM_NAME,
        );
        return this;
    }

    /**
     * Set the untethered resting timeout, as a duration string ("100us", "1ms", ...), or copy it from a channel URI.
     *
     * @param timeout for the channel.
     * @return this for a fluent API.
     */
    public untetheredRestingTimeout(timeout: string | null): this;
    public untetheredRestingTimeout(channelUri: ChannelUri): this;
    public untetheredRestingTimeout(timeout: string | null | ChannelUri): this {
        if (timeout instanceof ChannelUri) {
            this.untetheredRestingTimeout(timeout.get(UNTETHERED_RESTING_TIMEOUT_PARAM_NAME));
            return this;
        }

        this._untetheredRestingTimeoutNs =
            null !== timeout ? SystemUtil.parseDuration(UNTETHERED_RESTING_TIMEOUT_PARAM_NAME, timeout) : null;
        return this;
    }

    /**
     * Set the untethered resting timeout in nanoseconds, or get it.
     *
     * @param timeout for the channel.
     * @return this for a fluent API.
     */
    public untetheredRestingTimeoutNs(): number | null;
    public untetheredRestingTimeoutNs(timeout: number | null): this;
    public untetheredRestingTimeoutNs(timeout?: number | null): number | null | this {
        if (undefined === timeout) {
            return this._untetheredRestingTimeoutNs;
        }

        this._untetheredRestingTimeoutNs = ChannelUriStringBuilder.requireNonNegative(
            timeout,
            UNTETHERED_RESTING_TIMEOUT_PARAM_NAME,
        );
        return this;
    }

    /**
     * Set the maximum number of retransmits, or copy it from a channel URI, or get it.
     *
     * @param maxResend for the channel.
     * @return this for a fluent API.
     */
    public maxResend(): number | null;
    public maxResend(maxResend: number | null): this;
    public maxResend(channelUri: ChannelUri): this;
    public maxResend(maxResend?: number | null | ChannelUri): number | null | this {
        if (undefined === maxResend) {
            return this._maxResend;
        }

        if (maxResend instanceof ChannelUri) {
            const valueStr = maxResend.get(MAX_RESEND_PARAM_NAME);
            if (null === valueStr) {
                this._maxResend = null;
                return this;
            } else {
                try {
                    return this.maxResend(Integer.parseInt(valueStr));
                } catch (ex) {
                    if (ex instanceof NumberFormatException) {
                        throw new IllegalArgumentException(MAX_RESEND_PARAM_NAME + ' must be a number', {
                            cause: ex,
                        });
                    }
                    throw ex;
                }
            }
        }

        this._maxResend = ChannelUriStringBuilder.requireNonNegative(maxResend, MAX_RESEND_PARAM_NAME);
        return this;
    }

    /**
     * Get the stream id, set it, or copy it from a channel URI.
     *
     * @param streamId for the channel.
     * @return this for a fluent API.
     */
    public streamId(): number | null;
    public streamId(streamId: number | null): this;
    public streamId(channelUri: ChannelUri): this;
    public streamId(streamId?: number | null | ChannelUri): number | null | this {
        if (undefined === streamId) {
            return this._streamId;
        }

        if (streamId instanceof ChannelUri) {
            const valueStr = streamId.get(STREAM_ID_PARAM_NAME);
            if (null === valueStr) {
                this._streamId = null;
                return this;
            } else {
                try {
                    return this.streamId(Integer.parseInt(valueStr));
                } catch (ex) {
                    if (ex instanceof NumberFormatException) {
                        throw new IllegalArgumentException(STREAM_ID_PARAM_NAME + ' must be a number', { cause: ex });
                    }
                    throw ex;
                }
            }
        }

        this._streamId = streamId;
        return this;
    }

    /**
     * Set the publication window length, or copy it from a channel URI, or get it.
     *
     * @param publicationWindowLength for the channel.
     * @return this for a fluent API.
     */
    public publicationWindowLength(): number | null;
    public publicationWindowLength(publicationWindowLength: number | null): this;
    public publicationWindowLength(channelUri: ChannelUri): this;
    public publicationWindowLength(publicationWindowLength?: number | null | ChannelUri): number | null | this {
        if (undefined === publicationWindowLength) {
            return this._publicationWindowLength;
        }

        if (publicationWindowLength instanceof ChannelUri) {
            const valueStr = publicationWindowLength.get(PUBLICATION_WINDOW_LENGTH_PARAM_NAME);
            if (null === valueStr) {
                this._publicationWindowLength = null;
                return this;
            } else {
                const value = SystemUtil.parseSize(PUBLICATION_WINDOW_LENGTH_PARAM_NAME, valueStr);
                if (value > Integer.MAX_VALUE) {
                    throw new IllegalArgumentException('value exceeds maximum permitted: value=' + value);
                }

                return this.publicationWindowLength(value | 0);
            }
        }

        this._publicationWindowLength = ChannelUriStringBuilder.requireNonNegative(
            publicationWindowLength,
            PUBLICATION_WINDOW_LENGTH_PARAM_NAME,
        );
        return this;
    }

    /**
     * Build a channel URI String for the given parameters.
     *
     * @return a channel URI String for the given parameters.
     */
    public build(): string {
        let sb = '';

        if (null !== this._prefix && this._prefix.length !== 0) {
            sb += this._prefix + ':';
        }

        sb += ChannelUri.AERON_SCHEME + ':' + this._media + '?';

        sb = ChannelUriStringBuilder.appendParameter(sb, TAGS_PARAM_NAME, this._tags);
        sb = ChannelUriStringBuilder.appendParameter(sb, ENDPOINT_PARAM_NAME, this._endpoint);
        sb = ChannelUriStringBuilder.appendParameter(sb, INTERFACE_PARAM_NAME, this._networkInterface);
        sb = ChannelUriStringBuilder.appendParameter(sb, MDC_CONTROL_PARAM_NAME, this._controlEndpoint);
        sb = ChannelUriStringBuilder.appendParameter(sb, MDC_CONTROL_MODE_PARAM_NAME, this._controlMode);
        sb = ChannelUriStringBuilder.appendSize(sb, MTU_LENGTH_PARAM_NAME, this._mtu);
        sb = ChannelUriStringBuilder.appendSize(sb, TERM_LENGTH_PARAM_NAME, this._termLength);
        sb = ChannelUriStringBuilder.appendParameter(sb, INITIAL_TERM_ID_PARAM_NAME, this._initialTermId);
        sb = ChannelUriStringBuilder.appendParameter(sb, TERM_ID_PARAM_NAME, this._termId);
        sb = ChannelUriStringBuilder.appendParameter(sb, TERM_OFFSET_PARAM_NAME, this._termOffset);

        if (null !== this._sessionId) {
            sb = ChannelUriStringBuilder.appendParameter(
                sb,
                SESSION_ID_PARAM_NAME,
                ChannelUriStringBuilder.prefixTag(this._isSessionIdTagged, this._sessionId),
            );
        }

        sb = ChannelUriStringBuilder.appendParameter(sb, TTL_PARAM_NAME, this._ttl);
        sb = ChannelUriStringBuilder.appendParameter(sb, RELIABLE_STREAM_PARAM_NAME, this._reliable);
        sb = ChannelUriStringBuilder.appendDuration(sb, LINGER_PARAM_NAME, this._linger);
        sb = ChannelUriStringBuilder.appendParameter(sb, ALIAS_PARAM_NAME, this._alias);
        sb = ChannelUriStringBuilder.appendParameter(sb, CONGESTION_CONTROL_PARAM_NAME, this._cc);
        sb = ChannelUriStringBuilder.appendParameter(sb, FLOW_CONTROL_PARAM_NAME, this._fc);
        sb = ChannelUriStringBuilder.appendParameter(sb, GROUP_TAG_PARAM_NAME, this._groupTag);
        sb = ChannelUriStringBuilder.appendParameter(sb, SPARSE_PARAM_NAME, this._sparse);
        sb = ChannelUriStringBuilder.appendParameter(sb, EOS_PARAM_NAME, this._eos);
        sb = ChannelUriStringBuilder.appendParameter(sb, TETHER_PARAM_NAME, this._tether);
        sb = ChannelUriStringBuilder.appendParameter(sb, GROUP_PARAM_NAME, this._group);
        sb = ChannelUriStringBuilder.appendParameter(sb, REJOIN_PARAM_NAME, this._rejoin);
        sb = ChannelUriStringBuilder.appendParameter(sb, SPIES_SIMULATE_CONNECTION_PARAM_NAME, this._ssc);
        sb = ChannelUriStringBuilder.appendSize(sb, SOCKET_SNDBUF_PARAM_NAME, this._socketSndbufLength);
        sb = ChannelUriStringBuilder.appendSize(sb, SOCKET_RCVBUF_PARAM_NAME, this._socketRcvbufLength);
        sb = ChannelUriStringBuilder.appendSize(sb, RECEIVER_WINDOW_LENGTH_PARAM_NAME, this._receiverWindowLength);
        sb = ChannelUriStringBuilder.appendParameter(
            sb,
            MEDIA_RCV_TIMESTAMP_OFFSET_PARAM_NAME,
            this._mediaReceiveTimestampOffset,
        );
        sb = ChannelUriStringBuilder.appendParameter(
            sb,
            CHANNEL_RECEIVE_TIMESTAMP_OFFSET_PARAM_NAME,
            this._channelReceiveTimestampOffset,
        );
        sb = ChannelUriStringBuilder.appendParameter(
            sb,
            CHANNEL_SEND_TIMESTAMP_OFFSET_PARAM_NAME,
            this._channelSendTimestampOffset,
        );
        sb = ChannelUriStringBuilder.appendParameter(sb, RESPONSE_ENDPOINT_PARAM_NAME, this._responseEndpoint);
        sb = ChannelUriStringBuilder.appendParameter(
            sb,
            RESPONSE_CORRELATION_ID_PARAM_NAME,
            this._responseCorrelationId,
        );
        sb = ChannelUriStringBuilder.appendDuration(sb, NAK_DELAY_PARAM_NAME, this._nakDelay);
        sb = ChannelUriStringBuilder.appendDuration(
            sb,
            UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME,
            this._untetheredWindowLimitTimeoutNs,
        );
        sb = ChannelUriStringBuilder.appendDuration(
            sb,
            UNTETHERED_LINGER_TIMEOUT_PARAM_NAME,
            this._untetheredLingerTimeoutNs,
        );
        sb = ChannelUriStringBuilder.appendDuration(
            sb,
            UNTETHERED_RESTING_TIMEOUT_PARAM_NAME,
            this._untetheredRestingTimeoutNs,
        );
        sb = ChannelUriStringBuilder.appendParameter(sb, MAX_RESEND_PARAM_NAME, this._maxResend);
        sb = ChannelUriStringBuilder.appendParameter(sb, STREAM_ID_PARAM_NAME, this._streamId);
        sb = ChannelUriStringBuilder.appendSize(
            sb,
            PUBLICATION_WINDOW_LENGTH_PARAM_NAME,
            this._publicationWindowLength,
        );

        const lastChar = sb.charAt(sb.length - 1);
        if (lastChar === '|' || lastChar === '?') {
            sb = sb.substring(0, sb.length - 1);
        }

        return sb;
    }

    /**
     * {@inheritDoc}
     */
    public toString(): string {
        return this.build();
    }

    private static appendParameter(
        sb: string,
        paramName: string,
        paramValue: string | number | boolean | null,
    ): string {
        if (null !== paramValue) {
            return sb + paramName + '=' + String(paramValue) + '|';
        }

        return sb;
    }

    private static appendDuration(sb: string, paramName: string, valueNs: number | null): string {
        if (null !== valueNs) {
            return sb + paramName + '=' + SystemUtil.formatDuration(valueNs) + '|';
        }

        return sb;
    }

    private static appendSize(sb: string, paramName: string, value: number | null): string {
        if (null !== value) {
            return sb + paramName + '=' + SystemUtil.formatSize(value) + '|';
        }

        return sb;
    }

    private static requireNonNegative(value: number | null, name: string): number | null {
        if (null !== value && value < 0) {
            throw new IllegalArgumentException('`' + name + '` value cannot be negative: ' + value);
        }

        return value;
    }

    private static prefixTag(isTagged: boolean, value: number): string {
        return isTagged ? ChannelUriStringBuilder.TAG_PREFIX + value : String(value);
    }
}
