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
// Port of io/aeron/PublicationErrorFrameHandler.java @ 1.53.3
import type { PublicationErrorFrame } from './status/PublicationErrorFrame.js';

/**
 * Interface for handling various error frame messages for publications.
 * <p>
 * A Java functional interface: an object with the one method `onPublicationError`, as {@link AvailableImageHandler}.
 *
 * @since 1.47.0
 */
export interface PublicationErrorFrameHandler {
    /**
     * Called when an error frame for a publication is received by the local driver and needs to be propagated to the
     * appropriate clients. E.g. when an image is invalidated. This callback will reuse the {@link
     * PublicationErrorFrame} instance, so data is only valid for the lifetime of the callback. If the user needs to
     * pass the data onto another thread or hold in another location for use later, then the user needs to make use of
     * the {@link PublicationErrorFrame.clone} method to create a copy for their own use.
     * <p>
     * This callback will be executed on the client conductor thread, similar to image availability notifications.
     * <p>
     * This notification will only be propagated to clients that have added an instance of the Publication that received
     * the error frame (i.e. the originalRegistrationId matches the registrationId on the error frame).
     *
     * @param errorFrame containing the relevant information about the publication and the error message.
     */
    onPublicationError(errorFrame: PublicationErrorFrame): void;
}

/**
 * The constants of the Java interface.
 */
// The interface and its constant have one name, as in Java (a type and a value do not clash in TypeScript).
export const PublicationErrorFrameHandler = {
    /**
     * Default no-op error frame handler.
     */
    NO_OP: { onPublicationError: (_errorFrame: PublicationErrorFrame): void => {} },
};
