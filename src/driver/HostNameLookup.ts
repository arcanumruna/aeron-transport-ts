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

/** A caller waiting for a look-up: `done` when it is over, `onError` with what `done` threw (issue #84). */
type Waiter = { readonly done: () => void; readonly onError: (ex: unknown) => void };

/**
 * A `dns.lookup` that is out: its sequence number for its host, the callers waiting on it (emptied when a newer one
 * takes them over), and whether a refresh has joined it (issue #85).
 */
type LookUp = { readonly seq: number; readonly waiters: Waiter[]; refreshed: boolean };

/**
 * The look-ups of one host: the one that answers the waiters (null once it has), how many are out (that one and at most
 * one it superseded), the sequence number of the last one issued, and that of the last one whose answer was taken, so
 * that the answer of an older look-up that arrives late never replaces a newer one (issue #85).
 */
type HostLookUps = { current: LookUp | null; outstanding: number; issued: number; answered: number };

// The hosts with a look-up out, by lower-case host name (issue #78); a host is removed when none is out.
const hostLookUps = new Map<string, HostLookUps>();

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
 * <p>
 * Look-ups of the same name (case-insensitive) are coalesced (issue #78): a call while one is out joins it and starts no
 * second `dns.lookup`. A `refresh` joins too: its answer arrives after the request was made, but may come from a
 * look-up issued before it. A second refresh while the same look-up is still out supersedes it (issue #85): it starts a
 * new `dns.lookup` that takes over every waiter. At most one superseded look-up per name is out: while one is, every
 * call joins the current one, so a name never has more than two `dns.lookup`s out. The answer of a look-up is taken only
 * if no newer one has answered: a superseded look-up that answers late fills the cache only until the newer answers, and
 * never replaces its address.
 * <p>
 * Liveness: a refresh waits for at most one round of a look-up that hangs. Beyond that, a waiter relies on `dns.lookup`
 * answering at all, which the resolver of the OS bounds with its own timeouts and retries (`getaddrinfo`); a look-up that
 * the OS never answers holds its waiters, as a `getaddrinfo` that never returns holds Java's resolving thread.
 *
 * @param host    the host name, as {@link hostToLookUp} answers it.
 * @param done    called when the look-up is over, whatever its result: once per call, in the order of the calls. A name
 *                that is in the cache is not looked up again (unless `refresh`): `done` is called at once; otherwise it
 *                is called on the event loop. What it throws goes to `onError` and never stops the other waiters (issue
 *                #84). A `dns.lookup` that throws at once (an argument it refuses) throws from here, leaves no look-up
 *                out, and `done` is not called.
 * @param onError given what `done` threw. What `onError` itself throws is dropped: nothing up the stack of a dns callback
 *                can handle it, and from here it would read as the refusal of the argument.
 * @param refresh true to look the name up even if it is in the cache: the re-resolution of the driver (D58) wants the
 *                current address.
 */
export function lookUpHost(host: string, done: () => void, onError: (ex: unknown) => void, refresh = false): void {
    const key = host.toLowerCase();
    const waiter: Waiter = { done, onError };
    if (!refresh && InetAddress.nameCache.has(key)) {
        callWaiter(waiter);
        return;
    }

    let lookUps = hostLookUps.get(key);
    const joined = lookUps?.current ?? null;
    if (undefined !== lookUps && null !== joined) {
        // join, unless this is the second refresh of a look-up and no superseded one is still out
        if (!(refresh && joined.refreshed && 1 === lookUps.outstanding)) {
            joined.waiters.push(waiter);
            joined.refreshed ||= refresh;
            return;
        }
    }

    if (undefined === lookUps) {
        lookUps = { current: null, outstanding: 0, issued: 0, answered: 0 };
        hostLookUps.set(key, lookUps);
    }
    const state = lookUps;
    // a new look-up, or one that supersedes a look-up a refresh joined: it takes over the waiters. A refresh that starts
    // one does not mark it: the next refresh joins it, since its answer was asked for after that refresh was made.
    const lookUp: LookUp = {
        seq: ++state.issued,
        waiters: null === joined ? [waiter] : [...joined.waiters, waiter],
        refreshed: false,
    };
    state.current = lookUp;
    state.outstanding++;

    // only an error that dns.lookup itself throws is handled here: the callback never throws, and one that ran at once
    // (a mock; Node never calls back synchronously) has already settled this look-up
    let called = false;
    try {
        dns.lookup(host, { order: 'ipv4first' }, (err, address) => {
            called = true;
            state.outstanding--;
            if (lookUp.seq > state.answered) {
                state.answered = lookUp.seq;
                if (null === err) {
                    try {
                        DefaultNameResolver.cache(host, InetAddress.getByName(address));
                    } catch (ex) {
                        // the address is not usable: the name stays unresolved, as after a failed look-up
                        void ex;
                    }
                }
            }
            if (state.current !== lookUp) {
                return; // superseded: the look-up that replaced it answers the waiters
            }
            state.current = null;
            if (0 === state.outstanding && hostLookUps.get(key) === state) {
                hostLookUps.delete(key); // before any waiter runs: one that looks the name up again starts afresh
            }
            for (const w of lookUp.waiters) {
                callWaiter(w);
            }
        });
    } catch (ex) {
        if (!called) {
            state.outstanding--;
            state.current = joined; // a superseded look-up keeps its waiters, without this one
            if (null === joined && 0 === state.outstanding) {
                hostLookUps.delete(key);
            }
        }
        throw ex;
    }
    if (null !== joined) {
        joined.waiters.length = 0; // the new look-up answers them: the superseded one holds nothing
    }
}

function callWaiter(waiter: Waiter): void {
    try {
        waiter.done();
    } catch (ex) {
        try {
            waiter.onError(ex);
        } catch (ignore) {
            void ignore;
        }
    }
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
