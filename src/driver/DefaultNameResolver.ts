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
// Port of io/aeron/driver/DefaultNameResolver.java @ 1.53.3
import type { CountersReader } from '../agrona/concurrent/status/CountersReader.js';
import type { CounterProvider } from '../client/CounterProvider.js';
import { InetAddress, UnknownHostException } from './jdkNet.js';
import type { NameResolverAgent } from './NameResolverAgent.js';

/**
 * Use the default host name resolver via {@link InetAddress}.
 * <p>
 * Node's resolver is asynchronous, so `resolve` stays synchronous as in Java and answers IP literals, `localhost` and
 * the host names in the cache that {@link DefaultNameResolver.cache} fills (spec D7); any other name is the Java
 * `UnknownHostException`, which `resolve` turns into null.
 */
export class DefaultNameResolver implements NameResolverAgent {
    /**
     * Singleton instance which can be used to avoid allocation.
     */
    public static readonly INSTANCE = new DefaultNameResolver();

    /**
     * Add (or replace) the address of a host name, as `dns.lookup` found it. The name is case-insensitive.
     *
     * @param name    the host name.
     * @param address the address it resolves to.
     */
    public static cache(name: string, address: InetAddress): void {
        InetAddress.nameCache.set(name.toLowerCase(), address);
    }

    /**
     * Remove every cached host name.
     */
    public static clearCache(): void {
        InetAddress.nameCache.clear();
    }

    /**
     * {@inheritDoc}
     */
    public resolve(name: string, _uriParamName: string, _isReResolution: boolean): InetAddress | null {
        let resolvedAddress: InetAddress | null = null;
        try {
            resolvedAddress = InetAddress.getByName(name);
        } catch (e) {
            if (!(e instanceof UnknownHostException)) {
                throw e;
            }
        }

        return resolvedAddress;
    }

    /**
     * Name resolution hook, useful for logging.
     *
     * @param resolverName    used to handle the resolution.
     * @param hostname        that was resolved.
     * @param resolvedAddress the resulting address or null if it can't be resolved.
     * @deprecated No longer used for logging.
     */
    public resolveHook(_resolverName: string, _hostname: string, _resolvedAddress: InetAddress | null): void {}

    // The Java default methods of NameResolver, NameResolverAgent and Agent.

    public lookup(name: string, _uriParamName: string, _isReLookup: boolean): string {
        return name;
    }

    public name(): string {
        return this.constructor.name;
    }

    public init(_countersReader: CountersReader, _counterProvider: CounterProvider): void {}

    public onStart(): void {}

    public doWork(): number {
        return 0;
    }

    public onClose(): void {}

    public roleName(): string {
        return this.name();
    }
}
