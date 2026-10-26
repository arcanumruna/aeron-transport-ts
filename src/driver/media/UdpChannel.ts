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
// Port of io/aeron/driver/media/UdpChannel.java @ 1.53.3
import {
    Exception,
    IllegalArgumentException,
    Integer,
    Long,
    LongOverflowError,
    NumberFormatException,
} from '../../agrona/jdk.js';
import { objectsEquals, requireNonNull, stringHashCode } from '../../agrona/jdkUtil.js';
import { BitUtil } from '../../agrona/BitUtil.js';
import { SystemUtil } from '../../agrona/SystemUtil.js';
import { Aeron } from '../../client/Aeron.js';
import { ChannelUri } from '../../client/ChannelUri.js';
import { CommonContext } from '../../client/CommonContext.js';
import { DefaultNameResolver } from '../DefaultNameResolver.js';
import { InvalidChannelException } from '../exceptions/InvalidChannelException.js';
import {
    type InetAddress,
    Inet6Address,
    InetAddress as InetAddressClass,
    InetSocketAddress,
    type NetworkInterface,
    type ProtocolFamily,
    UnknownHostException,
} from '../jdkNet.js';
import type { NameResolver } from '../NameResolver.js';
import { ControlMode } from './ControlMode.js';
import { InterfaceSearchAddress } from './InterfaceSearchAddress.js';
import { NetworkUtil } from './NetworkUtil.js';
import { SocketAddressParser } from './SocketAddressParser.js';
import { UnresolvedInterface } from './UnresolvedInterface.js';

const ANY_IPV4 = new InetSocketAddress('0.0.0.0', 0);
const ANY_IPV6 = new InetSocketAddress('::', 0);

/**
 * Java's `private static final AtomicInteger UNIQUE_CANONICAL_FORM_VALUE`: a plain number, as the driver conductor
 * that parses channels is one thread (spec D19). `getAndAdd(1)` is `value++`.
 */
let uniqueCanonicalFormValue = 0;

/** The address of a socket address that is known to be resolved. */
function addressOf(socketAddress: InetSocketAddress): InetAddress {
    return socketAddress.getAddress() as InetAddress;
}

/**
 * The media configuration for Aeron UDP channels as an instantiation of the socket addresses for a {@link ChannelUri}.
 *
 * @see ChannelUri
 * @see ChannelUriStringBuilder
 */
export class UdpChannel {
    /**
     * The offset from the beginning of a payload where the reserved value begins.
     */
    public static readonly RESERVED_VALUE_MESSAGE_OFFSET: number = -8;

    private readonly _controlMode: ControlMode;
    private readonly _hasExplicitControl: boolean;
    private readonly _hasExplicitEndpoint: boolean;
    private readonly _isMulticast: boolean;
    private readonly _hasMulticastTtl: boolean;
    private readonly _hasTag: boolean;
    private readonly _multicastTtl: number;
    private readonly _socketRcvbufLength: number;
    private readonly _socketSndbufLength: number;
    private readonly _receiverWindowLength: number;
    private readonly _tag: number;
    private readonly _remoteData: InetSocketAddress;
    private readonly _localData: InetSocketAddress;
    private readonly _remoteControl: InetSocketAddress;
    private readonly _localControl: InetSocketAddress;
    private readonly _uriStr: string;
    private readonly _canonicalForm: string;
    private readonly _localInterface: NetworkInterface | null;
    private readonly _protocolFamily: ProtocolFamily;
    private readonly _channelUri: ChannelUri;
    private readonly _channelReceiveTimestampOffset: number;
    private readonly _channelSendTimestampOffset: number;
    private readonly _groupTag: number | null;
    private readonly _nakDelayNs: number | null;

    private constructor(context: UdpChannelContext) {
        this._controlMode = context.controlMode_;
        this._hasExplicitEndpoint = context.hasExplicitEndpoint_;
        this._hasExplicitControl = context.hasExplicitControl_;
        this._isMulticast = context.isMulticast_;
        this._hasTag = context.hasTagId_;
        this._tag = context.tagId_;
        this._hasMulticastTtl = context.hasMulticastTtl_;
        this._multicastTtl = context.multicastTtl_;
        this._remoteData = context.remoteData_ as InetSocketAddress;
        this._localData = context.localData_ as InetSocketAddress;
        this._remoteControl = context.remoteControl_ as InetSocketAddress;
        this._localControl = context.localControl_ as InetSocketAddress;
        this._uriStr = context.uriStr_ as string;
        this._canonicalForm = context.canonicalForm_ as string;
        this._localInterface = context.localInterface_;
        this._protocolFamily = context.protocolFamily_ as ProtocolFamily;
        this._channelUri = context.channelUri_ as ChannelUri;
        this._socketRcvbufLength = context.socketRcvbufLength_;
        this._socketSndbufLength = context.socketSndbufLength_;
        this._receiverWindowLength = context.receiverWindowLength_;
        this._channelReceiveTimestampOffset = context.channelReceiveTimestampOffset_;
        this._channelSendTimestampOffset = context.channelSendTimestampOffset_;
        this._groupTag = context.groupTag_;
        this._nakDelayNs = context.nakDelayNs_;
    }

    /**
     * Parse channel URI and create a {@link UdpChannel}. The overloads are `parse(uri)` with the default name
     * resolver, `parse(uri, nameResolver)` and `parse(uri, nameResolver, isDestination)`.
     *
     * @param channelUriString to parse.
     * @param nameResolver     to use for resolving names.
     * @param isDestination    to identify if it is a destination within a channel.
     * @return a new {@link UdpChannel} as the result of parsing.
     * @throws InvalidChannelException if an error occurs.
     */
    public static parse(
        channelUriString: string,
        nameResolver: NameResolver = DefaultNameResolver.INSTANCE,
        isDestination: boolean = false,
    ): UdpChannel {
        try {
            const channelUri = ChannelUri.parse(channelUriString);
            UdpChannel.validateConfiguration(channelUri);

            let endpointAddress = UdpChannel.getEndpointAddress(channelUri, nameResolver);
            const controlAddress = UdpChannel.getExplicitControlAddress(channelUri, nameResolver);

            const tagIdStr = channelUri.channelTag();
            const controlMode = UdpChannel.parseControlMode(channelUri);

            const socketRcvbufLength = UdpChannel.parseBufferLength(channelUri, CommonContext.SOCKET_RCVBUF_PARAM_NAME);
            const socketSndbufLength = UdpChannel.parseBufferLength(channelUri, CommonContext.SOCKET_SNDBUF_PARAM_NAME);
            const receiverWindowLength = UdpChannel.parseBufferLength(
                channelUri,
                CommonContext.RECEIVER_WINDOW_LENGTH_PARAM_NAME,
            );

            const requiresAdditionalSuffix =
                !isDestination &&
                ((null === endpointAddress && null === controlAddress) ||
                    (null !== endpointAddress && endpointAddress.getPort() === 0) ||
                    (null !== controlAddress && controlAddress.getPort() === 0));

            const hasNoDistinguishingCharacteristic =
                null === endpointAddress && null === controlAddress && null === tagIdStr;

            if (ControlMode.DYNAMIC === controlMode && null === controlAddress) {
                throw new IllegalArgumentException(
                    'explicit control expected with dynamic control mode: ' + channelUriString,
                );
            }

            if (
                hasNoDistinguishingCharacteristic &&
                ControlMode.MANUAL !== controlMode &&
                ControlMode.RESPONSE !== controlMode
            ) {
                throw new IllegalArgumentException(
                    'URIs for UDP must specify an endpoint, control, tags, or control-mode=manual/response: ' +
                        channelUriString,
                );
            }

            if (null !== endpointAddress && endpointAddress.isUnresolved()) {
                throw new UnknownHostException('could not resolve endpoint address: ' + endpointAddress);
            }

            if (null !== controlAddress && controlAddress.isUnresolved()) {
                throw new UnknownHostException('could not resolve control address: ' + controlAddress);
            }

            let hasExplicitEndpoint = true;
            if (null === endpointAddress) {
                hasExplicitEndpoint = false;
                endpointAddress =
                    null !== controlAddress && controlAddress.getAddress() instanceof Inet6Address
                        ? ANY_IPV6
                        : ANY_IPV4;
            }

            const protocolFamily = NetworkUtil.getProtocolFamily(addressOf(endpointAddress));

            const context = new UdpChannelContext()
                .protocolFamily(protocolFamily)
                .isMulticast(false)
                .hasExplicitControl(false)
                .hasMulticastTtl(false)
                .hasTagId(false)
                .uriStr(channelUriString)
                .channelUri(channelUri)
                .controlMode(controlMode)
                .hasExplicitEndpoint(hasExplicitEndpoint)
                .hasNoDistinguishingCharacteristic(hasNoDistinguishingCharacteristic)
                .socketRcvbufLength(socketRcvbufLength)
                .socketSndbufLength(socketSndbufLength)
                .receiverWindowLength(receiverWindowLength)
                .nakDelayNs(UdpChannel.parseOptionalDurationNs(channelUri, CommonContext.NAK_DELAY_PARAM_NAME));

            if (null !== tagIdStr) {
                context.hasTagId(true).tagId(Long.parseLong(tagIdStr));
            }

            if (addressOf(endpointAddress).isMulticastAddress()) {
                const unresolvedInterface = UdpChannel.getInterface(channelUri);
                const resolvedInterface = unresolvedInterface.resolve(true, protocolFamily);
                const localInterface = resolvedInterface.localInterface;
                const resolvedAddress = resolvedInterface.address;

                context
                    .isMulticast(true)
                    .remoteControlAddress(UdpChannel.getMulticastControlAddress(endpointAddress))
                    .remoteDataAddress(endpointAddress)
                    .localControlAddress(resolvedAddress)
                    .localDataAddress(resolvedAddress)
                    .localInterface(localInterface)
                    .canonicalForm(UdpChannel.canonicalise(null, resolvedAddress, null, endpointAddress));

                const ttlValue = channelUri.get(CommonContext.TTL_PARAM_NAME);
                if (null !== ttlValue) {
                    context.hasMulticastTtl(true).multicastTtl(Integer.parseInt(ttlValue));
                }
            } else if (null !== controlAddress) {
                const controlVal = channelUri.get(CommonContext.MDC_CONTROL_PARAM_NAME);
                const endpointVal = channelUri.get(CommonContext.ENDPOINT_PARAM_NAME);

                let suffix = '';
                if (requiresAdditionalSuffix) {
                    suffix = null !== tagIdStr ? '#' + tagIdStr : '-' + uniqueCanonicalFormValue++;
                }

                const canonicalForm =
                    UdpChannel.canonicalise(controlVal, controlAddress, endpointVal, endpointAddress) + suffix;

                context
                    .hasExplicitControl(true)
                    .remoteControlAddress(endpointAddress)
                    .remoteDataAddress(endpointAddress)
                    .localControlAddress(controlAddress)
                    .localDataAddress(controlAddress)
                    .canonicalForm(canonicalForm);
            } else {
                const unresolvedInterface = UdpChannel.getInterface(channelUri);
                const resolvedInterface = unresolvedInterface.resolve(false, protocolFamily);
                const localAddress = resolvedInterface.address;

                const endpointVal = channelUri.get(CommonContext.ENDPOINT_PARAM_NAME);
                let suffix = '';
                if (requiresAdditionalSuffix) {
                    suffix = null !== tagIdStr ? '#' + tagIdStr : '-' + uniqueCanonicalFormValue++;
                }

                context
                    .remoteControlAddress(endpointAddress)
                    .remoteDataAddress(endpointAddress)
                    .localControlAddress(localAddress)
                    .localDataAddress(localAddress)
                    .canonicalForm(UdpChannel.canonicalise(null, localAddress, endpointVal, endpointAddress) + suffix);
            }

            context.channelReceiveTimestampOffset(
                UdpChannel.parseTimestampOffset(channelUri, CommonContext.CHANNEL_RECEIVE_TIMESTAMP_OFFSET_PARAM_NAME),
            );
            context.channelSendTimestampOffset(
                UdpChannel.parseTimestampOffset(channelUri, CommonContext.CHANNEL_SEND_TIMESTAMP_OFFSET_PARAM_NAME),
            );

            const groupTag = UdpChannel.parseOptionalLong(channelUri, CommonContext.GROUP_TAG_PARAM_NAME);
            context.groupTag(groupTag);

            return new UdpChannel(context);
        } catch (ex) {
            // Java: catch (final Exception ex). A LongOverflowError (a long outside +/-(2^53 - 1), spec D5) is a
            // parameter Java would have accepted; it rejects the channel here instead of escaping as a RangeError.
            if (ex instanceof Exception || ex instanceof LongOverflowError) {
                throw new InvalidChannelException(ex);
            }
            throw ex;
        }
    }

    private static parseTimestampOffset(channelUri: ChannelUri, timestampOffsetParamName: string): number {
        const offsetStr = channelUri.get(timestampOffsetParamName);
        if (null === offsetStr) {
            return Aeron.NULL_VALUE;
        } else if (CommonContext.RESERVED_OFFSET === offsetStr) {
            return UdpChannel.RESERVED_VALUE_MESSAGE_OFFSET;
        } else {
            try {
                return Integer.parseInt(offsetStr);
            } catch (ex) {
                if (!(ex instanceof NumberFormatException)) {
                    throw ex;
                }
                throw new IllegalArgumentException(
                    "timestamp offset must be a valid integer or the 'reserved' keyword",
                    { cause: ex },
                );
            }
        }
    }

    private static parseOptionalLong(channelUri: ChannelUri, paramName: string): number | null {
        const longAsString = channelUri.get(paramName);
        if (null === longAsString) {
            return null;
        }

        try {
            return Long.parseLong(longAsString);
        } catch (ex) {
            if (!(ex instanceof NumberFormatException)) {
                throw ex;
            }
            throw new IllegalArgumentException("'" + paramName + "' does not contain a valid long value", {
                cause: ex,
            });
        }
    }

    /**
     * Parse a buffer length for a given URI paramName with a format specified by
     * {@link SystemUtil#parseSize(String, String)}, clamping the range to 0 &lt;= x &lt;= Integer.MAX_VALUE.
     *
     * @param channelUri to get the value from.
     * @param paramName  key for the parameter.
     * @return value as an integer.
     * @see SystemUtil#parseSize(String, String)
     */
    public static parseBufferLength(channelUri: ChannelUri, paramName: string): number {
        let socketBufferLength = 0;

        const paramValue = channelUri.get(paramName);
        if (null !== paramValue) {
            const size = SystemUtil.parseSize(paramName, paramValue);
            if (size < 0 || size > Integer.MAX_VALUE) {
                throw new IllegalArgumentException('Invalid ' + paramName + ' length: ' + size);
            }
            socketBufferLength = size | 0;
        }

        return socketBufferLength;
    }

    /**
     * Parse the control mode from the channel URI. If the value is null or unknown then {@link ControlMode#NONE} will
     * be used.
     *
     * @param channelUri to parse the control mode from.
     * @return an enum value representing the control mode.
     */
    public static parseControlMode(channelUri: ChannelUri): ControlMode {
        const paramValue = channelUri.get(CommonContext.MDC_CONTROL_MODE_PARAM_NAME);
        if (null === paramValue) {
            return ControlMode.NONE;
        }

        switch (paramValue) {
            case CommonContext.MDC_CONTROL_MODE_DYNAMIC:
                return ControlMode.DYNAMIC;
            case CommonContext.MDC_CONTROL_MODE_MANUAL:
                return ControlMode.MANUAL;
            case CommonContext.CONTROL_MODE_RESPONSE:
                return ControlMode.RESPONSE;
            default:
                return ControlMode.NONE;
        }
    }

    /**
     * Parses out a duration from a channel URI and caters for unit suffix information.
     *
     * @param channelUri to read the value from
     * @param paramName  specific field to access in the URI
     * @return duration in nanoseconds, null if not present
     */
    public static parseOptionalDurationNs(channelUri: ChannelUri, paramName: string): number | null {
        const valueStr = channelUri.get(paramName);
        if (null === valueStr) {
            return null;
        }

        return SystemUtil.parseDuration(paramName, valueStr);
    }

    /**
     * Return a string which is a canonical form of the channel suitable for use as a file or directory
     * name and also as a method of hashing, etc.
     * <p>
     * The general format is:
     * UDP-interface:localPort-remoteAddress:remotePort
     *
     * @param localParamValue  interface or MDC control param value or null for not set.
     * @param localData        address/interface for the channel.
     * @param remoteParamValue endpoint param value or null if not set.
     * @param remoteData       address for the channel.
     * @return canonical representation as a string.
     */
    public static canonicalise(
        localParamValue: string | null,
        localData: InetSocketAddress,
        remoteParamValue: string | null,
        remoteData: InetSocketAddress,
    ): string {
        let builder = 'UDP-';

        if (null === localParamValue) {
            builder += localData.getHostString() + ':' + localData.getPort();
        } else {
            builder += localParamValue;
        }

        builder += '-';

        if (null === remoteParamValue) {
            builder += remoteData.getHostString() + ':' + remoteData.getPort();
        } else {
            builder += remoteParamValue;
        }

        return builder;
    }

    /**
     * Remote data address and port.
     *
     * @return remote data address and port.
     */
    public remoteData(): InetSocketAddress {
        return this._remoteData;
    }

    /**
     * Local data address and port.
     *
     * @return local data address port.
     */
    public localData(): InetSocketAddress {
        return this._localData;
    }

    /**
     * Remote control address information.
     *
     * @return remote control address information.
     */
    public remoteControl(): InetSocketAddress {
        return this._remoteControl;
    }

    /**
     * Local control address and port.
     *
     * @return local control address and port.
     */
    public localControl(): InetSocketAddress {
        return this._localControl;
    }

    /**
     * Get the {@link ChannelUri} for this channel.
     *
     * @return the {@link ChannelUri} for this channel.
     */
    public channelUri(): ChannelUri {
        return this._channelUri;
    }

    /**
     * Has this channel got a multicast TTL value set so that {@link #multicastTtl()} is valid.
     *
     * @return true if this channel is a multicast TTL set otherwise false.
     */
    public hasMulticastTtl(): boolean {
        return this._hasMulticastTtl;
    }

    /**
     * Multicast TTL value.
     *
     * @return multicast TTL value.
     */
    public multicastTtl(): number {
        return this._multicastTtl;
    }

    /**
     * The canonical form for the channel.
     *
     * @return canonical form for channel.
     * @see UdpChannel#canonicalise
     */
    public canonicalForm(): string {
        return this._canonicalForm;
    }

    /**
     * The {@link #canonicalForm()} for the channel.
     *
     * @return the {@link #canonicalForm()} for the channel.
     */
    public toString(): string {
        return this._canonicalForm;
    }

    /**
     * Is the channel UDP multicast.
     *
     * @return true if the channel is UDP multicast.
     */
    public isMulticast(): boolean {
        return this._isMulticast;
    }

    /**
     * Local interface to be used by the channel.
     *
     * @return {@link NetworkInterface} for the local interface used by the channel, null for a unicast channel.
     */
    public localInterface(): NetworkInterface | null {
        return this._localInterface;
    }

    /**
     * Original URI of the channel URI.
     *
     * @return the original uri string from the client.
     */
    public originalUriString(): string {
        return this._uriStr;
    }

    /**
     * Get the {@link ProtocolFamily} for this channel.
     *
     * @return the {@link ProtocolFamily} for this channel.
     */
    public protocolFamily(): ProtocolFamily {
        return this._protocolFamily;
    }

    /**
     * Get the tag value on the channel which is only valid if {@link #hasTag()} is true.
     *
     * @return the tag value on the channel.
     */
    public tag(): number {
        return this._tag;
    }

    /**
     * The channel's control mode.
     *
     * @return the control mode for the channel.
     */
    public controlMode(): ControlMode {
        return this._controlMode;
    }

    /**
     * Does the channel have manual control mode specified.
     *
     * @return does channel have manual control mode specified.
     */
    public isManualControlMode(): boolean {
        return ControlMode.MANUAL === this._controlMode;
    }

    /**
     * Does the channel have dynamic control mode specified.
     *
     * @return does channel have dynamic control mode specified.
     */
    public isDynamicControlMode(): boolean {
        return ControlMode.DYNAMIC === this._controlMode;
    }

    /**
     * Does the channel have response control mode specified.
     *
     * @return does the channel have response control mode specified.
     */
    public isResponseControlMode(): boolean {
        return ControlMode.RESPONSE === this._controlMode;
    }

    /**
     * Does the channel have an explicit endpoint address?
     *
     * @return does channel have an explicit endpoint address or not?
     */
    public hasExplicitEndpoint(): boolean {
        return this._hasExplicitEndpoint;
    }

    /**
     * Does the channel have an explicit control address as used with multi-destination-cast or not?
     *
     * @return does channel have an explicit control address or not?
     */
    public hasExplicitControl(): boolean {
        return this._hasExplicitControl;
    }

    /**
     * Has the URI a tag to indicate entity relationships and if {@link #tag()} is valid.
     *
     * @return true if the channel has a tag.
     */
    public hasTag(): boolean {
        return this._hasTag;
    }

    /**
     * Is the channel configured as multi-destination.
     *
     * @return true if the channel configured as multi-destination.
     */
    public isMultiDestination(): boolean {
        return this._controlMode.isMultiDestination();
    }

    /**
     * Does the channel have group semantics (multicast or MDC).
     *
     * @return true if the channel has group semantics.
     */
    public hasGroupSemantics(): boolean {
        return this._isMulticast || this.isMultiDestination();
    }

    /**
     * Get the socket receive buffer length.
     *
     * @return socket receive buffer length or 0 if not specified.
     */
    public socketRcvbufLength(): number {
        return this._socketRcvbufLength;
    }

    /**
     * Get the socket receive buffer length.
     *
     * @param defaultValue to be used if the UdpChannel's value is 0 (unspecified).
     * @return socket receive buffer length or 0 if not specified.
     */
    public socketRcvbufLengthOrDefault(defaultValue: number): number {
        return 0 !== this._socketRcvbufLength ? this._socketRcvbufLength : defaultValue;
    }

    /**
     * Get the socket send buffer length.
     *
     * @return socket send buffer length or 0 if not specified.
     */
    public socketSndbufLength(): number {
        return this._socketSndbufLength;
    }

    /**
     * Get the socket send buffer length.
     *
     * @param defaultValue to be used if the UdpChannel's value is 0 (unspecified).
     * @return socket send buffer length or defaultValue if not specified.
     */
    public socketSndbufLengthOrDefault(defaultValue: number): number {
        return 0 !== this._socketSndbufLength ? this._socketSndbufLength : defaultValue;
    }

    /**
     * Get the receiver window length used as the initial window length for congestion control.
     *
     * @return receiver window length or 0 if not specified.
     */
    public receiverWindowLength(): number {
        return this._receiverWindowLength;
    }

    /**
     * Get the receiver window length used as the initial window length for congestion control.
     *
     * @param defaultValue to be used if the UdpChannel's value is 0 (unspecified).
     * @return receiver window length or defaultValue if not specified.
     */
    public receiverWindowLengthOrDefault(defaultValue: number): number {
        return 0 !== this.receiverWindowLength() ? this.receiverWindowLength() : defaultValue;
    }

    /**
     * The length of the initial nak delay to be used by the LossDetector on this channel.
     *
     * @return delay in nanoseconds or null if the value is not set.
     */
    public nakDelayNs(): number | null {
        return this._nakDelayNs;
    }

    /**
     * Does this channel have a tag match to another channel having INADDR_ANY endpoints.
     *
     * @param udpChannel    to match against.
     * @param localAddress  local address override to use for this channel.
     * @param remoteAddress remote address override to use for this channel.
     * @return true if there is a match otherwise false.
     */
    public matchesTag(
        udpChannel: UdpChannel,
        localAddress: InetSocketAddress | null,
        remoteAddress: InetSocketAddress | null,
    ): boolean {
        if (!this._hasTag || !udpChannel.hasTag() || this._tag !== udpChannel.tag()) {
            return false;
        }

        if (!this.hasMatchingControlMode(udpChannel)) {
            throw new IllegalArgumentException(
                'matching tag=' +
                    this._tag +
                    ' has mismatched control-mode: ' +
                    this._uriStr +
                    ' <> ' +
                    udpChannel._uriStr,
            );
        }

        if (!this.hasMatchingAddress(udpChannel, localAddress, remoteAddress)) {
            throw new IllegalArgumentException(
                'matching tag=' +
                    this._tag +
                    ' has mismatched endpoint or control: ' +
                    this._uriStr +
                    ' <> ' +
                    udpChannel._uriStr,
            );
        }

        return true;
    }

    private isWildcard(): boolean {
        return (
            addressOf(this._remoteData).isAnyLocalAddress() &&
            this._remoteData.getPort() === 0 &&
            addressOf(this._localData).isAnyLocalAddress() &&
            this._localData.getPort() === 0
        );
    }

    private hasMatchingControlMode(udpChannel: UdpChannel): boolean {
        return this.controlMode() === ControlMode.NONE || this.controlMode() === udpChannel.controlMode();
    }

    private hasMatchingAddress(
        udpChannel: UdpChannel,
        localAddress: InetSocketAddress | null,
        remoteAddress: InetSocketAddress | null,
    ): boolean {
        const otherLocalData = localAddress !== null ? localAddress : udpChannel.localData();
        const otherRemoteData = remoteAddress !== null ? remoteAddress : udpChannel.remoteData();

        return (
            this.isWildcard() ||
            (addressOf(this.remoteData()).equals(otherRemoteData.getAddress()) &&
                this.remoteData().getPort() === otherRemoteData.getPort() &&
                addressOf(this.localData()).equals(otherLocalData.getAddress()) &&
                this.localData().getPort() === otherLocalData.getPort())
        );
    }

    /**
     * Used for debugging to get a human-readable description of the channel.
     *
     * @return a human-readable description of the channel.
     */
    public description(): string {
        return (
            'localData: ' +
            NetworkUtil.formatAddressAndPort(addressOf(this._localData), this._localData.getPort()) +
            ', remoteData: ' +
            NetworkUtil.formatAddressAndPort(addressOf(this._remoteData), this._remoteData.getPort()) +
            ', ttl: ' +
            this._multicastTtl
        );
    }

    /**
     * Channels are considered equal if the {@link #canonicalForm()} is equal.
     *
     * @param o object to be compared with.
     * @return true if the {@link #canonicalForm()} is equal, otherwise false.
     */
    public equals(o: unknown): boolean {
        if (this === o) {
            return true;
        }

        if (o === null || o === undefined || !(o instanceof UdpChannel)) {
            return false;
        }

        return objectsEquals(this._canonicalForm, o._canonicalForm);
    }

    /**
     * The hash code for the {@link #canonicalForm()}.
     *
     * @return the hash code for the {@link #canonicalForm()}.
     */
    public hashCode(): number {
        return this._canonicalForm !== null ? stringHashCode(this._canonicalForm) : 0;
    }

    /**
     * Get the endpoint destination address from the URI.
     *
     * @param uri          to check.
     * @param nameResolver to use for resolution.
     * @return endpoint address for URI.
     */
    public static destinationAddress(uri: ChannelUri, nameResolver: NameResolver): InetSocketAddress {
        try {
            UdpChannel.validateConfiguration(uri);

            const endpointValue = uri.get(CommonContext.ENDPOINT_PARAM_NAME);
            // A missing endpoint is null in Java and SocketAddressParser.parse rejects it with a NullPointerException.
            return SocketAddressParser.parse(
                endpointValue as string,
                CommonContext.ENDPOINT_PARAM_NAME,
                false,
                nameResolver,
            );
        } catch (ex) {
            if (ex instanceof Exception) {
                throw new InvalidChannelException(ex);
            }
            throw ex;
        }
    }

    /**
     * Check if the address pointed to by the endpoint is multicast.
     *
     * @param uri to check.
     * @return {@code true} if the destination uses multicast address.
     * @since 1.44.0
     */
    public static isMulticastDestinationAddress(uri: ChannelUri): boolean {
        try {
            UdpChannel.validateConfiguration(uri);

            const endpointValue = uri.get(CommonContext.ENDPOINT_PARAM_NAME);
            return UdpChannel.isMulticastEndpoint(endpointValue as string);
        } catch (ex) {
            if (ex instanceof Exception) {
                throw new InvalidChannelException(ex);
            }
            throw ex;
        }
    }

    /**
     * Check if the endpoint is multicast.
     *
     * @param endpoint to check.
     * @return {@code true} if the destination uses multicast address.
     * @since 1.47.0
     */
    public static isMulticastEndpoint(endpoint: string): boolean {
        return SocketAddressParser.isMulticastAddress(endpoint);
    }

    /**
     * Resolve and endpoint into a {@link InetSocketAddress}.
     *
     * @param endpoint       to resolve.
     * @param uriParamName   for the resolution.
     * @param isReResolution for the resolution.
     * @param nameResolver   to be used for hostname.
     * @return address for endpoint.
     */
    public static resolve(
        endpoint: string,
        uriParamName: string,
        isReResolution: boolean,
        nameResolver: NameResolver,
    ): InetSocketAddress {
        return SocketAddressParser.parse(endpoint, uriParamName, isReResolution, nameResolver);
    }

    /**
     * Offset to store the channel receive timestamp in a user message.
     *
     * @return offset of channel receive timestamps.
     */
    public channelReceiveTimestampOffset(): number {
        return this._channelReceiveTimestampOffset;
    }

    /**
     * Check if channel receive timestamps should be recorded.
     *
     * @return true if channel receive timestamps should be collected false otherwise.
     */
    public isChannelReceiveTimestampEnabled(): boolean {
        return (
            UdpChannel.RESERVED_VALUE_MESSAGE_OFFSET === this._channelReceiveTimestampOffset ||
            0 <= this._channelReceiveTimestampOffset
        );
    }

    /**
     * Check if channel send timestamps should be recorded.
     *
     * @return true if channel send timestamps should be collected false otherwise.
     */
    public isChannelSendTimestampEnabled(): boolean {
        return (
            UdpChannel.RESERVED_VALUE_MESSAGE_OFFSET === this._channelSendTimestampOffset ||
            0 <= this._channelSendTimestampOffset
        );
    }

    /**
     * Offset to store the channel send timestamp in a user message.
     *
     * @return offset of channel send timestamps.
     */
    public channelSendTimestampOffset(): number {
        return this._channelSendTimestampOffset;
    }

    /**
     * Group tag specified for this channel or null if not specified.
     *
     * @return group tag for the channel
     */
    public groupTag(): number | null {
        return this._groupTag;
    }

    private static getMulticastControlAddress(endpointAddress: InetSocketAddress): InetSocketAddress {
        const addressAsBytes = addressOf(endpointAddress).getAddress();
        UdpChannel.validateDataAddress(addressAsBytes);

        // Java's byte increment wraps; so does the Uint8Array element.
        addressAsBytes[addressAsBytes.length - 1]!++;
        return new InetSocketAddress(InetAddressClass.getByAddress(null, addressAsBytes), endpointAddress.getPort());
    }

    private static getInterface(uri: ChannelUri): UnresolvedInterface {
        const interfaceValue = uri.get(CommonContext.INTERFACE_PARAM_NAME);
        if (null !== interfaceValue) {
            return UnresolvedInterface.parse(interfaceValue);
        }

        return InterfaceSearchAddress.wildcard();
    }

    private static getEndpointAddress(uri: ChannelUri, nameResolver: NameResolver): InetSocketAddress | null {
        let address: InetSocketAddress | null = null;
        const endpointValue = uri.get(CommonContext.ENDPOINT_PARAM_NAME);
        if (null !== endpointValue) {
            address = SocketAddressParser.parse(endpointValue, CommonContext.ENDPOINT_PARAM_NAME, false, nameResolver);

            if (address.isUnresolved()) {
                throw new UnknownHostException(
                    'unresolved - ' +
                        CommonContext.ENDPOINT_PARAM_NAME +
                        '=' +
                        endpointValue +
                        ', name-resolver=' +
                        nameResolver.name(),
                );
            }
        }

        return address;
    }

    private static getExplicitControlAddress(uri: ChannelUri, nameResolver: NameResolver): InetSocketAddress | null {
        let address: InetSocketAddress | null = null;
        const controlValue = uri.get(CommonContext.MDC_CONTROL_PARAM_NAME);
        if (null !== controlValue) {
            address = SocketAddressParser.parse(
                controlValue,
                CommonContext.MDC_CONTROL_PARAM_NAME,
                false,
                nameResolver,
            );

            if (address.isUnresolved()) {
                // Java: nameResolver.getClass().getName()
                throw new UnknownHostException(
                    'unresolved - ' +
                        CommonContext.MDC_CONTROL_PARAM_NAME +
                        '=' +
                        controlValue +
                        ', name-resolver=' +
                        nameResolver.constructor.name,
                );
            }
        }

        return address;
    }

    private static validateDataAddress(addressAsBytes: Uint8Array): void {
        if (BitUtil.isEven(addressAsBytes[addressAsBytes.length - 1] as number)) {
            throw new IllegalArgumentException('multicast data address must be odd');
        }
    }

    private static validateConfiguration(uri: ChannelUri): void {
        UdpChannel.validateMedia(uri);
    }

    private static validateMedia(uri: ChannelUri): void {
        // Java's `uri.isUdp()` on a null uri is a NullPointerException.
        if (!requireNonNull(uri, 'Cannot invoke "io.aeron.ChannelUri.isUdp()" because "uri" is null').isUdp()) {
            throw new IllegalArgumentException('UdpChannel only supports UDP media: ' + uri);
        }
    }
}

/**
 * The nested `UdpChannel.Context` of Java (package-private): the builder that {@link UdpChannel.parse} fills. A
 * TypeScript class cannot have a field and a method of one name, so each field has the Java name with a trailing
 * underscore and the fluent setters keep the Java names.
 */
export class UdpChannelContext {
    public controlMode_: ControlMode = ControlMode.NONE;
    public hasExplicitEndpoint_: boolean = false;
    public hasExplicitControl_: boolean = false;
    public isMulticast_: boolean = false;
    public hasMulticastTtl_: boolean = false;
    public hasTagId_: boolean = false;
    public hasNoDistinguishingCharacteristic_: boolean = false;
    public socketRcvbufLength_: number = 0;
    public socketSndbufLength_: number = 0;
    public receiverWindowLength_: number = 0;
    public multicastTtl_: number = 0;
    public tagId_: number = 0;
    public remoteData_: InetSocketAddress | null = null;
    public localData_: InetSocketAddress | null = null;
    public remoteControl_: InetSocketAddress | null = null;
    public localControl_: InetSocketAddress | null = null;
    public uriStr_: string | null = null;
    public canonicalForm_: string | null = null;
    public localInterface_: NetworkInterface | null = null;
    public protocolFamily_: ProtocolFamily | null = null;
    public channelUri_: ChannelUri | null = null;
    public channelReceiveTimestampOffset_: number = 0;
    public channelSendTimestampOffset_: number = 0;
    public groupTag_: number | null = null;
    public nakDelayNs_: number | null = null;

    public uriStr(uri: string): this {
        this.uriStr_ = uri;
        return this;
    }

    public remoteDataAddress(remoteData: InetSocketAddress): this {
        this.remoteData_ = remoteData;
        return this;
    }

    public localDataAddress(localData: InetSocketAddress): this {
        this.localData_ = localData;
        return this;
    }

    public remoteControlAddress(remoteControl: InetSocketAddress): this {
        this.remoteControl_ = remoteControl;
        return this;
    }

    public localControlAddress(localControl: InetSocketAddress): this {
        this.localControl_ = localControl;
        return this;
    }

    public canonicalForm(canonicalForm: string): this {
        this.canonicalForm_ = canonicalForm;
        return this;
    }

    public localInterface(networkInterface: NetworkInterface | null): this {
        this.localInterface_ = networkInterface;
        return this;
    }

    public protocolFamily(protocolFamily: ProtocolFamily): this {
        this.protocolFamily_ = protocolFamily;
        return this;
    }

    public hasMulticastTtl(hasMulticastTtl: boolean): this {
        this.hasMulticastTtl_ = hasMulticastTtl;
        return this;
    }

    public multicastTtl(multicastTtl: number): this {
        this.multicastTtl_ = multicastTtl;
        return this;
    }

    public tagId(tagId: number): this {
        this.tagId_ = tagId;
        return this;
    }

    public channelUri(channelUri: ChannelUri): this {
        this.channelUri_ = channelUri;
        return this;
    }

    public controlMode(controlMode: ControlMode): this {
        this.controlMode_ = controlMode;
        return this;
    }

    public hasExplicitEndpoint(hasExplicitEndpoint: boolean): this {
        this.hasExplicitEndpoint_ = hasExplicitEndpoint;
        return this;
    }

    public hasExplicitControl(hasExplicitControl: boolean): this {
        this.hasExplicitControl_ = hasExplicitControl;
        return this;
    }

    public isMulticast(isMulticast: boolean): this {
        this.isMulticast_ = isMulticast;
        return this;
    }

    public hasTagId(hasTagId: boolean): this {
        this.hasTagId_ = hasTagId;
        return this;
    }

    public hasNoDistinguishingCharacteristic(hasNoDistinguishingCharacteristic: boolean): this {
        this.hasNoDistinguishingCharacteristic_ = hasNoDistinguishingCharacteristic;
        return this;
    }

    public socketRcvbufLength(socketRcvbufLength: number): this {
        this.socketRcvbufLength_ = socketRcvbufLength;
        return this;
    }

    public socketSndbufLength(socketSndbufLength: number): this {
        this.socketSndbufLength_ = socketSndbufLength;
        return this;
    }

    public receiverWindowLength(receiverWindowLength: number): this {
        this.receiverWindowLength_ = receiverWindowLength;
        return this;
    }

    public channelReceiveTimestampOffset(timestampOffset: number): this {
        this.channelReceiveTimestampOffset_ = timestampOffset;
        return this;
    }

    public channelSendTimestampOffset(timestampOffset: number): this {
        this.channelSendTimestampOffset_ = timestampOffset;
        return this;
    }

    public nakDelayNs(nakDelayNs: number | null): this {
        this.nakDelayNs_ = nakDelayNs;
        return this;
    }

    /** Returns void in Java. */
    public groupTag(groupTag: number | null): void {
        this.groupTag_ = groupTag;
    }
}
