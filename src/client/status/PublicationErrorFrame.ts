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
// Port of io/aeron/status/PublicationErrorFrame.java @ 1.53.3
import { type InetSocketAddress } from '../../driver/jdkNet.js';
import { type PublicationErrorFrameFlyweight } from '../command/PublicationErrorFrameFlyweight.js';

/**
 * Encapsulates the data received when a publication receives an error frame.
 * <p>
 * Every `long` field is a `number` in +/-(2^53 - 1) (spec D5).
 */
export class PublicationErrorFrame {
    private _registrationId = 0;
    private _sessionId = 0;
    private _streamId = 0;
    private _receiverId = 0n;
    private _destinationRegistrationId = 0;
    private _groupTag = 0n;
    private _errorCode = 0;
    private _errorMessage: string | null = null;
    private _sourceAddress: InetSocketAddress | null = null;

    /**
     * Create an error frame flyweight that can be reused across calls.
     */
    public constructor() {}

    /**
     * Registration id of the publication that received the error frame.
     *
     * @return registration id of the publication.
     */
    public registrationId(): number {
        return this._registrationId;
    }

    /**
     * Session id of the publication that received the error frame.
     *
     * @return session id of the publication.
     */
    public sessionId(): number {
        return this._sessionId;
    }

    /**
     * Stream id of the publication that received the error frame.
     *
     * @return stream id of the publication.
     */
    public streamId(): number {
        return this._streamId;
    }

    /**
     * Receiver id of the source that send the error frame.
     *
     * @return receiver id of the source that send the error frame.
     */
    public receiverId(): bigint {
        return this._receiverId;
    }

    /**
     * Group tag of the source that sent the error frame.
     *
     * @return group tag of the source that sent the error frame or {@link Aeron.NULL_VALUE} if the source did not
     * have a group tag set.
     */
    public groupTag(): bigint {
        return this._groupTag;
    }

    /**
     * The error code of the error frame received.
     *
     * @return the error code.
     */
    public errorCode(): number {
        return this._errorCode;
    }

    /**
     * The error message of the error frame received.
     *
     * @return the error message.
     */
    public errorMessage(): string | null {
        return this._errorMessage;
    }

    /**
     * The address of the remote source that sent the error frame.
     *
     * @return address of the remote source.
     */
    public sourceAddress(): InetSocketAddress | null {
        return this._sourceAddress;
    }

    /**
     * The registrationId of the destination. Only used with manual MDC publications. Will be
     * {@link Aeron.NULL_VALUE} otherwise.
     *
     * @return registrationId of the destination or {@link Aeron.NULL_VALUE}.
     */
    public destinationRegistrationId(): number {
        return this._destinationRegistrationId;
    }

    /**
     * Set the fields of the publication error frame from the flyweight.
     *
     * @param frameFlyweight that was received from the client message buffer.
     * @return this for fluent API.
     */
    public set(frameFlyweight: PublicationErrorFrameFlyweight): PublicationErrorFrame {
        this._registrationId = frameFlyweight.registrationId();
        this._sessionId = frameFlyweight.sessionId();
        this._streamId = frameFlyweight.streamId();
        this._receiverId = frameFlyweight.receiverId();
        this._groupTag = frameFlyweight.groupTag();
        this._sourceAddress = frameFlyweight.sourceAddress();
        this._errorCode = frameFlyweight.errorCode().value();
        this._errorMessage = frameFlyweight.errorMessage();
        this._destinationRegistrationId = frameFlyweight.destinationRegistrationId();

        return this;
    }

    /**
     * Return a copy of this message. Useful if a callback is reusing an instance of this class to avoid unnecessary
     * allocation.
     * <p>
     * Java's `Object.clone()` is a shallow copy, so the copy shares the address and the message (both immutable).
     *
     * @return a copy of this instance's data.
     */
    public clone(): PublicationErrorFrame {
        const copy = new PublicationErrorFrame();
        copy._registrationId = this._registrationId;
        copy._sessionId = this._sessionId;
        copy._streamId = this._streamId;
        copy._receiverId = this._receiverId;
        copy._destinationRegistrationId = this._destinationRegistrationId;
        copy._groupTag = this._groupTag;
        copy._errorCode = this._errorCode;
        copy._errorMessage = this._errorMessage;
        copy._sourceAddress = this._sourceAddress;

        return copy;
    }

    /**
     * Build a String representation of the error frame.
     *
     * @return a String representation of the error frame.
     */
    public toString(): string {
        return (
            'PublicationErrorFrame{' +
            'registrationId=' +
            this.registrationId() +
            ', sessionId=' +
            this.sessionId() +
            ', streamId=' +
            this.streamId() +
            ', receiverId=' +
            this.receiverId() +
            ', destinationRegistrationId=' +
            this.destinationRegistrationId() +
            ', groupTag=' +
            this.groupTag() +
            ', errorCode=' +
            this.errorCode() +
            ', errorMessage=' +
            this.errorMessage() +
            ', sourceAddress=' +
            String(this.sourceAddress()) +
            '}'
        );
    }
}
