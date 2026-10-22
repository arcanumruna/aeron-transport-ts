// `org.agrona.collections.MutableInteger`, of which the ring buffer tests use a counter.
export class MutableInteger {
    private value = 0;

    public get(): number {
        return this.value;
    }

    public increment(): void {
        this.value++;
    }

    public incrementAndGet(): number {
        return ++this.value;
    }

    public getAndIncrement(): number {
        return this.value++;
    }
}
