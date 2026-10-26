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
// Port of io/aeron/Subscription.java @ 1.53.3
import { ArrayUtil } from '../agrona/collections/ArrayUtil.js';
import type { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import { ArrayIndexOutOfBoundsException } from '../agrona/jdk.js';
import { Aeron } from './Aeron.js';
import type { AvailableImageHandler } from './AvailableImageHandler.js';
import { ChannelUri } from './ChannelUri.js';
import { CommonContext } from './CommonContext.js';
import { AeronException } from './exceptions/AeronException.js';
import type { Image, ImageLogBuffers } from './Image.js';
import type { BlockHandler } from './logbuffer/BlockHandler.js';
import type { ControlledFragmentHandler } from './logbuffer/ControlledFragmentHandler.js';
import type { FragmentHandler } from './logbuffer/FragmentHandler.js';
import type { RawBlockHandler } from './logbuffer/RawBlockHandler.js';
import { ChannelEndpointStatus } from './status/ChannelEndpointStatus.js';
import { LocalSocketAddressStatus } from './status/LocalSocketAddressStatus.js';
import type { UnavailableImageHandler } from './UnavailableImageHandler.js';

const { NULL_VALUE } = Aeron;
const { ENDPOINT_PARAM_NAME, MDC_CONTROL_MODE_MANUAL, MDC_CONTROL_MODE_PARAM_NAME, SPY_PREFIX } = CommonContext;

/**
 * The client conductor that a subscription calls: the part of T19's `ClientConductor` that `Subscription` uses (a
 * forward reference, spec D80). T19 makes `ClientConductor` satisfy it and replaces it with
 * `import type { ClientConductor }`.
 */
export interface SubscriptionClientConductor {
    removeSubscription(subscription: Subscription): void;
    channelStatus(channelStatusId: number): number;
    countersReader(): CountersReader;
    addRcvDestination(registrationId: number, endpointChannel: string): void;
    removeRcvDestination(registrationId: number, endpointChannel: string): void;
    asyncAddRcvDestination(registrationId: number, endpointChannel: string): number;
    asyncRemoveRcvDestination(registrationId: number, endpointChannel: string): number;
    closeImages(images: readonly Image[], unavailableImageHandler: UnavailableImageHandler, lingerNs: number): void;
    releaseLogBuffers(logBuffers: ImageLogBuffers, registrationId: number, lingerNs: number): void;
    rejectImage(correlationId: number, position: number, reason: string): void;
}

/**
 * Aeron Subscriber API for receiving a reconstructed {@link Image} for a stream of messages from a publisher on a
 * given channel and streamId pair, i.e. a {@link Publication}. {@link Image}s are aggregated under a
 * {@link Subscription}.
 * <p>
 * {@link Subscription}s are created via an {@link Aeron} object, and received messages are delivered
 * to the {@link FragmentHandler}.
 * <p>
 * By default, fragmented messages are not reassembled before delivery. If an application must
 * receive whole messages, whether or not they were fragmented, then the Subscriber
 * should be created with a {@link FragmentAssembler} or a custom implementation.
 * <p>
 * It is an application's responsibility to {@link poll} the {@link Subscription} for new messages.
 * <p>
 * <b>Note:</b>Subscriptions are not threadsafe and should not be shared between subscribers.
 *
 * @see FragmentHandler
 * @see Aeron.addSubscription
 */
export class Subscription {
    // The padding fields of Java are not ported (no field layout in JS, spec D11, D19).
    private static readonly EMPTY_IMAGES: Image[] = [];

    private readonly _registrationId: number;
    private readonly _streamId: number;
    private roundRobinIndex: number = 0;
    /** @internal package-private in Java: `volatile boolean isClosed`, read by {@link isClosed} */
    public _isClosed: boolean = false;
    /** @internal package-private in Java: `volatile Image[] images`, read by {@link images} */
    public _images: readonly Image[] = Subscription.EMPTY_IMAGES;
    private readonly conductor: SubscriptionClientConductor;
    private readonly _channel: string;
    private readonly _availableImageHandler: AvailableImageHandler;
    private readonly _unavailableImageHandler: UnavailableImageHandler;
    private channelUri: ChannelUri | null = null;
    private resolvedChannel: string | null = null;
    private _resolvedEndpoint: string | null = null;
    private _channelStatusId: number = ChannelEndpointStatus.NO_ID_ALLOCATED;

    /** @internal package-private in Java */
    public constructor(
        conductor: SubscriptionClientConductor,
        channel: string,
        streamId: number,
        registrationId: number,
        availableImageHandler: AvailableImageHandler,
        unavailableImageHandler: UnavailableImageHandler,
    ) {
        this._registrationId = registrationId;
        this._streamId = streamId;
        this.conductor = conductor;
        this._channel = channel;
        this._availableImageHandler = availableImageHandler;
        this._unavailableImageHandler = unavailableImageHandler;
    }

    /**
     * Media address for delivery to the channel.
     *
     * @return Media address for delivery to the channel.
     */
    public channel(): string {
        return this._channel;
    }

    /**
     * Stream identity for scoping within the channel media address.
     *
     * @return Stream identity for scoping within the channel media address.
     */
    public streamId(): number {
        return this._streamId;
    }

    /**
     * Return the registration id used to register this Publication with the media driver.
     *
     * @return registration id
     */
    public registrationId(): number {
        return this._registrationId;
    }

    /**
     * Callback used to indicate when an {@link Image} becomes available under this {@link Subscription}.
     *
     * @return callback used to indicate when an {@link Image} becomes available under this {@link Subscription}.
     */
    public availableImageHandler(): AvailableImageHandler {
        return this._availableImageHandler;
    }

    /**
     * Callback used to indicate when an {@link Image} goes unavailable under this {@link Subscription}.
     *
     * @return callback used to indicate when an {@link Image} goes unavailable under this {@link Subscription}.
     */
    public unavailableImageHandler(): UnavailableImageHandler {
        return this._unavailableImageHandler;
    }

    /**
     * Poll the {@link Image}s under the subscription for available message fragments.
     * <p>
     * Each fragment read will be a whole message if it is under MTU length. If larger than MTU then it will come
     * as a series of fragments ordered within a session.
     *
     * @param fragmentHandler callback for handling each message fragment as it is read.
     * @param fragmentLimit   number of message fragments to limit for a single poll operation.
     * @return the number of fragments received
     * @see FragmentAssembler
     * @see ImageFragmentAssembler
     */
    public poll(fragmentHandler: FragmentHandler, fragmentLimit: number): number {
        const images = this._images;
        const length = images.length;
        let fragmentsRead = 0;

        let startingIndex = this.roundRobinIndex++;
        if (startingIndex >= length) {
            startingIndex = 0;
            this.roundRobinIndex = 1;
        }

        for (let i = startingIndex; i < length && fragmentsRead < fragmentLimit; i++) {
            fragmentsRead += (images[i] as Image).poll(fragmentHandler, fragmentLimit - fragmentsRead);
        }

        for (let i = 0; i < startingIndex && fragmentsRead < fragmentLimit; i++) {
            fragmentsRead += (images[i] as Image).poll(fragmentHandler, fragmentLimit - fragmentsRead);
        }

        return fragmentsRead;
    }

    /**
     * Poll in a controlled manner the {@link Image}s under the subscription for available message fragments.
     * Control is provided through the {@link ControlledFragmentHandler} for delegating to the
     * {@link ControlledFragmentAssembler} or a custom handler.
     *
     * @param fragmentHandler callback for handling each message fragment as it is read.
     * @param fragmentLimit   number of message fragments to limit for a single poll operation.
     * @return the number of fragments received
     * @see ControlledFragmentHandler
     * @see ControlledFragmentAssembler
     * @see ControlledImageFragmentAssembler
     */
    public controlledPoll(fragmentHandler: ControlledFragmentHandler, fragmentLimit: number): number {
        const images = this._images;
        const length = images.length;
        let fragmentsRead = 0;

        let startingIndex = this.roundRobinIndex++;
        if (startingIndex >= length) {
            startingIndex = 0;
            this.roundRobinIndex = 1;
        }

        for (let i = startingIndex; i < length && fragmentsRead < fragmentLimit; i++) {
            fragmentsRead += (images[i] as Image).controlledPoll(fragmentHandler, fragmentLimit - fragmentsRead);
        }

        for (let i = 0; i < startingIndex && fragmentsRead < fragmentLimit; i++) {
            fragmentsRead += (images[i] as Image).controlledPoll(fragmentHandler, fragmentLimit - fragmentsRead);
        }

        return fragmentsRead;
    }

    /**
     * Poll the {@link Image}s under the subscription for available message fragments in blocks.
     *
     * @param blockHandler     to receive a block of fragments from each {@link Image}.
     * @param blockLengthLimit for each individual block.
     * @return the number of bytes consumed.
     */
    public blockPoll(blockHandler: BlockHandler, blockLengthLimit: number): number {
        let bytesConsumed = 0;
        const images = this._images;
        for (let i = 0, length = images.length; i < length; i++) {
            bytesConsumed += (images[i] as Image).blockPoll(blockHandler, blockLengthLimit);
        }

        return bytesConsumed;
    }

    /**
     * Poll the {@link Image}s under the subscription for available message fragments in blocks, with the
     * `FileChannel` of the log (none: the logs are in memory, spec D4).
     *
     * @param rawBlockHandler  to receive a block of fragments from each {@link Image}.
     * @param blockLengthLimit for each individual block.
     * @return the number of bytes consumed.
     */
    public rawPoll(rawBlockHandler: RawBlockHandler, blockLengthLimit: number): number {
        let bytesConsumed = 0;
        const images = this._images;
        for (let i = 0, length = images.length; i < length; i++) {
            bytesConsumed += (images[i] as Image).rawPoll(rawBlockHandler, blockLengthLimit);
        }

        return bytesConsumed;
    }

    /**
     * Is this subscription connected by having at least one open publication {@link Image}.
     *
     * @return true if this subscription connected by having at least one open publication {@link Image}.
     */
    public isConnected(): boolean {
        const images = this._images;
        for (let i = 0, length = images.length; i < length; i++) {
            if (!(images[i] as Image).isClosed()) {
                return true;
            }
        }

        return false;
    }

    /**
     * Has this subscription currently no {@link Image}s?
     *
     * @return true if this subscription currently has no {@link Image}s.
     */
    public hasNoImages(): boolean {
        return this._images.length === 0;
    }

    /**
     * Count of images connected to this subscription.
     *
     * @return count of images connected to this subscription.
     */
    public imageCount(): number {
        return this._images.length;
    }

    /**
     * Return the {@link Image} associated with the given sessionId.
     *
     * @param sessionId associated with the {@link Image}.
     * @return Image associated with the given sessionId or null if no Image exist.
     */
    public imageBySessionId(sessionId: number): Image | null {
        let result: Image | null = null;

        const images = this._images;
        for (let i = 0, length = images.length; i < length; i++) {
            const image = images[i] as Image;
            if (sessionId === image.sessionId()) {
                result = image;
                break;
            }
        }

        return result;
    }

    /**
     * Get the {@link Image} at the given index from the images array.
     * <p>
     * This is only valid for the current images array. It is not safe to use as an index for the images array
     * between two calls.
     *
     * @param index in the array
     * @return image at given index or exception if no image exists for the index.
     * @see imageCount
     */
    public imageAtIndex(index: number): Image {
        const image = this._images[index];
        if (undefined === image) {
            throw new ArrayIndexOutOfBoundsException(
                'Index ' + index + ' out of bounds for length ' + this._images.length,
            );
        }

        return image;
    }

    /**
     * Get a list of current images for the subscription.
     * <p>
     * The array is replaced, never changed, when an image is added or removed: this is the array the subscription
     * holds now, as Java's unmodifiable list over it.
     *
     * @return an unmodifiable list of the images.
     */
    public images(): readonly Image[] {
        return this._images;
    }

    /**
     * Iterate over the {@link Image}s for this subscription.
     *
     * @param consumer to handle each {@link Image}.
     */
    public forEachImage(consumer: (image: Image) => void): void {
        const images = this._images;
        for (let i = 0, length = images.length; i < length; i++) {
            consumer(images[i] as Image);
        }
    }

    /**
     * Close the Subscription so that associated {@link Image}s can be released.
     * <p>
     * This method is idempotent.
     */
    public close(): void {
        if (!this._isClosed) {
            this.conductor.removeSubscription(this);
        }
    }

    /**
     * Has this object been closed and should no longer be used?
     *
     * @return true if it has been closed otherwise false.
     */
    public isClosed(): boolean {
        return this._isClosed;
    }

    /**
     * Get the status of the media channel for this Subscription.
     * <p>
     * The status will be {@link ChannelEndpointStatus.ERRORED} if a socket exception occurs on setup
     * and {@link ChannelEndpointStatus.ACTIVE} if all is well.
     *
     * @return status for the channel as one of the constants from {@link ChannelEndpointStatus} with it being
     * {@link ChannelEndpointStatus.NO_ID_ALLOCATED} if the subscription is closed.
     * @see ChannelEndpointStatus
     */
    public channelStatus(): number {
        if (this._isClosed) {
            return ChannelEndpointStatus.NO_ID_ALLOCATED;
        }

        return this.conductor.channelStatus(this._channelStatusId);
    }

    /**
     * Get the counter id used to represent the channel status.
     *
     * @return the counter id used to represent the channel status.
     */
    public channelStatusId(): number;
    /**
     * Set the counter id used to represent the channel status.
     *
     * @param id the counter id used to represent the channel status.
     * @internal package-private in Java
     */
    public channelStatusId(id: number): void;
    public channelStatusId(id?: number): number | void {
        if (undefined === id) {
            return this._channelStatusId;
        }

        this._channelStatusId = id;
    }

    /**
     * Fetches the local socket addresses for this subscription. If the channel is not
     * {@link ChannelEndpointStatus.ACTIVE}, then this will return an empty list.
     * <p>
     * The format is as follows:
     * <br>
     * <br>
     * IPv4: <code>ip address:port</code>
     * <br>
     * IPv6: <code>[ip6 address]:port</code>
     * <br>
     * <br>
     * This is to match the formatting used in the Aeron URI.
     *
     * @return a list of local socket addresses for this subscription.
     * @see channelStatus
     */
    public localSocketAddresses(): string[] {
        return LocalSocketAddressStatus.findAddresses(
            this.conductor.countersReader(),
            this.channelStatus(),
            this._channelStatusId,
        );
    }

    /**
     * Add a destination manually to a multi-destination-subscription.
     *
     * @param endpointChannel for the destination to add.
     */
    public addDestination(endpointChannel: string): void {
        if (this._isClosed) {
            throw new AeronException('Subscription is closed');
        }

        this.conductor.addRcvDestination(this._registrationId, endpointChannel);
    }

    /**
     * Remove a previously added destination from a multi-destination-subscription.
     *
     * @param endpointChannel for the destination to remove.
     */
    public removeDestination(endpointChannel: string): void {
        if (this._isClosed) {
            throw new AeronException('Subscription is closed');
        }

        this.conductor.removeRcvDestination(this._registrationId, endpointChannel);
    }

    /**
     * Asynchronously add a destination manually to a multi-destination-subscription.
     * <p>
     * Errors will be delivered asynchronously to the {@link Aeron.Context.errorHandler}. Completion can be
     * tracked by passing the returned correlation id to {@link Aeron.isCommandActive}.
     *
     * @param endpointChannel for the destination to add.
     * @return the correlationId for the command.
     */
    public asyncAddDestination(endpointChannel: string): number {
        if (this._isClosed) {
            throw new AeronException('Subscription is closed');
        }

        return this.conductor.asyncAddRcvDestination(this._registrationId, endpointChannel);
    }

    /**
     * Asynchronously remove a previously added destination from a multi-destination-subscription.
     * <p>
     * Errors will be delivered asynchronously to the {@link Aeron.Context.errorHandler}. Completion can be
     * tracked by passing the returned correlation id to {@link Aeron.isCommandActive}.
     *
     * @param endpointChannel for the destination to remove.
     * @return the correlationId for the command.
     */
    public asyncRemoveDestination(endpointChannel: string): number {
        if (this._isClosed) {
            throw new AeronException('Subscription is closed');
        }

        return this.conductor.asyncRemoveRcvDestination(this._registrationId, endpointChannel);
    }

    /**
     * Resolve channel endpoint and replace it with the port from the ephemeral range when the original channel's
     * endpoint is `localhost:0` or similar.
     *
     * @return channel URI string with an endpoint being resolved to the allocated port, or null when the channel
     * status is not active or there are no active bind addresses.
     * @see channelStatus
     * @see ChannelEndpointStatus
     */
    public tryResolveChannelEndpointPort(): string | null {
        if (null === this.resolvedChannel) {
            if (null === this.channelUri) {
                const uri = ChannelUri.parse(this._channel);
                const endpoint = uri.get(ENDPOINT_PARAM_NAME);
                if (
                    null === endpoint ||
                    !endpoint.endsWith(':0') ||
                    MDC_CONTROL_MODE_MANUAL === uri.get(MDC_CONTROL_MODE_PARAM_NAME)
                ) {
                    this.resolvedChannel = this._channel;
                    return this._channel;
                }
                this.channelUri = uri;
            }

            const endpoint = this.resolvedEndpoint();
            if (null !== endpoint) {
                this.channelUri.replaceEndpointWildcardPort(endpoint);
                this.resolvedChannel = this.channelUri.toString();
            }
        }
        return this.resolvedChannel;
    }

    /**
     * Find the resolved endpoint for the channel. This may be null if MDS is used and no destination is yet added.
     * The result will similar to taking the first element returned from {@link localSocketAddresses}. If more than
     * one destination is added then the first found is returned.
     *
     * @return The resolved endpoint or null if not found.
     * @see localSocketAddresses
     */
    public resolvedEndpoint(): string | null {
        if (null === this._resolvedEndpoint) {
            this._resolvedEndpoint = LocalSocketAddressStatus.findAddress(
                this.conductor.countersReader(),
                this.channelStatus(),
                this._channelStatusId,
            );
        }
        return this._resolvedEndpoint;
    }

    /** @internal package-private in Java */
    public internalClose(lingerDurationNs: number): void {
        const images = this._images;
        this._images = Subscription.EMPTY_IMAGES;
        this._isClosed = true;
        this.conductor.closeImages(images, this._unavailableImageHandler, lingerDurationNs);
    }

    /** @internal package-private in Java */
    public addImage(image: Image): void {
        this._images = ArrayUtil.add(this._images, image);
    }

    /** @internal package-private in Java */
    public removeImage(correlationId: number): Image | null {
        const oldArray = this._images;
        let removedImage: Image | null = null;

        let i = 0;
        for (let j = 0, length = oldArray.length; j < length; j++) {
            const image = oldArray[j] as Image;
            if (image.correlationId() === correlationId) {
                removedImage = image;
                break;
            }

            i++;
        }

        if (null !== removedImage) {
            removedImage.close();
            this._images =
                oldArray.length === 1 ? Subscription.EMPTY_IMAGES : ArrayUtil.removeAt(oldArray as Image[], i);
            this.conductor.releaseLogBuffers(removedImage.logBuffers(), correlationId, NULL_VALUE);
        }

        return removedImage;
    }

    /** @internal package-private in Java */
    public rejectImage(correlationId: number, position: number, reason: string): void {
        if (this._channel.startsWith(SPY_PREFIX)) {
            throw new AeronException('spies can not reject images');
        }

        this.conductor.rejectImage(correlationId, position, reason);
    }

    public toString(): string {
        return (
            'Subscription{' +
            'registrationId=' +
            this._registrationId +
            ', isClosed=' +
            this._isClosed +
            ', isConnected=' +
            this.isConnected() +
            ', streamId=' +
            this._streamId +
            ", channel='" +
            this._channel +
            "'" +
            ', localSocketAddresses=[' +
            this.localSocketAddresses().join(', ') +
            ']' +
            ', imageCount=' +
            this.imageCount() +
            '}'
        );
    }
}
