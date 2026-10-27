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
// Port of io/aeron/driver/PendingSetupMessageFromSource.java @ 1.53.3
import { SessionState } from './DataPacketDispatcher.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { ReceiveChannelEndpoint } from './media/ReceiveChannelEndpoint.js';

const { PENDING_SETUP_FRAME } = SessionState;

/**
 * A setup message that the receiver has asked a source for and is waiting for, with the time of the last request. The
 * fields have the Java names with a leading `_` because the accessors have the Java names.
 *
 * @internal package-private in Java
 */
export class PendingSetupMessageFromSource {
    private readonly _sessionId: number = 0;
    private readonly _streamId: number = 0;
    private readonly _transportIndex: number = 0;
    private readonly periodic: boolean;
    private readonly _channelEndpoint: ReceiveChannelEndpoint;
    private _controlAddress: InetSocketAddress | null;

    private _timeOfStatusMessageNs = 0;

    public constructor(
        sessionId: number,
        streamId: number,
        transportIndex: number,
        channelEndpoint: ReceiveChannelEndpoint,
        periodic: boolean,
        controlAddress: InetSocketAddress | null,
    ) {
        this._sessionId = sessionId;
        this._streamId = streamId;
        this._transportIndex = transportIndex;
        this._channelEndpoint = channelEndpoint;
        this.periodic = periodic;
        this._controlAddress = controlAddress;
    }

    public sessionId(): number {
        return this._sessionId;
    }

    public streamId(): number {
        return this._streamId;
    }

    public transportIndex(): number {
        return this._transportIndex;
    }

    public channelEndpoint(): ReceiveChannelEndpoint {
        return this._channelEndpoint;
    }

    public isPeriodic(): boolean {
        return this.periodic;
    }

    public shouldElicitSetupMessage(): boolean {
        return this._channelEndpoint.dispatcher().shouldElicitSetupMessage();
    }

    /**
     * The control address of the source, or set it (Java: two overloads).
     */
    public controlAddress(): InetSocketAddress | null;
    public controlAddress(newControlAddress: InetSocketAddress | null): void;
    public controlAddress(newControlAddress?: InetSocketAddress | null): InetSocketAddress | null | void {
        if (undefined === newControlAddress) {
            return this._controlAddress;
        }

        this._controlAddress = newControlAddress;
    }

    /**
     * The time of the last status message that was sent for the pending setup, or set it (Java: two overloads).
     */
    public timeOfStatusMessageNs(): number;
    public timeOfStatusMessageNs(nowNs: number): void;
    public timeOfStatusMessageNs(nowNs?: number): number | void {
        if (undefined === nowNs) {
            return this._timeOfStatusMessageNs;
        }

        this._timeOfStatusMessageNs = nowNs;
    }

    public removeFromDataPacketDispatcher(): void {
        this._channelEndpoint
            .dispatcher()
            .removeSessionInterestByState(this._sessionId, this._streamId, PENDING_SETUP_FRAME);
    }

    public toString(): string {
        return (
            'PendingSetupMessageFromSource{' +
            'sessionId=' +
            this._sessionId +
            ', streamId=' +
            this._streamId +
            ', transportIndex=' +
            this._transportIndex +
            ', periodic=' +
            this.periodic +
            ', channelEndpoint=' +
            this._channelEndpoint +
            ', controlAddress=' +
            this._controlAddress +
            ', timeOfStatusMessageNs=' +
            this._timeOfStatusMessageNs +
            '}'
        );
    }
}
