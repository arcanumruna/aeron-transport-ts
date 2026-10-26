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
// Not in Java (spec D7, D58, D92): the asynchronous look-up of a host name that fills the cache of the name resolver.
import dns from 'node:dns';
import net from 'node:net';
import { ChannelUri } from '../client/ChannelUri.js';
import { CommonContext } from '../client/CommonContext.js';
import { DefaultNameResolver } from './DefaultNameResolver.js';
import { InetAddress } from './jdkNet.js';

const { ENDPOINT_PARAM_NAME, INTERFACE_PARAM_NAME, MDC_CONTROL_PARAM_NAME, RESPONSE_ENDPOINT_PARAM_NAME } =
    CommonContext;

const NO_HOSTS: readonly string[] = [];

const HOST_NAME = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/**
 * The host of an `endpoint`, `interface` or `control` value that is a DNS name to look up: not an IP literal, not
 * `localhost`, not a tag (`tag:1234`), and a valid host name. Anything else (and anything that does not parse) is
 * resolved at once by the synchronous resolver, which fails as Java's does.
 *
 * @param endpoint the value of the parameter, `host:port`.
 * @return the host name to look up, or null if there is none.
 */
export function hostToLookUp(endpoint: string): string | null {
    const separator = endpoint.lastIndexOf(':');
    if (separator <= 0 || '[' === endpoint.charAt(0)) {
        return null;
    }
    const host = endpoint.substring(0, separator);
    if (
        0 !== net.isIP(host) ||
        'localhost' === host.toLowerCase() ||
        'tag' === host.toLowerCase() ||
        !HOST_NAME.test(host)
    ) {
        return null;
    }
    return host;
}

/**
 * Look up a host name with `dns.lookup(name, { order: 'ipv4first' })` (Java's order), and put the address in the cache of
 * the {@link DefaultNameResolver} so that its synchronous `resolve` finds it. A failed look-up leaves the cache as it is:
 * the name then fails to resolve as in Java, and the command that uses it is answered with the error.
 *
 * @param host the host name, as {@link hostToLookUp} answers it.
 * @param done called when the look-up is over, whatever its result, on the event loop. A `dns.lookup` that throws
 *             at once (an argument it refuses) throws from here.
 */
export function lookUpHost(host: string, done: () => void): void {
    dns.lookup(host, { order: 'ipv4first' }, (err, address) => {
        if (null === err) {
            try {
                DefaultNameResolver.cache(host, InetAddress.getByName(address));
            } catch (ex) {
                // the address is not usable: the name stays unresolved, as after a failed look-up
                void ex;
            }
        }
        done();
    });
}

/**
 * The host names to look up before a command with this channel reaches the conductor (spec D7, D92): the DNS names
 * in the `endpoint`, `interface`, `control` and `response-endpoint` parameters of a UDP channel. The same name is
 * listed once. A channel that does not parse, or is not UDP, has none: the driver answers it with the error.
 *
 * @param channel the channel URI of a publication, a subscription or a destination.
 * @return the host names, in the order of the parameters; empty (and shared) when there are none.
 */
export function hostsToLookUp(channel: string): readonly string[] {
    let uri: ChannelUri;
    try {
        uri = ChannelUri.parse(channel);
    } catch (ex) {
        void ex;
        return NO_HOSTS;
    }

    if ((uri.prefix() ?? '').length > 0 || !uri.isUdp()) {
        return NO_HOSTS;
    }

    let hosts: string[] | null = null;
    for (const name of [
        ENDPOINT_PARAM_NAME,
        INTERFACE_PARAM_NAME,
        MDC_CONTROL_PARAM_NAME,
        RESPONSE_ENDPOINT_PARAM_NAME,
    ]) {
        const value = uri.get(name);
        if (null !== value) {
            const host = hostToLookUp(value);
            if (null !== host && (null === hosts || !hosts.includes(host))) {
                (hosts ??= []).push(host);
            }
        }
    }

    return hosts ?? NO_HOSTS;
}
