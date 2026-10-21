package pkg;

class SampleTest extends BaseTests
{
    @BeforeEach
    void before()
    {
    }

    @Test
    void shouldDoA()
    {
    }

    @ParameterizedTest
    @ValueSource(ints = { 1, 2 })
    void shouldDoB(final int value)
    {
    }

    @Test
    @Disabled
    public void shouldDoC() throws Exception
    {
    }

    private void helper()
    {
    }
}
