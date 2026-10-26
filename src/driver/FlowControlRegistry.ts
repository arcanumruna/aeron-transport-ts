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
// Not in Java (spec D25, D118): the class names that Java resolves with `Class.forName(name).getConstructor()
// .newInstance()` for the flow control strategies and suppliers.
import { ClassNotFoundException } from '../agrona/jdk.js';
import { LangUtil } from '../agrona/LangUtil.js';
import { DefaultMulticastFlowControlSupplier } from './DefaultMulticastFlowControlSupplier.js';
import { DefaultUnicastFlowControlSupplier } from './DefaultUnicastFlowControlSupplier.js';
import { type FlowControl } from './FlowControl.js';
import { type FlowControlSupplier } from './FlowControlSupplier.js';
import { MaxMulticastFlowControl } from './MaxMulticastFlowControl.js';
import { MaxMulticastFlowControlSupplier } from './MaxMulticastFlowControlSupplier.js';
import { MinMulticastFlowControl } from './MinMulticastFlowControl.js';
import { MinMulticastFlowControlSupplier } from './MinMulticastFlowControlSupplier.js';
import { PreferredMulticastFlowControl } from './PreferredMulticastFlowControl.js';
import { PreferredMulticastFlowControlSupplier } from './PreferredMulticastFlowControlSupplier.js';
import { TaggedMulticastFlowControl } from './TaggedMulticastFlowControl.js';
import { TaggedMulticastFlowControlSupplier } from './TaggedMulticastFlowControlSupplier.js';
import { UnicastFlowControl } from './UnicastFlowControl.js';

const STRATEGIES: ReadonlyMap<string, () => FlowControl> = new Map<string, () => FlowControl>([
    ['io.aeron.driver.MaxMulticastFlowControl', () => new MaxMulticastFlowControl()],
    ['io.aeron.driver.MinMulticastFlowControl', () => new MinMulticastFlowControl()],
    ['io.aeron.driver.TaggedMulticastFlowControl', () => new TaggedMulticastFlowControl()],
    ['io.aeron.driver.PreferredMulticastFlowControl', () => new PreferredMulticastFlowControl()],
    ['io.aeron.driver.UnicastFlowControl', () => new UnicastFlowControl()],
]);

const SUPPLIERS: ReadonlyMap<string, () => FlowControlSupplier> = new Map<string, () => FlowControlSupplier>([
    ['io.aeron.driver.DefaultUnicastFlowControlSupplier', () => new DefaultUnicastFlowControlSupplier()],
    ['io.aeron.driver.DefaultMulticastFlowControlSupplier', () => new DefaultMulticastFlowControlSupplier()],
    ['io.aeron.driver.MaxMulticastFlowControlSupplier', () => new MaxMulticastFlowControlSupplier()],
    ['io.aeron.driver.MinMulticastFlowControlSupplier', () => new MinMulticastFlowControlSupplier()],
    ['io.aeron.driver.TaggedMulticastFlowControlSupplier', () => new TaggedMulticastFlowControlSupplier()],
    ['io.aeron.driver.PreferredMulticastFlowControlSupplier', () => new PreferredMulticastFlowControlSupplier()],
]);

/**
 * The static registry of the {@link FlowControl} strategies and {@link FlowControlSupplier}s by their Java class name
 * (there is no class loader, spec D25). The registered classes are the ones this port has: Java loads any class on
 * the class path, and a name that is not registered is a `ClassNotFoundException` carrying the name.
 */
export const FlowControlRegistry = {
    /**
     * `Class.forName(className).getConstructor().newInstance()` for a {@link FlowControl}.
     *
     * @param className the fully qualified Java class name of the strategy.
     * @return a new strategy.
     * @throws ClassNotFoundException if the name is not registered.
     */
    newFlowControl(className: string): FlowControl {
        const factory = STRATEGIES.get(className);
        if (undefined === factory) {
            return LangUtil.rethrowUnchecked(new ClassNotFoundException(className));
        }

        return factory();
    },

    /**
     * `Class.forName(className).getConstructor().newInstance()` for a {@link FlowControlSupplier}.
     *
     * @param className the fully qualified Java class name of the supplier.
     * @return a new supplier.
     * @throws ClassNotFoundException if the name is not registered.
     */
    newFlowControlSupplier(className: string): FlowControlSupplier {
        const factory = SUPPLIERS.get(className);
        if (undefined === factory) {
            return LangUtil.rethrowUnchecked(new ClassNotFoundException(className));
        }

        return factory();
    },
} as const;
