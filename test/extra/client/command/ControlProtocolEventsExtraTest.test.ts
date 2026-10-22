// Not in Aeron: every constant of ControlProtocolEvents, as numbers written out from the Java source.
import { describe, expect, it } from 'vitest';
import { SemanticVersion } from '../../../../src/agrona/SemanticVersion.js';
import { ControlProtocolEvents as E } from '../../../../src/client/command/ControlProtocolEvents.js';

describe('ControlProtocolEventsExtraTest', () => {
    it('the client to driver commands are 0x01 to 0x12 in order', () => {
        // mutation: swap two ids (for instance ADD_DESTINATION and REMOVE_DESTINATION)
        const commands = [
            E.ADD_PUBLICATION,
            E.REMOVE_PUBLICATION,
            E.ADD_EXCLUSIVE_PUBLICATION,
            E.ADD_SUBSCRIPTION,
            E.REMOVE_SUBSCRIPTION,
            E.CLIENT_KEEPALIVE,
            E.ADD_DESTINATION,
            E.REMOVE_DESTINATION,
            E.ADD_COUNTER,
            E.REMOVE_COUNTER,
            E.CLIENT_CLOSE,
            E.ADD_RCV_DESTINATION,
            E.REMOVE_RCV_DESTINATION,
            E.TERMINATE_DRIVER,
            E.ADD_STATIC_COUNTER,
            E.REJECT_IMAGE,
            E.REMOVE_DESTINATION_BY_ID,
            E.GET_NEXT_AVAILABLE_SESSION_ID,
        ];
        expect(commands).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    });

    it('the driver to client events are 0x0F01 to 0x0F0D in order', () => {
        // mutation: change ON_PUBLICATION_ERROR to 0x0F0B
        const events = [
            E.ON_ERROR,
            E.ON_AVAILABLE_IMAGE,
            E.ON_PUBLICATION_READY,
            E.ON_OPERATION_SUCCESS,
            E.ON_UNAVAILABLE_IMAGE,
            E.ON_EXCLUSIVE_PUBLICATION_READY,
            E.ON_SUBSCRIPTION_READY,
            E.ON_COUNTER_READY,
            E.ON_UNAVAILABLE_COUNTER,
            E.ON_CLIENT_TIMEOUT,
            E.ON_STATIC_COUNTER,
            E.ON_PUBLICATION_ERROR,
            E.ON_NEXT_AVAILABLE_SESSION_ID,
        ];
        expect(events).toEqual(Array.from({ length: 13 }, (_, i) => 0x0f01 + i));
    });

    it('the protocol version is 1.0.0', () => {
        // mutation: change the major version
        expect(E.CONTROL_PROTOCOL_MAJOR_VERSION).toBe(1);
        expect(E.CONTROL_PROTOCOL_MINOR_VERSION).toBe(0);
        expect(E.CONTROL_PROTOCOL_PATCH_VERSION).toBe(0);
        expect(E.CONTROL_PROTOCOL_SEMANTIC_VERSION).toBe(SemanticVersion.compose(1, 0, 0));
        expect(E.CONTROL_PROTOCOL_SEMANTIC_VERSION).toBe(65536);
    });
});
