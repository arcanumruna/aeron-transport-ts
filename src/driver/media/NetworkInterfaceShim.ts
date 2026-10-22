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
// Port of io/aeron/driver/media/NetworkInterfaceShim.java @ 1.53.3
import { type InterfaceAddress, NetworkInterface } from '../jdkNet.js';

export interface NetworkInterfaceShim {
    /** An array where Java returns an `Enumeration`. */
    getNetworkInterfaces(): NetworkInterface[];

    getInterfaceAddresses(ifc: NetworkInterface): InterfaceAddress[];

    isLoopback(ifc: NetworkInterface): boolean;
}

/**
 * The interface constant `DEFAULT`: `NetworkInterfaceShim.DEFAULT`. The shim reads `os.networkInterfaces()` through the
 * {@link NetworkInterface} stand-in.
 */
export const NetworkInterfaceShim = {
    DEFAULT: {
        getNetworkInterfaces(): NetworkInterface[] {
            return NetworkInterface.getNetworkInterfaces();
        },

        getInterfaceAddresses(ifc: NetworkInterface): InterfaceAddress[] {
            return ifc.getInterfaceAddresses();
        },

        isLoopback(ifc: NetworkInterface): boolean {
            return ifc.isLoopback();
        },
    } as NetworkInterfaceShim,
} as const;
