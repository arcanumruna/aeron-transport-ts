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
// Port of io/aeron/driver/Receiver.java @ 1.53.3
import { ArrayListUtil } from '../agrona/collections/ArrayListUtil.js';
import { ArrayUtil } from '../agrona/collections/ArrayUtil.js';
import type { Agent } from '../agrona/concurrent/Agent.js';
import type { CachedNanoClock } from '../agrona/concurrent/CachedNanoClock.js';
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import type { OneToOneConcurrentArrayQueue } from '../agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import { CommonContext } from '../client/CommonContext.js';
import { Configuration } from './Configuration.js';
import { SessionState } from './DataPacketDispatcher.js';
import type { DriverConductorProxy } from './DriverConductorProxy.js';
import type { DutyCycleTracker } from './DutyCycleTracker.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { MediaDriverContext } from './MediaDriver.js';
import { PendingSetupMessageFromSource } from './PendingSetupMessageFromSource.js';
import type { PublicationImage } from './PublicationImage.js';
import type { DataTransportPoller } from './media/DataTransportPoller.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import type { ReceiveDestinationTransport } from './media/ReceiveDestinationTransport.js';
import type { UdpChannel } from './media/UdpChannel.js';
import { SystemCounterDescriptor } from './status/SystemCounterDescriptor.js';
import type { SystemCounters } from './status/SystemCounters.js';

const { PENDING_SETUPS_TIMEOUT_NS } = Configuration;
const { INIT_IN_PROGRESS, ON_COOL_DOWN } = SessionState;
const { BYTES_RECEIVED, RESOLUTION_CHANGES } = SystemCounterDescriptor;

// Java's `MediaDriver.AERON_DRIVER_RECEIVER_THREAD_NAME` and `..._CLASSIC`, which `MediaDriver` gets with T18.
const AERON_DRIVER_RECEIVER_THREAD_NAME = 'aeron-md-rcv';
const AERON_DRIVER_RECEIVER_THREAD_NAME_CLASSIC = 'receiver';

const EMPTY_IMAGES: PublicationImage[] = [];

/**
 * Agent that receives messages streams and rebuilds {@link PublicationImage}s, plus iterates over them sending
 * status messages, NAKs and RTT measurements.
 * <p>
 * The overloads of Java that differ by the session id (`onAddSubscription` and `onRemoveSubscription`) are one method
 * with an optional `sessionId`.
 */
export class Receiver implements Agent {
    private readonly reResolutionCheckIntervalNs: number;
    private reResolutionDeadlineNs = 0;
    private readonly dataTransportPoller: DataTransportPoller;
    private readonly commandQueue: OneToOneConcurrentArrayQueue<() => void>;
    private readonly totalBytesReceived: AtomicCounter;
    private readonly resolutionChanges: AtomicCounter;
    private readonly nanoClock: NanoClock;
    private readonly cachedNanoClock: CachedNanoClock;
    private publicationImages: PublicationImage[] = EMPTY_IMAGES;
    private readonly pendingSetupMessages: PendingSetupMessageFromSource[] = [];
    private readonly conductorProxy: DriverConductorProxy;
    private readonly dutyCycleTracker: DutyCycleTracker;
    private readonly _roleName: string;

    public constructor(ctx: MediaDriverContext) {
        this.dataTransportPoller = ctx.dataTransportPoller() as DataTransportPoller;
        this.commandQueue = ctx.receiverCommandQueue() as OneToOneConcurrentArrayQueue<() => void>;
        const systemCounters = ctx.systemCounters() as SystemCounters;
        this.totalBytesReceived = systemCounters.get(BYTES_RECEIVED);
        this.resolutionChanges = systemCounters.get(RESOLUTION_CHANGES);
        this.nanoClock = ctx.nanoClock() as NanoClock;
        this.cachedNanoClock = ctx.receiverCachedNanoClock() as CachedNanoClock;
        this.conductorProxy = ctx.driverConductorProxy() as DriverConductorProxy;
        this.reResolutionCheckIntervalNs = ctx.reResolutionCheckIntervalNs();
        this.dutyCycleTracker = ctx.receiverDutyCycleTracker() as DutyCycleTracker;
        this._roleName = CommonContext.threadName(
            AERON_DRIVER_RECEIVER_THREAD_NAME,
            AERON_DRIVER_RECEIVER_THREAD_NAME_CLASSIC,
        );
    }

    /**
     * {@inheritDoc}
     */
    public onStart(): void {
        const nowNs = this.nanoClock.nanoTime();
        this.cachedNanoClock.update(nowNs);
        this.dutyCycleTracker.update(nowNs);
        this.reResolutionDeadlineNs = nowNs + this.reResolutionCheckIntervalNs;
    }

    /**
     * {@inheritDoc}
     */
    public onClose(): void {
        this.dataTransportPoller.close();
    }

    /**
     * {@inheritDoc}
     */
    public roleName(): string {
        return this._roleName;
    }

    /**
     * {@inheritDoc}
     */
    public doWork(): number {
        const nowNs = this.nanoClock.nanoTime();
        this.cachedNanoClock.update(nowNs);
        this.dutyCycleTracker.measureAndUpdate(nowNs);

        let workCount = 0;
        const command = this.commandQueue.poll();
        if (null !== command) {
            command();
            workCount++;
        }

        const bytesReceived = this.dataTransportPoller.pollTransports();
        this.totalBytesReceived.getAndAddOrdered(bytesReceived);

        const publicationImages = this.publicationImages;
        for (let lastIndex = publicationImages.length - 1, i = lastIndex; i >= 0; i--) {
            const image = publicationImages[i] as PublicationImage;
            if (image.isConnected(nowNs)) {
                image.checkEosForDrainTransition(nowNs);

                workCount += image.sendPendingStatusMessage(nowNs);
                workCount += image.processPendingLoss();
                workCount += image.initiateAnyRttMeasurements(nowNs);
            } else {
                this.publicationImages =
                    1 === this.publicationImages.length ? EMPTY_IMAGES : ArrayUtil.removeAt(this.publicationImages, i);
                image.removeFromDispatcher();
                image.receiverRelease();
                workCount++;
            }
        }

        workCount += this.checkPendingSetupMessages(nowNs);

        if (this.reResolutionCheckIntervalNs > 0 && this.reResolutionDeadlineNs - nowNs < 0) {
            this.reResolutionDeadlineNs = nowNs + this.reResolutionCheckIntervalNs;
            this.dataTransportPoller.checkForReResolutions(nowNs, this.conductorProxy);
        }

        return workCount + bytesReceived;
    }

    /** @internal package-private in Java */
    public addPendingSetupMessage(
        sessionId: number,
        streamId: number,
        transportIndex: number,
        channelEndpoint: ReceiveChannelEndpoint,
        periodic: boolean,
        controlAddress: InetSocketAddress | null,
    ): void {
        const cmd = new PendingSetupMessageFromSource(
            sessionId,
            streamId,
            transportIndex,
            channelEndpoint,
            periodic,
            controlAddress,
        );

        cmd.timeOfStatusMessageNs(this.cachedNanoClock.nanoTime());
        this.pendingSetupMessages.push(cmd);
    }

    /** @internal package-private in Java */
    public onAddSubscription(channelEndpoint: ReceiveChannelEndpoint, streamId: number, sessionId?: number): void {
        if (undefined === sessionId) {
            channelEndpoint.dispatcher().addSubscription(streamId);
        } else {
            channelEndpoint.dispatcher().addSubscription(streamId, sessionId);
            if (channelEndpoint.hasExplicitControl()) {
                channelEndpoint.sendSetupElicitingStatusMessage(
                    0,
                    channelEndpoint.explicitControlAddress() as InetSocketAddress,
                    sessionId,
                    streamId,
                );
            }
        }
    }

    /** @internal package-private in Java */
    public onRequestSetup(channelEndpoint: ReceiveChannelEndpoint, streamId: number, sessionId: number): void {
        if (channelEndpoint.hasExplicitControl()) {
            channelEndpoint.sendSetupElicitingStatusMessage(
                0,
                channelEndpoint.explicitControlAddress() as InetSocketAddress,
                sessionId,
                streamId,
            );
        }
    }

    /** @internal package-private in Java */
    public onRemoveSubscription(channelEndpoint: ReceiveChannelEndpoint, streamId: number, sessionId?: number): void {
        if (undefined === sessionId) {
            channelEndpoint.dispatcher().removeSubscription(streamId);
        } else {
            channelEndpoint.dispatcher().removeSubscription(streamId, sessionId);

            const pendingSetupMessages = this.pendingSetupMessages;
            for (let lastIndex = pendingSetupMessages.length - 1, i = lastIndex; i >= 0; i--) {
                const pending = pendingSetupMessages[i] as PendingSetupMessageFromSource;

                if (
                    pending.channelEndpoint() === channelEndpoint &&
                    pending.streamId() === streamId &&
                    pending.sessionId() === sessionId
                ) {
                    ArrayListUtil.fastUnorderedRemove(pendingSetupMessages, i, lastIndex--);
                    pending.removeFromDataPacketDispatcher();
                }
            }
        }
    }

    /** @internal package-private in Java */
    public onNewPublicationImage(channelEndpoint: ReceiveChannelEndpoint, image: PublicationImage): void {
        this.disconnectInactiveImage(channelEndpoint, image.streamId(), image.sessionId());
        this.publicationImages = ArrayUtil.add(this.publicationImages, image);
        channelEndpoint.dispatcher().addPublicationImage(image);
    }

    /** @internal package-private in Java */
    public onRegisterReceiveChannelEndpoint(channelEndpoint: ReceiveChannelEndpoint): void {
        if (!channelEndpoint.hasDestinationControl()) {
            this.dataTransportPoller.registerForRead(channelEndpoint, channelEndpoint, 0);

            if (channelEndpoint.hasExplicitControl()) {
                const controlAddress = channelEndpoint.explicitControlAddress();
                this.addPendingSetupMessage(0, 0, 0, channelEndpoint, true, controlAddress);
                channelEndpoint.sendSetupElicitingStatusMessage(0, controlAddress as InetSocketAddress, 0, 0);
            }
        }
    }

    /** @internal package-private in Java */
    public onCloseReceiveChannelEndpoint(channelEndpoint: ReceiveChannelEndpoint): void {
        this.dataTransportPoller.cancelReadForAllTransports(channelEndpoint);

        const pendingSetupMessages = this.pendingSetupMessages;
        for (let lastIndex = pendingSetupMessages.length - 1, i = lastIndex; i >= 0; i--) {
            const pending = pendingSetupMessages[i] as PendingSetupMessageFromSource;

            if (pending.channelEndpoint() === channelEndpoint) {
                ArrayListUtil.fastUnorderedRemove(pendingSetupMessages, i, lastIndex--);
                pending.removeFromDataPacketDispatcher();
            }
        }

        this.conductorProxy.receiveChannelEndpointClosed(channelEndpoint);
    }

    /** @internal package-private in Java */
    public onRemoveCoolDown(channelEndpoint: ReceiveChannelEndpoint, sessionId: number, streamId: number): void {
        channelEndpoint.dispatcher().removeSessionInterestByState(sessionId, streamId, ON_COOL_DOWN);
    }

    /** @internal package-private in Java */
    public onRemoveInitInProgress(channelEndpoint: ReceiveChannelEndpoint, sessionId: number, streamId: number): void {
        channelEndpoint.dispatcher().removeSessionInterestByState(sessionId, streamId, INIT_IN_PROGRESS);
    }

    /** @internal package-private in Java */
    public onAddDestination(channelEndpoint: ReceiveChannelEndpoint, transport: ReceiveDestinationTransport): void {
        const transportIndex = channelEndpoint.addDestination(transport);
        this.dataTransportPoller.registerForRead(channelEndpoint, transport, transportIndex);

        if (transport.hasExplicitControl()) {
            const controlAddress = transport.explicitControlAddress();
            this.addPendingSetupMessage(0, 0, transportIndex, channelEndpoint, true, controlAddress);
            channelEndpoint.sendSetupElicitingStatusMessage(transportIndex, controlAddress as InetSocketAddress, 0, 0);
        }

        for (const image of this.publicationImages) {
            if (channelEndpoint === image.channelEndpoint()) {
                image.addDestination(transportIndex, transport);
            }
        }
    }

    /** @internal package-private in Java */
    public onRemoveDestination(channelEndpoint: ReceiveChannelEndpoint, udpChannel: UdpChannel): void {
        const transportIndex = channelEndpoint.destination(udpChannel);
        if (ArrayUtil.UNKNOWN_INDEX !== transportIndex) {
            const transport = channelEndpoint.destination(transportIndex);

            this.dataTransportPoller.cancelRead(channelEndpoint, transport);
            channelEndpoint.removeDestination(transportIndex);

            for (const image of this.publicationImages) {
                if (channelEndpoint === image.channelEndpoint()) {
                    image.removeDestination(transportIndex);
                }
            }

            this.conductorProxy.closeReceiveDestination(transport);
        }
    }

    /** @internal package-private in Java */
    public onResolutionChange(
        channelEndpoint: ReceiveChannelEndpoint,
        channel: UdpChannel,
        newAddress: InetSocketAddress,
    ): void {
        const transportIndex = channelEndpoint.hasDestinationControl() ? channelEndpoint.destination(channel) : 0;

        for (let i = 0, size = this.pendingSetupMessages.length; i < size; i++) {
            const pending = this.pendingSetupMessages[i] as PendingSetupMessageFromSource;

            if (
                pending.channelEndpoint() === channelEndpoint &&
                pending.isPeriodic() &&
                pending.transportIndex() === transportIndex
            ) {
                pending.controlAddress(newAddress);
                this.resolutionChanges.getAndAddRelease(1);
            }
        }

        channelEndpoint.updateControlAddress(transportIndex, newAddress);
    }

    /**
     * Reject an image. The correlation id and the position are `number`s (spec D5, 5.2).
     *
     * @internal package-private in Java
     */
    public onRejectImage(imageCorrelationId: number, _position: number, reason: string): void {
        for (const image of this.publicationImages) {
            if (imageCorrelationId === image.correlationId()) {
                image.reject(reason);
                break;
            }
        }
    }

    private checkPendingSetupMessages(nowNs: number): number {
        let workCount = 0;
        const pendingSetupMessages = this.pendingSetupMessages;
        for (let lastIndex = pendingSetupMessages.length - 1, i = lastIndex; i >= 0; i--) {
            const pending = pendingSetupMessages[i] as PendingSetupMessageFromSource;

            if (pending.timeOfStatusMessageNs() + PENDING_SETUPS_TIMEOUT_NS - nowNs < 0) {
                if (!pending.isPeriodic()) {
                    ArrayListUtil.fastUnorderedRemove(pendingSetupMessages, i, lastIndex--);
                    pending.removeFromDataPacketDispatcher();
                    workCount++;
                } else if (pending.shouldElicitSetupMessage()) {
                    pending.timeOfStatusMessageNs(nowNs);
                    pending
                        .channelEndpoint()
                        .sendSetupElicitingStatusMessage(
                            pending.transportIndex(),
                            pending.controlAddress() as InetSocketAddress,
                            pending.sessionId(),
                            pending.streamId(),
                        );
                    workCount++;
                }
            }
        }
        return workCount;
    }

    /** @internal package-private in Java */
    public disconnectInactiveImage(channelEndpoint: ReceiveChannelEndpoint, streamId: number, sessionId: number): void {
        for (const publicationImage of this.publicationImages) {
            if (
                publicationImage.channelEndpoint() === channelEndpoint &&
                publicationImage.streamId() === streamId &&
                publicationImage.sessionId() === sessionId
            ) {
                publicationImage.stopStatusMessagesIfNotActive();
            }
        }
    }
}
