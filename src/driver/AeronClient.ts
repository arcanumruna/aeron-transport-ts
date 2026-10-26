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
// Port of io/aeron/driver/AeronClient.java @ 1.53.3
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import { TimeUnit } from '../agrona/jdk.js';
import type { DriverManagedResource } from './DriverManagedResource.js';

/**
 * The members of the `DriverConductor` (task T18) that {@link AeronClient.onTimeEvent} calls: the narrowest type it
 * needs, a forward reference in the manner of spec D24 (`docs/mapping.md`, "Sources"). `DriverManagedResource` still
 * declares the conductor as an opaque type until T18; a method parameter is compared bivariantly, so the class
 * satisfies the interface.
 */
export interface AeronClientConductor {
    clientTimeout(clientId: number): void;
    unavailableCounter(registrationId: number, counterId: number): void;
}

/**
 * Aeron client library tracker.
 */
export class AeronClient implements DriverManagedResource {
    private readonly _clientId: number;
    private readonly clientLivenessTimeoutMs: number;
    private reachedEndOfLife = false;
    private closedByCommand = false;
    private readonly clientTimeouts: AtomicCounter;
    private readonly heartbeatTimestamp: AtomicCounter;

    public constructor(
        clientId: number,
        clientLivenessTimeoutNs: number,
        clientTimeouts: AtomicCounter,
        heartbeatTimestamp: AtomicCounter,
    ) {
        this._clientId = clientId;
        this.clientLivenessTimeoutMs = Math.max(1, TimeUnit.NANOSECONDS.toMillis(clientLivenessTimeoutNs));
        this.clientTimeouts = clientTimeouts;
        this.heartbeatTimestamp = heartbeatTimestamp;
    }

    public close(): void {
        this.heartbeatTimestamp.close();
    }

    public onTimeEvent(_timeNs: number, timeMs: number, conductor: AeronClientConductor): void {
        if (timeMs > this.heartbeatTimestamp.get() + this.clientLivenessTimeoutMs) {
            this.reachedEndOfLife = true;

            if (!this.closedByCommand) {
                this.clientTimeouts.incrementRelease();
                conductor.clientTimeout(this._clientId);
            }

            conductor.unavailableCounter(this._clientId, this.heartbeatTimestamp.id());
        }
    }

    public hasReachedEndOfLife(): boolean {
        return this.reachedEndOfLife;
    }

    public toString(): string {
        return (
            'AeronClient{' +
            'clientId=' +
            this._clientId +
            ', clientLivenessTimeoutMs=' +
            this.clientLivenessTimeoutMs +
            ', reachedEndOfLife=' +
            this.reachedEndOfLife +
            ', closedByCommand=' +
            this.closedByCommand +
            ', clientTimeouts=' +
            this.clientTimeouts +
            ', heartbeatTimestamp=' +
            this.heartbeatTimestamp +
            '}'
        );
    }

    public clientId(): number {
        return this._clientId;
    }

    public hasTimedOut(): boolean {
        return this.reachedEndOfLife;
    }

    public timeOfLastKeepaliveMs(nowMs: number): void {
        this.heartbeatTimestamp.setRelease(nowMs);
    }

    public onClosedByCommand(): void {
        this.closedByCommand = true;
        this.heartbeatTimestamp.setRelease(0);
    }
}
