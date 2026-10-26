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
// Extra tests of T12 (port-only): `WildcardPortManager` beyond Java's ten tests (port range parsing, every branch of
// `getManagedPort` and `freeManagedPort`), `Integer.parseUnsignedInt`, the transport poller bases, and the socket buffer
// lengths the Context probes (`osDefault...`, `osMax...`, the port managers it creates, `validateSocketBufferLengths`
// and the two validators of the params classes that read them).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    IllegalArgumentException,
    IllegalStateException,
    Integer,
    NumberFormatException,
} from '../../../../src/agrona/jdk.js';
import { System } from '../../../../src/agrona/jdkLang.js';
import { TransportPoller } from '../../../../src/agrona/nio/TransportPoller.js';
import { ConfigurationException } from '../../../../src/client/exceptions/ConfigurationException.js';
import { Configuration } from '../../../../src/driver/Configuration.js';
import { BindException, InetAddress, InetSocketAddress } from '../../../../src/driver/jdkNet.js';
import { MediaDriver } from '../../../../src/driver/MediaDriver.js';
import { UdpChannel } from '../../../../src/driver/media/UdpChannel.js';
import { UdpTransportPoller } from '../../../../src/driver/media/UdpTransportPoller.js';
import { WildcardPortManager } from '../../../../src/driver/media/WildcardPortManager.js';
import { PublicationParams } from '../../../../src/driver/PublicationParams.js';
import { SubscriptionParams } from '../../../../src/driver/SubscriptionParams.js';
import { assertThrows } from '../../../support/Assertions.js';

const udpChannel = UdpChannel.parse('aeron:udp?endpoint=localhost:0');
const udpChannelControl = UdpChannel.parse('aeron:udp?control=localhost:0|endpoint=localhost:9999');
const localhost = (port: number): InetSocketAddress => new InetSocketAddress('localhost', port);

describe('Integer.parseUnsignedInt', () => {
    it.each([
        ['0', 0],
        ['1', 1],
        ['+7', 7],
        ['65535', 65535],
        ['2147483647', 2147483647],
        ['2147483648', -2147483648],
        ['4294967295', -1],
        ['007', 7],
    ])('parses %s as %d', (text, expected) => {
        expect(Integer.parseUnsignedInt(text)).toBe(expected);
    });

    it.each([null, '', '-1', '-0', 'a', '1a', ' 1', '1 ', '4294967296', '99999999999999999999', '+', '1.5'])(
        'rejects %s',
        (text) => {
            assertThrows(NumberFormatException, () => Integer.parseUnsignedInt(text));
        },
    );
});

describe('WildcardPortManager.parsePortRange', () => {
    it.each([
        ['20000 20003', [20000, 20003]],
        ['20000   20003', [20000, 20003]],
        ['20000 20003 ', [20000, 20003]],
        ['0 0', [0, 0]],
        ['5 5', [5, 5]],
        ['0 65535', [0, 65535]],
        ['+1 +2', [1, 2]],
    ])('parses "%s"', (text, expected) => {
        expect(WildcardPortManager.parsePortRange(text)).toEqual(expected);
    });

    it('returns the empty range for null and for an empty string', () => {
        expect(WildcardPortManager.parsePortRange(null)).toBe(WildcardPortManager.EMPTY_PORT_RANGE);
        expect(WildcardPortManager.parsePortRange('')).toBe(WildcardPortManager.EMPTY_PORT_RANGE);
        expect(WildcardPortManager.EMPTY_PORT_RANGE).toEqual([0, 0]);
    });

    it.each(['1', '1 2 3', ' ', ' 1 2', '1,2', '1-2'])('rejects "%s" as an incorrect format or value', (text) => {
        const error = assertThrows(IllegalArgumentException, () => WildcardPortManager.parsePortRange(text));
        expect(error.message).toMatch(/^(port range ".*" incorrect format|invalid port value .*)$/);
    });

    it.each([
        ['a b', 'invalid port value a b'],
        ['-1 5', 'invalid port value -1 5'],
        ['5 4', 'invalid port value 5 4'],
        ['65536 65537', 'invalid port value 65536 65537'],
        ['1 65536', 'invalid port value 1 65536'],
        ['4294967296 1', 'invalid port value 4294967296 1'],
    ])('rejects "%s" with the value in the message and a NumberFormatException as the cause', (text, message) => {
        const error = assertThrows(IllegalArgumentException, () => WildcardPortManager.parsePortRange(text));
        expect(error.message).toBe(message);
        expect(error.cause).toBeInstanceOf(NumberFormatException);
    });

    it('keeps the Java quirk that 4294967295 parses as the int -1, which passes both range checks', () => {
        expect(WildcardPortManager.parsePortRange('4294967295 5')).toEqual([-1, 5]);
    });
});

describe('WildcardPortManager', () => {
    it('allocates only inside the range, wraps, and reports the range in the exhaustion error', () => {
        const manager = new WildcardPortManager([7000, 7001], false);
        const ports: number[] = [];
        for (let i = 0; i < 2; i++) {
            ports.push(manager.getManagedPort(udpChannel, localhost(0)).getPort());
        }
        expect(ports).toEqual([7000, 7001]);

        const error = assertThrows(BindException, () => manager.getManagedPort(udpChannel, localhost(0)));
        expect(error.message).toBe('no available ports in range 7000 7001');

        manager.freeManagedPort(localhost(7001));
        expect(manager.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(7001);
        expect(manager.nextPort).toBe(7000);
    });

    it('a range of one port allocates it, again after it is freed, and not twice', () => {
        const manager = new WildcardPortManager([9, 9], false);
        expect(manager.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(9);
        assertThrows(BindException, () => manager.getManagedPort(udpChannel, localhost(0)));
        manager.freeManagedPort(localhost(9));
        expect(manager.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(9);
    });

    it('the allocated address keeps the host of the bind address', () => {
        const manager = new WildcardPortManager([7000, 7001], false);
        const bind = new InetSocketAddress(InetAddress.getByName('127.0.0.5'), 0);
        const address = manager.getManagedPort(udpChannel, bind);
        expect(address.getAddress()!.getHostAddress()).toBe('127.0.0.5');
        expect(address.getPort()).toBe(7000);
        expect(bind.getPort()).toBe(0);
    });

    it('an OS wildcard range (0 0) never allocates, for a sender or a receiver, and an explicit port is only tracked', () => {
        for (const isSender of [true, false]) {
            const manager = new WildcardPortManager([0, 0], isSender);
            expect(manager.isOsWildcard).toBe(true);
            expect(manager.getManagedPort(udpChannelControl, localhost(0)).getPort()).toBe(0);
            expect(manager.getManagedPort(udpChannelControl, localhost(1234)).getPort()).toBe(1234);
            expect(manager.portSet.contains(1234)).toBe(true);
            manager.freeManagedPort(localhost(1234));
            expect(manager.portSet.contains(1234)).toBe(false);
        }
    });

    it('a sender allocates for a channel with an explicit control address, a receiver for every channel', () => {
        const sender = new WildcardPortManager([7000, 7009], true);
        expect(sender.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(0);
        expect(sender.getManagedPort(udpChannelControl, localhost(0)).getPort()).toBe(7000);

        const receiver = new WildcardPortManager([7000, 7009], false);
        expect(receiver.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(7000);
        expect(receiver.getManagedPort(udpChannelControl, localhost(0)).getPort()).toBe(7001);
    });

    it('freeing port 0, a port never bound or a port twice is harmless', () => {
        const manager = new WildcardPortManager([7000, 7001], false);
        manager.freeManagedPort(localhost(0));
        manager.freeManagedPort(localhost(7000));
        expect(manager.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(7000);
        manager.freeManagedPort(localhost(7000));
        manager.freeManagedPort(localhost(7000));
        expect(manager.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(7001);
    });

    it('an explicit port inside the range blocks the allocation of that port until it is freed', () => {
        const manager = new WildcardPortManager([7000, 7002], false);
        manager.getManagedPort(udpChannel, localhost(7001));
        expect(manager.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(7000);
        expect(manager.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(7002);
        assertThrows(BindException, () => manager.getManagedPort(udpChannel, localhost(0)));
        manager.freeManagedPort(localhost(7001));
        expect(manager.getManagedPort(udpChannel, localhost(0)).getPort()).toBe(7001);
    });
});

describe('TransportPoller and UdpTransportPoller', () => {
    afterEach(() => {
        System.clearProperty(TransportPoller.ITERATION_THRESHOLD_PROP_NAME);
    });

    it('has the Agrona constants', () => {
        expect(TransportPoller.ITERATION_THRESHOLD_PROP_NAME).toBe('org.agrona.transport.iteration.threshold');
        expect(TransportPoller.ITERATION_THRESHOLD_DEFAULT).toBe(5);
        expect(TransportPoller.ITERATION_THRESHOLD).toBe(5);
    });

    class TestPoller extends UdpTransportPoller<string> {
        public pollTransports(): number {
            return this.transports.length;
        }

        public register(name: string): void {
            this.transports.push(name);
        }

        public errorHandlerOf(): unknown {
            return this.errorHandler;
        }
    }

    it('keeps the registered transports and the error handler, and close forgets the transports', () => {
        const errorHandler = { onError: vi.fn() };
        const poller = new TestPoller(errorHandler);
        expect(poller.errorHandlerOf()).toBe(errorHandler);

        poller.register('a');
        poller.register('b');
        expect(poller.pollTransports()).toBe(2);

        poller.selectNowWithoutProcessing(); // nothing to select, nothing happens
        expect(poller.pollTransports()).toBe(2);

        poller.close();
        expect(poller.pollTransports()).toBe(0);
        poller.close();
    });
});

describe('Context: socket buffer lengths and port managers', () => {
    let context: MediaDriver.Context;

    afterEach(() => {
        context.close();
        System.clearProperty(Configuration.SENDER_WILDCARD_PORT_RANGE_PROP_NAME);
        System.clearProperty(Configuration.RECEIVER_WILDCARD_PORT_RANGE_PROP_NAME);
        vi.restoreAllMocks();
    });

    it('probes the OS once: defaults positive, maxima at least the defaults, the same values every time', () => {
        context = new MediaDriver.Context();
        const values = [
            context.osDefaultSocketRcvbufLength(),
            context.osMaxSocketRcvbufLength(),
            context.osDefaultSocketSndbufLength(),
            context.osMaxSocketSndbufLength(),
        ];

        expect(values.every((v) => v > 0)).toBe(true);
        expect(context.osMaxSocketRcvbufLength()).toBeGreaterThanOrEqual(context.osDefaultSocketRcvbufLength());
        expect(context.osMaxSocketSndbufLength()).toBeGreaterThanOrEqual(context.osDefaultSocketSndbufLength());

        context.resolveOsSocketBufLengths();
        expect([
            context.osDefaultSocketRcvbufLength(),
            context.osMaxSocketRcvbufLength(),
            context.osDefaultSocketSndbufLength(),
            context.osMaxSocketSndbufLength(),
        ]).toEqual(values);
    });

    it('conclude creates a sender and a receiver wildcard port manager from the configured ranges', () => {
        System.setProperty(Configuration.SENDER_WILDCARD_PORT_RANGE_PROP_NAME, '30000 30009');
        System.setProperty(Configuration.RECEIVER_WILDCARD_PORT_RANGE_PROP_NAME, '31000 31009');
        context = new MediaDriver.Context().conclude();

        const sender = context.senderPortManager() as WildcardPortManager;
        const receiver = context.receiverPortManager() as WildcardPortManager;
        expect(sender).toBeInstanceOf(WildcardPortManager);
        expect(receiver).toBeInstanceOf(WildcardPortManager);
        expect([sender.lowPort, sender.highPort, sender.isSender]).toEqual([30000, 30009, true]);
        expect([receiver.lowPort, receiver.highPort, receiver.isSender]).toEqual([31000, 31009, false]);
        expect(context.osMaxSocketRcvbufLength()).toBeGreaterThan(0); // conclude probed
    });

    it('conclude with the default (empty) ranges makes OS wildcard managers, and keeps a manager that is set', () => {
        const own = new WildcardPortManager([1, 2], true);
        context = new MediaDriver.Context().senderPortManager(own).conclude();

        expect(context.senderPortManager()).toBe(own);
        expect((context.receiverPortManager() as WildcardPortManager).isOsWildcard).toBe(true);
    });

    it('conclude fails on a malformed port range', () => {
        System.setProperty(Configuration.SENDER_WILDCARD_PORT_RANGE_PROP_NAME, 'abc');
        context = new MediaDriver.Context();
        assertThrows(IllegalArgumentException, () => context.conclude());
    });

    it('validateSocketBufferLengths accepts the defaults and rejects an MTU above the send buffer', () => {
        context = new MediaDriver.Context().conclude();
        Configuration.validateSocketBufferLengths(context);

        context.socketSndbufLength(context.mtuLength() - 1);
        const error = assertThrows(ConfigurationException, () => Configuration.validateSocketBufferLengths(context));
        expect(error.message).toContain(
            'mtuLength=' + context.mtuLength() + ' > SO_SNDBUF=' + (context.mtuLength() - 1),
        );
        expect(error.message).toContain('increase aeron.socket.so_sndbuf to match MTU');

        context.socketSndbufLength(context.mtuLength());
        Configuration.validateSocketBufferLengths(context); // exactly the MTU fits
    });

    it('validateSocketBufferLengths rejects an initial window above the receive buffer', () => {
        context = new MediaDriver.Context().conclude();
        context.socketRcvbufLength(context.initialWindowLength() - 1);

        const error = assertThrows(ConfigurationException, () => Configuration.validateSocketBufferLengths(context));
        expect(error.message).toContain('initialWindowLength=' + context.initialWindowLength() + ' > SO_RCVBUF=');
        expect(error.message).toContain('increase aeron.socket.so_rcvbuf limits to match initialWindowLength');

        context.socketRcvbufLength(context.initialWindowLength());
        Configuration.validateSocketBufferLengths(context);
    });

    it('validateSocketBufferLengths warns, and carries on, when the OS caps a configured length', () => {
        context = new MediaDriver.Context().conclude();
        const lines = vi.spyOn(console, 'error').mockImplementation(() => {});
        const above = context.osMaxSocketSndbufLength() + 1;
        context.socketSndbufLength(above);
        context.socketRcvbufLength(context.osMaxSocketRcvbufLength() + 1);

        Configuration.validateSocketBufferLengths(context);

        expect(lines).toHaveBeenCalledWith(
            'WARNING: Could not set desired SO_SNDBUF, adjust OS to allow aeron.socket.so_sndbuf attempted=' +
                above +
                ', actual=' +
                context.osMaxSocketSndbufLength(),
        );
        expect(lines).toHaveBeenCalledWith(
            expect.stringContaining(
                'WARNING: Could not set desired SO_RCVBUF, adjust OS to allow aeron.socket.so_rcvbuf',
            ),
        );
    });

    it('PublicationParams.validateMtuForSndbuf checks the channel send buffer, else the OS default', () => {
        context = new MediaDriver.Context();
        const params = new PublicationParams();
        params.mtuLength = 1408;

        PublicationParams.validateMtuForSndbuf(params, 1408, context, 'ch', null); // equal fits
        PublicationParams.validateMtuForSndbuf(params, 0, context, 'ch', null); // the OS default is far larger

        const channel = assertThrows(IllegalStateException, () =>
            PublicationParams.validateMtuForSndbuf(params, 1407, context, 'aeron:udp?x', 'aeron:udp?y'),
        );
        expect(channel.message).toBe(
            'MTU greater than SO_SNDBUF for channel: mtu=1408 so-sndbuf=1407 existingChannel=aeron:udp?y channel=aeron:udp?x',
        );

        params.mtuLength = context.osDefaultSocketSndbufLength() + 1;
        const os = assertThrows(IllegalStateException, () =>
            PublicationParams.validateMtuForSndbuf(params, 0, context, 'aeron:udp?x', null),
        );
        expect(os.message).toBe(
            'MTU greater than SO_SNDBUF for channel: mtu=' +
                params.mtuLength +
                ' so-sndbuf=' +
                context.osDefaultSocketSndbufLength() +
                ' (OS default) channel=aeron:udp?x',
        );
    });

    it('SubscriptionParams.validateInitialWindowForRcvBuf checks the channel receive buffer, else the OS default', () => {
        context = new MediaDriver.Context();
        const params = new SubscriptionParams();
        params.receiverWindowLength = 4096;

        SubscriptionParams.validateInitialWindowForRcvBuf(params, 'ch', 4096, context, null);
        SubscriptionParams.validateInitialWindowForRcvBuf(params, 'ch', 0, context, null);

        const channel = assertThrows(IllegalStateException, () =>
            SubscriptionParams.validateInitialWindowForRcvBuf(params, 'aeron:udp?x', 4095, context, 'aeron:udp?y'),
        );
        expect(channel.message).toBe(
            'Initial window greater than SO_RCVBUF for channel: rcv-wnd=4096 so-rcvbuf=4095 existingChannel=aeron:udp?y channel=aeron:udp?x',
        );

        params.receiverWindowLength = context.osDefaultSocketRcvbufLength() + 1;
        const os = assertThrows(IllegalStateException, () =>
            SubscriptionParams.validateInitialWindowForRcvBuf(params, 'aeron:udp?x', 0, context, null),
        );
        expect(os.message).toBe(
            'Initial window greater than SO_RCVBUF for channel: rcv-wnd=' +
                params.receiverWindowLength +
                ' so-rcvbuf=' +
                context.osDefaultSocketRcvbufLength() +
                ' (OS default) channel=aeron:udp?x',
        );
    });
});
