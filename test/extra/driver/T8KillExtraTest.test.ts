import { describe, expect, it, vi } from 'vitest';
import { DefaultNameResolver } from '../../../src/driver/DefaultNameResolver.js';
import { TimeTrackingNameResolver } from '../../../src/driver/TimeTrackingNameResolver.js';
import type { NameResolver } from '../../../src/driver/NameResolver.js';
import { InetAddress, StandardProtocolFamily, UnknownHostException } from '../../../src/driver/jdkNet.js';
import { InterfaceSearchAddress } from '../../../src/driver/media/InterfaceSearchAddress.js';
import { SocketAddressParser } from '../../../src/driver/media/SocketAddressParser.js';
import { assertThrowsExactly } from '../../support/Assertions.js';

describe('T8KillExtraTest', () => {
    it('M16 wildcardResolvesToAnInterfaceWhenMulticast', () => {
        const wildcard = InterfaceSearchAddress.wildcard();
        const resolved = wildcard.resolve(true, StandardProtocolFamily.INET);
        expect(resolved.localInterface).not.toBeNull();
        expect(resolved.address).not.toBe(wildcard.address);
    });
    it('M19 rejectsFiveIpV4Parts', () => {
        assertThrowsExactly(UnknownHostException, () => InetAddress.getByName('1.2.3.4.0'));
    });
    it('M20 twoPartFormFillsTheThreeLowBytes', () => {
        expect([...InetAddress.getByName('1.65536').getAddress()]).toEqual([1, 1, 0, 0]);
    });
    it('M21 rejectsDoubleColonWithEightGroups', () => {
        const e = assertThrowsExactly(UnknownHostException, () => InetAddress.getByName('1:2:3:4::5:6:7:8'));
        expect(e.message).toBe('1:2:3:4::5:6:7:8: invalid IPv6 address');
    });
    it('M29 emptyBrackets', () => {
        const e = assertThrowsExactly(UnknownHostException, () => InetAddress.getByName('[]'));
        expect(e.message).toBe('[]: invalid IPv6 address');
    });
    it('M33 ipV4TailAfterSixGroups', () => {
        expect(InetAddress.getByName('1:2:3:4:5:6:1.2.3.4').getHostAddress()).toBe('1:2:3:4:5:6:102:304');
    });
    it('M35 timeTrackingName', () => {
        const r = new TimeTrackingNameResolver(
            new DefaultNameResolver(),
            { nanoTime: () => 0 },
            {
                update: () => {},
                measureAndUpdate: () => {},
            },
        );
        expect(r.name()).toBe('TimeTracking(DefaultNameResolver)');
        expect(r.roleName()).toBe('TimeTracking(DefaultNameResolver)');
    });
    it('M36 passesReResolutionThrough', () => {
        const spy: NameResolver = {
            resolve: vi.fn((name: string) => InetAddress.getByName(name)),
            lookup: vi.fn((name: string) => name),
            name: () => 'spy',
        };
        SocketAddressParser.parse('10.0.0.1:5', 'endpoint', true, spy);
        expect(spy.lookup).toHaveBeenCalledWith('10.0.0.1:5', 'endpoint', true);
        expect(spy.resolve).toHaveBeenCalledWith('10.0.0.1', 'endpoint', true);
    });
    it('M37 anyLocalNeedsEveryByteZero', () => {
        expect(InetAddress.getByName('0.1.2.3').isAnyLocalAddress()).toBe(false);
    });
    it('M39 octetOfFourDigitsIsNotMulticast', () => {
        expect(SocketAddressParser.isMulticastAddress('224.1234.0.1:5')).toBe(false);
    });
});
