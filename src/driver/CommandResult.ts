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
// Port of io/aeron/driver/CommandResult.java @ 1.53.3
import { LangUtil } from '../agrona/LangUtil.js';

/**
 * The result of a command that the {@link NativeResourceAgent} completes, read by the conductor on a later duty cycle.
 * Java's fields are `volatile`; here the agents share one thread (spec D3), so they are plain.
 */
export class CommandResult<T> {
    private value: T | null = null;
    private _error: Error | null = null;

    public ok(value: T): void {
        this.value = value;
    }

    public error(error: Error): void {
        this._error = error;
    }

    /**
     * @return the value, or null while the command has not completed.
     * @throws the error the command completed with.
     */
    public get(): T | null {
        const error = this._error;
        if (null !== error) {
            LangUtil.rethrowUnchecked(error);
        }
        return this.value;
    }
}
