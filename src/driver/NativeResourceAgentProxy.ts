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
// Port of io/aeron/driver/NativeResourceAgentProxy.java @ 1.53.3
import type { OneToOneConcurrentArrayQueue } from '../agrona/concurrent/OneToOneConcurrentArrayQueue.js';
import type { AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import type { ChannelUri } from '../client/ChannelUri.js';
import type { RawLog } from './buffer/RawLog.js';
import { CommandProxy } from './CommandProxy.js';
import type { Runnable } from './CommandProxy.js';
import { CommandResult } from './CommandResult.js';
import type { InetSocketAddress } from './jdkNet.js';
import type { UdpChannel } from './media/UdpChannel.js';
import type { NativeResourceAgent } from './NativeResourceAgent.js';

/**
 * Proxy for offering into the {@link NativeResourceAgent}'s command queue. A command is a closure (Java: a
 * `Runnable`) made by the conductor, which is the control plane and not a per-message path.
 */
export class NativeResourceAgentProxy extends CommandProxy {
    private _nativeResourceAgent: NativeResourceAgent | null = null;

    public constructor(commandQueue: OneToOneConcurrentArrayQueue<Runnable>, failCount: AtomicCounter) {
        super(commandQueue, failCount);
    }

    public nativeResourceAgent(nativeResourceAgent: NativeResourceAgent): void {
        this._nativeResourceAgent = nativeResourceAgent;
    }

    /**
     * Completes the parses that wait for a `dns.lookup` with the cache as it is (see
     * {@link NativeResourceAgent.failPendingLookups}); a synchronous client call that blocks the thread calls it.
     */
    public failPendingLookups(): number {
        return this._nativeResourceAgent?.failPendingLookups() ?? 0;
    }

    public parseChannel(channel: string, isDestination: boolean): CommandResult<UdpChannel> {
        const result = new CommandResult<UdpChannel>();
        this.offer(() =>
            (this._nativeResourceAgent as NativeResourceAgent).onParseChannel(result, channel, isDestination),
        );
        return result;
    }

    public reResolveAddress(endpoint: string, uriParamName: string): CommandResult<InetSocketAddress> {
        const result = new CommandResult<InetSocketAddress>();
        this.offer(() =>
            (this._nativeResourceAgent as NativeResourceAgent).onReResolveAddress(result, endpoint, uriParamName),
        );
        return result;
    }

    public destinationAddress(channel: ChannelUri): CommandResult<InetSocketAddress> {
        const result = new CommandResult<InetSocketAddress>();
        this.offer(() => (this._nativeResourceAgent as NativeResourceAgent).onDestinationAddress(result, channel));
        return result;
    }

    public freeLogBuffer(rawLog: RawLog): void {
        this.offer(() => (this._nativeResourceAgent as NativeResourceAgent).onFreeLogBuffer(rawLog));
    }

    public newPublicationLog(
        registrationId: number,
        termBufferLength: number,
        useSparseFiles: boolean,
    ): CommandResult<RawLog> {
        const result = new CommandResult<RawLog>();
        this.offer(() =>
            (this._nativeResourceAgent as NativeResourceAgent).onNewPublicationLog(
                result,
                registrationId,
                termBufferLength,
                useSparseFiles,
            ),
        );
        return result;
    }

    public newImageLog(
        registrationId: number,
        termBufferLength: number,
        useSparseFiles: boolean,
    ): CommandResult<RawLog> {
        const result = new CommandResult<RawLog>();
        this.offer(() =>
            (this._nativeResourceAgent as NativeResourceAgent).onNewImageLog(
                result,
                registrationId,
                termBufferLength,
                useSparseFiles,
            ),
        );
        return result;
    }
}
