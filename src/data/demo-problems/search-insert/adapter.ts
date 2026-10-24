import {
  addCppCaseResult,
  cppIntLiteral,
  cppIntVectorLiteral,
  objectField,
  type DemoProblemAdapter,
} from "../adapter.types";

export const searchInsertAdapter: DemoProblemAdapter = {
  slug: "search-insert-position",
  methodName: "searchInsert",
  orderMatters: true,
  buildCppCase(testCase) {
    const nums = cppIntVectorLiteral(objectField(testCase.input, "nums"), "nums");
    const target = cppIntLiteral(objectField(testCase.input, "target"), "target");
    const expected = cppIntLiteral(testCase.expected, "expected");

    return [
      "{",
      `  vector<int> nums = ${nums};`,
      `  int target = ${target};`,
      "  Solution solution;",
      "  int actual = solution.searchInsert(nums, target);",
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
