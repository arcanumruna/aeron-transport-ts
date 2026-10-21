describe('SampleTest', () => {
    baseTests();

    it('shouldDoA', () => {});

    it.each([[1], [2]])('shouldDoB %s', (value) => {});

    // Disabled in Aeron.
    it.skip('shouldDoC', () => {});
});
