// Extra tests of phase 3 (port-only): the group tag halves of the flyweights (spec D118) and the group tag of the
// configuration, which the multicast flow control strategies compare without a `bigint`.
import { afterEach, describe, expect, it } from 'vitest';
import { System } from '../../../src/agrona/jdkLang.js';
import { ErrorFlyweight } from '../../../src/client/protocol/ErrorFlyweight.js';
import { StatusMessageFlyweight } from '../../../src/client/protocol/StatusMessageFlyweight.js';
import { Configuration } from '../../../src/driver/Configuration.js';
import { MediaDriver } from '../../../src/driver/MediaDriver.js';

const TAGS: bigint[] = [0n, 1n, -1n, 123n, 3_000_000_000n, -3_000_000_000n, 0x1fffffffffffffn, -0x1fffffffffffffn];

function halves(tag: bigint): [number, number] {
    return [Number(BigInt.asIntN(32, tag >> 32n)), Number(BigInt.asIntN(32, tag))];
}

describe('MulticastFlowControlExtraTest', () => {
    afterEach(() => {
        System.clearProperty(Configuration.FLOW_CONTROL_GROUP_TAG_PROP_NAME);
        System.clearProperty('aeron.PreferredMulticastFlowControl.asf');
    });

    it.each(TAGS)('StatusMessageFlyweight.groupTagHigh and groupTagLow are the halves of the group tag %d', (tag) => {
        const flyweight = new StatusMessageFlyweight(new Uint8Array(1024));
        flyweight.groupTag(tag);

        expect([flyweight.groupTagHigh(), flyweight.groupTagLow()]).toEqual(halves(tag));
        expect(flyweight.groupTag()).toBe(tag);
    });

    it.each(TAGS)('ErrorFlyweight.groupTagHigh and groupTagLow are the halves of the group tag %d', (tag) => {
        const flyweight = new ErrorFlyweight(new Uint8Array(ErrorFlyweight.MAX_ERROR_FRAME_LENGTH));
        flyweight.groupTag(tag);

        expect([flyweight.groupTagHigh(), flyweight.groupTagLow()]).toEqual(halves(tag));
        expect(flyweight.groupTag()).toBe(tag);
    });

    it('Configuration.flowControlGroupTag defaults to the legacy ASF read as a little endian long (all ones)', () => {
        expect(Configuration.flowControlGroupTag()).toBe(-1);
        expect(new MediaDriver.Context().flowControlGroupTag()).toBe(-1);
    });

    it('Configuration.flowControlGroupTag is the property when set', () => {
        System.setProperty(Configuration.FLOW_CONTROL_GROUP_TAG_PROP_NAME, '3000000000');

        expect(Configuration.flowControlGroupTag()).toBe(3_000_000_000);
        expect(new MediaDriver.Context().flowControlGroupTag()).toBe(3_000_000_000);
    });

    it('Configuration.flowControlGroupTag falls back to the legacy ASF property', () => {
        System.setProperty('aeron.PreferredMulticastFlowControl.asf', '0100000000000000');

        expect(Configuration.flowControlGroupTag()).toBe(1);
    });

    it('MediaDriver.Context.flowControlGroupTag is set and read back', () => {
        const context = new MediaDriver.Context().flowControlGroupTag(42);

        expect(context.flowControlGroupTag()).toBe(42);
        expect(context.toString()).toContain('flowControlGroupTag=42');
    });
});
