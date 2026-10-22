package pkg;

class OneLineAnnotationTest
{
    @Test void shouldA() {}

    @Test public void shouldB() throws Exception {}

    @ParameterizedTest @ValueSource(ints = { 1, 2 }) void shouldC(final int value) {}

    @Test
    // a comment between the annotation and the method
    void shouldD()
    {
    }

    @Test
    @Disabled("reason (with a paren")
    /* a block comment */
    void shouldE()
    {
    }

    @BeforeEach void before() {}

    void helper()
    {
    }
}
