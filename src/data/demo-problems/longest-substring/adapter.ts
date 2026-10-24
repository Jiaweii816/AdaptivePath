import {
  addCppCaseResult,
  cppIntLiteral,
  cppStringValueLiteral,
  objectField,
  type DemoProblemAdapter,
} from "../adapter.types";

export const longestSubstringAdapter: DemoProblemAdapter = {
  slug: "longest-substring-without-repeating-characters",
  methodName: "lengthOfLongestSubstring",
  orderMatters: true,
  buildCppCase(testCase) {
    const s = cppStringValueLiteral(objectField(testCase.input, "s"), "s");
    const expected = cppIntLiteral(testCase.expected, "expected");

    return [
      "{",
      `  string s = ${s};`,
      "  Solution solution;",
      "  int actual = solution.lengthOfLongestSubstring(s);",
      `  int expected = ${expected};`,
      "  bool passed = actual == expected;",
      addCppCaseResult({
        testCase,
        actualJsonExpression: "to_string(actual)",
        expectedJsonExpression: "to_string(expected)",
        passedExpression: "passed",
      }),
      "}",
    ].join("\n");
  },
};
