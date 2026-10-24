import {
  addCppCaseResult,
  cppIntLiteral,
  cppIntVectorLiteral,
  objectField,
  type DemoProblemAdapter,
} from "../adapter.types";

export const twoSumAdapter: DemoProblemAdapter = {
  slug: "two-sum",
  methodName: "twoSum",
  orderMatters: false,
  buildCppCase(testCase) {
    const nums = cppIntVectorLiteral(objectField(testCase.input, "nums"), "nums");
    const target = cppIntLiteral(objectField(testCase.input, "target"), "target");
    const expected = cppIntVectorLiteral(testCase.expected, "expected");

    return [
      "{",
      `  vector<int> nums = ${nums};`,
      `  int target = ${target};`,
      "  Solution solution;",
      "  vector<int> actual = solution.twoSum(nums, target);",
      `  vector<int> expected = ${expected};`,
      "  bool passed = __pc_equal_int_vector(actual, expected, false);",
      addCppCaseResult({
        testCase,
        actualJsonExpression: "__pc_int_vector_json(actual)",
        expectedJsonExpression: "__pc_int_vector_json(expected)",
        passedExpression: "passed",
      }),
      "}",
    ].join("\n");
  },
};
