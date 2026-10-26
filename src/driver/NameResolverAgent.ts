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
// Port of io/aeron/driver/NameResolverAgent.java @ 1.53.3
import type { Agent } from '../agrona/concurrent/Agent.js';
import type { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import type { CounterProvider } from '../client/CounterProvider.js';
import type { NameResolver } from './NameResolver.js';

/**
 * Interface to allow managing a {@link NameResolver} using an {@link Agent}.
 * <p>
 * The Java default methods `init` (does nothing), `doWork` (returns 0) and `roleName` (returns `name()`) are required
 * members here (see {@link NameResolver}).
 */
export interface NameResolverAgent extends NameResolver, Agent {
    /**
     * Do post construction initialisation of the name resolver.
     *
     * @param countersReader for finding existing counters.
     * @param counterProvider for adding counters.
     */
    init(countersReader: CountersReader, counterProvider: CounterProvider): void;
}
