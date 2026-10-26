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
// Port of io/aeron/driver/SessionKey.java @ 1.53.3
import { stringHashCode } from '../agrona/jdkUtil.js';

/**
 * Key of a session in the driver: a session id, a stream id and a channel. Java's package-private class is exported
 * for the other driver files and the tests. The fields are package-private in Java (`sessionId` is not final); they
 * are public here. {@code equals} and {@code hashCode} are Java's, with `int` arithmetic that wraps.
 */
export class SessionKey {
    public sessionId = 0;
    public readonly streamId: number = 0;
    public readonly channel: string;

    public constructor(streamId: number, channel: string);
    public constructor(sessionId: number, streamId: number, channel: string);
    public constructor(...args: [number, string] | [number, number, string]) {
        if (2 === args.length) {
            this.streamId = args[0];
            this.channel = args[1];
        } else {
            this.sessionId = args[0];
            this.streamId = args[1];
            this.channel = args[2];
        }
    }

    public equals(o: unknown): boolean {
        if (this === o) {
            return true;
        }

        if (!(o instanceof SessionKey) || o.constructor !== this.constructor) {
            return false;
        }

        return this.sessionId === o.sessionId && this.streamId === o.streamId && this.channel === o.channel;
    }

    public hashCode(): number {
        return Math.imul(Math.imul(Math.imul(31, this.sessionId), this.streamId), stringHashCode(this.channel));
    }

    public toString(): string {
        return (
            'SessionKey{sessionId=' + this.sessionId + ', streamId=' + this.streamId + ', channel=' + this.channel + '}'
        );
    }
}
