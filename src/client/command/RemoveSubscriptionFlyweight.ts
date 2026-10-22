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
// Port of io/aeron/command/RemoveSubscriptionFlyweight.java @ 1.53.3
import { RemoveMessageFlyweight } from './RemoveMessageFlyweight.js';

/**
 * Command message flyweight to remove a subscription.
 *
 * @see RemoveMessageFlyweight
 */
export class RemoveSubscriptionFlyweight extends RemoveMessageFlyweight {
    /**
     * Length of the message in bytes.
     * <p>
     * Not in Java, where this class inherits the static `length()` of {@link RemoveMessageFlyweight}: every JS class has
     * its own `length` property (the number of constructor parameters), which hides an inherited static method of that
     * name, so `RemoveSubscriptionFlyweight.length()` needs its own.
     *
     * @return length of the message in bytes.
     */
    public static override length(): number {
        return RemoveMessageFlyweight.length();
    }
}
