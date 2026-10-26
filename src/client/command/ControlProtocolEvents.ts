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
// Port of io/aeron/command/ControlProtocolEvents.java @ 1.53.3
import { SemanticVersion } from '../../agrona/SemanticVersion.js';

/**
 * List of events used in the control protocol between client and the media driver.
 */
export class ControlProtocolEvents {
    private constructor() {}

    /**
     * Major version of the control protocol between client and the media driver.
     *
     * @since 1.49.0
     */
    public static readonly CONTROL_PROTOCOL_MAJOR_VERSION = 1;

    /**
     * Minor version of the control protocol between client and the media driver.
     *
     * @since 1.49.0
     */
    public static readonly CONTROL_PROTOCOL_MINOR_VERSION = 0;

    /**
     * Patch version of the control protocol between client and the media driver.
     *
     * @since 1.49.0
     */
    public static readonly CONTROL_PROTOCOL_PATCH_VERSION = 0;

    /**
     * Semantic version of the control protocol between clients and media driver.
     *
     * @since 1.49.0
     */
    public static readonly CONTROL_PROTOCOL_SEMANTIC_VERSION = SemanticVersion.compose(
        ControlProtocolEvents.CONTROL_PROTOCOL_MAJOR_VERSION,
        ControlProtocolEvents.CONTROL_PROTOCOL_MINOR_VERSION,
        ControlProtocolEvents.CONTROL_PROTOCOL_PATCH_VERSION,
    );

    // Clients to Media Driver

    /**
     * Add a Publication.
     */
    public static readonly ADD_PUBLICATION = 0x01;

    /**
     * Remove a Publication.
     */
    public static readonly REMOVE_PUBLICATION = 0x02;

    /**
     * Add an Exclusive Publication.
     */
    public static readonly ADD_EXCLUSIVE_PUBLICATION = 0x03;

    /**
     * Add a Subscriber.
     */
    public static readonly ADD_SUBSCRIPTION = 0x04;

    /**
     * Remove a Subscriber.
     */
    public static readonly REMOVE_SUBSCRIPTION = 0x05;

    /**
     * Keepalive from Client.
     */
    public static readonly CLIENT_KEEPALIVE = 0x06;

    /**
     * Add Destination to an existing Publication.
     */
    public static readonly ADD_DESTINATION = 0x07;

    /**
     * Remove Destination from an existing Publication.
     */
    public static readonly REMOVE_DESTINATION = 0x08;

    /**
     * Add a Counter to the counters-manager.
     */
    public static readonly ADD_COUNTER = 0x09;

    /**
     * Remove a Counter from the counters-manager.
     */
    public static readonly REMOVE_COUNTER = 0x0a;

    /**
     * Close indication from Client.
     */
    public static readonly CLIENT_CLOSE = 0x0b;

    /**
     * Add Destination for existing Subscription.
     */
    public static readonly ADD_RCV_DESTINATION = 0x0c;

    /**
     * Remove Destination for existing Subscription.
     */
    public static readonly REMOVE_RCV_DESTINATION = 0x0d;

    /**
     * Request the driver to terminate.
     */
    public static readonly TERMINATE_DRIVER = 0x0e;

    /**
     * Add or return a static Counter, i.e. the Counter that cannot be deleted and whose lifecycle is decoupled from
     * the Aeron instance that created it.
     *
     * @since 1.45.0
     */
    public static readonly ADD_STATIC_COUNTER = 0x0f;

    /**
     * Invalidate an image.
     *
     * @since 1.47.0
     */
    public static readonly REJECT_IMAGE = 0x10;

    /**
     * Remove a destination by registration id.
     *
     * @since 1.47.0
     */
    public static readonly REMOVE_DESTINATION_BY_ID = 0x11;

    /**
     * Get next available session id from the media driver.
     *
     * @since 1.49.0
     */
    public static readonly GET_NEXT_AVAILABLE_SESSION_ID = 0x12;

    // Media Driver to Clients

    /**
     * Error Response as a result of attempting to process a client command operation.
     */
    public static readonly ON_ERROR = 0x0f01;

    /**
     * Subscribed Image buffers are available notification.
     */
    public static readonly ON_AVAILABLE_IMAGE = 0x0f02;

    /**
     * New Publication buffers are ready notification.
     */
    public static readonly ON_PUBLICATION_READY = 0x0f03;

    /**
     * Operation has succeeded.
     */
    public static readonly ON_OPERATION_SUCCESS = 0x0f04;

    /**
     * Inform client of timeout and removal of an inactive Image.
     */
    public static readonly ON_UNAVAILABLE_IMAGE = 0x0f05;

    /**
     * New Exclusive Publication buffers are ready notification.
     */
    public static readonly ON_EXCLUSIVE_PUBLICATION_READY = 0x0f06;

    /**
     * New Subscription is ready notification.
     */
    public static readonly ON_SUBSCRIPTION_READY = 0x0f07;

    /**
     * New counter is ready notification.
     */
    public static readonly ON_COUNTER_READY = 0x0f08;

    /**
     * Inform clients of removal of counter.
     */
    public static readonly ON_UNAVAILABLE_COUNTER = 0x0f09;

    /**
     * Inform clients of client timeout.
     */
    public static readonly ON_CLIENT_TIMEOUT = 0x0f0a;

    /**
     * A response to {@link ADD_STATIC_COUNTER} command.
     *
     * @since 1.45.0
     */
    public static readonly ON_STATIC_COUNTER = 0x0f0b;

    /**
     * Inform clients of error frame received by publication.
     *
     * @since 1.47.0
     */
    public static readonly ON_PUBLICATION_ERROR = 0x0f0c;

    /**
     * A response to the {@link GET_NEXT_AVAILABLE_SESSION_ID} command.
     *
     * @since 1.49.0
     */
    public static readonly ON_NEXT_AVAILABLE_SESSION_ID = 0x0f0d;
}
