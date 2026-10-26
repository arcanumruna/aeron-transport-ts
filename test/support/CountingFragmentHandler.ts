// Port of aeron-test-support/src/main/java/io/aeron/test/CountingFragmentHandler.java @ 1.53.3 (phase 3, T9, D115).
import type { DirectBuffer } from '../../src/agrona/DirectBuffer.js';
import type { FragmentHandler } from '../../src/client/logbuffer/FragmentHandler.js';
import type { Header } from '../../src/client/logbuffer/Header.js';

export class CountingFragmentHandler implements FragmentHandler {
    private readonly name: string;
    private lastCheckedTargetValue = 0;
    private received = 0;

    public constructor(name: string) {
        this.name = name;
    }

    public notDone(targetValue: number): boolean {
        this.lastCheckedTargetValue = targetValue;
        return targetValue !== this.received;
    }

    public onFragment(_buffer: DirectBuffer, _offset: number, _length: number, _header: Header): void {
        this.received++;
    }

    public toString(): string {
        return (
            "CountingFragmentHandler{name='" +
            this.name +
            "', received=" +
            this.received +
            ', lastCheckedTargetValue=' +
            this.lastCheckedTargetValue +
            '}'
        );
    }
}
