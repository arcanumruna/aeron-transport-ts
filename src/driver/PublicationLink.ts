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
// Port of io/aeron/driver/PublicationLink.java @ 1.53.3
import type { AeronClient } from './AeronClient.js';
import type { DriverManagedResource } from './DriverManagedResource.js';

/**
 * The members of a `NetworkPublication` (task T15) or an `IpcPublication` (not ported) that a
 * {@link PublicationLink} calls: the narrowest type it needs, a forward reference in the manner of spec D24
 * (`docs/mapping.md`, "Sources"). Both Java constructors become one taking this type (spec D43).
 */
export interface LinkedPublication {
    incRef(): void;
    decRef(): void;
    revoke(): void;
}

/**
 * Tracks an Aeron client interest registration in a {@link NetworkPublication} or {@link IpcPublication}.
 */
export class PublicationLink implements DriverManagedResource {
    private readonly _registrationId: number = 0;
    private readonly publication: LinkedPublication;
    private readonly client: AeronClient;
    private reachedEndOfLife = false;

    public constructor(registrationId: number, client: AeronClient, publication: LinkedPublication) {
        this._registrationId = registrationId;
        this.client = client;

        this.publication = publication;
        publication.incRef();
    }

    public close(): void {
        this.publication.decRef();
    }

    public revoke(): void {
        this.publication.revoke();
    }

    public onTimeEvent(_timeNs: number, _timeMs: number, _conductor: unknown): void {
        if (this.client.hasTimedOut()) {
            this.reachedEndOfLife = true;
        }
    }

    public hasReachedEndOfLife(): boolean {
        return this.reachedEndOfLife;
    }

    public registrationId(): number {
        return this._registrationId;
    }
}
