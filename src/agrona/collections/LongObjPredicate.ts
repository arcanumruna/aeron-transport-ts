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
// Port of org/agrona/collections/IntObjPredicate.java @ Agrona 2.6.1 (generated for long in Agrona's build)

/**
 * This is a (long, Object) primitive specialisation of a BiPredicate. Generated from IntObjPredicate.
 * <p>
 * A `long` is a `number` in +/-(2^53 - 1) (spec D5). The Java functional interface is a function type.
 */
export type LongObjPredicate<T> = (valueOne: number, valueTwo: T) => boolean;
