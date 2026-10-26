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
// Port of io/aeron/driver/DataPacketDispatcher.java @ 1.53.3
import { Int2ObjectHashMap } from '../agrona/collections/Int2ObjectHashMap.js';
import { IntHashSet } from '../agrona/collections/IntHashSet.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import { AeronEvent } from '../client/exceptions/AeronEvent.js';
import { DataHeaderFlyweight } from '../client/protocol/DataHeaderFlyweight.js';
import { RttMeasurementFlyweight } from '../client/protocol/RttMeasurementFlyweight.js';
import type { SetupFlyweight } from '../client/protocol/SetupFlyweight.js';
import { UnknownSubscriptionException } from './exceptions/UnknownSubscriptionException.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { PublicationImage } from './PublicationImage.js';
import type { Receiver } from './Receiver.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';
import type { DriverConductorProxy } from './DriverConductorProxy.js';

/**
 * The state of the interest in a session of a stream: the Java enum `SessionState`, a class with one `static readonly`
 * instance per constant in the Java ordinal order, with `name()`, `ordinal()`, `values()` and `toString()`.
 *
 * @internal package-private in Java
 */
export class SessionState {
    private static nextOrdinal = 0;

    public static readonly ACTIVE: SessionState = new SessionState('ACTIVE');
    public static readonly PENDING_SETUP_FRAME: SessionState = new SessionState('PENDING_SETUP_FRAME');
    public static readonly INIT_IN_PROGRESS: SessionState = new SessionState('INIT_IN_PROGRESS');
    public static readonly ON_COOL_DOWN: SessionState = new SessionState('ON_COOL_DOWN');
    public static readonly NO_INTEREST: SessionState = new SessionState('NO_INTEREST');

    private readonly _name: string;
    private readonly _ordinal: number = 0;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = SessionState.nextOrdinal++;
    }

    /**
     * The constants of the enum in ordinal order.
     */
    public static values(): SessionState[] {
        return [
            SessionState.ACTIVE,
            SessionState.PENDING_SETUP_FRAME,
            SessionState.INIT_IN_PROGRESS,
            SessionState.ON_COOL_DOWN,
            SessionState.NO_INTEREST,
        ];
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
}

const { PENDING_SETUP_FRAME, INIT_IN_PROGRESS, ON_COOL_DOWN, NO_INTEREST } = SessionState;

/**
 * The interest in one stream: whether it is for all sessions, the state of the sessions, the images that are active and
 * the sessions that were subscribed to by id.
 *
 * @internal package-private in Java
 */
export class StreamInterest {
    public isAllSessions: boolean;
    public readonly sessionInterestByIdMap = new Int2ObjectHashMap<SessionState>();
    public readonly activeImageByIdMap = new Int2ObjectHashMap<PublicationImage>();
    public readonly subscribedSessionIds = new IntHashSet();

    public constructor(isAllSessions: boolean) {
        this.isAllSessions = isAllSessions;
    }

    public findActive(sessionId: number): PublicationImage | null {
        return this.activeImageByIdMap.get(sessionId);
    }

    public isSessionLimitExceeded(sessionLimit: number): boolean {
        return sessionLimit <= this.activeImageByIdMap.size();
    }

    public removeNonSessionSpecificInterest(): void {
        const activeIterator = this.activeImageByIdMap.entrySet().iterator();

        while (activeIterator.hasNext()) {
            activeIterator.next();

            const sessionId = activeIterator.getIntKey();
            if (!this.subscribedSessionIds.contains(sessionId)) {
                (activeIterator.getValue() as PublicationImage).deactivate();
                activeIterator.remove();
            }
        }

        const iterator = this.sessionInterestByIdMap.entrySet().iterator();

        while (iterator.hasNext()) {
            iterator.next();

            const sessionId = iterator.getIntKey();
            if (!this.subscribedSessionIds.contains(sessionId)) {
                iterator.remove();
            }
        }
    }
}

/**
 * Handling of dispatching data packets to {@link PublicationImage}s streams.
 * <p>
 * All methods should be called from the {@link Receiver} thread.
 */
export class DataPacketDispatcher {
    private readonly streamInterestByIdMap = new Int2ObjectHashMap<StreamInterest>();
    private readonly conductorProxy: DriverConductorProxy;
    private readonly receiver: Receiver;
    private readonly streamSessionLimit: number = 0;

    public constructor(conductorProxy: DriverConductorProxy, receiver: Receiver, streamSessionLimit: number) {
        this.conductorProxy = conductorProxy;
        this.receiver = receiver;
        this.streamSessionLimit = streamSessionLimit;
    }

    /**
     * Add a subscription to a channel for a given stream id and wildcard session id, or (with a session id) for given
     * stream and session ids (Java: two overloads).
     *
     * @param streamId  to capture within a channel.
     * @param sessionId to capture within a stream id, or omitted for the wildcard.
     */
    public addSubscription(streamId: number, sessionId?: number): void {
        if (undefined !== sessionId) {
            this.addSessionSubscription(streamId, sessionId);
            return;
        }

        const streamInterest = this.streamInterestByIdMap.get(streamId);

        if (null === streamInterest) {
            this.streamInterestByIdMap.put(streamId, new StreamInterest(true));
        } else if (!streamInterest.isAllSessions) {
            streamInterest.isAllSessions = true;

            const iterator = streamInterest.sessionInterestByIdMap.values().iterator();

            while (iterator.hasNext()) {
                if (NO_INTEREST === iterator.next()) {
                    iterator.remove();
                }
            }
        }
    }

    private addSessionSubscription(streamId: number, sessionId: number): void {
        let streamInterest = this.streamInterestByIdMap.get(streamId);
        if (null === streamInterest) {
            streamInterest = new StreamInterest(false);
            this.streamInterestByIdMap.put(streamId, streamInterest);
        }

        streamInterest.subscribedSessionIds.add(sessionId);

        const sessionState = streamInterest.sessionInterestByIdMap.get(sessionId);
        if (NO_INTEREST === sessionState) {
            streamInterest.sessionInterestByIdMap.remove(sessionId);
        }
    }

    /**
     * Remove a subscription for a previously registered given stream id and wildcard session id, or (with a session id)
     * for a given stream id and session id (Java: two overloads).
     *
     * @param streamId  to remove the capture for.
     * @param sessionId within the given stream id, or omitted for the wildcard.
     */
    public removeSubscription(streamId: number, sessionId?: number): void {
        if (undefined !== sessionId) {
            this.removeSessionSubscription(streamId, sessionId);
            return;
        }

        const streamInterest = this.streamInterestByIdMap.get(streamId);
        if (null === streamInterest) {
            throw new UnknownSubscriptionException('no subscription for stream ' + streamId);
        }

        streamInterest.removeNonSessionSpecificInterest();

        streamInterest.isAllSessions = false;

        if (streamInterest.subscribedSessionIds.isEmpty()) {
            this.streamInterestByIdMap.remove(streamId);
        }
    }

    private removeSessionSubscription(streamId: number, sessionId: number): void {
        const streamInterest = this.streamInterestByIdMap.get(streamId);
        if (null === streamInterest) {
            throw new UnknownSubscriptionException('no subscription for stream ' + streamId);
        }

        if (!streamInterest.isAllSessions) {
            const publicationImage = streamInterest.activeImageByIdMap.remove(sessionId);
            if (null !== publicationImage) {
                publicationImage.deactivate();
            }
            streamInterest.sessionInterestByIdMap.remove(sessionId);
        }

        streamInterest.subscribedSessionIds.remove(sessionId);

        if (!streamInterest.isAllSessions && streamInterest.subscribedSessionIds.isEmpty()) {
            this.streamInterestByIdMap.remove(streamId);
        }
    }

    /**
     * Add a {@link PublicationImage} to dispatch packets to.
     *
     * @param image to which the packets are dispatched.
     */
    public addPublicationImage(image: PublicationImage): void {
        const streamInterest = this.streamInterestByIdMap.get(image.streamId());
        if (null !== streamInterest) {
            streamInterest.sessionInterestByIdMap.remove(image.sessionId());
            streamInterest.activeImageByIdMap.put(image.sessionId(), image);
            image.activate();
        }
    }

    /**
     * Remove a previously added {@link PublicationImage} so packets are no longer dispatched to it.
     *
     * @param image to which the packets are dispatched.
     */
    public removePublicationImage(image: PublicationImage): void {
        const streamInterest = this.streamInterestByIdMap.get(image.streamId());
        if (null !== streamInterest) {
            const activeImage = streamInterest.activeImageByIdMap.get(image.sessionId());
            if (null !== activeImage && activeImage.correlationId() === image.correlationId()) {
                streamInterest.activeImageByIdMap.remove(image.sessionId());

                if (!image.isEndOfStream()) {
                    streamInterest.sessionInterestByIdMap.put(image.sessionId(), ON_COOL_DOWN);
                }
            }
        }

        image.deactivate();
    }

    /**
     * Dispatch a data packet to the registered interest.
     *
     * @param channelEndpoint on which the packet was received.
     * @param header          of the data first frame.
     * @param buffer          containing the data packet.
     * @param length          of the data packet.
     * @param srcAddress      from which the data packet was received.
     * @param transportIndex  on which the packet was received.
     * @return number of bytes applied as a result of this action.
     */
    public onDataPacket(
        channelEndpoint: ReceiveChannelEndpoint,
        header: DataHeaderFlyweight,
        buffer: UnsafeBuffer,
        length: number,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): number {
        const streamId = header.streamId();
        const streamInterest = this.streamInterestByIdMap.get(streamId);

        if (null !== streamInterest) {
            const sessionId = header.sessionId();

            const image = streamInterest.findActive(sessionId);
            if (null !== image) {
                return image.insertPacket(
                    header.termId(),
                    header.termOffset(),
                    buffer,
                    length,
                    transportIndex,
                    srcAddress,
                );
            } else if (
                !DataHeaderFlyweight.isEndOfStream(buffer) &&
                !streamInterest.sessionInterestByIdMap.containsKey(sessionId)
            ) {
                if (streamInterest.isAllSessions || streamInterest.subscribedSessionIds.contains(sessionId)) {
                    streamInterest.sessionInterestByIdMap.put(sessionId, PENDING_SETUP_FRAME);
                    this.elicitSetupMessageFromSource(channelEndpoint, transportIndex, srcAddress, streamId, sessionId);
                } else {
                    streamInterest.sessionInterestByIdMap.put(sessionId, NO_INTEREST);
                }
            }
        }

        return 0;
    }

    /**
     * Dispatch a setup message to registered interest.
     *
     * @param channelEndpoint of reception.
     * @param msg             flyweight over the network packet.
     * @param srcAddress      the message came from.
     * @param transportIndex  on which the message was received.
     */
    public onSetupMessage(
        channelEndpoint: ReceiveChannelEndpoint,
        msg: SetupFlyweight,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): void {
        const streamId = msg.streamId();
        const streamInterest = this.streamInterestByIdMap.get(streamId);

        if (null !== streamInterest) {
            const sessionId = msg.sessionId();

            if (streamInterest.isSessionLimitExceeded(this.streamSessionLimit)) {
                throw new AeronEvent('exceeded session limit, streamId=' + streamId + ' sourceAddress=' + srcAddress);
            }

            const image = streamInterest.findActive(sessionId);
            const sessionInterest = streamInterest.sessionInterestByIdMap.get(sessionId);

            if (null !== image) {
                image.addDestinationConnectionIfUnknown(transportIndex, srcAddress);
            } else if (null !== sessionInterest) {
                if (PENDING_SETUP_FRAME === sessionInterest) {
                    streamInterest.sessionInterestByIdMap.put(sessionId, INIT_IN_PROGRESS);

                    this.createPublicationImage(
                        channelEndpoint,
                        transportIndex,
                        srcAddress,
                        streamId,
                        sessionId,
                        msg.initialTermId(),
                        msg.activeTermId(),
                        msg.termOffset(),
                        msg.termLength(),
                        msg.mtuLength(),
                        msg.ttl(),
                        msg.flags(),
                    );
                }
            } else {
                if (streamInterest.isAllSessions || streamInterest.subscribedSessionIds.contains(sessionId)) {
                    streamInterest.sessionInterestByIdMap.put(sessionId, INIT_IN_PROGRESS);
                    this.createPublicationImage(
                        channelEndpoint,
                        transportIndex,
                        srcAddress,
                        streamId,
                        sessionId,
                        msg.initialTermId(),
                        msg.activeTermId(),
                        msg.termOffset(),
                        msg.termLength(),
                        msg.mtuLength(),
                        msg.ttl(),
                        msg.flags(),
                    );
                } else {
                    streamInterest.sessionInterestByIdMap.put(sessionId, NO_INTEREST);
                }
            }
        }
    }

    /**
     * Dispatch an RTT measurement message to registered interest.
     *
     * @param channelEndpoint of reception.
     * @param msg             flyweight over the network packet.
     * @param srcAddress      the message came from.
     * @param transportIndex  on which the message was received.
     */
    public onRttMeasurement(
        channelEndpoint: ReceiveChannelEndpoint,
        msg: RttMeasurementFlyweight,
        srcAddress: InetSocketAddress,
        transportIndex: number,
    ): void {
        const streamId = msg.streamId();
        const streamInterest = this.streamInterestByIdMap.get(streamId);

        if (null !== streamInterest) {
            const sessionId = msg.sessionId();

            const image = streamInterest.findActive(sessionId);
            if (null !== image) {
                if (RttMeasurementFlyweight.REPLY_FLAG === (msg.flags() & RttMeasurementFlyweight.REPLY_FLAG)) {
                    const controlAddress = channelEndpoint.isMulticast(transportIndex)
                        ? channelEndpoint.udpChannel(transportIndex).remoteControl()
                        : srcAddress;

                    channelEndpoint.sendRttMeasurement(
                        transportIndex,
                        controlAddress,
                        sessionId,
                        streamId,
                        msg.echoTimestampNs(),
                        0n,
                        false,
                    );
                } else {
                    image.onRttMeasurement(msg, transportIndex, srcAddress);
                }
            }
        }
    }

    /**
     * Should a setup message be elicited for a channel given interest.
     *
     * @return true if there is interest otherwise false.
     */
    public shouldElicitSetupMessage(): boolean {
        return !this.streamInterestByIdMap.isEmpty();
    }

    /** @internal Package-private in Java: the receiver and the pending setup message call it. */
    public removeSessionInterestByState(sessionId: number, streamId: number, state: SessionState): void {
        const streamInterest = this.streamInterestByIdMap.get(streamId);
        if (null !== streamInterest) {
            const sessionState = streamInterest.sessionInterestByIdMap.get(sessionId);
            if (null !== sessionState && state === sessionState) {
                streamInterest.sessionInterestByIdMap.remove(sessionId);
            }
        }
    }

    private elicitSetupMessageFromSource(
        channelEndpoint: ReceiveChannelEndpoint,
        transportIndex: number,
        srcAddress: InetSocketAddress,
        streamId: number,
        sessionId: number,
    ): void {
        const controlAddress = channelEndpoint.isMulticast(transportIndex)
            ? channelEndpoint.udpChannel(transportIndex).remoteControl()
            : srcAddress;

        channelEndpoint.sendSetupElicitingStatusMessage(transportIndex, controlAddress, sessionId, streamId);
        this.receiver.addPendingSetupMessage(
            sessionId,
            streamId,
            transportIndex,
            channelEndpoint,
            false,
            controlAddress,
        );
    }

    private createPublicationImage(
        channelEndpoint: ReceiveChannelEndpoint,
        transportIndex: number,
        srcAddress: InetSocketAddress,
        streamId: number,
        sessionId: number,
        initialTermId: number,
        activeTermId: number,
        termOffset: number,
        termLength: number,
        mtuLength: number,
        setupTtl: number,
        flags: number,
    ): void {
        const controlAddress = channelEndpoint.isMulticast(transportIndex)
            ? channelEndpoint.udpChannel(transportIndex).remoteControl()
            : srcAddress;

        if (channelEndpoint.isMulticast(transportIndex) && channelEndpoint.multicastTtl(transportIndex) < setupTtl) {
            channelEndpoint.possibleTtlAsymmetryEncountered();
        }

        this.conductorProxy.createPublicationImage(
            sessionId,
            streamId,
            initialTermId,
            activeTermId,
            termOffset,
            termLength,
            mtuLength,
            transportIndex,
            flags,
            controlAddress,
            srcAddress,
            channelEndpoint,
        );
    }
}
