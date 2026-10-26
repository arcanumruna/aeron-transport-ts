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
// Not in Java (spec D90): the value of `Aeron.NULL_VALUE`, in a module with no imports.

/**
 * Used to represent a null value for when some value is not yet set: `Aeron.NULL_VALUE`. It lives in a leaf module
 * because the files that `Aeron.ts` imports (`CommonContext`, `Subscription`, `ChannelUri`, ...) read it when they are
 * evaluated, and `Aeron.ts` imports them in turn (`Aeron.Context` extends `CommonContext`): reading it from `Aeron`
 * would run into the cycle.
 */
export const NULL_VALUE = -1;
