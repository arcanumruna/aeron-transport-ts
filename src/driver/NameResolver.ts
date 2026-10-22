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
// Port of io/aeron/driver/NameResolver.java @ 1.53.3
import type { InetAddress } from './jdkNet.js';

/**
 * Interface to allow resolving a name to an {@link InetAddress}.
 * <p>
 * Java's default methods `lookup` (returns the name) and `name` (the class name) are required members here, because a
 * TypeScript interface has no default methods: every implementer writes them, as `DefaultNameResolver` does.
 */
export interface NameResolver {
    /**
     * Resolve a name and return the most up to date {@link InetAddress} that represents the name.
     *
     * @param name           to resolve.
     * @param uriParamName   that the resolution is for.
     * @param isReResolution `true` if this is a re-resolution or `false` if initial resolution.
     * @return address for the name that most recently represents the name or null if not resolvable currently.
     * @see CommonContext.ENDPOINT_PARAM_NAME
     * @see CommonContext.MDC_CONTROL_PARAM_NAME
     */
    resolve(name: string, uriParamName: string, isReResolution: boolean): InetAddress | null;

    /**
     * Lookup the name and return a string of the form `name:port` that represents the endpoint or control param
     * of the URI. The Java default returns `name`.
     *
     * @param name         to lookup
     * @param uriParamName that the lookup is for.
     * @param isReLookup   `true` if this is a re-lookup or `false` if initial lookup.
     * @return string in `name:port` form.
     */
    lookup(name: string, uriParamName: string, isReLookup: boolean): string;

    /**
     * Gets the name of the resolver, used for logging and debugging. The Java default is the qualified class name.
     *
     * @return name of the resolver.
     */
    name(): string;
}
