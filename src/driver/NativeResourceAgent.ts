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
// Port of io/aeron/driver/NativeResourceAgent.java @ 1.53.3
import dns from 'node:dns';
import net from 'node:net';
import type { Agent } from '../agrona/concurrent/Agent.js';
import type { CountedErrorHandler } from '../agrona/concurrent/CountedErrorHandler.js';
import type { NanoClock } from '../agrona/concurrent/NanoClock.js';
import type { OneToOneConcurrentArrayQueue } from '../agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { ChannelUri } from '../client/ChannelUri.js';
import type { LogFactory } from './buffer/LogFactory.js';
import type { RawLog } from './buffer/RawLog.js';
import type { CommandResult } from './CommandResult.js';
import { DefaultNameResolver } from './DefaultNameResolver.js';
import type { DutyCycleTracker } from './DutyCycleTracker.js';
import type { NameResolverAgent } from './NameResolverAgent.js';
import type { SystemCounters } from './status/SystemCounters.js';
import { InetAddress, type InetSocketAddress } from './jdkNet.js';
import { MediaDriver, type MediaDriverContext } from './MediaDriver.js';
import { UdpChannel } from './media/UdpChannel.js';
import { SystemCounterDescriptor } from './status/SystemCounterDescriptor.js';
import { TimeTrackingNameResolver } from './TimeTrackingNameResolver.js';

type Task = () => void;

const HOST_NAME = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/**
 * The host of an `endpoint` or `control` value that is a DNS name to look up: not an IP literal, not `localhost`, and
 * a valid host name. Anything else (and anything that does not parse) is resolved at once by the synchronous resolver,
 * which fails as Java's does.
 */
function hostToLookUp(endpoint: string): string | null {
    const separator = endpoint.lastIndexOf(':');
    if (separator <= 0 || '[' === endpoint.charAt(0)) {
        return null;
    }
    const host = endpoint.substring(0, separator);
    if (0 !== net.isIP(host) || 'localhost' === host.toLowerCase() || !HOST_NAME.test(host)) {
        return null;
    }
    return host;
}

/**
 * Agent that does the work of the conductor's blocking commands: parsing channels (name resolution), re-resolution,
 * log buffer creation and freeing. In the Java driver it runs on a thread of its own so that the conductor never
 * blocks; here it is stepped by the invoker (spec D3).
 * <p>
 * Re-resolution of a DNS name starts a `dns.lookup` (Node's resolver is asynchronous, spec D7, plan decision 6); the
 * callback refreshes the {@link DefaultNameResolver} cache and completes the {@link CommandResult}, which the
 * conductor reads on a later duty cycle. {@link NativeResourceAgent.setWakeUp} lets the runner be woken then.
 */
export class NativeResourceAgent implements Agent {
    private readonly logBuffersToFree: RawLog[] = [];
    private readonly nameResolver: TimeTrackingNameResolver;
    private readonly taskQueue: OneToOneConcurrentArrayQueue<Task>;
    private readonly freeFailsCounter: AtomicCounter;
    private readonly freeLimit: number;
    private readonly logFactory: LogFactory;
    private readonly countedErrorHandler: CountedErrorHandler;
    private wakeUp: (() => void) | null = null;

    public constructor(ctx: MediaDriverContext) {
        this.nameResolver = new TimeTrackingNameResolver(
            ctx.nameResolver() as NameResolverAgent,
            ctx.nanoClock() as NanoClock,
            ctx.nameResolverTimeTracker() as DutyCycleTracker,
        );
        this.taskQueue = ctx.nativeResourceAgentCommandQueue() as OneToOneConcurrentArrayQueue<Task>;
        this.freeFailsCounter = (ctx.systemCounters() as SystemCounters).get(SystemCounterDescriptor.FREE_FAILS);
        this.freeLimit = ctx.resourceFreeLimit();
        this.logFactory = ctx.logFactory() as LogFactory;
        this.countedErrorHandler = ctx.countedErrorHandler() as CountedErrorHandler;
    }

    /**
     * Called when a `dns.lookup` completes, so the runner that is idle can be woken (spec D8).
     */
    public setWakeUp(wakeUp: (() => void) | null): void {
        this.wakeUp = wakeUp;
    }

    public onStart(): void {
        this.nameResolver.onStart();
    }

    public doWork(): number {
        let workCount = 0;
        workCount += this.nameResolver.doWork();
        workCount += this.runTasks();
        workCount += this.freeEndOfLifeResources();

        return workCount;
    }

    public onClose(): void {
        this.nameResolver.onClose();

        let rawLog: RawLog | undefined;
        while (undefined !== (rawLog = this.logBuffersToFree.shift())) {
            rawLog.free();
        }
    }

    public roleName(): string {
        return MediaDriver.AERON_DRIVER_NATIVE_RESOURCE_THREAD_NAME;
    }

    public onParseChannel(result: CommandResult<UdpChannel>, channel: string, isDestination: boolean): void {
        try {
            result.ok(UdpChannel.parse(channel, this.nameResolver, isDestination));
        } catch (ex) {
            result.error(ex as Error);
        }
    }

    public onReResolveAddress(result: CommandResult<InetSocketAddress>, endpoint: string, uriParamName: string): void {
        const host = hostToLookUp(endpoint);
        if (null === host) {
            this.completeReResolution(result, endpoint, uriParamName);
            return;
        }

        try {
            dns.lookup(host, { order: 'ipv4first' }, (err, address) => {
                if (null === err) {
                    try {
                        DefaultNameResolver.cache(host, InetAddress.getByName(address));
                    } catch (ex) {
                        // the address is not usable: resolve as a failed lookup would
                        void ex;
                    }
                }
                // A failed lookup leaves the cache as it is: the resolution then ends as Java's does when the name
                // cannot be resolved, an unresolved address.
                this.completeReResolution(result, endpoint, uriParamName);
                this.wakeUp?.();
            });
        } catch (ex) {
            result.error(ex as Error);
        }
    }

    private completeReResolution(
        result: CommandResult<InetSocketAddress>,
        endpoint: string,
        uriParamName: string,
    ): void {
        try {
            result.ok(UdpChannel.resolve(endpoint, uriParamName, true, this.nameResolver));
        } catch (ex) {
            result.error(ex as Error);
        }
    }

    public onDestinationAddress(result: CommandResult<InetSocketAddress>, channel: ChannelUri): void {
        try {
            result.ok(UdpChannel.destinationAddress(channel, this.nameResolver));
        } catch (ex) {
            result.error(ex as Error);
        }
    }

    public onFreeLogBuffer(rawLog: RawLog): void {
        if (!rawLog.free()) {
            this.onFreeFail(rawLog);
        }
    }

    public onNewPublicationLog(
        result: CommandResult<RawLog>,
        registrationId: number,
        termBufferLength: number,
        useSparseFiles: boolean,
    ): void {
        try {
            result.ok(this.logFactory.newPublication(registrationId, termBufferLength, useSparseFiles));
        } catch (ex) {
            result.error(ex as Error);
        }
    }

    public onNewImageLog(
        result: CommandResult<RawLog>,
        registrationId: number,
        termBufferLength: number,
        useSparseFiles: boolean,
    ): void {
        try {
            result.ok(this.logFactory.newImage(registrationId, termBufferLength, useSparseFiles));
        } catch (ex) {
            result.error(ex as Error);
        }
    }

    private runTasks(): number {
        const task = this.taskQueue.poll();
        if (null !== task) {
            try {
                task();
            } catch (ex) {
                this.countedErrorHandler.onError(ex as Error);
            }
            return 1;
        }
        return 0;
    }

    private freeEndOfLifeResources(): number {
        let workCount = 0;

        for (let i = 0; i < this.freeLimit; i++) {
            const rawLog = this.logBuffersToFree.shift();
            if (undefined === rawLog) {
                break;
            }

            if (rawLog.free()) {
                workCount++;
            } else {
                this.onFreeFail(rawLog);
            }
        }

        return workCount;
    }

    private onFreeFail(rawLog: RawLog): void {
        if (!this.freeFailsCounter.isClosed()) {
            this.freeFailsCounter.incrementRelease();
        }
        this.logBuffersToFree.push(rawLog);
    }
}
