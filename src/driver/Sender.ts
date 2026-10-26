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
// Port of io/aeron/driver/Sender.java @ 1.53.3
import { ArrayUtil } from '../agrona/collections/ArrayUtil.js';
import type { Agent } from '../agrona/concurrent/Agent.js';
import type { CachedNanoClock } from '../agrona/concurrent/CachedNanoClock.js';
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import type { OneToOneConcurrentArrayQueue } from '../agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { ChannelUri } from '../client/ChannelUri.js';
import { CommonContext } from '../client/CommonContext.js';
import type { DutyCycleTracker } from './DutyCycleTracker.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { MediaDriverContext } from './MediaDriver.js';
import type { NetworkPublication } from './NetworkPublication.js';
import type { ControlTransportPoller } from './media/ControlTransportPoller.js';
import type { DriverConductorProxy } from './DriverConductorProxy.js';
import type { SendChannelEndpoint } from './media/SendChannelEndpoint.js';
import { SystemCounterDescriptor } from './status/SystemCounterDescriptor.js';
import type { SystemCounters } from './status/SystemCounters.js';

const { BYTES_SENT, RESOLUTION_CHANGES, SHORT_SENDS } = SystemCounterDescriptor;

// Java's `MediaDriver.AERON_DRIVER_SENDER_THREAD_NAME` and `..._CLASSIC`, which `MediaDriver` gets with T18.
const AERON_DRIVER_SENDER_THREAD_NAME = 'aeron-md-snd';
const AERON_DRIVER_SENDER_THREAD_NAME_CLASSIC = 'sender';

/**
 * Agent that iterates over {@link NetworkPublication}s for sending them to {@link Receiver}s on behalf of registered
 * subscribers.
 * <p>
 * The cache line padding classes of Java (`SenderLhsPadding`, `SenderHotFields`, `SenderRhsPadding`) keep the hot
 * fields of the sender thread off the cache lines of its neighbours; with one thread (spec D3) they have no purpose and
 * the fields are declared here.
 */
export class Sender implements Agent {
    private controlPollDeadlineNs = 0;
    private reResolutionDeadlineNs = 0;
    private dutyCycleCounter = 0;
    private roundRobinIndex = 0;

    private networkPublications: NetworkPublication[] = [];

    private readonly statusMessageReadTimeoutNs: number = 0;
    private readonly reResolutionCheckIntervalNs: number = 0;
    private readonly dutyCycleRatio: number = 0;
    private readonly controlTransportPoller: ControlTransportPoller;
    private readonly commandQueue: OneToOneConcurrentArrayQueue<() => void>;
    private readonly totalBytesSent: AtomicCounter;
    private readonly resolutionChanges: AtomicCounter;
    private readonly shortSends: AtomicCounter;
    private readonly nanoClock: NanoClock;
    private readonly cachedNanoClock: CachedNanoClock;
    private readonly conductorProxy: DriverConductorProxy | null;
    private readonly dutyCycleTracker: DutyCycleTracker;
    private readonly _roleName: string;

    public constructor(ctx: MediaDriverContext) {
        this.controlTransportPoller = ctx.controlTransportPoller() as ControlTransportPoller;
        this.commandQueue = ctx.senderCommandQueue() as OneToOneConcurrentArrayQueue<() => void>;
        const systemCounters = ctx.systemCounters() as SystemCounters;
        this.totalBytesSent = systemCounters.get(BYTES_SENT);
        this.resolutionChanges = systemCounters.get(RESOLUTION_CHANGES);
        this.shortSends = systemCounters.get(SHORT_SENDS);
        this.nanoClock = ctx.nanoClock() as NanoClock;
        this.cachedNanoClock = ctx.senderCachedNanoClock() as CachedNanoClock;
        // Java: `ctx.statusMessageTimeoutNs() >> 1`, on a `long`
        this.statusMessageReadTimeoutNs = Math.floor(ctx.statusMessageTimeoutNs() / 2);
        this.reResolutionCheckIntervalNs = ctx.reResolutionCheckIntervalNs();
        this.dutyCycleRatio = ctx.sendToStatusMessagePollRatio();
        this.conductorProxy = ctx.driverConductorProxy();
        this.dutyCycleTracker = ctx.senderDutyCycleTracker() as DutyCycleTracker;
        this._roleName = CommonContext.threadName(
            AERON_DRIVER_SENDER_THREAD_NAME,
            AERON_DRIVER_SENDER_THREAD_NAME_CLASSIC,
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
        this.controlTransportPoller.close();
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

        const shortSendsBefore = this.shortSends.get();
        const bytesSent = this.doSend(nowNs);
        let bytesReceived = 0;

        if (
            0 === bytesSent ||
            ++this.dutyCycleCounter >= this.dutyCycleRatio ||
            this.controlPollDeadlineNs - nowNs < 0 ||
            shortSendsBefore < this.shortSends.get()
        ) {
            bytesReceived = this.controlTransportPoller.pollTransports();

            this.dutyCycleCounter = 0;
            this.controlPollDeadlineNs = nowNs + this.statusMessageReadTimeoutNs;
        }

        if (this.reResolutionCheckIntervalNs > 0 && this.reResolutionDeadlineNs - nowNs < 0) {
            this.reResolutionDeadlineNs = nowNs + this.reResolutionCheckIntervalNs;
            this.controlTransportPoller.checkForReResolutions(nowNs, this.conductorProxy as DriverConductorProxy);
        }

        return workCount + bytesSent + bytesReceived;
    }

    /**
     * {@inheritDoc}
     */
    public roleName(): string {
        return this._roleName;
    }

    /** @internal package-private in Java */
    public onRegisterSendChannelEndpoint(channelEndpoint: SendChannelEndpoint): void {
        this.controlTransportPoller.registerForRead(channelEndpoint);
    }

    /** @internal package-private in Java */
    public onCloseSendChannelEndpoint(channelEndpoint: SendChannelEndpoint): void {
        this.controlTransportPoller.cancelRead(channelEndpoint);
        (this.conductorProxy as DriverConductorProxy).sendChannelEndpointClosed(channelEndpoint);
    }

    /** @internal package-private in Java */
    public onNewNetworkPublication(publication: NetworkPublication): void {
        this.networkPublications = ArrayUtil.add(this.networkPublications, publication);
        publication.channelEndpoint().registerForSend(publication);
    }

    /** @internal package-private in Java */
    public onRemoveNetworkPublication(publication: NetworkPublication): void {
        this.networkPublications = ArrayUtil.remove(this.networkPublications, publication);
        publication.channelEndpoint().unregisterForSend(publication);
        publication.senderRelease();
    }

    /** @internal package-private in Java */
    public onAddDestination(
        channelEndpoint: SendChannelEndpoint,
        channelUri: ChannelUri,
        address: InetSocketAddress,
        registrationId: number,
    ): void {
        channelEndpoint.addDestination(channelUri, address, registrationId);
    }

    /** @internal package-private in Java */
    public onRemoveDestination(
        channelEndpoint: SendChannelEndpoint,
        channelUri: ChannelUri,
        address: InetSocketAddress,
    ): void;

    /** @internal package-private in Java */
    public onRemoveDestination(channelEndpoint: SendChannelEndpoint, destinationRegistrationId: number): void;

    public onRemoveDestination(
        channelEndpoint: SendChannelEndpoint,
        channelUriOrRegistrationId: ChannelUri | number,
        address?: InetSocketAddress,
    ): void {
        if (typeof channelUriOrRegistrationId === 'number') {
            channelEndpoint.removeDestination(channelUriOrRegistrationId);
        } else {
            channelEndpoint.removeDestination(channelUriOrRegistrationId, address as InetSocketAddress);
        }
    }

    /** @internal package-private in Java */
    public onResolutionChange(
        channelEndpoint: SendChannelEndpoint,
        endpoint: string,
        newAddress: InetSocketAddress,
    ): void {
        channelEndpoint.resolutionChange(endpoint, newAddress);
        this.resolutionChanges.getAndAddRelease(1);
    }

    private doSend(nowNs: number): number {
        let bytesSent = 0;
        const publications = this.networkPublications;
        const length = publications.length;

        let startingIndex = this.roundRobinIndex++;
        if (startingIndex >= length) {
            startingIndex = 0;
            this.roundRobinIndex = 1;
        }

        for (let i = startingIndex; i < length; i++) {
            bytesSent += (publications[i] as NetworkPublication).send(nowNs);
        }

        for (let i = 0; i < startingIndex; i++) {
            bytesSent += (publications[i] as NetworkPublication).send(nowNs);
        }

        this.totalBytesSent.getAndAddRelease(bytesSent);

        return bytesSent;
    }
}
