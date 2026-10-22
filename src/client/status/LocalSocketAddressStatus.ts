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
// Port of io/aeron/status/LocalSocketAddressStatus.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type DirectBuffer } from '../../agrona/DirectBuffer.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { type UnsafeBuffer } from '../../agrona/concurrent/UnsafeBuffer.js';
import { type AtomicCounter } from '../../agrona/concurrent/status/AtomicCounter.js';
import { type CountersManager } from '../../agrona/concurrent/status/CountersManager.js';
import { CountersReader } from '../../agrona/concurrent/status/CountersReader.js';
import { IllegalArgumentException } from '../../agrona/jdk.js';
import { AeronCounters } from '../AeronCounters.js';
import { ChannelEndpointStatus } from './ChannelEndpointStatus.js';

const { RECORD_ALLOCATED, RECORD_UNUSED } = CountersReader;

/**
 * Counter used to store the status of a bind address and port for the local end of a channel.
 * <p>
 * When the value is {@link ChannelEndpointStatus.ACTIVE} then the key value and label will be updated with the
 * socket address and port which is bound.
 */
export class LocalSocketAddressStatus {
    private static readonly CHANNEL_STATUS_ID_OFFSET = 0;
    private static readonly LOCAL_SOCKET_ADDRESS_LENGTH_OFFSET =
        LocalSocketAddressStatus.CHANNEL_STATUS_ID_OFFSET + BitUtil.SIZE_OF_INT;
    private static readonly LOCAL_SOCKET_ADDRESS_STRING_OFFSET =
        LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_LENGTH_OFFSET + BitUtil.SIZE_OF_INT;
    private static readonly MAX_IPV6_LENGTH = '[ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255]:65536'.length;

    /**
     * Initial length for a key, this will be expanded later when bound.
     */
    public static readonly INITIAL_LENGTH = BitUtil.SIZE_OF_INT * 2;

    /**
     * Type of the counter used to track a local socket address and port.
     */
    public static readonly LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID =
        AeronCounters.DRIVER_LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID;

    private constructor() {}

    /**
     * Allocate a counter to represent a local socket address associated with a channel.
     *
     * @param tempBuffer      for building up the key and label.
     * @param countersManager which will allocate the counter.
     * @param registrationId  of the action the counter is associated with.
     * @param channelStatusId with which the new counter is associated.
     * @param name            for the counter to put in the label.
     * @param typeId          to categorise the counter.
     * @return the allocated counter.
     */
    public static allocate(
        tempBuffer: MutableDirectBuffer,
        countersManager: CountersManager,
        registrationId: number,
        channelStatusId: number,
        name: string,
        typeId: number,
    ): AtomicCounter {
        tempBuffer.putInt(LocalSocketAddressStatus.CHANNEL_STATUS_ID_OFFSET, channelStatusId);
        tempBuffer.putInt(LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_LENGTH_OFFSET, 0);
        const keyLength = LocalSocketAddressStatus.INITIAL_LENGTH;

        let labelLength = 0;
        labelLength += tempBuffer.putStringWithoutLengthAscii(keyLength + labelLength, name);
        labelLength += tempBuffer.putStringWithoutLengthAscii(keyLength + labelLength, ': ');
        labelLength += tempBuffer.putIntAscii(keyLength + labelLength, channelStatusId);
        labelLength += tempBuffer.putStringWithoutLengthAscii(keyLength + labelLength, ' ');

        const counter = countersManager.newCounter(
            typeId,
            tempBuffer,
            0,
            keyLength,
            tempBuffer,
            keyLength,
            labelLength,
        );
        countersManager.setCounterRegistrationId(counter.id(), registrationId);

        return counter;
    }

    /**
     * Update the key metadata and label to contain the bound socket address once the transport is active.
     *
     * @param counter                representing the local socket address of the transport.
     * @param bindAddressAndPort     in string representation.
     * @param countersMetadataBuffer to be updated for the bound address.
     */
    public static updateBindAddress(
        counter: AtomicCounter,
        bindAddressAndPort: string,
        countersMetadataBuffer: UnsafeBuffer,
    ): void {
        if (bindAddressAndPort.length > LocalSocketAddressStatus.MAX_IPV6_LENGTH) {
            throw new IllegalArgumentException(
                'bindAddressAndPort value too long: ' +
                    bindAddressAndPort.length +
                    ' max: ' +
                    LocalSocketAddressStatus.MAX_IPV6_LENGTH,
            );
        }

        const keyIndex = CountersReader.metaDataOffset(counter.id()) + CountersReader.KEY_OFFSET;
        const addressStringIndex = keyIndex + LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STRING_OFFSET;
        const length = countersMetadataBuffer.putStringWithoutLengthAscii(addressStringIndex, bindAddressAndPort);
        const addressLengthIndex = keyIndex + LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_LENGTH_OFFSET;
        countersMetadataBuffer.putInt(addressLengthIndex, length);
        counter.appendToLabel(bindAddressAndPort);
    }

    /**
     * Find the list of currently bound local sockets.
     *
     * @param countersReader  for the connected driver.
     * @param channelStatus   value for the channel which aggregates the transports.
     * @param channelStatusId identity of the counter for the channel which aggregates the transports.
     * @return the list of active bound local socket addresses.
     */
    public static findAddresses(
        countersReader: CountersReader,
        channelStatus: number,
        channelStatusId: number,
    ): string[] {
        if (channelStatus !== ChannelEndpointStatus.ACTIVE) {
            return [];
        }

        const bindings: string[] = [];
        const buffer: DirectBuffer = countersReader.metaDataBuffer();

        for (let counterId = 0, maxId = countersReader.maxCounterId(); counterId <= maxId; counterId++) {
            const counterState = countersReader.getCounterState(counterId);

            if (RECORD_ALLOCATED === counterState) {
                if (
                    countersReader.getCounterTypeId(counterId) ===
                    LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID
                ) {
                    const recordOffset = CountersReader.metaDataOffset(counterId);
                    const keyIndex = recordOffset + CountersReader.KEY_OFFSET;

                    if (
                        channelStatusId ===
                            buffer.getInt(keyIndex + LocalSocketAddressStatus.CHANNEL_STATUS_ID_OFFSET) &&
                        ChannelEndpointStatus.ACTIVE === countersReader.getCounterValue(counterId)
                    ) {
                        const length = buffer.getInt(
                            keyIndex + LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_LENGTH_OFFSET,
                        );
                        if (length > 0) {
                            bindings.push(
                                buffer.getStringWithoutLengthAscii(
                                    keyIndex + LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STRING_OFFSET,
                                    length,
                                ),
                            );
                        }
                    }
                }
            } else if (RECORD_UNUSED === counterState) {
                break;
            }
        }

        return bindings;
    }

    /**
     * Find the currently bound socket address for the channel. There is an expectation that only one exists when
     * searching.
     *
     * @param countersReader  for the connected driver.
     * @param channelStatus   value for the channel which aggregates the transports.
     * @param channelStatusId identity of the counter for the channel which aggregates the transports.
     * @return the endpoint representing the bound socket address or `null` if not found.
     */
    public static findAddress(
        countersReader: CountersReader,
        channelStatus: number,
        channelStatusId: number,
    ): string | null {
        let endpoint: string | null = null;

        if (channelStatus === ChannelEndpointStatus.ACTIVE) {
            const buffer: DirectBuffer = countersReader.metaDataBuffer();

            for (let counterId = 0, maxId = countersReader.maxCounterId(); counterId <= maxId; counterId++) {
                const counterState = countersReader.getCounterState(counterId);

                if (RECORD_ALLOCATED === counterState) {
                    if (
                        countersReader.getCounterTypeId(counterId) ===
                        LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID
                    ) {
                        const recordOffset = CountersReader.metaDataOffset(counterId);
                        const keyIndex = recordOffset + CountersReader.KEY_OFFSET;

                        if (
                            channelStatusId ===
                                buffer.getInt(keyIndex + LocalSocketAddressStatus.CHANNEL_STATUS_ID_OFFSET) &&
                            ChannelEndpointStatus.ACTIVE === countersReader.getCounterValue(counterId)
                        ) {
                            const length = buffer.getInt(
                                keyIndex + LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_LENGTH_OFFSET,
                            );
                            if (length > 0) {
                                endpoint = buffer.getStringWithoutLengthAscii(
                                    keyIndex + LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STRING_OFFSET,
                                    length,
                                );
                            }

                            break;
                        }
                    }
                } else if (RECORD_UNUSED === counterState) {
                    break;
                }
            }
        }

        return endpoint;
    }

    /**
     * Return number of local addresses for the given subscription registration id.
     *
     * @param countersReader for the connected driver.
     * @param registrationId for the subscription.
     * @return number of local socket addresses in use.
     */
    public static findNumberOfAddressesByRegistrationId(
        countersReader: CountersReader,
        registrationId: number,
    ): number {
        let result = 0;

        for (let counterId = 0, maxId = countersReader.maxCounterId(); counterId <= maxId; counterId++) {
            const counterState = countersReader.getCounterState(counterId);

            if (
                counterState === RECORD_ALLOCATED &&
                countersReader.getCounterTypeId(counterId) ===
                    LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID &&
                countersReader.getCounterRegistrationId(counterId) === registrationId
            ) {
                result++;
            } else if (RECORD_UNUSED === counterState) {
                break;
            }
        }

        return result;
    }

    /**
     * Is a socket currently active for a channel.
     *
     * @param countersReader  for the connected driver.
     * @param channelStatusId identity of the counter for the channel.
     * @return true if the counter is active otherwise false.
     */
    public static isActive(countersReader: CountersReader, channelStatusId: number): boolean {
        const buffer: DirectBuffer = countersReader.metaDataBuffer();

        for (let counterId = 0, maxId = countersReader.maxCounterId(); counterId <= maxId; counterId++) {
            const counterState = countersReader.getCounterState(counterId);

            if (RECORD_ALLOCATED === counterState) {
                if (
                    countersReader.getCounterTypeId(counterId) ===
                    LocalSocketAddressStatus.LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID
                ) {
                    const recordOffset = CountersReader.metaDataOffset(counterId);
                    const keyIndex = recordOffset + CountersReader.KEY_OFFSET;

                    if (
                        channelStatusId ===
                            buffer.getInt(keyIndex + LocalSocketAddressStatus.CHANNEL_STATUS_ID_OFFSET) &&
                        ChannelEndpointStatus.ACTIVE === countersReader.getCounterValue(counterId)
                    ) {
                        return true;
                    }
                }
            } else if (RECORD_UNUSED === counterState) {
                break;
            }
        }

        return false;
    }
}
