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
// Port of org/agrona/concurrent/ControlledMessageHandler.java @ Agrona 2.6.1
import type { MutableDirectBuffer } from '../MutableDirectBuffer.js';

/**
 * Action to be taken on return from {@link ControlledMessageHandler.onMessage}: the nested Java enum
 * `ControlledMessageHandler.Action`, also reachable as `ControlledMessageHandler.Action`.
 */
export class Action {
    private static nextOrdinal = 0;

    /**
     * Abort the current read operation and do not advance the position for this message.
     */
    public static readonly ABORT: Action = new Action('ABORT');

    /**
     * Break from the current read operation and commit the position as of the end of the current message
     * being handled.
     */
    public static readonly BREAK: Action = new Action('BREAK');

    /**
     * Continue processing but commit the position as of the end of the current message so that
     * flow control is applied to this point.
     */
    public static readonly COMMIT: Action = new Action('COMMIT');

    /**
     * Continue processing until limit or no messages with position commit at end of read as the in
     * {@link ControlledMessageHandler.onMessage}.
     */
    public static readonly CONTINUE: Action = new Action('CONTINUE');

    private readonly _name: string;
    private readonly _ordinal: number = 0;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = Action.nextOrdinal++;
    }

    public static values(): Action[] {
        return [Action.ABORT, Action.BREAK, Action.COMMIT, Action.CONTINUE];
    }

    public name(): string {
        return this._name;
    }

    public ordinal(): number {
        return this._ordinal;
    }

    public toString(): string {
        return this._name;
    }
}

/**
 * Callback interface for processing of messages that are read from a buffer, where the handler controls how the read
 * progresses. An interface with the method `onMessage`, as {@link MessageHandler}.
 */
export interface ControlledMessageHandler {
    /**
     * Called for the processing of each message read from a buffer in turn.
     *
     * @param msgTypeId type of the encoded message.
     * @param buffer    containing the encoded message.
     * @param index     at which the encoded message begins.
     * @param length    in bytes of the encoded message.
     * @return {@link Action} to be taken to control how the read progresses.
     */
    onMessage(msgTypeId: number, buffer: MutableDirectBuffer, index: number, length: number): Action;
}

/**
 * The nested enum `ControlledMessageHandler.Action`, beside the interface of the same name.
 */
export const ControlledMessageHandler = { Action } as const;

type ActionType = Action;

// Declaration merging: `ControlledMessageHandler.Action` is a type as well as a value, as the nested Java enum is.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ControlledMessageHandler {
    export type Action = ActionType;
}
