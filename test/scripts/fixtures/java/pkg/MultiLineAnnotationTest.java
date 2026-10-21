package pkg;

class MultiLineAnnotationTest
{
    @ParameterizedTest
    @CsvSource({
        "0,64,0",
        "1,1024,1024 (a paren in a string",
        "9999999999,8589934592,17179869184" })
    void alignWithLongValues(final long value, final long alignment, final long expected)
    {
    }

    @Test
    @EnabledOnOs(
        architectures = { "x64" })
    void isX64ArchSystemTest()
    {
    }

    private void helper()
    {
    }
}
