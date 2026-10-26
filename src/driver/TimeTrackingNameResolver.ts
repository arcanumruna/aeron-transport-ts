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
// Port of io/aeron/driver/TimeTrackingNameResolver.java @ 1.53.3
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import type { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import { requireNonNull } from '../agrona/jdkLang.js';
import type { CounterProvider } from '../client/CounterProvider.js';
import type { InetAddress } from './jdkNet.js';
import type { DutyCycleTracker } from './DutyCycleTracker.js';
import type { NameResolverAgent } from './NameResolverAgent.js';

export class TimeTrackingNameResolver implements NameResolverAgent {
    private readonly delegateResolver: NameResolverAgent;
    private readonly clock: NanoClock;
    private readonly maxTimeTracker: DutyCycleTracker;

    public constructor(delegateResolver: NameResolverAgent, clock: NanoClock, maxTimeTracker: DutyCycleTracker) {
        this.delegateResolver = requireNonNull(delegateResolver);
        this.clock = requireNonNull(clock);
        this.maxTimeTracker = requireNonNull(maxTimeTracker);
    }

    /**
     * {@inheritDoc}
     */
    public resolve(name: string, uriParamName: string, isReResolution: boolean): InetAddress | null {
        const beginNs = this.clock.nanoTime();
        this.maxTimeTracker.update(beginNs);
        try {
            return this.delegateResolver.resolve(name, uriParamName, isReResolution);
        } finally {
            const endNs = this.clock.nanoTime();
            this.maxTimeTracker.measureAndUpdate(endNs);
            // Java logs the resolution here (DriverLog.logResolve); the logging agents are not ported.
        }
    }

    /**
     * {@inheritDoc}
     */
    public lookup(name: string, uriParamName: string, isReLookup: boolean): string {
        const beginNs = this.clock.nanoTime();
        this.maxTimeTracker.update(beginNs);
        try {
            return this.delegateResolver.lookup(name, uriParamName, isReLookup);
        } finally {
            const endNs = this.clock.nanoTime();
            this.maxTimeTracker.measureAndUpdate(endNs);
            // Java logs the lookup here (DriverLog.logLookup); the logging agents are not ported.
        }
    }

    /**
     * {@inheritDoc}
     */
    public init(countersReader: CountersReader, counterProvider: CounterProvider): void {
        this.delegateResolver.init(countersReader, counterProvider);
    }

    /**
     * {@inheritDoc}
     */
    public onStart(): void {
        this.delegateResolver.onStart();
    }

    /**
     * {@inheritDoc}
     */
    public doWork(): number {
        return this.delegateResolver.doWork();
    }

    /**
     * {@inheritDoc}
     */
    public onClose(): void {
        this.delegateResolver.onClose();
    }

    /**
     * {@inheritDoc}
     */
    public name(): string {
        return 'TimeTracking(' + this.delegateResolver.name() + ')';
    }

    /**
     * {@inheritDoc}
     */
    public roleName(): string {
        return this.name();
    }
}
