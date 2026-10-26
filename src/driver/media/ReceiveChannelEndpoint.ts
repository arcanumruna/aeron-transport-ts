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
// Port of io/aeron/driver/media/ReceiveChannelEndpoint.java @ 1.53.3
import { CloseHelper } from '../../agrona/CloseHelper.js';
import { Int2IntCounterMap } from '../../agrona/collections/Int2IntCounterMap.js';
import { LongHalves2LongCounterMap } from '../../agrona/collections/LongHalves2LongCounterMap.js';
import type { CachedNanoClock } from '../../agrona/concurrent/CachedNanoClock.js';
import type { UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import type { AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { IllegalStateException, TimeUnit } from '../../agrona/jdk.js';
import { requireNonNull } from '../../agrona/jdkLang.js';
import { CommonContext } from '../../client/CommonContext.js';
import { ErrorCode } from '../../client/ErrorCode.js';
import { AeronException } from '../../client/exceptions/AeronException.js';
import { ControlProtocolException } from '../../client/exceptions/ControlProtocolException.js';
import type { DataHeaderFlyweight } from '../../client/protocol/DataHeaderFlyweight.js';
import type { ErrorFlyweight } from '../../client/protocol/ErrorFlyweight.js';
import { NakFlyweight } from '../../client/protocol/NakFlyweight.js';
import { ResponseSetupFlyweight } from '../../client/protocol/ResponseSetupFlyweight.js';
import { RttMeasurementFlyweight } from '../../client/protocol/RttMeasurementFlyweight.js';
import type { SetupFlyweight } from '../../client/protocol/SetupFlyweight.js';
import { StatusMessageFlyweight } from '../../client/protocol/StatusMessageFlyweight.js';
import { ChannelEndpointStatus } from '../../client/status/ChannelEndpointStatus.js';
import { LocalSocketAddressStatus } from '../../client/status/LocalSocketAddressStatus.js';
import type { InetSocketAddress } from '../jdkNet.js';
import type { MediaDriverContext } from '../MediaDriver.js';
import { SystemCounterDescriptor } from '../status/SystemCounterDescriptor.js';
import type { ImageConnection } from './ImageConnection.js';
import { MultiRcvDestination } from './MultiRcvDestination.js';
import type { ReceiveChannelEndpointThreadLocals } from './ReceiveChannelEndpointThreadLocals.js';
import type { ReceiveDestinationTransport } from './ReceiveDestinationTransport.js';
import type { DriverConductorProxy } from './SendChannelEndpoint.js';
import type { UdpChannel } from './UdpChannel.js';
import { UdpChannelTransport } from './UdpChannelTransport.js';

const { SEND_SETUP_FLAG } = StatusMessageFlyweight;

/**
 * Stand-in for `DataPacketDispatcher`, which task T14 ports. It has the members that a `ReceiveChannelEndpoint` calls;
 * T14 replaces it with `import type { DataPacketDispatcher } from '../DataPacketDispatcher.js'` (spec D24,
 * `docs/mapping.md`).
 */
export interface DataPacketDispatcher {
    onDataPacket(
        channelEndpoint: ReceiveChannelEndpoint,
        header: DataHeaderFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): number;

    onSetupMessage(
        channelEndpoint: ReceiveChannelEndpoint,
        msg: SetupFlyweight,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): void;

    onRttMeasurement(
        channelEndpoint: ReceiveChannelEndpoint,
        msg: RttMeasurementFlyweight,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): void;
}

/**
 * Aggregator of multiple subscriptions onto a single transport channel for the receiving of data and setup frames
 * plus sending status and NAK frames.
 * <p>
 * Java pads the hot fields against false sharing; a JS object has no field layout to control (spec D11, D19), so the
 * padding classes are not ported.
 */
export class ReceiveChannelEndpoint extends UdpChannelTransport {
    public static readonly DESTINATION_ADDRESS_TIMEOUT: number = TimeUnit.SECONDS.toNanos(5);

    /**
     * Counter for the number of errors frames send back by this channel endpoint.
     */
    protected readonly errorFramesSent: AtomicCounter;
    public timeOfLastActivityNs: number;

    private readonly _dispatcher: DataPacketDispatcher;
    private readonly smBuffer: UnsafeBuffer;
    private readonly statusMessageFlyweight: StatusMessageFlyweight;
    private readonly nakBuffer: UnsafeBuffer;
    private readonly nakFlyweight: NakFlyweight;
    private readonly rttMeasurementBuffer: UnsafeBuffer;
    private readonly rttMeasurementFlyweight: RttMeasurementFlyweight;
    private readonly responseSetupBuffer: UnsafeBuffer;
    private readonly responseSetupHeader: ResponseSetupFlyweight;
    private readonly errorBuffer: UnsafeBuffer;
    private readonly errorFlyweight: ErrorFlyweight;
    private readonly shortSends: AtomicCounter;
    private readonly possibleTtlAsymmetry: AtomicCounter;
    private readonly statusIndicator: AtomicCounter;
    private readonly refCountByStreamIdMap = new Int2IntCounterMap(0);
    // keyed by (streamId, sessionId) as the halves of Java's compoundKey (spec D14)
    private readonly refCountByStreamIdAndSessionIdMap = new LongHalves2LongCounterMap(0);
    private readonly responseRefCountByStreamIdMap = new Int2IntCounterMap(0);
    private readonly multiRcvDestination: MultiRcvDestination | null;
    private readonly cachedNanoClock: CachedNanoClock;
    private readonly groupTag: bigint | null;
    private readonly isChannelReceiveTimestampEnabled: boolean;

    // The receiver id is a `long`; the halves are what the frames write and compare, without a `bigint` (spec D14).
    private readonly receiverId: bigint;
    private readonly receiverIdHigh: number;
    private readonly receiverIdLow: number;
    private _currentControlAddress: InetSocketAddress | null;
    private _localSocketAddressIndicator: AtomicCounter | null = null;
    private imageRefCount = 0;

    /**
     * Construct the receiver end for data streams.
     *
     * @param udpChannel      configuration for the media.
     * @param dispatcher      for forwarding packets.
     * @param statusIndicator to indicate the status of the channel endpoint.
     * @param context         for configuration.
     */
    public constructor(
        udpChannel: UdpChannel,
        dispatcher: DataPacketDispatcher,
        statusIndicator: AtomicCounter,
        context: MediaDriverContext,
    ) {
        super(
            udpChannel,
            udpChannel.remoteData(),
            udpChannel.remoteData(),
            null,
            context.receiverPortManager(),
            context,
        );

        const systemCounters = requireNonNull(context.systemCounters());
        this.errorFramesSent = systemCounters.get(SystemCounterDescriptor.ERROR_FRAMES_SENT);

        this._dispatcher = dispatcher;
        this.statusIndicator = statusIndicator;

        this.shortSends = systemCounters.get(SystemCounterDescriptor.SHORT_SENDS);
        this.possibleTtlAsymmetry = systemCounters.get(SystemCounterDescriptor.POSSIBLE_TTL_ASYMMETRY);

        const threadLocals = context.receiveChannelEndpointThreadLocals() as ReceiveChannelEndpointThreadLocals;
        this.smBuffer = threadLocals.statusMessageBuffer();
        this.statusMessageFlyweight = threadLocals.statusMessageFlyweight();
        this.nakBuffer = threadLocals.nakBuffer();
        this.nakFlyweight = threadLocals.nakFlyweight();
        this.rttMeasurementBuffer = threadLocals.rttMeasurementBuffer();
        this.rttMeasurementFlyweight = threadLocals.rttMeasurementFlyweight();
        this.responseSetupBuffer = threadLocals.responseSetupBuffer();
        this.responseSetupHeader = threadLocals.responseSetupHeader();
        this.errorBuffer = threadLocals.errorBuffer();
        this.errorFlyweight = threadLocals.errorFlyweight();
        this.cachedNanoClock = context.receiverCachedNanoClock() as CachedNanoClock;
        this.timeOfLastActivityNs = this.cachedNanoClock.nanoTime();
        this.receiverId = threadLocals.nextReceiverId();
        this.receiverIdHigh = Number(BigInt.asIntN(32, this.receiverId >> 32n));
        this.receiverIdLow = Number(BigInt.asIntN(32, this.receiverId));

        // a group tag is a `long`: the frames take a `bigint` (spec 5.2), made once here
        const channelGroupTag = udpChannel.groupTag();
        const groupTag = null === channelGroupTag ? context.receiverGroupTag() : channelGroupTag;
        this.groupTag = null === groupTag ? null : BigInt(groupTag);

        this.multiRcvDestination = udpChannel.isManualControlMode() ? new MultiRcvDestination() : null;
        this._currentControlAddress = udpChannel.localControl();

        // Java also reads context.channelReceiveTimestampClock() here and never uses it: PublicationImage does
        this.isChannelReceiveTimestampEnabled = udpChannel.isChannelReceiveTimestampEnabled();
    }

    /**
     * Set a channel binding status counter, if required (not used by control-mode=manual).
     *
     * @param counter to be set.
     */
    public localSocketAddressIndicator(counter: AtomicCounter): void {
        if (null !== this.multiRcvDestination) {
            throw new IllegalStateException('local socket address indicator not used for MDS');
        }

        this._localSocketAddressIndicator = counter;
    }

    /**
     * Send `length` bytes of `buffer` from `offset` to the remote address (Java: `sendTo(ByteBuffer, InetSocketAddress)`,
     * with the `ByteBuffer` position and remaining as `offset` and `length`, spec D28).
     *
     * @param buffer        to send containing the payload.
     * @param offset        of the first byte to send.
     * @param length        of the bytes to send.
     * @param remoteAddress to send the payload to.
     * @return number of bytes sent.
     */
    public override sendTo(
        buffer: UnsafeBuffer,
        offset: number,
        length: number,
        remoteAddress: InetSocketAddress,
    ): number {
        let bytesSent = 0;
        if (null !== this.sendDatagramChannel) {
            this.sendHook(buffer, remoteAddress);
            bytesSent = super.sendTo(buffer, offset, length, remoteAddress);
        }

        return bytesSent;
    }

    /**
     * The original URI String used when a subscription was added.
     *
     * @return the original URI String used when a subscription was added.
     */
    public originalUriString(): string {
        return this.subscriptionUdpChannel().originalUriString();
    }

    /**
     * Counter which indicates the status of the channel.
     *
     * @return counter which indicates the status of the channel.
     */
    public statusIndicatorCounter(): AtomicCounter {
        return this.statusIndicator;
    }

    /**
     * Indicate that the channel as active after successfully opening it.
     */
    public indicateActive(): void {
        const currentStatus = this.statusIndicator.getPlain();
        if (currentStatus !== ChannelEndpointStatus.INITIALIZING) {
            throw new AeronException(
                'channel cannot be registered unless INITIALIZING: status=' +
                    ChannelEndpointStatus.status(currentStatus),
            );
        }

        if (null === this.multiRcvDestination) {
            const bindAddressAndPort = this.bindAddressAndPort();
            this.statusIndicator.appendToLabel(bindAddressAndPort);
            this.updateLocalSocketAddress(bindAddressAndPort);
        }

        this.statusIndicator.setRelease(ChannelEndpointStatus.ACTIVE);
    }

    /**
     * Indicate that the channel is closing and should not be used for new subscriptions.
     */
    public indicateClosing(): void {
        this.statusIndicator.setRelease(ChannelEndpointStatus.CLOSING);
    }

    /**
     * The {@link ChannelEndpointStatus} value for the channel.
     *
     * <p>Must not be called after calling {@link close}, as it accesses a counter.</p>
     *
     * @return the {@link ChannelEndpointStatus} value for the channel.
     */
    public status(): number {
        return this.statusIndicator.getAcquire();
    }

    /**
     * Open the underlying sockets for the channel.
     */
    public openChannel(): void {
        if (null === this.multiRcvDestination) {
            this.openDatagramChannel(this.statusIndicator);
        }
    }

    /**
     * {@inheritDoc}
     */
    public override close(): void {
        super.close();

        CloseHelper.close(this.errorHandler, this.statusIndicator);
        CloseHelper.close(this.errorHandler, this._localSocketAddressIndicator);
        if (null !== this.multiRcvDestination) {
            this.multiRcvDestination.close(this.errorHandler);
        }
    }

    /**
     * Increment the {@link SystemCounterDescriptor.POSSIBLE_TTL_ASYMMETRY} counter.
     */
    public possibleTtlAsymmetryEncountered(): void {
        this.possibleTtlAsymmetry.incrementRelease();
    }

    /**
     * Called from the {@link DriverConductor} to increment the reference count for a given stream id.
     *
     * @param streamId to increment the reference for.
     * @return current reference count after the increment.
     */
    public incRefToStream(streamId: number): number {
        return this.refCountByStreamIdMap.incrementAndGet(streamId);
    }

    /**
     * Called from the {@link DriverConductor} to decrement the reference count for a given stream id.
     *
     * @param streamId to decrement the reference for.
     * @return current reference count after the decrement.
     */
    public decRefToStream(streamId: number): number {
        const count = this.refCountByStreamIdMap.decrementAndGet(streamId);

        if (-1 === count) {
            this.refCountByStreamIdMap.remove(streamId);
            throw new IllegalStateException('unknown stream Id: ' + streamId);
        }

        return count;
    }

    /**
     * Called from the {@link DriverConductor} to increment the reference count for a given stream id and session id.
     *
     * @param streamId  to increment the reference for.
     * @param sessionId to increment the reference for.
     * @return current reference count after the increment.
     */
    public incRefToStreamAndSession(streamId: number, sessionId: number): number {
        return this.refCountByStreamIdAndSessionIdMap.incrementAndGet(streamId, sessionId);
    }

    /**
     * Called from the {@link DriverConductor} to decrement the reference count for a given stream id and session id.
     *
     * @param streamId  to increment the reference for.
     * @param sessionId to increment the reference for.
     * @return current reference count after the decrement.
     */
    public decRefToStreamAndSession(streamId: number, sessionId: number): number {
        const count = this.refCountByStreamIdAndSessionIdMap.decrementAndGet(streamId, sessionId);

        if (-1 === count) {
            this.refCountByStreamIdAndSessionIdMap.remove(streamId, sessionId);
            throw new IllegalStateException('unknown stream Id + session Id: ' + streamId + ' ' + sessionId);
        }

        return count;
    }

    /**
     * Called from the {@link DriverConductor} to increment the reference count for a given stream id for a response
     * subscription while it is waiting to be connected.
     *
     * @param streamId to increment the reference for.
     * @return current reference count after the increment.
     */
    public incResponseRefToStream(streamId: number): number {
        return this.responseRefCountByStreamIdMap.incrementAndGet(streamId);
    }

    /**
     * Called from the {@link DriverConductor} to decrement the reference count for a given stream id for a response
     * subscription while it is waiting to be connected.
     *
     * @param streamId to decrement the reference for.
     * @return current reference count after the decrement.
     */
    public decResponseRefToStream(streamId: number): number {
        const count = this.responseRefCountByStreamIdMap.decrementAndGet(streamId);

        if (-1 === count) {
            this.responseRefCountByStreamIdMap.remove(streamId);
            throw new IllegalStateException('unknown stream Id: ' + streamId);
        }

        return count;
    }

    /**
     * Total count of distinct subscriptions to streams.
     *
     * @return total count of distinct subscriptions to streams.
     */
    public distinctSubscriptionCount(): number {
        return this.refCountByStreamIdMap.size() + this.refCountByStreamIdAndSessionIdMap.size();
    }

    /**
     * Called from the {@link DriverConductor} to determine if the channel should be closed for cleanup.
     *
     * @return true if the channel should be closed for cleanup.
     */
    public shouldBeClosed(): boolean {
        return (
            this.refCountByStreamIdMap.isEmpty() &&
            this.refCountByStreamIdAndSessionIdMap.isEmpty() &&
            this.responseRefCountByStreamIdMap.isEmpty() &&
            !this.statusIndicator.isClosed() &&
            this.statusIndicator.get() !== ChannelEndpointStatus.CLOSING &&
            this.imageRefCount <= 0
        );
    }

    /**
     * Does the channel have an explicit control address as used with multi-destination-cast or not?
     *
     * @return does channel have an explicit control address or not?
     */
    public hasExplicitControl(): boolean {
        return this._udpChannel.hasExplicitControl();
    }

    /**
     * Does the channel have an explicit control address as used with multi-destination-cast or not?
     *
     * @return does channel have an explicit control address or not?
     */
    public explicitControlAddress(): InetSocketAddress | null {
        return this._udpChannel.hasExplicitControl() ? this._currentControlAddress : null;
    }

    /**
     * Has the channel got control of destinations for MDS.
     *
     * @return true if the channel got control of destinations for MDS.
     */
    public hasDestinationControl(): boolean {
        return null !== this.multiRcvDestination;
    }

    /**
     * Validate that the channel allows destination control.
     * <p>
     * If not then a {@link ControlProtocolException} will be thrown.
     */
    public validateAllowsDestinationControl(): void {
        if (null === this.multiRcvDestination) {
            throw new ControlProtocolException(ErrorCode.INVALID_CHANNEL, 'channel does not allow manual control');
        }
    }

    /**
     * Is a given transport index multicast? Without an index (Java: `isMulticast()`), is the primary transport
     * multicast?
     *
     * @param transportIndex to check for multicast.
     * @return true if the transport index is multicast.
     */
    public override isMulticast(transportIndex = 0): boolean {
        if (null !== this.multiRcvDestination) {
            return this.multiRcvDestination.transport(transportIndex).isMulticast();
        } else if (0 === transportIndex) {
            return super.isMulticast();
        }

        throw new IllegalStateException('isMulticast for unknown index ' + transportIndex);
    }

    /**
     * Return the {@link UdpChannel} for the Subscription channel.
     *
     * @return {@link UdpChannel} for the Subscription channel.
     */
    public subscriptionUdpChannel(): UdpChannel {
        return this._udpChannel;
    }

    /**
     * Get the {@link UdpChannel} for the transport index, or for the primary transport without an index.
     *
     * @param transportIndex to the {@link UdpChannel}.
     * @return the {@link UdpChannel} for the transport index.
     */
    public override udpChannel(transportIndex = 0): UdpChannel {
        if (null !== this.multiRcvDestination && this.multiRcvDestination.hasDestination(transportIndex)) {
            return this.multiRcvDestination.transport(transportIndex).udpChannel();
        } else if (0 === transportIndex) {
            return super.udpChannel();
        }

        throw new IllegalStateException('udpChannel for unknown index ' + transportIndex);
    }

    /**
     * Has the channel been tagged?
     *
     * @return true if the channel has a tag identity.
     */
    public hasTag(): boolean {
        return this._udpChannel.hasTag();
    }

    /**
     * The tag identity for the channel.
     *
     * @return the tag identity for the channel.
     */
    public tag(): number {
        return this._udpChannel.tag();
    }

    /**
     * Does the channel have a matching tag?
     *
     * @param udpChannel with tag to match against.
     * @return true if the channel matches on tag identity.
     */
    public matchesTag(udpChannel: UdpChannel): boolean {
        return udpChannel.matchesTag(this._udpChannel, this._currentControlAddress, null);
    }

    /**
     * Get the multicast TTL for the transport index, or for the primary transport without an index.
     *
     * @param transportIndex to get the multicast TTL for.
     * @return the multicast TTL for the transport index.
     */
    public override multicastTtl(transportIndex = 0): number {
        if (null !== this.multiRcvDestination) {
            return this.multiRcvDestination.transport(transportIndex).multicastTtl();
        } else if (0 === transportIndex) {
            return super.multicastTtl();
        }

        throw new IllegalStateException('multicastTtl for unknown index ' + transportIndex);
    }

    /**
     * Add a destination to the channel to receive on.
     *
     * @param transport to add for the destination.
     * @return index for the transport.
     */
    public addDestination(transport: ReceiveDestinationTransport): number {
        return (this.multiRcvDestination as MultiRcvDestination).addDestination(transport);
    }

    /**
     * Remove transport by index from the channel.
     *
     * @param transportIndex to be removed.
     */
    public removeDestination(transportIndex: number): void {
        (this.multiRcvDestination as MultiRcvDestination).removeDestination(transportIndex);
    }

    /**
     * Get the transport index for a given channel, or the transport destination for a given index (Java: two
     * overloads of `destination`).
     *
     * @param udpChannelOrIndex to look up the transport index for, or the transport index to get.
     * @return the transport index if found otherwise {@link ArrayUtil.UNKNOWN_INDEX}, or the transport destination for
     * a given index.
     */
    public destination(udpChannel: UdpChannel): number;
    public destination(transportIndex: number): ReceiveDestinationTransport;
    public destination(udpChannelOrIndex: UdpChannel | number): ReceiveDestinationTransport | number {
        const multiRcvDestination = this.multiRcvDestination as MultiRcvDestination;
        if (typeof udpChannelOrIndex === 'number') {
            return multiRcvDestination.transport(udpChannelOrIndex);
        }

        return multiRcvDestination.transport(udpChannelOrIndex);
    }

    /**
     * Does the channel have a destination for a given index value.
     *
     * @param transportIndex to check if a destination exists for.
     * @return true if the channel has a given transport index.
     */
    public hasDestination(transportIndex: number): boolean {
        return null === this.multiRcvDestination
            ? 0 === transportIndex
            : this.multiRcvDestination.hasDestination(transportIndex);
    }

    /**
     * Callback to handle a received data packet.
     *
     * @param header         of the data first frame.
     * @param buffer         containing the data packet.
     * @param length         of the data packet.
     * @param srcAddress     from which the data packet was received.
     * @param transportIndex on which the packet was received.
     * @return number of bytes applied as a result of this action.
     */
    public onDataPacket(
        header: DataHeaderFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): number {
        this.updateTimeOfLastActivityNs(this.cachedNanoClock.nanoTime(), transportIndex);
        return this._dispatcher.onDataPacket(this, header, buffer, length, srcAddress, transportIndex);
    }

    /**
     * Callback to handle a received setup frame.
     *
     * @param header         of the setup frame.
     * @param buffer         containing the setup frame.
     * @param length         of the setup frame.
     * @param srcAddress     the message came from.
     * @param transportIndex on which the message was received.
     */
    public onSetupMessage(
        header: SetupFlyweight,
        _buffer: UnsafeBuffer,
        _length: number,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): void {
        if (!header.isValid()) {
            this.invalidPackets.increment();
            return;
        }

        this.updateTimeOfLastActivityNs(this.cachedNanoClock.nanoTime(), transportIndex);
        this._dispatcher.onSetupMessage(this, header, srcAddress, transportIndex);
    }

    /**
     * Callback to handle a received RTT Measurement frame.
     *
     * @param header         of the RTT Measurement frame.
     * @param buffer         containing the RTT Measurement frame.
     * @param length         of the RTT Measurement frame.
     * @param srcAddress     the message came from.
     * @param transportIndex on which the message was received.
     */
    public onRttMeasurement(
        header: RttMeasurementFlyweight,
        _buffer: UnsafeBuffer,
        _length: number,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): void {
        // requestedReceiverId == receiverId || 0 == requestedReceiverId, on the halves (spec D14)
        const requestedReceiverIdHigh = header.receiverIdHigh();
        const requestedReceiverIdLow = header.receiverIdLow();
        if (
            (requestedReceiverIdHigh === this.receiverIdHigh && requestedReceiverIdLow === this.receiverIdLow) ||
            (0 === requestedReceiverIdHigh && 0 === requestedReceiverIdLow)
        ) {
            this.updateTimeOfLastActivityNs(this.cachedNanoClock.nanoTime(), transportIndex);
            this._dispatcher.onRttMeasurement(this, header, srcAddress, transportIndex);
        }
    }

    /**
     * Send a Setup Eliciting Status Message to a source.
     *
     * @param transportIndex for the source.
     * @param controlAddress for the source.
     * @param sessionId      for the image.
     * @param streamId       for the image.
     */
    public sendSetupElicitingStatusMessage(
        transportIndex: number,
        controlAddress: InetSocketAddress,
        sessionId: number,
        streamId: number,
    ): void {
        this.statusMessageFlyweight
            .sessionId(sessionId)
            .streamId(streamId)
            .consumptionTermId(0)
            .consumptionTermOffset(0)
            .receiverWindowLength(0)
            .receiverIdHigh(this.receiverIdHigh)
            .receiverIdLow(this.receiverIdLow)
            .groupTag(this.groupTag)
            .flags(SEND_SETUP_FLAG);

        this.sendToSource(this.smBuffer, this.statusMessageFlyweight.frameLength(), transportIndex, controlAddress);
    }

    /**
     * Send RTT Measurement frame to a source, or to the sources (Java: two overloads of `sendRttMeasurement`).
     *
     * @param transportIndex  for the source.
     * @param controlAddress  for the source.
     * @param sessionId       for the image.
     * @param streamId        for the image.
     * @param echoTimestampNs timestamp to echo in a reply, a `bigint` (an opaque 64-bit value, spec 5.2).
     * @param receptionDelta  time in nanoseconds between receiving original request and sending Reply RTT Measurement,
     *                        a `bigint`.
     * @param isReply         true if a reply.
     */
    public sendRttMeasurement(
        transportIndex: number,
        controlAddress: InetSocketAddress,
        sessionId: number,
        streamId: number,
        echoTimestampNs: bigint,
        receptionDelta: bigint,
        isReply: boolean,
    ): void;
    /**
     * Send RTT Measurement frame to the sources.
     *
     * @param controlAddresses of the sources.
     * @param sessionId        for the image.
     * @param streamId         for the image.
     * @param echoTimestampNs  timestamp to echo in a reply.
     * @param receptionDelta   time in nanoseconds between receiving original request and sending Reply RTT
     *                         Measurement.
     * @param isReply          true if a reply.
     */
    public sendRttMeasurement(
        controlAddresses: (ImageConnection | null)[],
        sessionId: number,
        streamId: number,
        echoTimestampNs: bigint,
        receptionDelta: bigint,
        isReply: boolean,
    ): void;
    public sendRttMeasurement(
        transportIndexOrControlAddresses: number | (ImageConnection | null)[],
        controlAddressOrSessionId: InetSocketAddress | number,
        sessionIdOrStreamId: number,
        streamIdOrEchoTimestampNs: number | bigint,
        echoTimestampNsOrReceptionDelta: bigint,
        receptionDeltaOrIsReply: bigint | boolean,
        isReply?: boolean,
    ): void {
        if (typeof transportIndexOrControlAddresses === 'number') {
            this.rttMeasurementFlyweight
                .sessionId(sessionIdOrStreamId)
                .streamId(streamIdOrEchoTimestampNs as number)
                .receiverIdHigh(this.receiverIdHigh)
                .receiverIdLow(this.receiverIdLow)
                .echoTimestampNs(echoTimestampNsOrReceptionDelta)
                .receptionDelta(receptionDeltaOrIsReply as bigint)
                .flags(isReply ? RttMeasurementFlyweight.REPLY_FLAG : 0);

            this.sendToSource(
                this.rttMeasurementBuffer,
                RttMeasurementFlyweight.HEADER_LENGTH,
                transportIndexOrControlAddresses,
                controlAddressOrSessionId as InetSocketAddress,
            );
        } else {
            this.rttMeasurementFlyweight
                .sessionId(controlAddressOrSessionId as number)
                .streamId(sessionIdOrStreamId)
                .receiverIdHigh(this.receiverIdHigh)
                .receiverIdLow(this.receiverIdLow)
                .echoTimestampNs(streamIdOrEchoTimestampNs as bigint)
                .receptionDelta(echoTimestampNsOrReceptionDelta)
                .flags(receptionDeltaOrIsReply ? RttMeasurementFlyweight.REPLY_FLAG : 0);

            this.sendToImageConnections(
                this.rttMeasurementBuffer,
                RttMeasurementFlyweight.HEADER_LENGTH,
                transportIndexOrControlAddresses,
            );
        }
    }

    /**
     * Send a Status Message back to a sources.
     *
     * @param controlAddresses of the sources.
     * @param sessionId        of the image.
     * @param streamId         of the image.
     * @param termId           of the image to indicate position.
     * @param termOffset       of the image to indicate position.
     * @param windowLength     for available buffer from the position.
     * @param flags            for the header.
     */
    public sendStatusMessage(
        controlAddresses: (ImageConnection | null)[],
        sessionId: number,
        streamId: number,
        termId: number,
        termOffset: number,
        windowLength: number,
        flags: number,
    ): void {
        this.statusMessageFlyweight
            .sessionId(sessionId)
            .streamId(streamId)
            .consumptionTermId(termId)
            .consumptionTermOffset(termOffset)
            .receiverWindowLength(windowLength)
            .receiverIdHigh(this.receiverIdHigh)
            .receiverIdLow(this.receiverIdLow)
            .groupTag(this.groupTag)
            .flags(flags);

        this.sendToImageConnections(this.smBuffer, this.statusMessageFlyweight.frameLength(), controlAddresses);
    }

    /**
     * Send a NAK message back to the sources.
     *
     * @param controlAddresses of the sources.
     * @param sessionId        of the image.
     * @param streamId         of the image.
     * @param termId           of the image to indicate position.
     * @param termOffset       of the image to indicate position.
     * @param length           of the range to be re-transmitted.
     */
    public sendNakMessage(
        controlAddresses: (ImageConnection | null)[],
        sessionId: number,
        streamId: number,
        termId: number,
        termOffset: number,
        length: number,
    ): void {
        // DriverLog.logNaksSent: the logging agents are out of scope (spec section 3)

        this.nakFlyweight.streamId(streamId).sessionId(sessionId).termId(termId).termOffset(termOffset).length(length);

        this.sendToImageConnections(this.nakBuffer, NakFlyweight.HEADER_LENGTH, controlAddresses);
    }

    /**
     * Send a response setup message.
     *
     * @param controlAddresses  of the sources.
     * @param sessionId         for the image.
     * @param streamId          for the image.
     * @param responseSessionId to be used by the remote subscription to listen for responses.
     */
    public sendResponseSetup(
        controlAddresses: (ImageConnection | null)[],
        sessionId: number,
        streamId: number,
        responseSessionId: number,
    ): void {
        this.responseSetupHeader.sessionId(sessionId).streamId(streamId).responseSessionId(responseSessionId);

        this.sendToImageConnections(this.responseSetupBuffer, ResponseSetupFlyweight.HEADER_LENGTH, controlAddresses);
    }

    /**
     * Send an error frame back to the source publications to indicate this image has errored.
     *
     * @param controlAddresses of the sources.
     * @param sessionId        for the image.
     * @param streamId         for the image.
     * @param errorCode        for the error being sent.
     * @param errorMessage     to be sent back to the publication.
     */
    public sendErrorFrame(
        controlAddresses: (ImageConnection | null)[],
        sessionId: number,
        streamId: number,
        errorCode: number,
        errorMessage: string,
    ): void {
        this.errorFramesSent.increment();

        this.errorFlyweight
            .sessionId(sessionId)
            .streamId(streamId)
            .receiverIdHigh(this.receiverIdHigh)
            .receiverIdLow(this.receiverIdLow)
            .groupTag(this.groupTag)
            .errorCode(errorCode)
            .errorMessage(errorMessage);

        this.sendToImageConnections(this.errorBuffer, this.errorFlyweight.frameLength(), controlAddresses);
    }

    /**
     * Dispatcher for the channel.
     *
     * @return dispatcher for the channel.
     */
    public dispatcher(): DataPacketDispatcher {
        return this._dispatcher;
    }

    /**
     * Update the control address for a channel transport when re-resolution occurs.
     *
     * @param transportIndex to update the control address for.
     * @param newAddress     for the control of the transport.
     */
    public updateControlAddress(transportIndex: number, newAddress: InetSocketAddress): void {
        if (null !== this.multiRcvDestination) {
            this.multiRcvDestination.updateControlAddress(transportIndex, newAddress);
        } else if (this._udpChannel.hasExplicitControl()) {
            this._currentControlAddress = newAddress;
        }
    }

    /**
     * Send a frame to the image connections (Java: `send(ByteBuffer, int, ImageConnection[])`, renamed because the
     * transport has a `send` of its own, spec D28).
     *
     * @param buffer           containing the frame.
     * @param length           of the frame in the buffer.
     * @param imageConnections to send the frame to.
     */
    protected sendToImageConnections(
        buffer: UnsafeBuffer,
        length: number,
        imageConnections: (ImageConnection | null)[],
    ): void {
        const bytesSent =
            null === this.multiRcvDestination
                ? this.sendTo(buffer, 0, length, (imageConnections[0] as ImageConnection).controlAddress)
                : this.multiRcvDestination.sendToAll(imageConnections, buffer, length, this.cachedNanoClock.nanoTime());

        if (length !== bytesSent) {
            this.shortSends.increment();
        }
    }

    /**
     * Send a frame to a source (Java: `send(ByteBuffer, int, int, InetSocketAddress)`, renamed as above).
     *
     * @param buffer         containing the frame.
     * @param length         of the frame in the buffer.
     * @param transportIndex to send the frame on.
     * @param remoteAddress  to send the frame to.
     */
    protected sendToSource(
        buffer: UnsafeBuffer,
        length: number,
        transportIndex: number,
        remoteAddress: InetSocketAddress,
    ): void {
        const bytesSent =
            null === this.multiRcvDestination
                ? this.sendTo(buffer, 0, length, remoteAddress)
                : MultiRcvDestination.sendTo(
                      this.multiRcvDestination.transport(transportIndex),
                      buffer,
                      0,
                      length,
                      remoteAddress,
                  );

        if (length !== bytesSent) {
            this.shortSends.increment();
        }
    }

    public checkForReResolution(nowNs: number, conductorProxy: DriverConductorProxy): void {
        if (null !== this.multiRcvDestination) {
            this.multiRcvDestination.checkForReResolution(this, nowNs, conductorProxy);
        } else if (
            this._udpChannel.hasExplicitControl() &&
            this.timeOfLastActivityNs + ReceiveChannelEndpoint.DESTINATION_ADDRESS_TIMEOUT - nowNs < 0
        ) {
            this.timeOfLastActivityNs = nowNs;
            conductorProxy.reResolveControl(
                this._udpChannel.channelUri().get(CommonContext.MDC_CONTROL_PARAM_NAME) as string,
                this._udpChannel,
                this,
                this._currentControlAddress,
            );
        }
    }

    /**
     * Called from the {@link DriverConductor} to increment image ref count for this channel endpoint.
     */
    public incRefImages(): void {
        this.imageRefCount++;
    }

    /**
     * Called from the {@link DriverConductor} to decrement image ref count for this channel endpoint.
     */
    public decRefImages(): void {
        --this.imageRefCount;
    }

    private updateTimeOfLastActivityNs(nowNs: number, transportIndex: number): void {
        if (null === this.multiRcvDestination) {
            this.timeOfLastActivityNs = nowNs;
        } else {
            this.multiRcvDestination.transport(transportIndex).timeOfLastActivityNs(nowNs);
        }
    }

    private updateLocalSocketAddress(bindAddressAndPort: string): void {
        if (null !== this._localSocketAddressIndicator) {
            LocalSocketAddressStatus.updateBindAddress(
                this._localSocketAddressIndicator,
                bindAddressAndPort,
                this.context.countersMetaDataBuffer() as UnsafeBuffer,
            );
            this._localSocketAddressIndicator.setRelease(ChannelEndpointStatus.ACTIVE);
        }
    }

    /**
     * {@inheritDoc}
     */
    public override toString(): string {
        return (
            'ReceiveChannelEndpoint{' +
            'groupTag=' +
            this.groupTag +
            ', isChannelReceiveTimestampEnabled=' +
            this.isChannelReceiveTimestampEnabled +
            ', receiverId=' +
            this.receiverId +
            ', currentControlAddress=' +
            this._currentControlAddress +
            ', imageRefCount=' +
            this.imageRefCount +
            ', udpChannel=' +
            this._udpChannel +
            ', connectAddress=' +
            this.connectAddress +
            ', multiRcvDestination=' +
            this.multiRcvDestination +
            ', statusIndicator=' +
            this.statusIndicator.getPlain() +
            '}'
        );
    }
}
