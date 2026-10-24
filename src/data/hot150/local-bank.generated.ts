import { localHot150BankSchema } from "./local-run-types";

export const localHot150Bank = localHot150BankSchema.parse({
  "generatedAt": "2026-06-18T15:17:13.834Z",
  "generatorVersion": 1,
  "problems": [
    {
      "leetcodeNumber": 88,
      "slug": "merge-sorted-array",
      "title": "Merge Sorted Array",
      "difficulty": "Easy",
      "hot150Order": 1,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/merge-sorted-array/",
      "statementMarkdown": "You are given two integer arrays nums1 and nums2, sorted in non-decreasing order, and two integers m and n, representing the number of elements in nums1 and nums2 respectively.\n\nMerge nums1 and nums2 into a single array sorted in non-decreasing order.\n\nThe final sorted array should not be returned by the function, but instead be stored inside the array nums1. To accommodate this, nums1 has a length of m + n, where the first m elements denote the elements that should be merged, and the last n elements are set to 0 and should be ignored. nums2 has a length of n.\n\n \n\nExample 1:\n\n```text\n\nInput: nums1 = [1,2,3,0,0,0], m = 3, nums2 = [2,5,6], n = 3\nOutput: [1,2,2,3,5,6]\nExplanation: The arrays we are merging are [1,2,3] and [2,5,6].\nThe result of the merge is [1,2,2,3,5,6] with the underlined elements coming from nums1.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums1 = [1], m = 1, nums2 = [], n = 0\nOutput: [1]\nExplanation: The arrays we are merging are [1] and [].\nThe result of the merge is [1].\n\n```\n\nExample 3:\n\n```text\n\nInput: nums1 = [0], m = 0, nums2 = [1], n = 1\nOutput: [1]\nExplanation: The arrays we are merging are [] and [1].\nThe result of the merge is [1].\nNote that because m = 0, there are no elements in nums1. The 0 is only there to ensure the merge result can fit in nums1.\n\n```\n\n \n\nConstraints:\n\n\t- nums1.length == m + n\n\n\t- nums2.length == n\n\n\t- 0 <= m, n <= 200\n\n\t- 1 <= m + n <= 200\n\n\t- -109 <= nums1[i], nums2[j] <= 109\n\n \n\nFollow up: Can you come up with an algorithm that runs in O(m + n) time?",
      "examples": [
        {
          "input": {
            "nums1": [
              1,
              2,
              3,
              0,
              0,
              0
            ],
            "m": 3,
            "nums2": [
              2,
              5,
              6
            ],
            "n": 3
          },
          "output": [
            1,
            2,
            2,
            3,
            5,
            6
          ]
        },
        {
          "input": {
            "nums1": [
              1
            ],
            "m": 1,
            "nums2": [],
            "n": 0
          },
          "output": [
            1
          ]
        },
        {
          "input": {
            "nums1": [
              0
            ],
            "m": 0,
            "nums2": [
              1
            ],
            "n": 1
          },
          "output": [
            1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers",
        "sorting"
      ],
      "starterCodePython": "class Solution:\n    def merge(self, nums1: List[int], m: int, nums2: List[int], n: int) -> None:\n        \"\"\"\n        Do not return anything, modify nums1 in-place instead.\n        \"\"\"\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    void merge(vector<int>& nums1, int m, vector<int>& nums2, int n) {\n        \n    }\n};",
      "methodName": "merge",
      "executionContract": {
        "name": "merge",
        "params": [
          {
            "name": "nums1",
            "type": "integer[]"
          },
          {
            "name": "m",
            "type": "integer"
          },
          {
            "name": "nums2",
            "type": "integer[]"
          },
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "void",
        "contractKind": "inplace_arg"
      },
      "comparisonStrategy": "inplace_arg",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:09.631Z",
      "referenceSolutionHash": "sha256:3997baa699df1544e291c658c414bedb9f69c80bdc8de6f61c0b555cce52cc74",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums1": [
              1,
              2,
              3,
              0,
              0,
              0
            ],
            "m": 3,
            "nums2": [
              2,
              5,
              6
            ],
            "n": 3
          },
          "expected": [
            1,
            2,
            2,
            3,
            5,
            6
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,0,0,0]\n3\n[2,5,6]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums1": [
              1
            ],
            "m": 1,
            "nums2": [],
            "n": 0
          },
          "expected": [
            1
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1]\n1\n[]\n0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums1": [
              0
            ],
            "m": 0,
            "nums2": [
              1
            ],
            "n": 1
          },
          "expected": [
            1
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[0]\n0\n[1]\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 27,
      "slug": "remove-element",
      "title": "Remove Element",
      "difficulty": "Easy",
      "hot150Order": 2,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/remove-element/",
      "statementMarkdown": "Given an integer array nums and an integer val, remove all occurrences of val in nums in-place. The order of the elements may be changed. Then return the number of elements in nums which are not equal to val.\n\nConsider the number of elements in nums which are not equal to val be k, to get accepted, you need to do the following things:\n\n\t- Change the array nums such that the first k elements of nums contain the elements which are not equal to val. The remaining elements of nums are not important as well as the size of nums.\n\n\t- Return k.\n\nCustom Judge:\n\nThe judge will test your solution with the following code:\n\n```text\n\nint[] nums = [...]; // Input array\nint val = ...; // Value to remove\nint[] expectedNums = [...]; // The expected answer with correct length.\n                            // It is sorted with no values equaling val.\n\nint k = removeElement(nums, val); // Calls your implementation\n\nassert k == expectedNums.length;\nsort(nums, 0, k); // Sort the first k elements of nums\nfor (int i = 0; i < actualLength; i++) {\n    assert nums[i] == expectedNums[i];\n}\n\n```\n\nIf all assertions pass, then your solution will be accepted.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [3,2,2,3], val = 3\nOutput: 2, nums = [2,2,_,_]\nExplanation: Your function should return k = 2, with the first two elements of nums being 2.\nIt does not matter what you leave beyond the returned k (hence they are underscores).\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [0,1,2,2,3,0,4,2], val = 2\nOutput: 5, nums = [0,1,4,0,3,_,_,_]\nExplanation: Your function should return k = 5, with the first five elements of nums containing 0, 0, 1, 3, and 4.\nNote that the five elements can be returned in any order.\nIt does not matter what you leave beyond the returned k (hence they are underscores).\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= nums.length <= 100\n\n\t- 0 <= nums[i] <= 50\n\n\t- 0 <= val <= 100",
      "examples": [
        {
          "input": {
            "nums": [
              3,
              2,
              2,
              3
            ],
            "val": 3
          },
          "output": 2
        },
        {
          "input": {
            "nums": [
              0,
              1,
              2,
              2,
              3,
              0,
              4,
              2
            ],
            "val": 2
          },
          "output": 5
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers"
      ],
      "starterCodePython": "class Solution:\n    def removeElement(self, nums: List[int], val: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int removeElement(vector<int>& nums, int val) {\n        \n    }\n};",
      "methodName": "removeElement",
      "executionContract": {
        "name": "removeElement",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          },
          {
            "name": "val",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:10.018Z",
      "referenceSolutionHash": "sha256:c425f5d464ca3a8ea9079de46e87d59b23cafdf8c620f5c9105b56f3ba6007c7",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              3,
              2,
              2,
              3
            ],
            "val": 3
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,2,2,3]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              1,
              2,
              2,
              3,
              0,
              4,
              2
            ],
            "val": 2
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,1,2,2,3,0,4,2]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 26,
      "slug": "remove-duplicates-from-sorted-array",
      "title": "Remove Duplicates from Sorted Array",
      "difficulty": "Easy",
      "hot150Order": 3,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/remove-duplicates-from-sorted-array/",
      "statementMarkdown": "Given an integer array nums sorted in non-decreasing order, remove the duplicates in-place such that each unique element appears only once. The relative order of the elements should be kept the same.\n\nConsider the number of unique elements in nums to be k​​​​​​​​​​​​​​. After removing duplicates, return the number of unique elements k.\n\nThe first k elements of nums should contain the unique numbers in sorted order. The remaining elements beyond index k - 1 can be ignored.\n\nCustom Judge:\n\nThe judge will test your solution with the following code:\n\n```text\n\nint[] nums = [...]; // Input array\nint[] expectedNums = [...]; // The expected answer with correct length\n\nint k = removeDuplicates(nums); // Calls your implementation\n\nassert k == expectedNums.length;\nfor (int i = 0; i < k; i++) {\n    assert nums[i] == expectedNums[i];\n}\n\n```\n\nIf all assertions pass, then your solution will be accepted.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [1,1,2]\nOutput: 2, nums = [1,2,_]\nExplanation: Your function should return k = 2, with the first two elements of nums being 1 and 2 respectively.\nIt does not matter what you leave beyond the returned k (hence they are underscores).\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [0,0,1,1,1,2,2,3,3,4]\nOutput: 5, nums = [0,1,2,3,4,_,_,_,_,_]\nExplanation: Your function should return k = 5, with the first five elements of nums being 0, 1, 2, 3, and 4 respectively.\nIt does not matter what you leave beyond the returned k (hence they are underscores).\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 3 * 104\n\n\t- -100 <= nums[i] <= 100\n\n\t- nums is sorted in non-decreasing order.",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              1,
              2
            ]
          },
          "output": 2
        },
        {
          "input": {
            "nums": [
              0,
              0,
              1,
              1,
              1,
              2,
              2,
              3,
              3,
              4
            ]
          },
          "output": 5
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers"
      ],
      "starterCodePython": "class Solution:\n    def removeDuplicates(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int removeDuplicates(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "removeDuplicates",
      "executionContract": {
        "name": "removeDuplicates",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:10.418Z",
      "referenceSolutionHash": "sha256:2fe61901d3dfe9f11c5de391921098e8e053134ea6bbb46b54ec95752118e9c3",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              1,
              2
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,1,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              0,
              1,
              1,
              1,
              2,
              2,
              3,
              3,
              4
            ]
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,0,1,1,1,2,2,3,3,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 80,
      "slug": "remove-duplicates-from-sorted-array-ii",
      "title": "Remove Duplicates from Sorted Array II",
      "difficulty": "Medium",
      "hot150Order": 4,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/remove-duplicates-from-sorted-array-ii/",
      "statementMarkdown": "Given an integer array nums sorted in non-decreasing order, remove some duplicates in-place such that each unique element appears at most twice. The relative order of the elements should be kept the same.\n\nSince it is impossible to change the length of the array in some languages, you must instead have the result be placed in the first part of the array nums. More formally, if there are k elements after removing the duplicates, then the first k elements of nums should hold the final result. It does not matter what you leave beyond the first k elements.\n\nReturn k after placing the final result in the first k slots of nums.\n\nDo not allocate extra space for another array. You must do this by modifying the input array in-place with O(1) extra memory.\n\nCustom Judge:\n\nThe judge will test your solution with the following code:\n\n```text\n\nint[] nums = [...]; // Input array\nint[] expectedNums = [...]; // The expected answer with correct length\n\nint k = removeDuplicates(nums); // Calls your implementation\n\nassert k == expectedNums.length;\nfor (int i = 0; i < k; i++) {\n    assert nums[i] == expectedNums[i];\n}\n\n```\n\nIf all assertions pass, then your solution will be accepted.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [1,1,1,2,2,3]\nOutput: 5, nums = [1,1,2,2,3,_]\nExplanation: Your function should return k = 5, with the first five elements of nums being 1, 1, 2, 2 and 3 respectively.\nIt does not matter what you leave beyond the returned k (hence they are underscores).\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [0,0,1,1,1,1,2,3,3]\nOutput: 7, nums = [0,0,1,1,2,3,3,_,_]\nExplanation: Your function should return k = 7, with the first seven elements of nums being 0, 0, 1, 1, 2, 3 and 3 respectively.\nIt does not matter what you leave beyond the returned k (hence they are underscores).\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 3 * 104\n\n\t- -104 <= nums[i] <= 104\n\n\t- nums is sorted in non-decreasing order.",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              1,
              1,
              2,
              2,
              3
            ]
          },
          "output": 5
        },
        {
          "input": {
            "nums": [
              0,
              0,
              1,
              1,
              1,
              1,
              2,
              3,
              3
            ]
          },
          "output": 7
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers"
      ],
      "starterCodePython": "class Solution:\n    def removeDuplicates(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int removeDuplicates(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "removeDuplicates",
      "executionContract": {
        "name": "removeDuplicates",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:10.954Z",
      "referenceSolutionHash": "sha256:9864795d28b47c2700e2556a63f31864ca42f55f99ef5ca2ec25f3474bbd5b68",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              1,
              1,
              2,
              2,
              3
            ]
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,1,1,2,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              0,
              1,
              1,
              1,
              1,
              2,
              3,
              3
            ]
          },
          "expected": 7,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,0,1,1,1,1,2,3,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 169,
      "slug": "majority-element",
      "title": "Majority Element",
      "difficulty": "Easy",
      "hot150Order": 5,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/majority-element/",
      "statementMarkdown": "Given an array nums of size n, return the majority element.\n\nThe majority element is the element that appears more than &lfloor;n / 2&rfloor; times. You may assume that the majority element always exists in the array.\n\n \n\nExample 1:\n\n```text\nInput: nums = [3,2,3]\nOutput: 3\n\n```\nExample 2:\n\n```text\nInput: nums = [2,2,1,1,1,2,2]\nOutput: 2\n\n```\n\n \n\nConstraints:\n\n\t- n == nums.length\n\n\t- 1 <= n <= 5 * 104\n\n\t- -109 <= nums[i] <= 109\n\n\t- The input is generated such that a majority element will exist in the array.\n\n \n\nFollow-up: Could you solve the problem in linear time and in O(1) space?",
      "examples": [
        {
          "input": {
            "nums": [
              3,
              2,
              3
            ]
          },
          "output": 3
        },
        {
          "input": {
            "nums": [
              2,
              2,
              1,
              1,
              1,
              2,
              2
            ]
          },
          "output": 2
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "divide-and-conquer",
        "sorting",
        "counting"
      ],
      "starterCodePython": "class Solution:\n    def majorityElement(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int majorityElement(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "majorityElement",
      "executionContract": {
        "name": "majorityElement",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:11.319Z",
      "referenceSolutionHash": "sha256:89edf15167f2133a75a9867c1629549a7e8cf961a3c1255ed67c448a44d9cd8c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              3,
              2,
              3
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              2,
              2,
              1,
              1,
              1,
              2,
              2
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2,2,1,1,1,2,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 189,
      "slug": "rotate-array",
      "title": "Rotate Array",
      "difficulty": "Medium",
      "hot150Order": 6,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/rotate-array/",
      "statementMarkdown": "Given an integer array nums, rotate the array to the right by k steps, where k is non-negative.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [1,2,3,4,5,6,7], k = 3\nOutput: [5,6,7,1,2,3,4]\nExplanation:\nrotate 1 steps to the right: [7,1,2,3,4,5,6]\nrotate 2 steps to the right: [6,7,1,2,3,4,5]\nrotate 3 steps to the right: [5,6,7,1,2,3,4]\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [-1,-100,3,99], k = 2\nOutput: [3,99,-1,-100]\nExplanation: \nrotate 1 steps to the right: [99,-1,-100,3]\nrotate 2 steps to the right: [3,99,-1,-100]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 105\n\n\t- -231 <= nums[i] <= 231 - 1\n\n\t- 0 <= k <= 105\n\n \n\nFollow up:\n\n\t- Try to come up with as many solutions as you can. There are at least three different ways to solve this problem.\n\n\t- Could you do it in-place with O(1) extra space?",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              2,
              3,
              4,
              5,
              6,
              7
            ],
            "k": 3
          },
          "output": [
            5,
            6,
            7,
            1,
            2,
            3,
            4
          ]
        },
        {
          "input": {
            "nums": [
              -1,
              -100,
              3,
              99
            ],
            "k": 2
          },
          "output": [
            3,
            99,
            -1,
            -100
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "math",
        "two-pointers"
      ],
      "starterCodePython": "class Solution:\n    def rotate(self, nums: List[int], k: int) -> None:\n        \"\"\"\n        Do not return anything, modify nums in-place instead.\n        \"\"\"\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    void rotate(vector<int>& nums, int k) {\n        \n    }\n};",
      "methodName": "rotate",
      "executionContract": {
        "name": "rotate",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          },
          {
            "name": "k",
            "type": "integer"
          }
        ],
        "returnType": "void",
        "contractKind": "inplace_arg"
      },
      "comparisonStrategy": "inplace_arg",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:11.696Z",
      "referenceSolutionHash": "sha256:e4d29d6a345a7a3b5302562a52a40a2c77224d3eae202ba523613cc2e7e31adb",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              2,
              3,
              4,
              5,
              6,
              7
            ],
            "k": 3
          },
          "expected": [
            5,
            6,
            7,
            1,
            2,
            3,
            4
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4,5,6,7]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              -1,
              -100,
              3,
              99
            ],
            "k": 2
          },
          "expected": [
            3,
            99,
            -1,
            -100
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[-1,-100,3,99]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 121,
      "slug": "best-time-to-buy-and-sell-stock",
      "title": "Best Time to Buy and Sell Stock",
      "difficulty": "Easy",
      "hot150Order": 7,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/best-time-to-buy-and-sell-stock/",
      "statementMarkdown": "You are given an array prices where prices[i] is the price of a given stock on the ith day.\n\nYou want to maximize your profit by choosing a single day to buy one stock and choosing a different day in the future to sell that stock.\n\nReturn the maximum profit you can achieve from this transaction. If you cannot achieve any profit, return 0.\n\n \n\nExample 1:\n\n```text\n\nInput: prices = [7,1,5,3,6,4]\nOutput: 5\nExplanation: Buy on day 2 (price = 1) and sell on day 5 (price = 6), profit = 6-1 = 5.\nNote that buying on day 2 and selling on day 1 is not allowed because you must buy before you sell.\n\n```\n\nExample 2:\n\n```text\n\nInput: prices = [7,6,4,3,1]\nOutput: 0\nExplanation: In this case, no transactions are done and the max profit = 0.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= prices.length <= 105\n\n\t- 0 <= prices[i] <= 104",
      "examples": [
        {
          "input": {
            "prices": [
              7,
              1,
              5,
              3,
              6,
              4
            ]
          },
          "output": 5
        },
        {
          "input": {
            "prices": [
              7,
              6,
              4,
              3,
              1
            ]
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "dynamic-programming"
      ],
      "starterCodePython": "class Solution:\n    def maxProfit(self, prices: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maxProfit(vector<int>& prices) {\n        \n    }\n};",
      "methodName": "maxProfit",
      "executionContract": {
        "name": "maxProfit",
        "params": [
          {
            "name": "prices",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:12.128Z",
      "referenceSolutionHash": "sha256:c9186df427abcded12ce798788b545979d163bb86439103ab92a973c0a7e16fa",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "prices": [
              7,
              1,
              5,
              3,
              6,
              4
            ]
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[7,1,5,3,6,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "prices": [
              7,
              6,
              4,
              3,
              1
            ]
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[7,6,4,3,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 122,
      "slug": "best-time-to-buy-and-sell-stock-ii",
      "title": "Best Time to Buy and Sell Stock II",
      "difficulty": "Medium",
      "hot150Order": 8,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/best-time-to-buy-and-sell-stock-ii/",
      "statementMarkdown": "You are given an integer array prices where prices[i] is the price of a given stock on the ith day.\n\nOn each day, you may decide to buy and/or sell the stock. You can only hold at most one share of the stock at any time. However, you can sell and buy the stock multiple times on the same day, ensuring you never hold more than one share of the stock.\n\nFind and return the maximum profit you can achieve.\n\n \n\nExample 1:\n\n```text\n\nInput: prices = [7,1,5,3,6,4]\nOutput: 7\nExplanation: Buy on day 2 (price = 1) and sell on day 3 (price = 5), profit = 5-1 = 4.\nThen buy on day 4 (price = 3) and sell on day 5 (price = 6), profit = 6-3 = 3.\nTotal profit is 4 + 3 = 7.\n\n```\n\nExample 2:\n\n```text\n\nInput: prices = [1,2,3,4,5]\nOutput: 4\nExplanation: Buy on day 1 (price = 1) and sell on day 5 (price = 5), profit = 5-1 = 4.\nTotal profit is 4.\n\n```\n\nExample 3:\n\n```text\n\nInput: prices = [7,6,4,3,1]\nOutput: 0\nExplanation: There is no way to make a positive profit, so we never buy the stock to achieve the maximum profit of 0.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= prices.length <= 3 * 104\n\n\t- 0 <= prices[i] <= 104",
      "examples": [
        {
          "input": {
            "prices": [
              7,
              1,
              5,
              3,
              6,
              4
            ]
          },
          "output": 7
        },
        {
          "input": {
            "prices": [
              1,
              2,
              3,
              4,
              5
            ]
          },
          "output": 4
        },
        {
          "input": {
            "prices": [
              7,
              6,
              4,
              3,
              1
            ]
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "dynamic-programming",
        "greedy"
      ],
      "starterCodePython": "class Solution:\n    def maxProfit(self, prices: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maxProfit(vector<int>& prices) {\n        \n    }\n};",
      "methodName": "maxProfit",
      "executionContract": {
        "name": "maxProfit",
        "params": [
          {
            "name": "prices",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:12.489Z",
      "referenceSolutionHash": "sha256:d4120c49d4092096b62547b6add4d645d75ccfb4a5acf1fd3107cc7837261ed8",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "prices": [
              7,
              1,
              5,
              3,
              6,
              4
            ]
          },
          "expected": 7,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[7,1,5,3,6,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "prices": [
              1,
              2,
              3,
              4,
              5
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2,3,4,5]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "prices": [
              7,
              6,
              4,
              3,
              1
            ]
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[7,6,4,3,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 55,
      "slug": "jump-game",
      "title": "Jump Game",
      "difficulty": "Medium",
      "hot150Order": 9,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/jump-game/",
      "statementMarkdown": "You are given an integer array nums. You are initially positioned at the array's first index, and each element in the array represents your maximum jump length at that position.\n\nReturn true if you can reach the last index, or false otherwise.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [2,3,1,1,4]\nOutput: true\nExplanation: Jump 1 step from index 0 to 1, then 3 steps to the last index.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [3,2,1,0,4]\nOutput: false\nExplanation: You will always arrive at index 3 no matter what. Its maximum jump length is 0, which makes it impossible to reach the last index.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 104\n\n\t- 0 <= nums[i] <= 105",
      "examples": [
        {
          "input": {
            "nums": [
              2,
              3,
              1,
              1,
              4
            ]
          },
          "output": true
        },
        {
          "input": {
            "nums": [
              3,
              2,
              1,
              0,
              4
            ]
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "dynamic-programming",
        "greedy"
      ],
      "starterCodePython": "class Solution:\n    def canJump(self, nums: List[int]) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool canJump(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "canJump",
      "executionContract": {
        "name": "canJump",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:12.859Z",
      "referenceSolutionHash": "sha256:46bbc8add490daecb54ffe5701cce4637601ee1549a312ae214a1c66d7db3571",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              2,
              3,
              1,
              1,
              4
            ]
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,3,1,1,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              3,
              2,
              1,
              0,
              4
            ]
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[3,2,1,0,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 45,
      "slug": "jump-game-ii",
      "title": "Jump Game II",
      "difficulty": "Medium",
      "hot150Order": 10,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/jump-game-ii/",
      "statementMarkdown": "You are given a 0-indexed array of integers nums of length n. You are initially positioned at index 0.\n\nEach element nums[i] represents the maximum length of a forward jump from index i. In other words, if you are at index i, you can jump to any index (i + j) where:\n\n\t- 0 <= j <= nums[i] and\n\n\t- i + j < n\n\nReturn the minimum number of jumps to reach index n - 1. The test cases are generated such that you can reach index n - 1.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [2,3,1,1,4]\nOutput: 2\nExplanation: The minimum number of jumps to reach the last index is 2. Jump 1 step from index 0 to 1, then 3 steps to the last index.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [2,3,0,1,4]\nOutput: 2\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 104\n\n\t- 0 <= nums[i] <= 1000\n\n\t- It's guaranteed that you can reach nums[n - 1].",
      "examples": [
        {
          "input": {
            "nums": [
              2,
              3,
              1,
              1,
              4
            ]
          },
          "output": 2
        },
        {
          "input": {
            "nums": [
              2,
              3,
              0,
              1,
              4
            ]
          },
          "output": 2
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "dynamic-programming",
        "greedy"
      ],
      "starterCodePython": "class Solution:\n    def jump(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int jump(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "jump",
      "executionContract": {
        "name": "jump",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:13.291Z",
      "referenceSolutionHash": "sha256:81a36c3dfe2a207b514ba1c690cf117da77056d211d298ec10563c455088d371",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              2,
              3,
              1,
              1,
              4
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,3,1,1,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              2,
              3,
              0,
              1,
              4
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2,3,0,1,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 274,
      "slug": "h-index",
      "title": "H-Index",
      "difficulty": "Medium",
      "hot150Order": 11,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/h-index/",
      "statementMarkdown": "Given an array of integers citations where citations[i] is the number of citations a researcher received for their ith paper, return the researcher's h-index.\n\nAccording to the definition of h-index on Wikipedia: The h-index is defined as the maximum value of h such that the given researcher has published at least h papers that have each been cited at least h times.\n\n \n\nExample 1:\n\n```text\n\nInput: citations = [3,0,6,1,5]\nOutput: 3\nExplanation: [3,0,6,1,5] means the researcher has 5 papers in total and each of them had received 3, 0, 6, 1, 5 citations respectively.\nSince the researcher has 3 papers with at least 3 citations each and the remaining two with no more than 3 citations each, their h-index is 3.\n\n```\n\nExample 2:\n\n```text\n\nInput: citations = [1,3,1]\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- n == citations.length\n\n\t- 1 <= n <= 5000\n\n\t- 0 <= citations[i] <= 1000",
      "examples": [
        {
          "input": {
            "citations": [
              3,
              0,
              6,
              1,
              5
            ]
          },
          "output": 3
        },
        {
          "input": {
            "citations": [
              1,
              3,
              1
            ]
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "sorting",
        "counting-sort"
      ],
      "starterCodePython": "class Solution:\n    def hIndex(self, citations: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int hIndex(vector<int>& citations) {\n        \n    }\n};",
      "methodName": "hIndex",
      "executionContract": {
        "name": "hIndex",
        "params": [
          {
            "name": "citations",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:13.773Z",
      "referenceSolutionHash": "sha256:a76ede2279d984931be1ca536389d113abffa82506dc296437dc07ff36cc5a16",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "citations": [
              3,
              0,
              6,
              1,
              5
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,0,6,1,5]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "citations": [
              1,
              3,
              1
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,3,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 380,
      "slug": "insert-delete-getrandom-o1",
      "title": "Insert Delete GetRandom O(1)",
      "difficulty": "Medium",
      "hot150Order": 12,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/insert-delete-getrandom-o1/",
      "statementMarkdown": "Implement the RandomizedSet class:\n\n\t- RandomizedSet() Initializes the RandomizedSet object.\n\n\t- bool insert(int val) Inserts an item val into the set if not present. Returns true if the item was not present, false otherwise.\n\n\t- bool remove(int val) Removes an item val from the set if present. Returns true if the item was present, false otherwise.\n\n\t- int getRandom() Returns a random element from the current set of elements (it's guaranteed that at least one element exists when this method is called). Each element must have the same probability of being returned.\n\nYou must implement the functions of the class such that each function works in average O(1) time complexity.\n\n \n\nExample 1:\n\n```text\n\nInput\n[\"RandomizedSet\", \"insert\", \"remove\", \"insert\", \"getRandom\", \"remove\", \"insert\", \"getRandom\"]\n[[], [1], [2], [2], [], [1], [2], []]\nOutput\n[null, true, false, true, 2, true, false, 2]\n\nExplanation\nRandomizedSet randomizedSet = new RandomizedSet();\nrandomizedSet.insert(1); // Inserts 1 to the set. Returns true as 1 was inserted successfully.\nrandomizedSet.remove(2); // Returns false as 2 does not exist in the set.\nrandomizedSet.insert(2); // Inserts 2 to the set, returns true. Set now contains [1,2].\nrandomizedSet.getRandom(); // getRandom() should return either 1 or 2 randomly.\nrandomizedSet.remove(1); // Removes 1 from the set, returns true. Set now contains [2].\nrandomizedSet.insert(2); // 2 was already in the set, so return false.\nrandomizedSet.getRandom(); // Since 2 is the only number in the set, getRandom() will always return 2.\n\n```\n\n \n\nConstraints:\n\n\t- -231 <= val <= 231 - 1\n\n\t- At most 2 * 105 calls will be made to insert, remove, and getRandom.\n\n\t- There will be at least one element in the data structure when getRandom is called.",
      "examples": [
        {
          "input": {
            "operations": [
              "RandomizedSet",
              "insert",
              "remove",
              "insert",
              "getRandom",
              "remove",
              "insert",
              "getRandom"
            ],
            "arguments": [
              [],
              [
                1
              ],
              [
                2
              ],
              [
                2
              ],
              [],
              [
                1
              ],
              [
                2
              ],
              []
            ]
          },
          "output": [
            null,
            true,
            false,
            true,
            2,
            true,
            false,
            2
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "math",
        "design",
        "randomized"
      ],
      "starterCodePython": "class RandomizedSet:\n\n    def __init__(self):\n        \n\n    def insert(self, val: int) -> bool:\n        \n\n    def remove(self, val: int) -> bool:\n        \n\n    def getRandom(self) -> int:\n        \n\n\n# Your RandomizedSet object will be instantiated and called as such:\n# obj = RandomizedSet()\n# param_1 = obj.insert(val)\n# param_2 = obj.remove(val)\n# param_3 = obj.getRandom()",
      "starterCodeCpp": "class RandomizedSet {\npublic:\n    RandomizedSet() {\n        \n    }\n    \n    bool insert(int val) {\n        \n    }\n    \n    bool remove(int val) {\n        \n    }\n    \n    int getRandom() {\n        \n    }\n};\n\n/**\n * Your RandomizedSet object will be instantiated and called as such:\n * RandomizedSet* obj = new RandomizedSet();\n * bool param_1 = obj->insert(val);\n * bool param_2 = obj->remove(val);\n * int param_3 = obj->getRandom();\n */",
      "methodName": "RandomizedSet",
      "executionContract": {
        "name": "RandomizedSet",
        "params": [],
        "returnType": "unknown",
        "contractKind": "design_class"
      },
      "comparisonStrategy": "op_sequence",
      "comparisonConfig": {
        "ignoreOps": [
          "getRandom"
        ]
      },
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:14.196Z",
      "referenceSolutionHash": "sha256:d801354b49755fc7c38ad5154fe465193b159b4478966682b8c420481855d2bf",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "operations": [
              "RandomizedSet",
              "insert",
              "remove",
              "insert",
              "getRandom",
              "remove",
              "insert",
              "getRandom"
            ],
            "arguments": [
              [],
              [
                1
              ],
              [
                2
              ],
              [
                2
              ],
              [],
              [
                1
              ],
              [
                2
              ],
              []
            ]
          },
          "expected": [
            null,
            true,
            false,
            true,
            2,
            true,
            false,
            2
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"RandomizedSet\",\"insert\",\"remove\",\"insert\",\"getRandom\",\"remove\",\"insert\",\"getRandom\"]\n[[],[1],[2],[2],[],[1],[2],[]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 238,
      "slug": "product-of-array-except-self",
      "title": "Product of Array Except Self",
      "difficulty": "Medium",
      "hot150Order": 13,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/product-of-array-except-self/",
      "statementMarkdown": "Given an integer array nums, return an array answer such that answer[i] is equal to the product of all the elements of nums except nums[i].\n\nThe product of any prefix or suffix of nums is guaranteed to fit in a 32-bit integer.\n\nYou must write an algorithm that runs in O(n) time and without using the division operation.\n\n \n\nExample 1:\n\n```text\nInput: nums = [1,2,3,4]\nOutput: [24,12,8,6]\n\n```\nExample 2:\n\n```text\nInput: nums = [-1,1,0,-3,3]\nOutput: [0,0,9,0,0]\n\n```\n\n \n\nConstraints:\n\n\t- 2 <= nums.length <= 105\n\n\t- -30 <= nums[i] <= 30\n\n\t- The input is generated such that answer[i] is guaranteed to fit in a 32-bit integer.\n\n \n\nFollow up: Can you solve the problem in O(1) extra space complexity? (The output array does not count as extra space for space complexity analysis.)",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              2,
              3,
              4
            ]
          },
          "output": [
            24,
            12,
            8,
            6
          ]
        },
        {
          "input": {
            "nums": [
              -1,
              1,
              0,
              -3,
              3
            ]
          },
          "output": [
            0,
            0,
            9,
            0,
            0
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "prefix-sum"
      ],
      "starterCodePython": "class Solution:\n    def productExceptSelf(self, nums: List[int]) -> List[int]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<int> productExceptSelf(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "productExceptSelf",
      "executionContract": {
        "name": "productExceptSelf",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer[]",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:14.556Z",
      "referenceSolutionHash": "sha256:f85a8ced3c23d877d316d0a125d2f61a8d85949c86d2ed29999285e4169776a0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              2,
              3,
              4
            ]
          },
          "expected": [
            24,
            12,
            8,
            6
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              -1,
              1,
              0,
              -3,
              3
            ]
          },
          "expected": [
            0,
            0,
            9,
            0,
            0
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[-1,1,0,-3,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 134,
      "slug": "gas-station",
      "title": "Gas Station",
      "difficulty": "Medium",
      "hot150Order": 14,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/gas-station/",
      "statementMarkdown": "There are n gas stations along a circular route, where the amount of gas at the ith station is gas[i].\n\nYou have a car with an unlimited gas tank and it costs cost[i] of gas to travel from the ith station to its next (i + 1)th station. You begin the journey with an empty tank at one of the gas stations.\n\nGiven two integer arrays gas and cost, return the starting gas station's index if you can travel around the circuit once in the clockwise direction, otherwise return -1. If there exists a solution, it is guaranteed to be unique.\n\n \n\nExample 1:\n\n```text\n\nInput: gas = [1,2,3,4,5], cost = [3,4,5,1,2]\nOutput: 3\nExplanation:\nStart at station 3 (index 3) and fill up with 4 unit of gas. Your tank = 0 + 4 = 4\nTravel to station 4. Your tank = 4 - 1 + 5 = 8\nTravel to station 0. Your tank = 8 - 2 + 1 = 7\nTravel to station 1. Your tank = 7 - 3 + 2 = 6\nTravel to station 2. Your tank = 6 - 4 + 3 = 5\nTravel to station 3. The cost is 5. Your gas is just enough to travel back to station 3.\nTherefore, return 3 as the starting index.\n\n```\n\nExample 2:\n\n```text\n\nInput: gas = [2,3,4], cost = [3,4,3]\nOutput: -1\nExplanation:\nYou can't start at station 0 or 1, as there is not enough gas to travel to the next station.\nLet's start at station 2 and fill up with 4 unit of gas. Your tank = 0 + 4 = 4\nTravel to station 0. Your tank = 4 - 3 + 2 = 3\nTravel to station 1. Your tank = 3 - 3 + 3 = 3\nYou cannot travel back to station 2, as it requires 4 unit of gas but you only have 3.\nTherefore, you can't travel around the circuit once no matter where you start.\n\n```\n\n \n\nConstraints:\n\n\t- n == gas.length == cost.length\n\n\t- 1 <= n <= 105\n\n\t- 0 <= gas[i], cost[i] <= 104\n\n\t- The input is generated such that the answer is unique.",
      "examples": [
        {
          "input": {
            "gas": [
              1,
              2,
              3,
              4,
              5
            ],
            "cost": [
              3,
              4,
              5,
              1,
              2
            ]
          },
          "output": 3
        },
        {
          "input": {
            "gas": [
              2,
              3,
              4
            ],
            "cost": [
              3,
              4,
              3
            ]
          },
          "output": -1
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "greedy"
      ],
      "starterCodePython": "class Solution:\n    def canCompleteCircuit(self, gas: List[int], cost: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int canCompleteCircuit(vector<int>& gas, vector<int>& cost) {\n        \n    }\n};",
      "methodName": "canCompleteCircuit",
      "executionContract": {
        "name": "canCompleteCircuit",
        "params": [
          {
            "name": "gas",
            "type": "integer[]"
          },
          {
            "name": "cost",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:14.959Z",
      "referenceSolutionHash": "sha256:c9c9e378a095c436fcde66e7308a3d7c581ef5e0a6719a6da2a9dbbd4874318c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "gas": [
              1,
              2,
              3,
              4,
              5
            ],
            "cost": [
              3,
              4,
              5,
              1,
              2
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4,5]\n[3,4,5,1,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "gas": [
              2,
              3,
              4
            ],
            "cost": [
              3,
              4,
              3
            ]
          },
          "expected": -1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2,3,4]\n[3,4,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 135,
      "slug": "candy",
      "title": "Candy",
      "difficulty": "Hard",
      "hot150Order": 15,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/candy/",
      "statementMarkdown": "There are n children standing in a line. Each child is assigned a rating value given in the integer array ratings.\n\nYou are giving candies to these children subjected to the following requirements:\n\n\t- Each child must have at least one candy.\n\n\t- Children with a higher rating get more candies than their neighbors.\n\nReturn the minimum number of candies you need to have to distribute the candies to the children.\n\n \n\nExample 1:\n\n```text\n\nInput: ratings = [1,0,2]\nOutput: 5\nExplanation: You can allocate to the first, second and third child with 2, 1, 2 candies respectively.\n\n```\n\nExample 2:\n\n```text\n\nInput: ratings = [1,2,2]\nOutput: 4\nExplanation: You can allocate to the first, second and third child with 1, 2, 1 candies respectively.\nThe third child gets 1 candy because it satisfies the above two conditions.\n\n```\n\n \n\nConstraints:\n\n\t- n == ratings.length\n\n\t- 1 <= n <= 2 * 104\n\n\t- 0 <= ratings[i] <= 2 * 104",
      "examples": [
        {
          "input": {
            "ratings": [
              1,
              0,
              2
            ]
          },
          "output": 5
        },
        {
          "input": {
            "ratings": [
              1,
              2,
              2
            ]
          },
          "output": 4
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "greedy"
      ],
      "starterCodePython": "class Solution:\n    def candy(self, ratings: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int candy(vector<int>& ratings) {\n        \n    }\n};",
      "methodName": "candy",
      "executionContract": {
        "name": "candy",
        "params": [
          {
            "name": "ratings",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:15.334Z",
      "referenceSolutionHash": "sha256:3231962bac95cd3d5b0be9a2ee0b742490f6b27529d8a2b660f0f71b0015a826",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "ratings": [
              1,
              0,
              2
            ]
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,0,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "ratings": [
              1,
              2,
              2
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 42,
      "slug": "trapping-rain-water",
      "title": "Trapping Rain Water",
      "difficulty": "Hard",
      "hot150Order": 16,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/trapping-rain-water/",
      "statementMarkdown": "Given n non-negative integers representing an elevation map where the width of each bar is 1, compute how much water it can trap after raining.\n\n \n\nExample 1:\n\n```text\n\nInput: height = [0,1,0,2,1,0,1,3,2,1,2,1]\nOutput: 6\nExplanation: The above elevation map (black section) is represented by array [0,1,0,2,1,0,1,3,2,1,2,1]. In this case, 6 units of rain water (blue section) are being trapped.\n\n```\n\nExample 2:\n\n```text\n\nInput: height = [4,2,0,3,2,5]\nOutput: 9\n\n```\n\n \n\nConstraints:\n\n\t- n == height.length\n\n\t- 1 <= n <= 2 * 104\n\n\t- 0 <= height[i] <= 105",
      "examples": [
        {
          "input": {
            "height": [
              0,
              1,
              0,
              2,
              1,
              0,
              1,
              3,
              2,
              1,
              2,
              1
            ]
          },
          "output": 6
        },
        {
          "input": {
            "height": [
              4,
              2,
              0,
              3,
              2,
              5
            ]
          },
          "output": 9
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers",
        "dynamic-programming",
        "stack",
        "monotonic-stack"
      ],
      "starterCodePython": "class Solution:\n    def trap(self, height: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int trap(vector<int>& height) {\n        \n    }\n};",
      "methodName": "trap",
      "executionContract": {
        "name": "trap",
        "params": [
          {
            "name": "height",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:15.742Z",
      "referenceSolutionHash": "sha256:efeab2899ec93b360a5eaae5d4778e3c479376020d022d2b0526121b4ac0c153",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "height": [
              0,
              1,
              0,
              2,
              1,
              0,
              1,
              3,
              2,
              1,
              2,
              1
            ]
          },
          "expected": 6,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[0,1,0,2,1,0,1,3,2,1,2,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "height": [
              4,
              2,
              0,
              3,
              2,
              5
            ]
          },
          "expected": 9,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[4,2,0,3,2,5]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 13,
      "slug": "roman-to-integer",
      "title": "Roman to Integer",
      "difficulty": "Easy",
      "hot150Order": 17,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/roman-to-integer/",
      "statementMarkdown": "Roman numerals are represented by seven different symbols: I, V, X, L, C, D and M.\n\n```text\n\nSymbol       Value\nI             1\nV             5\nX             10\nL             50\nC             100\nD             500\nM             1000\n```\n\nFor example, 2 is written as II in Roman numeral, just two ones added together. 12 is written as XII, which is simply X + II. The number 27 is written as XXVII, which is XX + V + II.\n\nRoman numerals are usually written largest to smallest from left to right. However, the numeral for four is not IIII. Instead, the number four is written as IV. Because the one is before the five we subtract it making four. The same principle applies to the number nine, which is written as IX. There are six instances where subtraction is used:\n\n\t- I can be placed before V (5) and X (10) to make 4 and 9. \n\n\t- X can be placed before L (50) and C (100) to make 40 and 90. \n\n\t- C can be placed before D (500) and M (1000) to make 400 and 900.\n\nGiven a roman numeral, convert it to an integer.\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"III\"\nOutput: 3\nExplanation: III = 3.\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"LVIII\"\nOutput: 58\nExplanation: L = 50, V= 5, III = 3.\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \"MCMXCIV\"\nOutput: 1994\nExplanation: M = 1000, CM = 900, XC = 90 and IV = 4.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 15\n\n\t- s contains only the characters ('I', 'V', 'X', 'L', 'C', 'D', 'M').\n\n\t- It is guaranteed that s is a valid roman numeral in the range [1, 3999].",
      "examples": [
        {
          "input": {
            "s": "III"
          },
          "output": 3
        },
        {
          "input": {
            "s": "LVIII"
          },
          "output": 58
        },
        {
          "input": {
            "s": "MCMXCIV"
          },
          "output": 1994
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "math"
      ],
      "starterCodePython": "class Solution:\n    def romanToInt(self, s: str) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int romanToInt(string s) {\n        \n    }\n};",
      "methodName": "romanToInt",
      "executionContract": {
        "name": "romanToInt",
        "params": [
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:16.117Z",
      "referenceSolutionHash": "sha256:fcf66872a2f0633de419dd6a3b566e58721ec6c1dcd7d86d8ce671775d002186",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "III"
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"III\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "LVIII"
          },
          "expected": 58,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"LVIII\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "MCMXCIV"
          },
          "expected": 1994,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"MCMXCIV\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 12,
      "slug": "integer-to-roman",
      "title": "Integer to Roman",
      "difficulty": "Medium",
      "hot150Order": 18,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/integer-to-roman/",
      "statementMarkdown": "Seven different symbols represent Roman numerals with the following values:\n\n\t\n\t\t\n\t\t\tSymbol\n\t\t\tValue\n\t\t\n\t\n\t\n\t\t\n\t\t\tI\n\t\t\t1\n\t\t\n\t\t\n\t\t\tV\n\t\t\t5\n\t\t\n\t\t\n\t\t\tX\n\t\t\t10\n\t\t\n\t\t\n\t\t\tL\n\t\t\t50\n\t\t\n\t\t\n\t\t\tC\n\t\t\t100\n\t\t\n\t\t\n\t\t\tD\n\t\t\t500\n\t\t\n\t\t\n\t\t\tM\n\t\t\t1000\n\t\t\n\t\n\nRoman numerals are formed by appending the conversions of decimal place values from highest to lowest. Converting a decimal place value into a Roman numeral has the following rules:\n\n\t- If the value does not start with 4 or 9, select the symbol of the maximal value that can be subtracted from the input, append that symbol to the result, subtract its value, and convert the remainder to a Roman numeral.\n\n\t- If the value starts with 4 or 9 use the subtractive form representing one symbol subtracted from the following symbol, for example, 4 is 1 (I) less than 5 (V): IV and 9 is 1 (I) less than 10 (X): IX. Only the following subtractive forms are used: 4 (IV), 9 (IX), 40 (XL), 90 (XC), 400 (CD) and 900 (CM).\n\n\t- Only powers of 10 (I, X, C, M) can be appended consecutively at most 3 times to represent multiples of 10. You cannot append 5 (V), 50 (L), or 500 (D) multiple times. If you need to append a symbol 4 times use the subtractive form.\n\nGiven an integer, convert it to a Roman numeral.\n\n \n\nExample 1:\n\nInput: num = 3749\n\nOutput: \"MMMDCCXLIX\"\n\nExplanation:\n\n```text\n\n3000 = MMM as 1000 (M) + 1000 (M) + 1000 (M)\n 700 = DCC as 500 (D) + 100 (C) + 100 (C)\n  40 = XL as 10 (X) less of 50 (L)\n   9 = IX as 1 (I) less of 10 (X)\nNote: 49 is not 1 (I) less of 50 (L) because the conversion is based on decimal places\n\n```\n\nExample 2:\n\nInput: num = 58\n\nOutput: \"LVIII\"\n\nExplanation:\n\n```text\n\n50 = L\n 8 = VIII\n\n```\n\nExample 3:\n\nInput: num = 1994\n\nOutput: \"MCMXCIV\"\n\nExplanation:\n\n```text\n\n1000 = M\n 900 = CM\n  90 = XC\n   4 = IV\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= num <= 3999",
      "examples": [
        {
          "input": {
            "num": 3749
          },
          "output": "MMMDCCXLIX"
        },
        {
          "input": {
            "num": 58
          },
          "output": "LVIII"
        },
        {
          "input": {
            "num": 1994
          },
          "output": "MCMXCIV"
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "math"
      ],
      "starterCodePython": "class Solution:\n    def intToRoman(self, num: int) -> str:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    string intToRoman(int num) {\n        \n    }\n};",
      "methodName": "intToRoman",
      "executionContract": {
        "name": "intToRoman",
        "params": [
          {
            "name": "num",
            "type": "integer"
          }
        ],
        "returnType": "string",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:16.484Z",
      "referenceSolutionHash": "sha256:04ce234925340c88dcf59cb353ce50d72e865993c5738704c9d3ccebcf830980",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "num": 3749
          },
          "expected": "MMMDCCXLIX",
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "3749",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "num": 58
          },
          "expected": "LVIII",
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "58",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "num": 1994
          },
          "expected": "MCMXCIV",
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "1994",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 58,
      "slug": "length-of-last-word",
      "title": "Length of Last Word",
      "difficulty": "Easy",
      "hot150Order": 19,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/length-of-last-word/",
      "statementMarkdown": "Given a string s consisting of words and spaces, return the length of the last word in the string.\n\nA word is a maximal substring consisting of non-space characters only.\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"Hello World\"\nOutput: 5\nExplanation: The last word is \"World\" with length 5.\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"   fly me   to   the moon  \"\nOutput: 4\nExplanation: The last word is \"moon\" with length 4.\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \"luffy is still joyboy\"\nOutput: 6\nExplanation: The last word is \"joyboy\" with length 6.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 104\n\n\t- s consists of only English letters and spaces ' '.\n\n\t- There will be at least one word in s.",
      "examples": [
        {
          "input": {
            "s": "Hello World"
          },
          "output": 5
        },
        {
          "input": {
            "s": "   fly me   to   the moon  "
          },
          "output": 4
        },
        {
          "input": {
            "s": "luffy is still joyboy"
          },
          "output": 6
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150"
      ],
      "starterCodePython": "class Solution:\n    def lengthOfLastWord(self, s: str) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int lengthOfLastWord(string s) {\n        \n    }\n};",
      "methodName": "lengthOfLastWord",
      "executionContract": {
        "name": "lengthOfLastWord",
        "params": [
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:16.884Z",
      "referenceSolutionHash": "sha256:9a9988eb6581442ef2de3f72e4e9632b673df136c9cfb14a9047f867680da945",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "Hello World"
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"Hello World\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "   fly me   to   the moon  "
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"   fly me   to   the moon  \"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "luffy is still joyboy"
          },
          "expected": 6,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"luffy is still joyboy\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 14,
      "slug": "longest-common-prefix",
      "title": "Longest Common Prefix",
      "difficulty": "Easy",
      "hot150Order": 20,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/longest-common-prefix/",
      "statementMarkdown": "Write a function to find the longest common prefix string amongst an array of strings.\n\nIf there is no common prefix, return an empty string \"\".\n\n \n\nExample 1:\n\n```text\n\nInput: strs = [\"flower\",\"flow\",\"flight\"]\nOutput: \"fl\"\n\n```\n\nExample 2:\n\n```text\n\nInput: strs = [\"dog\",\"racecar\",\"car\"]\nOutput: \"\"\nExplanation: There is no common prefix among the input strings.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= strs.length <= 200\n\n\t- 0 <= strs[i].length <= 200\n\n\t- strs[i] consists of only lowercase English letters if it is non-empty.",
      "examples": [
        {
          "input": {
            "strs": [
              "flower",
              "flow",
              "flight"
            ]
          },
          "output": "fl"
        },
        {
          "input": {
            "strs": [
              "dog",
              "racecar",
              "car"
            ]
          },
          "output": ""
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "trie"
      ],
      "starterCodePython": "class Solution:\n    def longestCommonPrefix(self, strs: List[str]) -> str:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    string longestCommonPrefix(vector<string>& strs) {\n        \n    }\n};",
      "methodName": "longestCommonPrefix",
      "executionContract": {
        "name": "longestCommonPrefix",
        "params": [
          {
            "name": "strs",
            "type": "string[]"
          }
        ],
        "returnType": "string",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:17.311Z",
      "referenceSolutionHash": "sha256:1d2f2429bf626cae4dfba18ca45a2c0f0151b3dd1782da676ad8b5247faffe3f",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "strs": [
              "flower",
              "flow",
              "flight"
            ]
          },
          "expected": "fl",
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"flower\",\"flow\",\"flight\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "strs": [
              "dog",
              "racecar",
              "car"
            ]
          },
          "expected": "",
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[\"dog\",\"racecar\",\"car\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 151,
      "slug": "reverse-words-in-a-string",
      "title": "Reverse Words in a String",
      "difficulty": "Medium",
      "hot150Order": 21,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/reverse-words-in-a-string/",
      "statementMarkdown": "Given an input string s, reverse the order of the words.\n\nA word is defined as a sequence of non-space characters. The words in s will be separated by at least one space.\n\nReturn a string of the words in reverse order concatenated by a single space.\n\nNote that s may contain leading or trailing spaces or multiple spaces between two words. The returned string should only have a single space separating the words. Do not include any extra spaces.\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"the sky is blue\"\nOutput: \"blue is sky the\"\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"  hello world  \"\nOutput: \"world hello\"\nExplanation: Your reversed string should not contain leading or trailing spaces.\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \"a good   example\"\nOutput: \"example good a\"\nExplanation: You need to reduce multiple spaces between two words to a single space in the reversed string.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 104\n\n\t- s contains English letters (upper-case and lower-case), digits, and spaces ' '.\n\n\t- There is at least one word in s.\n\n \n\nFollow-up: If the string data type is mutable in your language, can you solve it in-place with O(1) extra space?",
      "examples": [
        {
          "input": {
            "s": "the sky is blue"
          },
          "output": "blue is sky the"
        },
        {
          "input": {
            "s": "  hello world  "
          },
          "output": "world hello"
        },
        {
          "input": {
            "s": "a good   example"
          },
          "output": "example good a"
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers"
      ],
      "starterCodePython": "class Solution:\n    def reverseWords(self, s: str) -> str:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    string reverseWords(string s) {\n        \n    }\n};",
      "methodName": "reverseWords",
      "executionContract": {
        "name": "reverseWords",
        "params": [
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "string",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:17.639Z",
      "referenceSolutionHash": "sha256:1325895c47dd7e4c0e9a3342e1aceddf6940327944aba6340fb38ab89f905c15",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "the sky is blue"
          },
          "expected": "blue is sky the",
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"the sky is blue\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "  hello world  "
          },
          "expected": "world hello",
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"  hello world  \"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "a good   example"
          },
          "expected": "example good a",
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"a good   example\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 6,
      "slug": "zigzag-conversion",
      "title": "Zigzag Conversion",
      "difficulty": "Medium",
      "hot150Order": 22,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/zigzag-conversion/",
      "statementMarkdown": "The string \"PAYPALISHIRING\" is written in a zigzag pattern on a given number of rows like this: (you may want to display this pattern in a fixed font for better legibility)\n\n```text\n\nP   A   H   N\nA P L S I I G\nY   I   R\n\n```\n\nAnd then read line by line: \"PAHNAPLSIIGYIR\"\n\nWrite the code that will take a string and make this conversion given a number of rows:\n\n```text\n\nstring convert(string s, int numRows);\n\n```\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"PAYPALISHIRING\", numRows = 3\nOutput: \"PAHNAPLSIIGYIR\"\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"PAYPALISHIRING\", numRows = 4\nOutput: \"PINALSIGYAHRPI\"\nExplanation:\nP     I    N\nA   L S  I G\nY A   H R\nP     I\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \"A\", numRows = 1\nOutput: \"A\"\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 1000\n\n\t- s consists of English letters (lower-case and upper-case), ',' and '.'.\n\n\t- 1 <= numRows <= 1000",
      "examples": [
        {
          "input": {
            "s": "PAYPALISHIRING",
            "numRows": 3
          },
          "output": "PAHNAPLSIIGYIR"
        },
        {
          "input": {
            "s": "PAYPALISHIRING",
            "numRows": 4
          },
          "output": "PINALSIGYAHRPI"
        },
        {
          "input": {
            "s": "A",
            "numRows": 1
          },
          "output": "A"
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150"
      ],
      "starterCodePython": "class Solution:\n    def convert(self, s: str, numRows: int) -> str:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    string convert(string s, int numRows) {\n        \n    }\n};",
      "methodName": "convert",
      "executionContract": {
        "name": "convert",
        "params": [
          {
            "name": "s",
            "type": "string"
          },
          {
            "name": "numRows",
            "type": "integer"
          }
        ],
        "returnType": "string",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:17.990Z",
      "referenceSolutionHash": "sha256:eae8d92576d01953a2a4acd7f29ca6a779ce9b0b506ae1eb7a28c56c35e03e5e",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "PAYPALISHIRING",
            "numRows": 3
          },
          "expected": "PAHNAPLSIIGYIR",
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"PAYPALISHIRING\"\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "PAYPALISHIRING",
            "numRows": 4
          },
          "expected": "PINALSIGYAHRPI",
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"PAYPALISHIRING\"\n4",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "A",
            "numRows": 1
          },
          "expected": "A",
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"A\"\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 28,
      "slug": "find-the-index-of-the-first-occurrence-in-a-string",
      "title": "Find the Index of the First Occurrence in a String",
      "difficulty": "Easy",
      "hot150Order": 23,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/find-the-index-of-the-first-occurrence-in-a-string/",
      "statementMarkdown": "Given two strings needle and haystack, return the index of the first occurrence of needle in haystack, or -1 if needle is not part of haystack.\n\n \n\nExample 1:\n\n```text\n\nInput: haystack = \"sadbutsad\", needle = \"sad\"\nOutput: 0\nExplanation: \"sad\" occurs at index 0 and 6.\nThe first occurrence is at index 0, so we return 0.\n\n```\n\nExample 2:\n\n```text\n\nInput: haystack = \"leetcode\", needle = \"leeto\"\nOutput: -1\nExplanation: \"leeto\" did not occur in \"leetcode\", so we return -1.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= haystack.length, needle.length <= 104\n\n\t- haystack and needle consist of only lowercase English characters.",
      "examples": [
        {
          "input": {
            "haystack": "sadbutsad",
            "needle": "sad"
          },
          "output": 0
        },
        {
          "input": {
            "haystack": "leetcode",
            "needle": "leeto"
          },
          "output": -1
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers",
        "string-matching"
      ],
      "starterCodePython": "class Solution:\n    def strStr(self, haystack: str, needle: str) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int strStr(string haystack, string needle) {\n        \n    }\n};",
      "methodName": "strStr",
      "executionContract": {
        "name": "strStr",
        "params": [
          {
            "name": "haystack",
            "type": "string"
          },
          {
            "name": "needle",
            "type": "string"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:18.382Z",
      "referenceSolutionHash": "sha256:5a22e45fb8d0c7601c12fd78e69d896e1615e6c55779cecc0d87fd5fead0a035",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "haystack": "sadbutsad",
            "needle": "sad"
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"sadbutsad\"\n\"sad\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "haystack": "leetcode",
            "needle": "leeto"
          },
          "expected": -1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"leetcode\"\n\"leeto\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 68,
      "slug": "text-justification",
      "title": "Text Justification",
      "difficulty": "Hard",
      "hot150Order": 24,
      "hot150Section": "Array / String",
      "officialUrl": "https://leetcode.com/problems/text-justification/",
      "statementMarkdown": "Given an array of strings words and a width maxWidth, format the text such that each line has exactly maxWidth characters and is fully (left and right) justified.\n\nYou should pack your words in a greedy approach; that is, pack as many words as you can in each line. Pad extra spaces ' ' when necessary so that each line has exactly maxWidth characters.\n\nExtra spaces between words should be distributed as evenly as possible. If the number of spaces on a line does not divide evenly between words, the empty slots on the left will be assigned more spaces than the slots on the right.\n\nFor the last line of text, it should be left-justified, and no extra space is inserted between words.\n\nNote:\n\n\t- A word is defined as a character sequence consisting of non-space characters only.\n\n\t- Each word's length is guaranteed to be greater than 0 and not exceed maxWidth.\n\n\t- The input array words contains at least one word.\n\n \n\nExample 1:\n\n```text\n\nInput: words = [\"This\", \"is\", \"an\", \"example\", \"of\", \"text\", \"justification.\"], maxWidth = 16\nOutput:\n[\n   \"This    is    an\",\n   \"example  of text\",\n   \"justification.  \"\n]\n```\n\nExample 2:\n\n```text\n\nInput: words = [\"What\",\"must\",\"be\",\"acknowledgment\",\"shall\",\"be\"], maxWidth = 16\nOutput:\n[\n  \"What   must   be\",\n  \"acknowledgment  \",\n  \"shall be        \"\n]\nExplanation: Note that the last line is \"shall be    \" instead of \"shall     be\", because the last line must be left-justified instead of fully-justified.\nNote that the second line is also left-justified because it contains only one word.\n```\n\nExample 3:\n\n```text\n\nInput: words = [\"Science\",\"is\",\"what\",\"we\",\"understand\",\"well\",\"enough\",\"to\",\"explain\",\"to\",\"a\",\"computer.\",\"Art\",\"is\",\"everything\",\"else\",\"we\",\"do\"], maxWidth = 20\nOutput:\n[\n  \"Science  is  what we\",\n  \"understand      well\",\n  \"enough to explain to\",\n  \"a  computer.  Art is\",\n  \"everything  else  we\",\n  \"do                  \"\n]\n```\n\n \n\nConstraints:\n\n\t- 1 <= words.length <= 300\n\n\t- 1 <= words[i].length <= 20\n\n\t- words[i] consists of only English letters and symbols.\n\n\t- 1 <= maxWidth <= 100\n\n\t- words[i].length <= maxWidth",
      "examples": [
        {
          "input": {
            "words": [
              "This",
              "is",
              "an",
              "example",
              "of",
              "text",
              "justification."
            ],
            "maxWidth": 16
          },
          "output": [
            "This    is    an",
            "example  of text",
            "justification.  "
          ]
        },
        {
          "input": {
            "words": [
              "What",
              "must",
              "be",
              "acknowledgment",
              "shall",
              "be"
            ],
            "maxWidth": 16
          },
          "output": [
            "What   must   be",
            "acknowledgment  ",
            "shall be        "
          ]
        },
        {
          "input": {
            "words": [
              "Science",
              "is",
              "what",
              "we",
              "understand",
              "well",
              "enough",
              "to",
              "explain",
              "to",
              "a",
              "computer.",
              "Art",
              "is",
              "everything",
              "else",
              "we",
              "do"
            ],
            "maxWidth": 20
          },
          "output": [
            "Science  is  what we",
            "understand      well",
            "enough to explain to",
            "a  computer.  Art is",
            "everything  else  we",
            "do                  "
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "array",
        "string",
        "top-interview-150",
        "interview-150",
        "hot150",
        "simulation"
      ],
      "starterCodePython": "class Solution:\n    def fullJustify(self, words: List[str], maxWidth: int) -> List[str]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<string> fullJustify(vector<string>& words, int maxWidth) {\n        \n    }\n};",
      "methodName": "fullJustify",
      "executionContract": {
        "name": "fullJustify",
        "params": [
          {
            "name": "words",
            "type": "string[]"
          },
          {
            "name": "maxWidth",
            "type": "integer"
          }
        ],
        "returnType": "list<string>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:18.745Z",
      "referenceSolutionHash": "sha256:0ac054a67fcc1e60d132b675654e22f26f8cdf6f6ac6ebf15a922fbf30df6a39",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "words": [
              "This",
              "is",
              "an",
              "example",
              "of",
              "text",
              "justification."
            ],
            "maxWidth": 16
          },
          "expected": [
            "This    is    an",
            "example  of text",
            "justification.  "
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"This\", \"is\", \"an\", \"example\", \"of\", \"text\", \"justification.\"]\n16",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "words": [
              "What",
              "must",
              "be",
              "acknowledgment",
              "shall",
              "be"
            ],
            "maxWidth": 16
          },
          "expected": [
            "What   must   be",
            "acknowledgment  ",
            "shall be        "
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[\"What\",\"must\",\"be\",\"acknowledgment\",\"shall\",\"be\"]\n16",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "words": [
              "Science",
              "is",
              "what",
              "we",
              "understand",
              "well",
              "enough",
              "to",
              "explain",
              "to",
              "a",
              "computer.",
              "Art",
              "is",
              "everything",
              "else",
              "we",
              "do"
            ],
            "maxWidth": 20
          },
          "expected": [
            "Science  is  what we",
            "understand      well",
            "enough to explain to",
            "a  computer.  Art is",
            "everything  else  we",
            "do                  "
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[\"Science\",\"is\",\"what\",\"we\",\"understand\",\"well\",\"enough\",\"to\",\"explain\",\"to\",\"a\",\"computer.\",\"Art\",\"is\",\"everything\",\"else\",\"we\",\"do\"]\n20",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 125,
      "slug": "valid-palindrome",
      "title": "Valid Palindrome",
      "difficulty": "Easy",
      "hot150Order": 25,
      "hot150Section": "Two Pointers",
      "officialUrl": "https://leetcode.com/problems/valid-palindrome/",
      "statementMarkdown": "A phrase is a palindrome if, after converting all uppercase letters into lowercase letters and removing all non-alphanumeric characters, it reads the same forward and backward. Alphanumeric characters include letters and numbers.\n\nGiven a string s, return true if it is a palindrome, or false otherwise.\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"A man, a plan, a canal: Panama\"\nOutput: true\nExplanation: \"amanaplanacanalpanama\" is a palindrome.\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"race a car\"\nOutput: false\nExplanation: \"raceacar\" is not a palindrome.\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \" \"\nOutput: true\nExplanation: s is an empty string \"\" after removing non-alphanumeric characters.\nSince an empty string reads the same forward and backward, it is a palindrome.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 2 * 105\n\n\t- s consists only of printable ASCII characters.",
      "examples": [
        {
          "input": {
            "s": "A man, a plan, a canal: Panama"
          },
          "output": true
        },
        {
          "input": {
            "s": "race a car"
          },
          "output": false
        },
        {
          "input": {
            "s": " "
          },
          "output": true
        }
      ],
      "constraints": [],
      "tags": [
        "two-pointers",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def isPalindrome(self, s: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isPalindrome(string s) {\n        \n    }\n};",
      "methodName": "isPalindrome",
      "executionContract": {
        "name": "isPalindrome",
        "params": [
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:19.186Z",
      "referenceSolutionHash": "sha256:507865a26f9cf42fc103f03c2d9262ccaa2ccaec48776511821fe0e9f966851c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "A man, a plan, a canal: Panama"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"A man, a plan, a canal: Panama\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "race a car"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"race a car\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": " "
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\" \"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 392,
      "slug": "is-subsequence",
      "title": "Is Subsequence",
      "difficulty": "Easy",
      "hot150Order": 26,
      "hot150Section": "Two Pointers",
      "officialUrl": "https://leetcode.com/problems/is-subsequence/",
      "statementMarkdown": "Given two strings s and t, return true if s is a subsequence of t, or false otherwise.\n\nA subsequence of a string is a new string that is formed from the original string by deleting some (can be none) of the characters without disturbing the relative positions of the remaining characters. (i.e., \"ace\" is a subsequence of \"abcde\" while \"aec\" is not).\n\n \n\nExample 1:\n\n```text\nInput: s = \"abc\", t = \"ahbgdc\"\nOutput: true\n\n```\nExample 2:\n\n```text\nInput: s = \"axc\", t = \"ahbgdc\"\nOutput: false\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= s.length <= 100\n\n\t- 0 <= t.length <= 104\n\n\t- s and t consist only of lowercase English letters.\n\n \n\nFollow up: Suppose there are lots of incoming s, say s1, s2, ..., sk where k >= 109, and you want to check one by one to see if t has its subsequence. In this scenario, how would you change your code?",
      "examples": [
        {
          "input": {
            "s": "abc",
            "t": "ahbgdc"
          },
          "output": true
        },
        {
          "input": {
            "s": "axc",
            "t": "ahbgdc"
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "two-pointers",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string",
        "dynamic-programming"
      ],
      "starterCodePython": "class Solution:\n    def isSubsequence(self, s: str, t: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isSubsequence(string s, string t) {\n        \n    }\n};",
      "methodName": "isSubsequence",
      "executionContract": {
        "name": "isSubsequence",
        "params": [
          {
            "name": "s",
            "type": "string"
          },
          {
            "name": "t",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:19.584Z",
      "referenceSolutionHash": "sha256:68f1661b6b320f4955609292b8779d18156b11c4ef4d976dab4bf9856c76df7f",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "abc",
            "t": "ahbgdc"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"abc\"\n\"ahbgdc\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "axc",
            "t": "ahbgdc"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"axc\"\n\"ahbgdc\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 167,
      "slug": "two-sum-ii-input-array-is-sorted",
      "title": "Two Sum II - Input Array Is Sorted",
      "difficulty": "Medium",
      "hot150Order": 27,
      "hot150Section": "Two Pointers",
      "officialUrl": "https://leetcode.com/problems/two-sum-ii-input-array-is-sorted/",
      "statementMarkdown": "Given a 1-indexed array of integers numbers that is already sorted in non-decreasing order, find two numbers such that they add up to a specific target number. Let these two numbers be numbers[index1] and numbers[index2] where 1 <= index1 < index2 <= numbers.length.\n\nReturn the indices of the two numbers index1 and index2, each incremented by one, as an integer array [index1, index2] of length 2.\n\nThe tests are generated such that there is exactly one solution. You may not use the same element twice.\n\nYour solution must use only constant extra space.\n\n \n\nExample 1:\n\n```text\n\nInput: numbers = [2,7,11,15], target = 9\nOutput: [1,2]\nExplanation: The sum of 2 and 7 is 9. Therefore, index1 = 1, index2 = 2. We return [1, 2].\n\n```\n\nExample 2:\n\n```text\n\nInput: numbers = [2,3,4], target = 6\nOutput: [1,3]\nExplanation: The sum of 2 and 4 is 6. Therefore index1 = 1, index2 = 3. We return [1, 3].\n\n```\n\nExample 3:\n\n```text\n\nInput: numbers = [-1,0], target = -1\nOutput: [1,2]\nExplanation: The sum of -1 and 0 is -1. Therefore index1 = 1, index2 = 2. We return [1, 2].\n\n```\n\n \n\nConstraints:\n\n\t- 2 <= numbers.length <= 3 * 104\n\n\t- -1000 <= numbers[i] <= 1000\n\n\t- numbers is sorted in non-decreasing order.\n\n\t- -1000 <= target <= 1000\n\n\t- The tests are generated such that there is exactly one solution.",
      "examples": [
        {
          "input": {
            "numbers": [
              2,
              7,
              11,
              15
            ],
            "target": 9
          },
          "output": [
            1,
            2
          ]
        },
        {
          "input": {
            "numbers": [
              2,
              3,
              4
            ],
            "target": 6
          },
          "output": [
            1,
            3
          ]
        },
        {
          "input": {
            "numbers": [
              -1,
              0
            ],
            "target": -1
          },
          "output": [
            1,
            2
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "two-pointers",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "binary-search"
      ],
      "starterCodePython": "class Solution:\n    def twoSum(self, numbers: List[int], target: int) -> List[int]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& numbers, int target) {\n        \n    }\n};",
      "methodName": "twoSum",
      "executionContract": {
        "name": "twoSum",
        "params": [
          {
            "name": "numbers",
            "type": "integer[]"
          },
          {
            "name": "target",
            "type": "integer"
          }
        ],
        "returnType": "integer[]",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:20.275Z",
      "referenceSolutionHash": "sha256:39c44f281677c5fcd37e3790cca16e9b7df46920b499537e29adcb088913fbdd",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "numbers": [
              2,
              7,
              11,
              15
            ],
            "target": 9
          },
          "expected": [
            1,
            2
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,7,11,15]\n9",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "numbers": [
              2,
              3,
              4
            ],
            "target": 6
          },
          "expected": [
            1,
            3
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2,3,4]\n6",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "numbers": [
              -1,
              0
            ],
            "target": -1
          },
          "expected": [
            1,
            2
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[-1,0]\n-1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 11,
      "slug": "container-with-most-water",
      "title": "Container With Most Water",
      "difficulty": "Medium",
      "hot150Order": 28,
      "hot150Section": "Two Pointers",
      "officialUrl": "https://leetcode.com/problems/container-with-most-water/",
      "statementMarkdown": "You are given an integer array height of length n. There are n vertical lines drawn such that the two endpoints of the ith line are (i, 0) and (i, height[i]).\n\nFind two lines that together with the x-axis form a container, such that the container contains the most water.\n\nReturn the maximum amount of water a container can store.\n\nNotice that you may not slant the container.\n\n \n\nExample 1:\n\n```text\n\nInput: height = [1,8,6,2,5,4,8,3,7]\nOutput: 49\nExplanation: The above vertical lines are represented by array [1,8,6,2,5,4,8,3,7]. In this case, the max area of water (blue section) the container can contain is 49.\n\n```\n\nExample 2:\n\n```text\n\nInput: height = [1,1]\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- n == height.length\n\n\t- 2 <= n <= 105\n\n\t- 0 <= height[i] <= 104",
      "examples": [
        {
          "input": {
            "height": [
              1,
              8,
              6,
              2,
              5,
              4,
              8,
              3,
              7
            ]
          },
          "output": 49
        },
        {
          "input": {
            "height": [
              1,
              1
            ]
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "two-pointers",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "greedy"
      ],
      "starterCodePython": "class Solution:\n    def maxArea(self, height: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maxArea(vector<int>& height) {\n        \n    }\n};",
      "methodName": "maxArea",
      "executionContract": {
        "name": "maxArea",
        "params": [
          {
            "name": "height",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:21.205Z",
      "referenceSolutionHash": "sha256:74841abf7938c11898989c9f39c501ec3e1080131724f45ed450e79fe6cf59b3",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "height": [
              1,
              8,
              6,
              2,
              5,
              4,
              8,
              3,
              7
            ]
          },
          "expected": 49,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,8,6,2,5,4,8,3,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "height": [
              1,
              1
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 15,
      "slug": "3sum",
      "title": "3Sum",
      "difficulty": "Medium",
      "hot150Order": 29,
      "hot150Section": "Two Pointers",
      "officialUrl": "https://leetcode.com/problems/3sum/",
      "statementMarkdown": "Given an integer array nums, return all the triplets [nums[i], nums[j], nums[k]] such that i != j, i != k, and j != k, and nums[i] + nums[j] + nums[k] == 0.\n\nNotice that the solution set must not contain duplicate triplets.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [-1,0,1,2,-1,-4]\nOutput: [[-1,-1,2],[-1,0,1]]\nExplanation: \nnums[0] + nums[1] + nums[2] = (-1) + 0 + 1 = 0.\nnums[1] + nums[2] + nums[4] = 0 + 1 + (-1) = 0.\nnums[0] + nums[3] + nums[4] = (-1) + 2 + (-1) = 0.\nThe distinct triplets are [-1,0,1] and [-1,-1,2].\nNotice that the order of the output and the order of the triplets does not matter.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [0,1,1]\nOutput: []\nExplanation: The only possible triplet does not sum up to 0.\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [0,0,0]\nOutput: [[0,0,0]]\nExplanation: The only possible triplet sums up to 0.\n\n```\n\n \n\nConstraints:\n\n\t- 3 <= nums.length <= 3000\n\n\t- -105 <= nums[i] <= 105",
      "examples": [
        {
          "input": {
            "nums": [
              -1,
              0,
              1,
              2,
              -1,
              -4
            ]
          },
          "output": [
            [
              -1,
              -1,
              2
            ],
            [
              -1,
              0,
              1
            ]
          ]
        },
        {
          "input": {
            "nums": [
              0,
              1,
              1
            ]
          },
          "output": []
        },
        {
          "input": {
            "nums": [
              0,
              0,
              0
            ]
          },
          "output": [
            [
              0,
              0,
              0
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "two-pointers",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "sorting"
      ],
      "starterCodePython": "class Solution:\n    def threeSum(self, nums: list[int]) -> list[list[int]]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<vector<int>> threeSum(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "threeSum",
      "executionContract": {
        "name": "threeSum",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "list<list<integer>>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_deep",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:21.742Z",
      "referenceSolutionHash": "sha256:512c9b2b907738b18a2aacb0ea9925ea7f04708f0a8092fffe7fd5cde8ab6bd7",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              -1,
              0,
              1,
              2,
              -1,
              -4
            ]
          },
          "expected": [
            [
              -1,
              -1,
              2
            ],
            [
              -1,
              0,
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[-1,0,1,2,-1,-4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              1,
              1
            ]
          },
          "expected": [],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,1,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              0,
              0,
              0
            ]
          },
          "expected": [
            [
              0,
              0,
              0
            ]
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[0,0,0]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 209,
      "slug": "minimum-size-subarray-sum",
      "title": "Minimum Size Subarray Sum",
      "difficulty": "Medium",
      "hot150Order": 30,
      "hot150Section": "Sliding Window",
      "officialUrl": "https://leetcode.com/problems/minimum-size-subarray-sum/",
      "statementMarkdown": "Given an array of positive integers nums and a positive integer target, return the minimal length of a subarray whose sum is greater than or equal to target. If there is no such subarray, return 0 instead.\n\n \n\nExample 1:\n\n```text\n\nInput: target = 7, nums = [2,3,1,2,4,3]\nOutput: 2\nExplanation: The subarray [4,3] has the minimal length under the problem constraint.\n\n```\n\nExample 2:\n\n```text\n\nInput: target = 4, nums = [1,4,4]\nOutput: 1\n\n```\n\nExample 3:\n\n```text\n\nInput: target = 11, nums = [1,1,1,1,1,1,1,1]\nOutput: 0\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= target <= 109\n\n\t- 1 <= nums.length <= 105\n\n\t- 1 <= nums[i] <= 104\n\n \n\nFollow up: If you have figured out the O(n) solution, try coding another solution of which the time complexity is O(n log(n)).",
      "examples": [
        {
          "input": {
            "target": 7,
            "nums": [
              2,
              3,
              1,
              2,
              4,
              3
            ]
          },
          "output": 2
        },
        {
          "input": {
            "target": 4,
            "nums": [
              1,
              4,
              4
            ]
          },
          "output": 1
        },
        {
          "input": {
            "target": 11,
            "nums": [
              1,
              1,
              1,
              1,
              1,
              1,
              1,
              1
            ]
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "sliding-window",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "binary-search",
        "prefix-sum"
      ],
      "starterCodePython": "class Solution:\n    def minSubArrayLen(self, target: int, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int minSubArrayLen(int target, vector<int>& nums) {\n        \n    }\n};",
      "methodName": "minSubArrayLen",
      "executionContract": {
        "name": "minSubArrayLen",
        "params": [
          {
            "name": "target",
            "type": "integer"
          },
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:22.181Z",
      "referenceSolutionHash": "sha256:81b6d44a8aebfb8cba2e55983588d5903a7dde51f0537b945fc515f5c90c415c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "target": 7,
            "nums": [
              2,
              3,
              1,
              2,
              4,
              3
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "7\n[2,3,1,2,4,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "target": 4,
            "nums": [
              1,
              4,
              4
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "4\n[1,4,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "target": 11,
            "nums": [
              1,
              1,
              1,
              1,
              1,
              1,
              1,
              1
            ]
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "11\n[1,1,1,1,1,1,1,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 3,
      "slug": "longest-substring-without-repeating-characters",
      "title": "Longest Substring Without Repeating Characters",
      "difficulty": "Medium",
      "hot150Order": 31,
      "hot150Section": "Sliding Window",
      "officialUrl": "https://leetcode.com/problems/longest-substring-without-repeating-characters/",
      "statementMarkdown": "Given a string s, find the length of the longest substring without duplicate characters.\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"abcabcbb\"\nOutput: 3\nExplanation: The answer is \"abc\", with the length of 3. Note that \"bca\" and \"cab\" are also correct answers.\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"bbbbb\"\nOutput: 1\nExplanation: The answer is \"b\", with the length of 1.\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \"pwwkew\"\nOutput: 3\nExplanation: The answer is \"wke\", with the length of 3.\nNotice that the answer must be a substring, \"pwke\" is a subsequence and not a substring.\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= s.length <= 5 * 104\n\n\t- s consists of English letters, digits, symbols and spaces.",
      "examples": [
        {
          "input": {
            "s": "abcabcbb"
          },
          "output": 3
        },
        {
          "input": {
            "s": "bbbbb"
          },
          "output": 1
        },
        {
          "input": {
            "s": "pwwkew"
          },
          "output": 3
        }
      ],
      "constraints": [],
      "tags": [
        "sliding-window",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int lengthOfLongestSubstring(string s) {\n        \n    }\n};",
      "methodName": "lengthOfLongestSubstring",
      "executionContract": {
        "name": "lengthOfLongestSubstring",
        "params": [
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:22.525Z",
      "referenceSolutionHash": "sha256:4d096a693cfd89d4c53f67abcf3203bee1f166d9dd7e8ad76e6f285233a79ab5",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "abcabcbb"
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"abcabcbb\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "bbbbb"
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"bbbbb\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "pwwkew"
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"pwwkew\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 30,
      "slug": "substring-with-concatenation-of-all-words",
      "title": "Substring with Concatenation of All Words",
      "difficulty": "Hard",
      "hot150Order": 32,
      "hot150Section": "Sliding Window",
      "officialUrl": "https://leetcode.com/problems/substring-with-concatenation-of-all-words/",
      "statementMarkdown": "You are given a string s and an array of strings words. All the strings of words are of the same length.\n\nA concatenated string is a string that exactly contains all the strings of any permutation of words concatenated.\n\n\t- For example, if words = [\"ab\",\"cd\",\"ef\"], then \"abcdef\", \"abefcd\", \"cdabef\", \"cdefab\", \"efabcd\", and \"efcdab\" are all concatenated strings. \"acdbef\" is not a concatenated string because it is not the concatenation of any permutation of words.\n\nReturn an array of the starting indices of all the concatenated substrings in s. You can return the answer in any order.\n\n \n\nExample 1:\n\nInput: s = \"barfoothefoobarman\", words = [\"foo\",\"bar\"]\n\nOutput: [0,9]\n\nExplanation:\n\nThe substring starting at 0 is \"barfoo\". It is the concatenation of [\"bar\",\"foo\"] which is a permutation of words.\n\nThe substring starting at 9 is \"foobar\". It is the concatenation of [\"foo\",\"bar\"] which is a permutation of words.\n\nExample 2:\n\nInput: s = \"wordgoodgoodgoodbestword\", words = [\"word\",\"good\",\"best\",\"word\"]\n\nOutput: []\n\nExplanation:\n\nThere is no concatenated substring.\n\nExample 3:\n\nInput: s = \"barfoofoobarthefoobarman\", words = [\"bar\",\"foo\",\"the\"]\n\nOutput: [6,9,12]\n\nExplanation:\n\nThe substring starting at 6 is \"foobarthe\". It is the concatenation of [\"foo\",\"bar\",\"the\"].\n\nThe substring starting at 9 is \"barthefoo\". It is the concatenation of [\"bar\",\"the\",\"foo\"].\n\nThe substring starting at 12 is \"thefoobar\". It is the concatenation of [\"the\",\"foo\",\"bar\"].\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 104\n\n\t- 1 <= words.length <= 5000\n\n\t- 1 <= words[i].length <= 30\n\n\t- s and words[i] consist of lowercase English letters.",
      "examples": [
        {
          "input": {
            "s": "barfoothefoobarman",
            "words": [
              "foo",
              "bar"
            ]
          },
          "output": [
            0,
            9
          ]
        },
        {
          "input": {
            "s": "wordgoodgoodgoodbestword",
            "words": [
              "word",
              "good",
              "best",
              "word"
            ]
          },
          "output": []
        },
        {
          "input": {
            "s": "barfoofoobarthefoobarman",
            "words": [
              "bar",
              "foo",
              "the"
            ]
          },
          "output": [
            6,
            9,
            12
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "sliding-window",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def findSubstring(self, s: str, words: List[str]) -> List[int]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<int> findSubstring(string s, vector<string>& words) {\n        \n    }\n};",
      "methodName": "findSubstring",
      "executionContract": {
        "name": "findSubstring",
        "params": [
          {
            "name": "s",
            "type": "string"
          },
          {
            "name": "words",
            "type": "string[]"
          }
        ],
        "returnType": "list<integer>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_top",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:22.995Z",
      "referenceSolutionHash": "sha256:249d729a6009e2ebbf7b6030fcd0b052a2ab6211d62df9653d79578360158831",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "barfoothefoobarman",
            "words": [
              "foo",
              "bar"
            ]
          },
          "expected": [
            0,
            9
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"barfoothefoobarman\"\n[\"foo\",\"bar\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "wordgoodgoodgoodbestword",
            "words": [
              "word",
              "good",
              "best",
              "word"
            ]
          },
          "expected": [],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"wordgoodgoodgoodbestword\"\n[\"word\",\"good\",\"best\",\"word\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "barfoofoobarthefoobarman",
            "words": [
              "bar",
              "foo",
              "the"
            ]
          },
          "expected": [
            6,
            9,
            12
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"barfoofoobarthefoobarman\"\n[\"bar\",\"foo\",\"the\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 76,
      "slug": "minimum-window-substring",
      "title": "Minimum Window Substring",
      "difficulty": "Hard",
      "hot150Order": 33,
      "hot150Section": "Sliding Window",
      "officialUrl": "https://leetcode.com/problems/minimum-window-substring/",
      "statementMarkdown": "Given two strings s and t of lengths m and n respectively, return the minimum window substring of s such that every character in t (including duplicates) is included in the window. If there is no such substring, return the empty string \"\".\n\nThe testcases will be generated such that the answer is unique.\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"ADOBECODEBANC\", t = \"ABC\"\nOutput: \"BANC\"\nExplanation: The minimum window substring \"BANC\" includes 'A', 'B', and 'C' from string t.\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"a\", t = \"a\"\nOutput: \"a\"\nExplanation: The entire string s is the minimum window.\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \"a\", t = \"aa\"\nOutput: \"\"\nExplanation: Both 'a's from t must be included in the window.\nSince the largest window of s only has one 'a', return empty string.\n\n```\n\n \n\nConstraints:\n\n\t- m == s.length\n\n\t- n == t.length\n\n\t- 1 <= m, n <= 105\n\n\t- s and t consist of uppercase and lowercase English letters.\n\n \n\nFollow up: Could you find an algorithm that runs in O(m + n) time?",
      "examples": [
        {
          "input": {
            "s": "ADOBECODEBANC",
            "t": "ABC"
          },
          "output": "BANC"
        },
        {
          "input": {
            "s": "a",
            "t": "a"
          },
          "output": "a"
        },
        {
          "input": {
            "s": "a",
            "t": "aa"
          },
          "output": ""
        }
      ],
      "constraints": [],
      "tags": [
        "sliding-window",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def minWindow(self, s: str, t: str) -> str:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    string minWindow(string s, string t) {\n        \n    }\n};",
      "methodName": "minWindow",
      "executionContract": {
        "name": "minWindow",
        "params": [
          {
            "name": "s",
            "type": "string"
          },
          {
            "name": "t",
            "type": "string"
          }
        ],
        "returnType": "string",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:23.371Z",
      "referenceSolutionHash": "sha256:1c2e954f9837e578b907529463c5a4fe45f05a9c8531e17154d9754b6be91e4c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "ADOBECODEBANC",
            "t": "ABC"
          },
          "expected": "BANC",
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"ADOBECODEBANC\"\n\"ABC\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "a",
            "t": "a"
          },
          "expected": "a",
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"a\"\n\"a\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "a",
            "t": "aa"
          },
          "expected": "",
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"a\"\n\"aa\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 36,
      "slug": "valid-sudoku",
      "title": "Valid Sudoku",
      "difficulty": "Medium",
      "hot150Order": 34,
      "hot150Section": "Matrix",
      "officialUrl": "https://leetcode.com/problems/valid-sudoku/",
      "statementMarkdown": "Determine if a 9 x 9 Sudoku board is valid. Only the filled cells need to be validated according to the following rules:\n\n\t- Each row must contain the digits 1-9 without repetition.\n\n\t- Each column must contain the digits 1-9 without repetition.\n\n\t- Each of the nine 3 x 3 sub-boxes of the grid must contain the digits 1-9 without repetition.\n\nNote:\n\n\t- A Sudoku board (partially filled) could be valid but is not necessarily solvable.\n\n\t- Only the filled cells need to be validated according to the mentioned rules.\n\n \n\nExample 1:\n\n```text\n\nInput: board = \n[[\"5\",\"3\",\".\",\".\",\"7\",\".\",\".\",\".\",\".\"]\n,[\"6\",\".\",\".\",\"1\",\"9\",\"5\",\".\",\".\",\".\"]\n,[\".\",\"9\",\"8\",\".\",\".\",\".\",\".\",\"6\",\".\"]\n,[\"8\",\".\",\".\",\".\",\"6\",\".\",\".\",\".\",\"3\"]\n,[\"4\",\".\",\".\",\"8\",\".\",\"3\",\".\",\".\",\"1\"]\n,[\"7\",\".\",\".\",\".\",\"2\",\".\",\".\",\".\",\"6\"]\n,[\".\",\"6\",\".\",\".\",\".\",\".\",\"2\",\"8\",\".\"]\n,[\".\",\".\",\".\",\"4\",\"1\",\"9\",\".\",\".\",\"5\"]\n,[\".\",\".\",\".\",\".\",\"8\",\".\",\".\",\"7\",\"9\"]]\nOutput: true\n\n```\n\nExample 2:\n\n```text\n\nInput: board = \n[[\"8\",\"3\",\".\",\".\",\"7\",\".\",\".\",\".\",\".\"]\n,[\"6\",\".\",\".\",\"1\",\"9\",\"5\",\".\",\".\",\".\"]\n,[\".\",\"9\",\"8\",\".\",\".\",\".\",\".\",\"6\",\".\"]\n,[\"8\",\".\",\".\",\".\",\"6\",\".\",\".\",\".\",\"3\"]\n,[\"4\",\".\",\".\",\"8\",\".\",\"3\",\".\",\".\",\"1\"]\n,[\"7\",\".\",\".\",\".\",\"2\",\".\",\".\",\".\",\"6\"]\n,[\".\",\"6\",\".\",\".\",\".\",\".\",\"2\",\"8\",\".\"]\n,[\".\",\".\",\".\",\"4\",\"1\",\"9\",\".\",\".\",\"5\"]\n,[\".\",\".\",\".\",\".\",\"8\",\".\",\".\",\"7\",\"9\"]]\nOutput: false\nExplanation: Same as Example 1, except with the 5 in the top left corner being modified to 8. Since there are two 8's in the top left 3x3 sub-box, it is invalid.\n\n```\n\n \n\nConstraints:\n\n\t- board.length == 9\n\n\t- board[i].length == 9\n\n\t- board[i][j] is a digit 1-9 or '.'.",
      "examples": [
        {
          "input": {
            "board": [
              [
                "5",
                "3",
                ".",
                ".",
                "7",
                ".",
                ".",
                ".",
                "."
              ],
              [
                "6",
                ".",
                ".",
                "1",
                "9",
                "5",
                ".",
                ".",
                "."
              ],
              [
                ".",
                "9",
                "8",
                ".",
                ".",
                ".",
                ".",
                "6",
                "."
              ],
              [
                "8",
                ".",
                ".",
                ".",
                "6",
                ".",
                ".",
                ".",
                "3"
              ],
              [
                "4",
                ".",
                ".",
                "8",
                ".",
                "3",
                ".",
                ".",
                "1"
              ],
              [
                "7",
                ".",
                ".",
                ".",
                "2",
                ".",
                ".",
                ".",
                "6"
              ],
              [
                ".",
                "6",
                ".",
                ".",
                ".",
                ".",
                "2",
                "8",
                "."
              ],
              [
                ".",
                ".",
                ".",
                "4",
                "1",
                "9",
                ".",
                ".",
                "5"
              ],
              [
                ".",
                ".",
                ".",
                ".",
                "8",
                ".",
                ".",
                "7",
                "9"
              ]
            ]
          },
          "output": true
        },
        {
          "input": {
            "board": [
              [
                "8",
                "3",
                ".",
                ".",
                "7",
                ".",
                ".",
                ".",
                "."
              ],
              [
                "6",
                ".",
                ".",
                "1",
                "9",
                "5",
                ".",
                ".",
                "."
              ],
              [
                ".",
                "9",
                "8",
                ".",
                ".",
                ".",
                ".",
                "6",
                "."
              ],
              [
                "8",
                ".",
                ".",
                ".",
                "6",
                ".",
                ".",
                ".",
                "3"
              ],
              [
                "4",
                ".",
                ".",
                "8",
                ".",
                "3",
                ".",
                ".",
                "1"
              ],
              [
                "7",
                ".",
                ".",
                ".",
                "2",
                ".",
                ".",
                ".",
                "6"
              ],
              [
                ".",
                "6",
                ".",
                ".",
                ".",
                ".",
                "2",
                "8",
                "."
              ],
              [
                ".",
                ".",
                ".",
                "4",
                "1",
                "9",
                ".",
                ".",
                "5"
              ],
              [
                ".",
                ".",
                ".",
                ".",
                "8",
                ".",
                ".",
                "7",
                "9"
              ]
            ]
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "matrix",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "hash-table"
      ],
      "starterCodePython": "class Solution:\n    def isValidSudoku(self, board: List[List[str]]) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isValidSudoku(vector<vector<char>>& board) {\n        \n    }\n};",
      "methodName": "isValidSudoku",
      "executionContract": {
        "name": "isValidSudoku",
        "params": [
          {
            "name": "board",
            "type": "character[][]"
          }
        ],
        "returnType": "boolean",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:23.815Z",
      "referenceSolutionHash": "sha256:66a6ef4b999d562b4852f5d6a6a5c66a9981368eaff79af7314988dc6e2b7ba5",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "board": [
              [
                "5",
                "3",
                ".",
                ".",
                "7",
                ".",
                ".",
                ".",
                "."
              ],
              [
                "6",
                ".",
                ".",
                "1",
                "9",
                "5",
                ".",
                ".",
                "."
              ],
              [
                ".",
                "9",
                "8",
                ".",
                ".",
                ".",
                ".",
                "6",
                "."
              ],
              [
                "8",
                ".",
                ".",
                ".",
                "6",
                ".",
                ".",
                ".",
                "3"
              ],
              [
                "4",
                ".",
                ".",
                "8",
                ".",
                "3",
                ".",
                ".",
                "1"
              ],
              [
                "7",
                ".",
                ".",
                ".",
                "2",
                ".",
                ".",
                ".",
                "6"
              ],
              [
                ".",
                "6",
                ".",
                ".",
                ".",
                ".",
                "2",
                "8",
                "."
              ],
              [
                ".",
                ".",
                ".",
                "4",
                "1",
                "9",
                ".",
                ".",
                "5"
              ],
              [
                ".",
                ".",
                ".",
                ".",
                "8",
                ".",
                ".",
                "7",
                "9"
              ]
            ]
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[\"5\",\"3\",\".\",\".\",\"7\",\".\",\".\",\".\",\".\"],[\"6\",\".\",\".\",\"1\",\"9\",\"5\",\".\",\".\",\".\"],[\".\",\"9\",\"8\",\".\",\".\",\".\",\".\",\"6\",\".\"],[\"8\",\".\",\".\",\".\",\"6\",\".\",\".\",\".\",\"3\"],[\"4\",\".\",\".\",\"8\",\".\",\"3\",\".\",\".\",\"1\"],[\"7\",\".\",\".\",\".\",\"2\",\".\",\".\",\".\",\"6\"],[\".\",\"6\",\".\",\".\",\".\",\".\",\"2\",\"8\",\".\"],[\".\",\".\",\".\",\"4\",\"1\",\"9\",\".\",\".\",\"5\"],[\".\",\".\",\".\",\".\",\"8\",\".\",\".\",\"7\",\"9\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "board": [
              [
                "8",
                "3",
                ".",
                ".",
                "7",
                ".",
                ".",
                ".",
                "."
              ],
              [
                "6",
                ".",
                ".",
                "1",
                "9",
                "5",
                ".",
                ".",
                "."
              ],
              [
                ".",
                "9",
                "8",
                ".",
                ".",
                ".",
                ".",
                "6",
                "."
              ],
              [
                "8",
                ".",
                ".",
                ".",
                "6",
                ".",
                ".",
                ".",
                "3"
              ],
              [
                "4",
                ".",
                ".",
                "8",
                ".",
                "3",
                ".",
                ".",
                "1"
              ],
              [
                "7",
                ".",
                ".",
                ".",
                "2",
                ".",
                ".",
                ".",
                "6"
              ],
              [
                ".",
                "6",
                ".",
                ".",
                ".",
                ".",
                "2",
                "8",
                "."
              ],
              [
                ".",
                ".",
                ".",
                "4",
                "1",
                "9",
                ".",
                ".",
                "5"
              ],
              [
                ".",
                ".",
                ".",
                ".",
                "8",
                ".",
                ".",
                "7",
                "9"
              ]
            ]
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[\"8\",\"3\",\".\",\".\",\"7\",\".\",\".\",\".\",\".\"],[\"6\",\".\",\".\",\"1\",\"9\",\"5\",\".\",\".\",\".\"],[\".\",\"9\",\"8\",\".\",\".\",\".\",\".\",\"6\",\".\"],[\"8\",\".\",\".\",\".\",\"6\",\".\",\".\",\".\",\"3\"],[\"4\",\".\",\".\",\"8\",\".\",\"3\",\".\",\".\",\"1\"],[\"7\",\".\",\".\",\".\",\"2\",\".\",\".\",\".\",\"6\"],[\".\",\"6\",\".\",\".\",\".\",\".\",\"2\",\"8\",\".\"],[\".\",\".\",\".\",\"4\",\"1\",\"9\",\".\",\".\",\"5\"],[\".\",\".\",\".\",\".\",\"8\",\".\",\".\",\"7\",\"9\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 54,
      "slug": "spiral-matrix",
      "title": "Spiral Matrix",
      "difficulty": "Medium",
      "hot150Order": 35,
      "hot150Section": "Matrix",
      "officialUrl": "https://leetcode.com/problems/spiral-matrix/",
      "statementMarkdown": "Given an m x n matrix, return all elements of the matrix in spiral order.\n\n \n\nExample 1:\n\n```text\n\nInput: matrix = [[1,2,3],[4,5,6],[7,8,9]]\nOutput: [1,2,3,6,9,8,7,4,5]\n\n```\n\nExample 2:\n\n```text\n\nInput: matrix = [[1,2,3,4],[5,6,7,8],[9,10,11,12]]\nOutput: [1,2,3,4,8,12,11,10,9,5,6,7]\n\n```\n\n \n\nConstraints:\n\n\t- m == matrix.length\n\n\t- n == matrix[i].length\n\n\t- 1 <= m, n <= 10\n\n\t- -100 <= matrix[i][j] <= 100",
      "examples": [
        {
          "input": {
            "matrix": [
              [
                1,
                2,
                3
              ],
              [
                4,
                5,
                6
              ],
              [
                7,
                8,
                9
              ]
            ]
          },
          "output": [
            1,
            2,
            3,
            6,
            9,
            8,
            7,
            4,
            5
          ]
        },
        {
          "input": {
            "matrix": [
              [
                1,
                2,
                3,
                4
              ],
              [
                5,
                6,
                7,
                8
              ],
              [
                9,
                10,
                11,
                12
              ]
            ]
          },
          "output": [
            1,
            2,
            3,
            4,
            8,
            12,
            11,
            10,
            9,
            5,
            6,
            7
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "matrix",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "simulation"
      ],
      "starterCodePython": "class Solution:\n    def spiralOrder(self, matrix: List[List[int]]) -> List[int]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<int> spiralOrder(vector<vector<int>>& matrix) {\n        \n    }\n};",
      "methodName": "spiralOrder",
      "executionContract": {
        "name": "spiralOrder",
        "params": [
          {
            "name": "matrix",
            "type": "integer[][]"
          }
        ],
        "returnType": "list<integer>",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:24.291Z",
      "referenceSolutionHash": "sha256:ef78aa0aaaad2f60ed27de3dbb0b416cf6e5e910d8bc182554f5185f15f381e1",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "matrix": [
              [
                1,
                2,
                3
              ],
              [
                4,
                5,
                6
              ],
              [
                7,
                8,
                9
              ]
            ]
          },
          "expected": [
            1,
            2,
            3,
            6,
            9,
            8,
            7,
            4,
            5
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,2,3],[4,5,6],[7,8,9]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "matrix": [
              [
                1,
                2,
                3,
                4
              ],
              [
                5,
                6,
                7,
                8
              ],
              [
                9,
                10,
                11,
                12
              ]
            ]
          },
          "expected": [
            1,
            2,
            3,
            4,
            8,
            12,
            11,
            10,
            9,
            5,
            6,
            7
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,2,3,4],[5,6,7,8],[9,10,11,12]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 48,
      "slug": "rotate-image",
      "title": "Rotate Image",
      "difficulty": "Medium",
      "hot150Order": 36,
      "hot150Section": "Matrix",
      "officialUrl": "https://leetcode.com/problems/rotate-image/",
      "statementMarkdown": "You are given an n x n 2D matrix representing an image, rotate the image by 90 degrees (clockwise).\n\nYou have to rotate the image in-place, which means you have to modify the input 2D matrix directly. DO NOT allocate another 2D matrix and do the rotation.\n\n \n\nExample 1:\n\n```text\n\nInput: matrix = [[1,2,3],[4,5,6],[7,8,9]]\nOutput: [[7,4,1],[8,5,2],[9,6,3]]\n\n```\n\nExample 2:\n\n```text\n\nInput: matrix = [[5,1,9,11],[2,4,8,10],[13,3,6,7],[15,14,12,16]]\nOutput: [[15,13,2,5],[14,3,4,1],[12,6,8,9],[16,7,10,11]]\n\n```\n\n \n\nConstraints:\n\n\t- n == matrix.length == matrix[i].length\n\n\t- 1 <= n <= 20\n\n\t- -1000 <= matrix[i][j] <= 1000",
      "examples": [
        {
          "input": {
            "matrix": [
              [
                1,
                2,
                3
              ],
              [
                4,
                5,
                6
              ],
              [
                7,
                8,
                9
              ]
            ]
          },
          "output": [
            [
              7,
              4,
              1
            ],
            [
              8,
              5,
              2
            ],
            [
              9,
              6,
              3
            ]
          ]
        },
        {
          "input": {
            "matrix": [
              [
                5,
                1,
                9,
                11
              ],
              [
                2,
                4,
                8,
                10
              ],
              [
                13,
                3,
                6,
                7
              ],
              [
                15,
                14,
                12,
                16
              ]
            ]
          },
          "output": [
            [
              15,
              13,
              2,
              5
            ],
            [
              14,
              3,
              4,
              1
            ],
            [
              12,
              6,
              8,
              9
            ],
            [
              16,
              7,
              10,
              11
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "matrix",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "math"
      ],
      "starterCodePython": "class Solution:\n    def rotate(self, matrix: List[List[int]]) -> None:\n        \"\"\"\n        Do not return anything, modify matrix in-place instead.\n        \"\"\"\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    void rotate(vector<vector<int>>& matrix) {\n        \n    }\n};",
      "methodName": "rotate",
      "executionContract": {
        "name": "rotate",
        "params": [
          {
            "name": "matrix",
            "type": "integer[][]"
          }
        ],
        "returnType": "void",
        "contractKind": "inplace_arg"
      },
      "comparisonStrategy": "inplace_arg",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:24.659Z",
      "referenceSolutionHash": "sha256:61c0aa9bd8298138126d2b86ee92324229c47aa1fc1b85cf97d7b5692537f0b1",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "matrix": [
              [
                1,
                2,
                3
              ],
              [
                4,
                5,
                6
              ],
              [
                7,
                8,
                9
              ]
            ]
          },
          "expected": [
            [
              7,
              4,
              1
            ],
            [
              8,
              5,
              2
            ],
            [
              9,
              6,
              3
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,2,3],[4,5,6],[7,8,9]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "matrix": [
              [
                5,
                1,
                9,
                11
              ],
              [
                2,
                4,
                8,
                10
              ],
              [
                13,
                3,
                6,
                7
              ],
              [
                15,
                14,
                12,
                16
              ]
            ]
          },
          "expected": [
            [
              15,
              13,
              2,
              5
            ],
            [
              14,
              3,
              4,
              1
            ],
            [
              12,
              6,
              8,
              9
            ],
            [
              16,
              7,
              10,
              11
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[5,1,9,11],[2,4,8,10],[13,3,6,7],[15,14,12,16]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 73,
      "slug": "set-matrix-zeroes",
      "title": "Set Matrix Zeroes",
      "difficulty": "Medium",
      "hot150Order": 37,
      "hot150Section": "Matrix",
      "officialUrl": "https://leetcode.com/problems/set-matrix-zeroes/",
      "statementMarkdown": "Given an m x n integer matrix matrix, if an element is 0, set its entire row and column to 0's.\n\nYou must do it in place.\n\n \n\nExample 1:\n\n```text\n\nInput: matrix = [[1,1,1],[1,0,1],[1,1,1]]\nOutput: [[1,0,1],[0,0,0],[1,0,1]]\n\n```\n\nExample 2:\n\n```text\n\nInput: matrix = [[0,1,2,0],[3,4,5,2],[1,3,1,5]]\nOutput: [[0,0,0,0],[0,4,5,0],[0,3,1,0]]\n\n```\n\n \n\nConstraints:\n\n\t- m == matrix.length\n\n\t- n == matrix[0].length\n\n\t- 1 <= m, n <= 200\n\n\t- -231 <= matrix[i][j] <= 231 - 1\n\n \n\nFollow up:\n\n\t- A straightforward solution using O(mn) space is probably a bad idea.\n\n\t- A simple improvement uses O(m + n) space, but still not the best solution.\n\n\t- Could you devise a constant space solution?",
      "examples": [
        {
          "input": {
            "matrix": [
              [
                1,
                1,
                1
              ],
              [
                1,
                0,
                1
              ],
              [
                1,
                1,
                1
              ]
            ]
          },
          "output": [
            [
              1,
              0,
              1
            ],
            [
              0,
              0,
              0
            ],
            [
              1,
              0,
              1
            ]
          ]
        },
        {
          "input": {
            "matrix": [
              [
                0,
                1,
                2,
                0
              ],
              [
                3,
                4,
                5,
                2
              ],
              [
                1,
                3,
                1,
                5
              ]
            ]
          },
          "output": [
            [
              0,
              0,
              0,
              0
            ],
            [
              0,
              4,
              5,
              0
            ],
            [
              0,
              3,
              1,
              0
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "matrix",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "hash-table"
      ],
      "starterCodePython": "class Solution:\n    def setZeroes(self, matrix: List[List[int]]) -> None:\n        \"\"\"\n        Do not return anything, modify matrix in-place instead.\n        \"\"\"\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    void setZeroes(vector<vector<int>>& matrix) {\n        \n    }\n};",
      "methodName": "setZeroes",
      "executionContract": {
        "name": "setZeroes",
        "params": [
          {
            "name": "matrix",
            "type": "integer[][]"
          }
        ],
        "returnType": "void",
        "contractKind": "inplace_arg"
      },
      "comparisonStrategy": "inplace_arg",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:25.121Z",
      "referenceSolutionHash": "sha256:a5a61087bdc3034f8a1251280bd87604778c506a640ab622261cea8f572adeec",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "matrix": [
              [
                1,
                1,
                1
              ],
              [
                1,
                0,
                1
              ],
              [
                1,
                1,
                1
              ]
            ]
          },
          "expected": [
            [
              1,
              0,
              1
            ],
            [
              0,
              0,
              0
            ],
            [
              1,
              0,
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,1,1],[1,0,1],[1,1,1]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "matrix": [
              [
                0,
                1,
                2,
                0
              ],
              [
                3,
                4,
                5,
                2
              ],
              [
                1,
                3,
                1,
                5
              ]
            ]
          },
          "expected": [
            [
              0,
              0,
              0,
              0
            ],
            [
              0,
              4,
              5,
              0
            ],
            [
              0,
              3,
              1,
              0
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[0,1,2,0],[3,4,5,2],[1,3,1,5]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 289,
      "slug": "game-of-life",
      "title": "Game of Life",
      "difficulty": "Medium",
      "hot150Order": 38,
      "hot150Section": "Matrix",
      "officialUrl": "https://leetcode.com/problems/game-of-life/",
      "statementMarkdown": "According to Wikipedia's article: \"The Game of Life, also known simply as Life, is a cellular automaton devised by the British mathematician John Horton Conway in 1970.\"\n\nThe board is made up of an m x n grid of cells, where each cell has an initial state: live (represented by a 1) or dead (represented by a 0). Each cell interacts with its eight neighbors (horizontal, vertical, diagonal) using the following four rules (taken from the above Wikipedia article):\n\n\t- Any live cell with fewer than two live neighbors dies as if caused by under-population.\n\n\t- Any live cell with two or three live neighbors lives on to the next generation.\n\n\t- Any live cell with more than three live neighbors dies, as if by over-population.\n\n\t- Any dead cell with exactly three live neighbors becomes a live cell, as if by reproduction.\n\nThe next state of the board is determined by applying the above rules simultaneously to every cell in the current state of the m x n grid board. In this process, births and deaths occur simultaneously.\n\nGiven the current state of the board, update the board to reflect its next state.\n\nNote that you do not need to return anything.\n\n \n\nExample 1:\n\n```text\n\nInput: board = [[0,1,0],[0,0,1],[1,1,1],[0,0,0]]\nOutput: [[0,0,0],[1,0,1],[0,1,1],[0,1,0]]\n\n```\n\nExample 2:\n\n```text\n\nInput: board = [[1,1],[1,0]]\nOutput: [[1,1],[1,1]]\n\n```\n\n \n\nConstraints:\n\n\t- m == board.length\n\n\t- n == board[i].length\n\n\t- 1 <= m, n <= 25\n\n\t- board[i][j] is 0 or 1.\n\n \n\nFollow up:\n\n\t- Could you solve it in-place? Remember that the board needs to be updated simultaneously: You cannot update some cells first and then use their updated values to update other cells.\n\n\t- In this question, we represent the board using a 2D array. In principle, the board is infinite, which would cause problems when the active area encroaches upon the border of the array (i.e., live cells reach the border). How would you address these problems?",
      "examples": [
        {
          "input": {
            "board": [
              [
                0,
                1,
                0
              ],
              [
                0,
                0,
                1
              ],
              [
                1,
                1,
                1
              ],
              [
                0,
                0,
                0
              ]
            ]
          },
          "output": [
            [
              0,
              0,
              0
            ],
            [
              1,
              0,
              1
            ],
            [
              0,
              1,
              1
            ],
            [
              0,
              1,
              0
            ]
          ]
        },
        {
          "input": {
            "board": [
              [
                1,
                1
              ],
              [
                1,
                0
              ]
            ]
          },
          "output": [
            [
              1,
              1
            ],
            [
              1,
              1
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "matrix",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "simulation"
      ],
      "starterCodePython": "class Solution:\n    def gameOfLife(self, board: List[List[int]]) -> None:\n        \"\"\"\n        Do not return anything, modify board in-place instead.\n        \"\"\"\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    void gameOfLife(vector<vector<int>>& board) {\n        \n    }\n};",
      "methodName": "gameOfLife",
      "executionContract": {
        "name": "gameOfLife",
        "params": [
          {
            "name": "board",
            "type": "integer[][]"
          }
        ],
        "returnType": "void",
        "contractKind": "inplace_arg"
      },
      "comparisonStrategy": "inplace_arg",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:25.564Z",
      "referenceSolutionHash": "sha256:5c7f4fcad256ecc61982c96a0b4e0591fbe9e70e3cac1bb0247449815a7d6a98",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "board": [
              [
                0,
                1,
                0
              ],
              [
                0,
                0,
                1
              ],
              [
                1,
                1,
                1
              ],
              [
                0,
                0,
                0
              ]
            ]
          },
          "expected": [
            [
              0,
              0,
              0
            ],
            [
              1,
              0,
              1
            ],
            [
              0,
              1,
              1
            ],
            [
              0,
              1,
              0
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[0,1,0],[0,0,1],[1,1,1],[0,0,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "board": [
              [
                1,
                1
              ],
              [
                1,
                0
              ]
            ]
          },
          "expected": [
            [
              1,
              1
            ],
            [
              1,
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,1],[1,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 383,
      "slug": "ransom-note",
      "title": "Ransom Note",
      "difficulty": "Easy",
      "hot150Order": 39,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/ransom-note/",
      "statementMarkdown": "Given two strings ransomNote and magazine, return true if ransomNote can be constructed by using the letters from magazine and false otherwise.\n\nEach letter in magazine can only be used once in ransomNote.\n\n \n\nExample 1:\n\n```text\nInput: ransomNote = \"a\", magazine = \"b\"\nOutput: false\n\n```\nExample 2:\n\n```text\nInput: ransomNote = \"aa\", magazine = \"ab\"\nOutput: false\n\n```\nExample 3:\n\n```text\nInput: ransomNote = \"aa\", magazine = \"aab\"\nOutput: true\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= ransomNote.length, magazine.length <= 105\n\n\t- ransomNote and magazine consist of lowercase English letters.",
      "examples": [
        {
          "input": {
            "ransomNote": "a",
            "magazine": "b"
          },
          "output": false
        },
        {
          "input": {
            "ransomNote": "aa",
            "magazine": "ab"
          },
          "output": false
        },
        {
          "input": {
            "ransomNote": "aa",
            "magazine": "aab"
          },
          "output": true
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string",
        "counting"
      ],
      "starterCodePython": "class Solution:\n    def canConstruct(self, ransomNote: str, magazine: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool canConstruct(string ransomNote, string magazine) {\n        \n    }\n};",
      "methodName": "canConstruct",
      "executionContract": {
        "name": "canConstruct",
        "params": [
          {
            "name": "ransomNote",
            "type": "string"
          },
          {
            "name": "magazine",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:25.959Z",
      "referenceSolutionHash": "sha256:08be408a79667c074787a029bcc072f6e5149c3ac771255118cbf5c99dc66b07",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "ransomNote": "a",
            "magazine": "b"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"a\"\n\"b\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "ransomNote": "aa",
            "magazine": "ab"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"aa\"\n\"ab\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "ransomNote": "aa",
            "magazine": "aab"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"aa\"\n\"aab\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 205,
      "slug": "isomorphic-strings",
      "title": "Isomorphic Strings",
      "difficulty": "Easy",
      "hot150Order": 40,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/isomorphic-strings/",
      "statementMarkdown": "Given two strings s and t, determine if they are isomorphic.\n\nTwo strings s and t are isomorphic if the characters in s can be replaced to get t.\n\nAll occurrences of a character must be replaced with another character while preserving the order of characters. No two characters may map to the same character, but a character may map to itself.\n\n \n\nExample 1:\n\nInput: s = \"egg\", t = \"add\"\n\nOutput: true\n\nExplanation:\n\nThe strings s and t can be made identical by:\n\n\t- Mapping 'e' to 'a'.\n\n\t- Mapping 'g' to 'd'.\n\nExample 2:\n\nInput: s = \"f11\", t = \"b23\"\n\nOutput: false\n\nExplanation:\n\nThe strings s and t can not be made identical as '1' needs to be mapped to both '2' and '3'.\n\nExample 3:\n\nInput: s = \"paper\", t = \"title\"\n\nOutput: true\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 5 * 104\n\n\t- t.length == s.length\n\n\t- s and t consist of any valid ascii character.",
      "examples": [
        {
          "input": {
            "s": "egg",
            "t": "add"
          },
          "output": true
        },
        {
          "input": {
            "s": "foo",
            "t": "bar"
          },
          "output": false
        },
        {
          "input": {
            "s": "paper",
            "t": "title"
          },
          "output": true
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def isIsomorphic(self, s: str, t: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isIsomorphic(string s, string t) {\n        \n    }\n};",
      "methodName": "isIsomorphic",
      "executionContract": {
        "name": "isIsomorphic",
        "params": [
          {
            "name": "s",
            "type": "string"
          },
          {
            "name": "t",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:26.329Z",
      "referenceSolutionHash": "sha256:24aed8210ce615323ec09ae54e1fa47b2ac4b9031195d52140a3391a7c12a1f0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "egg",
            "t": "add"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"egg\"\n\"add\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "foo",
            "t": "bar"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"foo\"\n\"bar\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "paper",
            "t": "title"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"paper\"\n\"title\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 290,
      "slug": "word-pattern",
      "title": "Word Pattern",
      "difficulty": "Easy",
      "hot150Order": 41,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/word-pattern/",
      "statementMarkdown": "Given a pattern and a string s, find if s follows the same pattern.\n\nHere follow means a full match, such that there is a bijection between a letter in pattern and a non-empty word in s. Specifically:\n\n\t- Each letter in pattern maps to exactly one unique word in s.\n\n\t- Each unique word in s maps to exactly one letter in pattern.\n\n\t- No two letters map to the same word, and no two words map to the same letter.\n\n \n\nExample 1:\n\nInput: pattern = \"abba\", s = \"dog cat cat dog\"\n\nOutput: true\n\nExplanation:\n\nThe bijection can be established as:\n\n\t- 'a' maps to \"dog\".\n\n\t- 'b' maps to \"cat\".\n\nExample 2:\n\nInput: pattern = \"abba\", s = \"dog cat cat fish\"\n\nOutput: false\n\nExample 3:\n\nInput: pattern = \"aaaa\", s = \"dog cat cat dog\"\n\nOutput: false\n\n \n\nConstraints:\n\n\t- 1 <= pattern.length <= 300\n\n\t- pattern contains only lower-case English letters.\n\n\t- 1 <= s.length <= 3000\n\n\t- s contains only lowercase English letters and spaces ' '.\n\n\t- s does not contain any leading or trailing spaces.\n\n\t- All the words in s are separated by a single space.",
      "examples": [
        {
          "input": {
            "pattern": "abba",
            "s": "dog cat cat dog"
          },
          "output": true
        },
        {
          "input": {
            "pattern": "abba",
            "s": "dog cat cat fish"
          },
          "output": false
        },
        {
          "input": {
            "pattern": "aaaa",
            "s": "dog cat cat dog"
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def wordPattern(self, pattern: str, s: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool wordPattern(string pattern, string s) {\n        \n    }\n};",
      "methodName": "wordPattern",
      "executionContract": {
        "name": "wordPattern",
        "params": [
          {
            "name": "pattern",
            "type": "string"
          },
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:26.782Z",
      "referenceSolutionHash": "sha256:94ed9ca7c1ff1bf47a62e3c3cc7543422a804fb4d98ac97b6cd6621caad96c2c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "pattern": "abba",
            "s": "dog cat cat dog"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"abba\"\n\"dog cat cat dog\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "pattern": "abba",
            "s": "dog cat cat fish"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"abba\"\n\"dog cat cat fish\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "pattern": "aaaa",
            "s": "dog cat cat dog"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"aaaa\"\n\"dog cat cat dog\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 242,
      "slug": "valid-anagram",
      "title": "Valid Anagram",
      "difficulty": "Easy",
      "hot150Order": 42,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/valid-anagram/",
      "statementMarkdown": "Given two strings s and t, return true if t is an anagram of s, and false otherwise.\n\n \n\nExample 1:\n\nInput: s = \"anagram\", t = \"nagaram\"\n\nOutput: true\n\nExample 2:\n\nInput: s = \"rat\", t = \"car\"\n\nOutput: false\n\n \n\nConstraints:\n\n\t- 1 <= s.length, t.length <= 5 * 104\n\n\t- s and t consist of lowercase English letters.\n\n \n\nFollow up: What if the inputs contain Unicode characters? How would you adapt your solution to such a case?",
      "examples": [
        {
          "input": {
            "s": "anagram",
            "t": "nagaram"
          },
          "output": true
        },
        {
          "input": {
            "s": "rat",
            "t": "car"
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string",
        "sorting"
      ],
      "starterCodePython": "class Solution:\n    def isAnagram(self, s: str, t: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isAnagram(string s, string t) {\n        \n    }\n};",
      "methodName": "isAnagram",
      "executionContract": {
        "name": "isAnagram",
        "params": [
          {
            "name": "s",
            "type": "string"
          },
          {
            "name": "t",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:27.228Z",
      "referenceSolutionHash": "sha256:ce2c8fd3d007d0f0605a654e8948de089707a64c0895747de2d8470dde4957a3",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "anagram",
            "t": "nagaram"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"anagram\"\n\"nagaram\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "rat",
            "t": "car"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"rat\"\n\"car\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 49,
      "slug": "group-anagrams",
      "title": "Group Anagrams",
      "difficulty": "Medium",
      "hot150Order": 43,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/group-anagrams/",
      "statementMarkdown": "Given an array of strings strs, group the anagrams together. You can return the answer in any order.\n\n \n\nExample 1:\n\nInput: strs = [\"eat\",\"tea\",\"tan\",\"ate\",\"nat\",\"bat\"]\n\nOutput: [[\"bat\"],[\"nat\",\"tan\"],[\"ate\",\"eat\",\"tea\"]]\n\nExplanation:\n\n\t- There is no string in strs that can be rearranged to form \"bat\".\n\n\t- The strings \"nat\" and \"tan\" are anagrams as they can be rearranged to form each other.\n\n\t- The strings \"ate\", \"eat\", and \"tea\" are anagrams as they can be rearranged to form each other.\n\nExample 2:\n\nInput: strs = [\"\"]\n\nOutput: [[\"\"]]\n\nExample 3:\n\nInput: strs = [\"a\"]\n\nOutput: [[\"a\"]]\n\n \n\nConstraints:\n\n\t- 1 <= strs.length <= 104\n\n\t- 0 <= strs[i].length <= 100\n\n\t- strs[i] consists of lowercase English letters.",
      "examples": [
        {
          "input": {
            "strs": [
              "eat",
              "tea",
              "tan",
              "ate",
              "nat",
              "bat"
            ]
          },
          "output": [
            [
              "eat",
              "tea",
              "ate"
            ],
            [
              "tan",
              "nat"
            ],
            [
              "bat"
            ]
          ]
        },
        {
          "input": {
            "strs": [
              ""
            ]
          },
          "output": [
            [
              ""
            ]
          ]
        },
        {
          "input": {
            "strs": [
              "a"
            ]
          },
          "output": [
            [
              "a"
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "string",
        "sorting"
      ],
      "starterCodePython": "class Solution:\n    def groupAnagrams(self, strs: List[str]) -> List[List[str]]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<vector<string>> groupAnagrams(vector<string>& strs) {\n        \n    }\n};",
      "methodName": "groupAnagrams",
      "executionContract": {
        "name": "groupAnagrams",
        "params": [
          {
            "name": "strs",
            "type": "string[]"
          }
        ],
        "returnType": "list<list<string>>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_deep",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:27.846Z",
      "referenceSolutionHash": "sha256:67cf6a60c6d835129afdd2a64bbe8129cf8a368afeb7c85262b7b791e2b75eca",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "strs": [
              "eat",
              "tea",
              "tan",
              "ate",
              "nat",
              "bat"
            ]
          },
          "expected": [
            [
              "eat",
              "tea",
              "ate"
            ],
            [
              "tan",
              "nat"
            ],
            [
              "bat"
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"eat\",\"tea\",\"tan\",\"ate\",\"nat\",\"bat\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "strs": [
              ""
            ]
          },
          "expected": [
            [
              ""
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[\"\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "strs": [
              "a"
            ]
          },
          "expected": [
            [
              "a"
            ]
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[\"a\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 1,
      "slug": "two-sum",
      "title": "Two Sum",
      "difficulty": "Easy",
      "hot150Order": 44,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/two-sum/",
      "statementMarkdown": "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\n\nYou may assume that each input would have exactly one solution, and you may not use the same element twice.\n\nYou can return the answer in any order.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [2,7,11,15], target = 9\nOutput: [0,1]\nExplanation: Because nums[0] + nums[1] == 9, we return [0, 1].\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [3,2,4], target = 6\nOutput: [1,2]\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [3,3], target = 6\nOutput: [0,1]\n\n```\n\n \n\nConstraints:\n\n\t- 2 <= nums.length <= 104\n\n\t- -109 <= nums[i] <= 109\n\n\t- -109 <= target <= 109\n\n\t- Only one valid answer exists.\n\n \n\nFollow-up: Can you come up with an algorithm that is less than O(n2) time complexity?",
      "examples": [
        {
          "input": {
            "nums": [
              2,
              7,
              11,
              15
            ],
            "target": 9
          },
          "output": [
            0,
            1
          ]
        },
        {
          "input": {
            "nums": [
              3,
              2,
              4
            ],
            "target": 6
          },
          "output": [
            1,
            2
          ]
        },
        {
          "input": {
            "nums": [
              3,
              3
            ],
            "target": 6
          },
          "output": [
            0,
            1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        \n    }\n};",
      "methodName": "twoSum",
      "executionContract": {
        "name": "twoSum",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          },
          {
            "name": "target",
            "type": "integer"
          }
        ],
        "returnType": "integer[]",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_top",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:28.197Z",
      "referenceSolutionHash": "sha256:924257ef1c6f472342b7b31f430191fa5687059dbc2c9d569da01ce8fdd8c6ad",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              2,
              7,
              11,
              15
            ],
            "target": 9
          },
          "expected": [
            0,
            1
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,7,11,15]\n9",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              3,
              2,
              4
            ],
            "target": 6
          },
          "expected": [
            1,
            2
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[3,2,4]\n6",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              3,
              3
            ],
            "target": 6
          },
          "expected": [
            0,
            1
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[3,3]\n6",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 202,
      "slug": "happy-number",
      "title": "Happy Number",
      "difficulty": "Easy",
      "hot150Order": 45,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/happy-number/",
      "statementMarkdown": "Write an algorithm to determine if a number n is happy.\n\nA happy number is a number defined by the following process:\n\n\t- Starting with any positive integer, replace the number by the sum of the squares of its digits.\n\n\t- Repeat the process until the number equals 1 (where it will stay), or it loops endlessly in a cycle which does not include 1.\n\n\t- Those numbers for which this process ends in 1 are happy.\n\nReturn true if n is a happy number, and false if not.\n\n \n\nExample 1:\n\n```text\n\nInput: n = 19\nOutput: true\nExplanation:\n12 + 92 = 82\n82 + 22 = 68\n62 + 82 = 100\n12 + 02 + 02 = 1\n\n```\n\nExample 2:\n\n```text\n\nInput: n = 2\nOutput: false\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= n <= 231 - 1",
      "examples": [
        {
          "input": {
            "n": 19
          },
          "output": true
        },
        {
          "input": {
            "n": 2
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "math",
        "two-pointers"
      ],
      "starterCodePython": "class Solution:\n    def isHappy(self, n: int) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isHappy(int n) {\n        \n    }\n};",
      "methodName": "isHappy",
      "executionContract": {
        "name": "isHappy",
        "params": [
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:28.556Z",
      "referenceSolutionHash": "sha256:b1f1cbb07ecf2f47fe0b02ceea70342cf4085ade9434360b745864c7cef2c1a0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "n": 19
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "19",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "n": 2
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 219,
      "slug": "contains-duplicate-ii",
      "title": "Contains Duplicate II",
      "difficulty": "Easy",
      "hot150Order": 46,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/contains-duplicate-ii/",
      "statementMarkdown": "Given an integer array nums and an integer k, return true if there are two distinct indices i and j in the array such that nums[i] == nums[j] and abs(i - j) <= k.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [1,2,3,1], k = 3\nOutput: true\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [1,0,1,1], k = 1\nOutput: true\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [1,2,3,1,2,3], k = 2\nOutput: false\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 105\n\n\t- -109 <= nums[i] <= 109\n\n\t- 0 <= k <= 105",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              2,
              3,
              1
            ],
            "k": 3
          },
          "output": true
        },
        {
          "input": {
            "nums": [
              1,
              0,
              1,
              1
            ],
            "k": 1
          },
          "output": true
        },
        {
          "input": {
            "nums": [
              1,
              2,
              3,
              1,
              2,
              3
            ],
            "k": 2
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "sliding-window"
      ],
      "starterCodePython": "class Solution:\n    def containsNearbyDuplicate(self, nums: List[int], k: int) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool containsNearbyDuplicate(vector<int>& nums, int k) {\n        \n    }\n};",
      "methodName": "containsNearbyDuplicate",
      "executionContract": {
        "name": "containsNearbyDuplicate",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          },
          {
            "name": "k",
            "type": "integer"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:29.027Z",
      "referenceSolutionHash": "sha256:4dc76bdf53469a3b2f0bc3d35ee1d04d7cc18f5f2b4e18b4d2a563601d5fc20e",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              2,
              3,
              1
            ],
            "k": 3
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,1]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              1,
              0,
              1,
              1
            ],
            "k": 1
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,0,1,1]\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              1,
              2,
              3,
              1,
              2,
              3
            ],
            "k": 2
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1,2,3,1,2,3]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 128,
      "slug": "longest-consecutive-sequence",
      "title": "Longest Consecutive Sequence",
      "difficulty": "Medium",
      "hot150Order": 47,
      "hot150Section": "Hashmap",
      "officialUrl": "https://leetcode.com/problems/longest-consecutive-sequence/",
      "statementMarkdown": "Given an unsorted array of integers nums, return the length of the longest consecutive elements sequence.\n\nYou must write an algorithm that runs in O(n) time.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [100,4,200,1,3,2]\nOutput: 4\nExplanation: The longest consecutive elements sequence is [1, 2, 3, 4]. Therefore its length is 4.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [0,3,7,2,5,8,4,6,0,1]\nOutput: 9\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [1,0,1,2]\nOutput: 3\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= nums.length <= 105\n\n\t- -109 <= nums[i] <= 109",
      "examples": [
        {
          "input": {
            "nums": [
              100,
              4,
              200,
              1,
              3,
              2
            ]
          },
          "output": 4
        },
        {
          "input": {
            "nums": [
              0,
              3,
              7,
              2,
              5,
              8,
              4,
              6,
              0,
              1
            ]
          },
          "output": 9
        },
        {
          "input": {
            "nums": [
              1,
              0,
              1,
              2
            ]
          },
          "output": 3
        }
      ],
      "constraints": [],
      "tags": [
        "hashmap",
        "hash-table",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "union-find"
      ],
      "starterCodePython": "class Solution:\n    def longestConsecutive(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int longestConsecutive(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "longestConsecutive",
      "executionContract": {
        "name": "longestConsecutive",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:29.471Z",
      "referenceSolutionHash": "sha256:205a4f395540afe04f97fbcebcfa3553aa244c54d49a1f2062f2a5baaa94ce3e",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              100,
              4,
              200,
              1,
              3,
              2
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[100,4,200,1,3,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              3,
              7,
              2,
              5,
              8,
              4,
              6,
              0,
              1
            ]
          },
          "expected": 9,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,3,7,2,5,8,4,6,0,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              1,
              0,
              1,
              2
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1,0,1,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 228,
      "slug": "summary-ranges",
      "title": "Summary Ranges",
      "difficulty": "Easy",
      "hot150Order": 48,
      "hot150Section": "Intervals",
      "officialUrl": "https://leetcode.com/problems/summary-ranges/",
      "statementMarkdown": "You are given a sorted unique integer array nums.\n\nA range [a,b] is the set of all integers from a to b (inclusive).\n\nReturn the smallest sorted list of ranges that cover all the numbers in the array exactly. That is, each element of nums is covered by exactly one of the ranges, and there is no integer x such that x is in one of the ranges but not in nums.\n\nEach range [a,b] in the list should be output as:\n\n\t- \"a->b\" if a != b\n\n\t- \"a\" if a == b\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [0,1,2,4,5,7]\nOutput: [\"0->2\",\"4->5\",\"7\"]\nExplanation: The ranges are:\n[0,2] --> \"0->2\"\n[4,5] --> \"4->5\"\n[7,7] --> \"7\"\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [0,2,3,4,6,8,9]\nOutput: [\"0\",\"2->4\",\"6\",\"8->9\"]\nExplanation: The ranges are:\n[0,0] --> \"0\"\n[2,4] --> \"2->4\"\n[6,6] --> \"6\"\n[8,9] --> \"8->9\"\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= nums.length <= 20\n\n\t- -231 <= nums[i] <= 231 - 1\n\n\t- All the values of nums are unique.\n\n\t- nums is sorted in ascending order.",
      "examples": [
        {
          "input": {
            "nums": [
              0,
              1,
              2,
              4,
              5,
              7
            ]
          },
          "output": [
            "0->2",
            "4->5",
            "7"
          ]
        },
        {
          "input": {
            "nums": [
              0,
              2,
              3,
              4,
              6,
              8,
              9
            ]
          },
          "output": [
            "0",
            "2->4",
            "6",
            "8->9"
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "intervals",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def summaryRanges(self, nums: List[int]) -> List[str]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<string> summaryRanges(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "summaryRanges",
      "executionContract": {
        "name": "summaryRanges",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "list<string>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:29.873Z",
      "referenceSolutionHash": "sha256:f3e08dc4733b881c58c26c53d8cc66ac8597506fca30eb7f7a0dabf72f371827",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              0,
              1,
              2,
              4,
              5,
              7
            ]
          },
          "expected": [
            "0->2",
            "4->5",
            "7"
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[0,1,2,4,5,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              2,
              3,
              4,
              6,
              8,
              9
            ]
          },
          "expected": [
            "0",
            "2->4",
            "6",
            "8->9"
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,2,3,4,6,8,9]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 56,
      "slug": "merge-intervals",
      "title": "Merge Intervals",
      "difficulty": "Medium",
      "hot150Order": 49,
      "hot150Section": "Intervals",
      "officialUrl": "https://leetcode.com/problems/merge-intervals/",
      "statementMarkdown": "Given an array of intervals where intervals[i] = [starti, endi], merge all overlapping intervals, and return an array of the non-overlapping intervals that cover all the intervals in the input.\n\n \n\nExample 1:\n\n```text\n\nInput: intervals = [[1,3],[2,6],[8,10],[15,18]]\nOutput: [[1,6],[8,10],[15,18]]\nExplanation: Since intervals [1,3] and [2,6] overlap, merge them into [1,6].\n\n```\n\nExample 2:\n\n```text\n\nInput: intervals = [[1,4],[4,5]]\nOutput: [[1,5]]\nExplanation: Intervals [1,4] and [4,5] are considered overlapping.\n\n```\n\nExample 3:\n\n```text\n\nInput: intervals = [[4,7],[1,4]]\nOutput: [[1,7]]\nExplanation: Intervals [1,4] and [4,7] are considered overlapping.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= intervals.length <= 104\n\n\t- intervals[i].length == 2\n\n\t- 0 <= starti <= endi <= 104",
      "examples": [
        {
          "input": {
            "intervals": [
              [
                1,
                3
              ],
              [
                2,
                6
              ],
              [
                8,
                10
              ],
              [
                15,
                18
              ]
            ]
          },
          "output": [
            [
              1,
              6
            ],
            [
              8,
              10
            ],
            [
              15,
              18
            ]
          ]
        },
        {
          "input": {
            "intervals": [
              [
                1,
                4
              ],
              [
                4,
                5
              ]
            ]
          },
          "output": [
            [
              1,
              5
            ]
          ]
        },
        {
          "input": {
            "intervals": [
              [
                4,
                7
              ],
              [
                1,
                4
              ]
            ]
          },
          "output": [
            [
              1,
              7
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "intervals",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "sorting"
      ],
      "starterCodePython": "class Solution:\n    def merge(self, intervals: List[List[int]]) -> List[List[int]]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<vector<int>> merge(vector<vector<int>>& intervals) {\n        \n    }\n};",
      "methodName": "merge",
      "executionContract": {
        "name": "merge",
        "params": [
          {
            "name": "intervals",
            "type": "integer[][]"
          }
        ],
        "returnType": "integer[][]",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:30.243Z",
      "referenceSolutionHash": "sha256:03ff8244dccdaecc8f1c9587b146aeb872ab0d8a12a86d536fc256ceab5a2acf",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "intervals": [
              [
                1,
                3
              ],
              [
                2,
                6
              ],
              [
                8,
                10
              ],
              [
                15,
                18
              ]
            ]
          },
          "expected": [
            [
              1,
              6
            ],
            [
              8,
              10
            ],
            [
              15,
              18
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,3],[2,6],[8,10],[15,18]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "intervals": [
              [
                1,
                4
              ],
              [
                4,
                5
              ]
            ]
          },
          "expected": [
            [
              1,
              5
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,4],[4,5]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "intervals": [
              [
                4,
                7
              ],
              [
                1,
                4
              ]
            ]
          },
          "expected": [
            [
              1,
              7
            ]
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[[4,7],[1,4]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 57,
      "slug": "insert-interval",
      "title": "Insert Interval",
      "difficulty": "Medium",
      "hot150Order": 50,
      "hot150Section": "Intervals",
      "officialUrl": "https://leetcode.com/problems/insert-interval/",
      "statementMarkdown": "You are given an array of non-overlapping intervals intervals where intervals[i] = [starti, endi] represent the start and the end of the ith interval and intervals is sorted in ascending order by starti. You are also given an interval newInterval = [start, end] that represents the start and end of another interval.\n\nInsert newInterval into intervals such that intervals is still sorted in ascending order by starti and intervals still does not have any overlapping intervals (merge overlapping intervals if necessary).\n\nReturn intervals after the insertion.\n\nNote that you don't need to modify intervals in-place. You can make a new array and return it.\n\n \n\nExample 1:\n\n```text\n\nInput: intervals = [[1,3],[6,9]], newInterval = [2,5]\nOutput: [[1,5],[6,9]]\n\n```\n\nExample 2:\n\n```text\n\nInput: intervals = [[1,2],[3,5],[6,7],[8,10],[12,16]], newInterval = [4,8]\nOutput: [[1,2],[3,10],[12,16]]\nExplanation: Because the new interval [4,8] overlaps with [3,5],[6,7],[8,10].\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= intervals.length <= 104\n\n\t- intervals[i].length == 2\n\n\t- 0 <= starti <= endi <= 105\n\n\t- intervals is sorted by starti in ascending order.\n\n\t- newInterval.length == 2\n\n\t- 0 <= start <= end <= 105",
      "examples": [
        {
          "input": {
            "intervals": [
              [
                1,
                3
              ],
              [
                6,
                9
              ]
            ],
            "newInterval": [
              2,
              5
            ]
          },
          "output": [
            [
              1,
              5
            ],
            [
              6,
              9
            ]
          ]
        },
        {
          "input": {
            "intervals": [
              [
                1,
                2
              ],
              [
                3,
                5
              ],
              [
                6,
                7
              ],
              [
                8,
                10
              ],
              [
                12,
                16
              ]
            ],
            "newInterval": [
              4,
              8
            ]
          },
          "output": [
            [
              1,
              2
            ],
            [
              3,
              10
            ],
            [
              12,
              16
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "intervals",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def insert(self, intervals: List[List[int]], newInterval: List[int]) -> List[List[int]]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<vector<int>> insert(vector<vector<int>>& intervals, vector<int>& newInterval) {\n        \n    }\n};",
      "methodName": "insert",
      "executionContract": {
        "name": "insert",
        "params": [
          {
            "name": "intervals",
            "type": "integer[][]"
          },
          {
            "name": "newInterval",
            "type": "integer[]"
          }
        ],
        "returnType": "integer[][]",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:30.640Z",
      "referenceSolutionHash": "sha256:98afadf0496f7777b8074ca0eaea2a4b429ea7b88679b883dd6e338022757ffa",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "intervals": [
              [
                1,
                3
              ],
              [
                6,
                9
              ]
            ],
            "newInterval": [
              2,
              5
            ]
          },
          "expected": [
            [
              1,
              5
            ],
            [
              6,
              9
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,3],[6,9]]\n[2,5]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "intervals": [
              [
                1,
                2
              ],
              [
                3,
                5
              ],
              [
                6,
                7
              ],
              [
                8,
                10
              ],
              [
                12,
                16
              ]
            ],
            "newInterval": [
              4,
              8
            ]
          },
          "expected": [
            [
              1,
              2
            ],
            [
              3,
              10
            ],
            [
              12,
              16
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,2],[3,5],[6,7],[8,10],[12,16]]\n[4,8]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 452,
      "slug": "minimum-number-of-arrows-to-burst-balloons",
      "title": "Minimum Number of Arrows to Burst Balloons",
      "difficulty": "Medium",
      "hot150Order": 51,
      "hot150Section": "Intervals",
      "officialUrl": "https://leetcode.com/problems/minimum-number-of-arrows-to-burst-balloons/",
      "statementMarkdown": "There are some spherical balloons taped onto a flat wall that represents the XY-plane. The balloons are represented as a 2D integer array points where points[i] = [xstart, xend] denotes a balloon whose horizontal diameter stretches between xstart and xend. You do not know the exact y-coordinates of the balloons.\n\nArrows can be shot up directly vertically (in the positive y-direction) from different points along the x-axis. A balloon with xstart and xend is burst by an arrow shot at x if xstart <= x <= xend. There is no limit to the number of arrows that can be shot. A shot arrow keeps traveling up infinitely, bursting any balloons in its path.\n\nGiven the array points, return the minimum number of arrows that must be shot to burst all balloons.\n\n \n\nExample 1:\n\n```text\n\nInput: points = [[10,16],[2,8],[1,6],[7,12]]\nOutput: 2\nExplanation: The balloons can be burst by 2 arrows:\n- Shoot an arrow at x = 6, bursting the balloons [2,8] and [1,6].\n- Shoot an arrow at x = 11, bursting the balloons [10,16] and [7,12].\n\n```\n\nExample 2:\n\n```text\n\nInput: points = [[1,2],[3,4],[5,6],[7,8]]\nOutput: 4\nExplanation: One arrow needs to be shot for each balloon for a total of 4 arrows.\n\n```\n\nExample 3:\n\n```text\n\nInput: points = [[1,2],[2,3],[3,4],[4,5]]\nOutput: 2\nExplanation: The balloons can be burst by 2 arrows:\n- Shoot an arrow at x = 2, bursting the balloons [1,2] and [2,3].\n- Shoot an arrow at x = 4, bursting the balloons [3,4] and [4,5].\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= points.length <= 105\n\n\t- points[i].length == 2\n\n\t- -231 <= xstart < xend <= 231 - 1",
      "examples": [
        {
          "input": {
            "points": [
              [
                10,
                16
              ],
              [
                2,
                8
              ],
              [
                1,
                6
              ],
              [
                7,
                12
              ]
            ]
          },
          "output": 2
        },
        {
          "input": {
            "points": [
              [
                1,
                2
              ],
              [
                3,
                4
              ],
              [
                5,
                6
              ],
              [
                7,
                8
              ]
            ]
          },
          "output": 4
        },
        {
          "input": {
            "points": [
              [
                1,
                2
              ],
              [
                2,
                3
              ],
              [
                3,
                4
              ],
              [
                4,
                5
              ]
            ]
          },
          "output": 2
        }
      ],
      "constraints": [],
      "tags": [
        "intervals",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "greedy",
        "sorting"
      ],
      "starterCodePython": "class Solution:\n    def findMinArrowShots(self, points: List[List[int]]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int findMinArrowShots(vector<vector<int>>& points) {\n        \n    }\n};",
      "methodName": "findMinArrowShots",
      "executionContract": {
        "name": "findMinArrowShots",
        "params": [
          {
            "name": "points",
            "type": "integer[][]"
          }
        ],
        "returnType": "integer",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:31.061Z",
      "referenceSolutionHash": "sha256:608e0c3622202dbfe3d4dc3972182c6a9048e5c191feb1c8524196910e0f7a4e",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "points": [
              [
                10,
                16
              ],
              [
                2,
                8
              ],
              [
                1,
                6
              ],
              [
                7,
                12
              ]
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[10,16],[2,8],[1,6],[7,12]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "points": [
              [
                1,
                2
              ],
              [
                3,
                4
              ],
              [
                5,
                6
              ],
              [
                7,
                8
              ]
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,2],[3,4],[5,6],[7,8]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "points": [
              [
                1,
                2
              ],
              [
                2,
                3
              ],
              [
                3,
                4
              ],
              [
                4,
                5
              ]
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[[1,2],[2,3],[3,4],[4,5]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 20,
      "slug": "valid-parentheses",
      "title": "Valid Parentheses",
      "difficulty": "Easy",
      "hot150Order": 52,
      "hot150Section": "Stack",
      "officialUrl": "https://leetcode.com/problems/valid-parentheses/",
      "statementMarkdown": "Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.\n\nAn input string is valid if:\n\n\t- Open brackets must be closed by the same type of brackets.\n\n\t- Open brackets must be closed in the correct order.\n\n\t- Every close bracket has a corresponding open bracket of the same type.\n\n \n\nExample 1:\n\nInput: s = \"()\"\n\nOutput: true\n\nExample 2:\n\nInput: s = \"()[]{}\"\n\nOutput: true\n\nExample 3:\n\nInput: s = \"(]\"\n\nOutput: false\n\nExample 4:\n\nInput: s = \"([])\"\n\nOutput: true\n\nExample 5:\n\nInput: s = \"([)]\"\n\nOutput: false\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 104\n\n\t- s consists of parentheses only '()[]{}'.",
      "examples": [
        {
          "input": {
            "s": "()"
          },
          "output": true
        },
        {
          "input": {
            "s": "()[]{}"
          },
          "output": true
        },
        {
          "input": {
            "s": "(]"
          },
          "output": false
        },
        {
          "input": {
            "s": "([])"
          },
          "output": true
        },
        {
          "input": {
            "s": "([)]"
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "stack",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def isValid(self, s: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isValid(string s) {\n        \n    }\n};",
      "methodName": "isValid",
      "executionContract": {
        "name": "isValid",
        "params": [
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:31.569Z",
      "referenceSolutionHash": "sha256:c481f7f54d6c2297ca582c6149b56d9bf305727e6ba06f940235219de491a299",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "()"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"()\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "()[]{}"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"()[]{}\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "(]"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"(]\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 4",
          "input": {
            "s": "([])"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 3,
          "metadata": {
            "dataInput": "\"([])\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 5",
          "input": {
            "s": "([)]"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 4,
          "metadata": {
            "dataInput": "\"([)]\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 71,
      "slug": "simplify-path",
      "title": "Simplify Path",
      "difficulty": "Medium",
      "hot150Order": 53,
      "hot150Section": "Stack",
      "officialUrl": "https://leetcode.com/problems/simplify-path/",
      "statementMarkdown": "You are given an absolute path for a Unix-style file system, which always begins with a slash '/'. Your task is to transform this absolute path into its simplified canonical path.\n\nThe rules of a Unix-style file system are as follows:\n\n\t- A single period '.' represents the current directory.\n\n\t- A double period '..' represents the previous/parent directory.\n\n\t- Multiple consecutive slashes such as '//' and '///' are treated as a single slash '/'.\n\n\t- Any sequence of periods that does not match the rules above should be treated as a valid directory or file name. For example, '...' and '....' are valid directory or file names.\n\nThe simplified canonical path should follow these rules:\n\n\t- The path must start with a single slash '/'.\n\n\t- Directories within the path must be separated by exactly one slash '/'.\n\n\t- The path must not end with a slash '/', unless it is the root directory.\n\n\t- The path must not have any single or double periods ('.' and '..') used to denote current or parent directories.\n\nReturn the simplified canonical path.\n\n \n\nExample 1:\n\nInput: path = \"/home/\"\n\nOutput: \"/home\"\n\nExplanation:\n\nThe trailing slash should be removed.\n\nExample 2:\n\nInput: path = \"/home//foo/\"\n\nOutput: \"/home/foo\"\n\nExplanation:\n\nMultiple consecutive slashes are replaced by a single one.\n\nExample 3:\n\nInput: path = \"/home/user/Documents/../Pictures\"\n\nOutput: \"/home/user/Pictures\"\n\nExplanation:\n\nA double period \"..\" refers to the directory up a level (the parent directory).\n\nExample 4:\n\nInput: path = \"/../\"\n\nOutput: \"/\"\n\nExplanation:\n\nGoing one level up from the root directory is not possible.\n\nExample 5:\n\nInput: path = \"/.../a/../b/c/../d/./\"\n\nOutput: \"/.../b/d\"\n\nExplanation:\n\n\"...\" is a valid name for a directory in this problem.\n\n \n\nConstraints:\n\n\t- 1 <= path.length <= 3000\n\n\t- path consists of English letters, digits, period '.', slash '/' or '_'.\n\n\t- path is a valid absolute Unix path.",
      "examples": [
        {
          "input": {
            "path": "/home/"
          },
          "output": "/home"
        },
        {
          "input": {
            "path": "/home//foo/"
          },
          "output": "/home/foo"
        },
        {
          "input": {
            "path": "/home/user/Documents/../Pictures"
          },
          "output": "/home/user/Pictures"
        },
        {
          "input": {
            "path": "/../"
          },
          "output": "/"
        },
        {
          "input": {
            "path": "/.../a/../b/c/../d/./"
          },
          "output": "/.../b/d"
        }
      ],
      "constraints": [],
      "tags": [
        "stack",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def simplifyPath(self, path: str) -> str:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    string simplifyPath(string path) {\n        \n    }\n};",
      "methodName": "simplifyPath",
      "executionContract": {
        "name": "simplifyPath",
        "params": [
          {
            "name": "path",
            "type": "string"
          }
        ],
        "returnType": "string",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:32.006Z",
      "referenceSolutionHash": "sha256:05d8de36f811f238c6896f90b7439094931f41471ce383ef28a772e2c30456c3",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "path": "/home/"
          },
          "expected": "/home",
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"/home/\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "path": "/home//foo/"
          },
          "expected": "/home/foo",
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"/home//foo/\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "path": "/home/user/Documents/../Pictures"
          },
          "expected": "/home/user/Pictures",
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"/home/user/Documents/../Pictures\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 4",
          "input": {
            "path": "/../"
          },
          "expected": "/",
          "source": "local_sample",
          "sortOrder": 3,
          "metadata": {
            "dataInput": "\"/../\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 5",
          "input": {
            "path": "/.../a/../b/c/../d/./"
          },
          "expected": "/.../b/d",
          "source": "local_sample",
          "sortOrder": 4,
          "metadata": {
            "dataInput": "\"/.../a/../b/c/../d/./\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 155,
      "slug": "min-stack",
      "title": "Min Stack",
      "difficulty": "Medium",
      "hot150Order": 54,
      "hot150Section": "Stack",
      "officialUrl": "https://leetcode.com/problems/min-stack/",
      "statementMarkdown": "Design a stack that supports push, pop, top, and retrieving the minimum element in constant time.\n\nImplement the MinStack class:\n\n\t- MinStack() initializes the stack object.\n\n\t- void push(int value) pushes the element value onto the stack.\n\n\t- void pop() removes the element on the top of the stack.\n\n\t- int top() gets the top element of the stack.\n\n\t- int getMin() retrieves the minimum element in the stack.\n\nYou must implement a solution with O(1) time complexity for each function.\n\n \n\nExample 1:\n\n```text\n\nInput\n[\"MinStack\",\"push\",\"push\",\"push\",\"getMin\",\"pop\",\"top\",\"getMin\"]\n[[],[-2],[0],[-3],[],[],[],[]]\n\nOutput\n[null,null,null,null,-3,null,0,-2]\n\nExplanation\nMinStack minStack = new MinStack();\nminStack.push(-2);\nminStack.push(0);\nminStack.push(-3);\nminStack.getMin(); // return -3\nminStack.pop();\nminStack.top();    // return 0\nminStack.getMin(); // return -2\n\n```\n\n \n\nConstraints:\n\n\t- -231 <= val <= 231 - 1\n\n\t- Methods pop, top and getMin operations will always be called on non-empty stacks.\n\n\t- At most 3 * 104 calls will be made to push, pop, top, and getMin.",
      "examples": [
        {
          "input": {
            "operations": [
              "MinStack",
              "push",
              "push",
              "push",
              "getMin",
              "pop",
              "top",
              "getMin"
            ],
            "arguments": [
              [],
              [
                -2
              ],
              [
                0
              ],
              [
                -3
              ],
              [],
              [],
              [],
              []
            ]
          },
          "output": [
            null,
            null,
            null,
            null,
            -3,
            null,
            0,
            -2
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "stack",
        "top-interview-150",
        "interview-150",
        "hot150",
        "design"
      ],
      "starterCodePython": "class MinStack:\n\n    def __init__(self):\n        \n\n    def push(self, value: int) -> None:\n        \n\n    def pop(self) -> None:\n        \n\n    def top(self) -> int:\n        \n\n    def getMin(self) -> int:\n        \n\n\n# Your MinStack object will be instantiated and called as such:\n# obj = MinStack()\n# obj.push(value)\n# obj.pop()\n# param_3 = obj.top()\n# param_4 = obj.getMin()",
      "starterCodeCpp": "class MinStack {\npublic:\n    MinStack() {\n        \n    }\n    \n    void push(int value) {\n        \n    }\n    \n    void pop() {\n        \n    }\n    \n    int top() {\n        \n    }\n    \n    int getMin() {\n        \n    }\n};\n\n/**\n * Your MinStack object will be instantiated and called as such:\n * MinStack* obj = new MinStack();\n * obj->push(value);\n * obj->pop();\n * int param_3 = obj->top();\n * int param_4 = obj->getMin();\n */",
      "methodName": "MinStack",
      "executionContract": {
        "name": "MinStack",
        "params": [],
        "returnType": "unknown",
        "contractKind": "design_class"
      },
      "comparisonStrategy": "op_sequence",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:32.469Z",
      "referenceSolutionHash": "sha256:223e3da5caf94d686b2d023306f56dae073ba78f4920002618fe817969f47454",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "operations": [
              "MinStack",
              "push",
              "push",
              "push",
              "getMin",
              "pop",
              "top",
              "getMin"
            ],
            "arguments": [
              [],
              [
                -2
              ],
              [
                0
              ],
              [
                -3
              ],
              [],
              [],
              [],
              []
            ]
          },
          "expected": [
            null,
            null,
            null,
            null,
            -3,
            null,
            0,
            -2
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"MinStack\",\"push\",\"push\",\"push\",\"getMin\",\"pop\",\"top\",\"getMin\"]\n[[],[-2],[0],[-3],[],[],[],[]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 150,
      "slug": "evaluate-reverse-polish-notation",
      "title": "Evaluate Reverse Polish Notation",
      "difficulty": "Medium",
      "hot150Order": 55,
      "hot150Section": "Stack",
      "officialUrl": "https://leetcode.com/problems/evaluate-reverse-polish-notation/",
      "statementMarkdown": "You are given an array of strings tokens that represents an arithmetic expression in a Reverse Polish Notation.\n\nEvaluate the expression. Return an integer that represents the value of the expression.\n\nNote that:\n\n\t- The valid operators are '+', '-', '*', and '/'.\n\n\t- Each operand may be an integer or another expression.\n\n\t- The division between two integers always truncates toward zero.\n\n\t- There will not be any division by zero.\n\n\t- The input represents a valid arithmetic expression in a reverse polish notation.\n\n\t- The answer and all the intermediate calculations can be represented in a 32-bit integer.\n\n \n\nExample 1:\n\n```text\n\nInput: tokens = [\"2\",\"1\",\"+\",\"3\",\"*\"]\nOutput: 9\nExplanation: ((2 + 1) * 3) = 9\n\n```\n\nExample 2:\n\n```text\n\nInput: tokens = [\"4\",\"13\",\"5\",\"/\",\"+\"]\nOutput: 6\nExplanation: (4 + (13 / 5)) = 6\n\n```\n\nExample 3:\n\n```text\n\nInput: tokens = [\"10\",\"6\",\"9\",\"3\",\"+\",\"-11\",\"*\",\"/\",\"*\",\"17\",\"+\",\"5\",\"+\"]\nOutput: 22\nExplanation: ((10 * (6 / ((9 + 3) * -11))) + 17) + 5\n= ((10 * (6 / (12 * -11))) + 17) + 5\n= ((10 * (6 / -132)) + 17) + 5\n= ((10 * 0) + 17) + 5\n= (0 + 17) + 5\n= 17 + 5\n= 22\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= tokens.length <= 104\n\n\t- tokens[i] is either an operator: \"+\", \"-\", \"*\", or \"/\", or an integer in the range [-200, 200].",
      "examples": [
        {
          "input": {
            "tokens": [
              "2",
              "1",
              "+",
              "3",
              "*"
            ]
          },
          "output": 9
        },
        {
          "input": {
            "tokens": [
              "4",
              "13",
              "5",
              "/",
              "+"
            ]
          },
          "output": 6
        },
        {
          "input": {
            "tokens": [
              "10",
              "6",
              "9",
              "3",
              "+",
              "-11",
              "*",
              "/",
              "*",
              "17",
              "+",
              "5",
              "+"
            ]
          },
          "output": 22
        }
      ],
      "constraints": [],
      "tags": [
        "stack",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "math"
      ],
      "starterCodePython": "class Solution:\n    def evalRPN(self, tokens: List[str]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int evalRPN(vector<string>& tokens) {\n        \n    }\n};",
      "methodName": "evalRPN",
      "executionContract": {
        "name": "evalRPN",
        "params": [
          {
            "name": "tokens",
            "type": "string[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:32.982Z",
      "referenceSolutionHash": "sha256:b7ed65d51e739fb85915cc15032d1ca7f5ba26e32257346e40061ffc358f1ae8",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "tokens": [
              "2",
              "1",
              "+",
              "3",
              "*"
            ]
          },
          "expected": 9,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"2\",\"1\",\"+\",\"3\",\"*\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "tokens": [
              "4",
              "13",
              "5",
              "/",
              "+"
            ]
          },
          "expected": 6,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[\"4\",\"13\",\"5\",\"/\",\"+\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "tokens": [
              "10",
              "6",
              "9",
              "3",
              "+",
              "-11",
              "*",
              "/",
              "*",
              "17",
              "+",
              "5",
              "+"
            ]
          },
          "expected": 22,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[\"10\",\"6\",\"9\",\"3\",\"+\",\"-11\",\"*\",\"/\",\"*\",\"17\",\"+\",\"5\",\"+\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 224,
      "slug": "basic-calculator",
      "title": "Basic Calculator",
      "difficulty": "Hard",
      "hot150Order": 56,
      "hot150Section": "Stack",
      "officialUrl": "https://leetcode.com/problems/basic-calculator/",
      "statementMarkdown": "Given a string s representing a valid expression, implement a basic calculator to evaluate it, and return the result of the evaluation.\n\nNote: You are not allowed to use any built-in function which evaluates strings as mathematical expressions, such as eval().\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"1 + 1\"\nOutput: 2\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \" 2-1 + 2 \"\nOutput: 3\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \"(1+(4+5+2)-3)+(6+8)\"\nOutput: 23\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 3 * 105\n\n\t- s consists of digits, '+', '-', '(', ')', and ' '.\n\n\t- s represents a valid expression.\n\n\t- '+' is not used as a unary operation (i.e., \"+1\" and \"+(2 + 3)\" is invalid).\n\n\t- '-' could be used as a unary operation (i.e., \"-1\" and \"-(2 + 3)\" is valid).\n\n\t- There will be no two consecutive operators in the input.\n\n\t- Every number and running calculation will fit in a signed 32-bit integer.",
      "examples": [
        {
          "input": {
            "s": "1 + 1"
          },
          "output": 2
        },
        {
          "input": {
            "s": " 2-1 + 2 "
          },
          "output": 3
        },
        {
          "input": {
            "s": "(1+(4+5+2)-3)+(6+8)"
          },
          "output": 23
        }
      ],
      "constraints": [],
      "tags": [
        "stack",
        "top-interview-150",
        "interview-150",
        "hot150",
        "math",
        "string",
        "recursion"
      ],
      "starterCodePython": "class Solution:\n    def calculate(self, s: str) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int calculate(string s) {\n        \n    }\n};",
      "methodName": "calculate",
      "executionContract": {
        "name": "calculate",
        "params": [
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:33.399Z",
      "referenceSolutionHash": "sha256:7ef355489f8d0491f8184964f6dbcd1eca20c2838ee309e9d96b7b08714236a5",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "1 + 1"
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"1 + 1\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": " 2-1 + 2 "
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\" 2-1 + 2 \"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "(1+(4+5+2)-3)+(6+8)"
          },
          "expected": 23,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"(1+(4+5+2)-3)+(6+8)\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 141,
      "slug": "linked-list-cycle",
      "title": "Linked List Cycle",
      "difficulty": "Easy",
      "hot150Order": 57,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/linked-list-cycle/",
      "statementMarkdown": "Given head, the head of a linked list, determine if the linked list has a cycle in it.\n\nThere is a cycle in a linked list if there is some node in the list that can be reached again by continuously following the next pointer. Internally, pos is used to denote the index of the node that tail's next pointer is connected to. Note that pos is not passed as a parameter.\n\nReturn true if there is a cycle in the linked list. Otherwise, return false.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [3,2,0,-4], pos = 1\nOutput: true\nExplanation: There is a cycle in the linked list, where the tail connects to the 1st node (0-indexed).\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [1,2], pos = 0\nOutput: true\nExplanation: There is a cycle in the linked list, where the tail connects to the 0th node.\n\n```\n\nExample 3:\n\n```text\n\nInput: head = [1], pos = -1\nOutput: false\nExplanation: There is no cycle in the linked list.\n\n```\n\n \n\nConstraints:\n\n\t- The number of the nodes in the list is in the range [0, 104].\n\n\t- -105 <= Node.val <= 105\n\n\t- pos is -1 or a valid index in the linked-list.\n\n \n\nFollow up: Can you solve it using O(1) (i.e. constant) memory?",
      "examples": [
        {
          "input": {
            "head": [
              3,
              2,
              0,
              -4
            ],
            "pos": 1
          },
          "output": true
        },
        {
          "input": {
            "head": [
              1,
              2
            ],
            "pos": 0
          },
          "output": true
        },
        {
          "input": {
            "head": [
              1
            ],
            "pos": -1
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "two-pointers"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, x):\n#         self.val = x\n#         self.next = None\n\nclass Solution:\n    def hasCycle(self, head: Optional[ListNode]) -> bool:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode(int x) : val(x), next(NULL) {}\n * };\n */\nclass Solution {\npublic:\n    bool hasCycle(ListNode *head) {\n        \n    }\n};",
      "methodName": "hasCycle",
      "executionContract": {
        "name": "hasCycle",
        "params": [
          {
            "name": "head",
            "type": "ListNode"
          },
          {
            "name": "pos",
            "type": "integer"
          }
        ],
        "returnType": "boolean",
        "contractKind": "linked_list",
        "inputAdapter": "linked_list_with_cycle"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:33.807Z",
      "referenceSolutionHash": "sha256:05bfda1038ca3524704173742ab9c0f99b88e785060652c234ec2e3d13e551ca",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              3,
              2,
              0,
              -4
            ],
            "pos": 1
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,2,0,-4]\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              1,
              2
            ],
            "pos": 0
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2]\n0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "head": [
              1
            ],
            "pos": -1
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1]\n-1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 2,
      "slug": "add-two-numbers",
      "title": "Add Two Numbers",
      "difficulty": "Medium",
      "hot150Order": 58,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/add-two-numbers/",
      "statementMarkdown": "You are given two non-empty linked lists representing two non-negative integers. The digits are stored in reverse order, and each of their nodes contains a single digit. Add the two numbers and return the sum as a linked list.\n\nYou may assume the two numbers do not contain any leading zero, except the number 0 itself.\n\n \n\nExample 1:\n\n```text\n\nInput: l1 = [2,4,3], l2 = [5,6,4]\nOutput: [7,0,8]\nExplanation: 342 + 465 = 807.\n\n```\n\nExample 2:\n\n```text\n\nInput: l1 = [0], l2 = [0]\nOutput: [0]\n\n```\n\nExample 3:\n\n```text\n\nInput: l1 = [9,9,9,9,9,9,9], l2 = [9,9,9,9]\nOutput: [8,9,9,9,0,0,0,1]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in each linked list is in the range [1, 100].\n\n\t- 0 <= Node.val <= 9\n\n\t- It is guaranteed that the list represents a number that does not have leading zeros.",
      "examples": [
        {
          "input": {
            "l1": [
              2,
              4,
              3
            ],
            "l2": [
              5,
              6,
              4
            ]
          },
          "output": [
            7,
            0,
            8
          ]
        },
        {
          "input": {
            "l1": [
              0
            ],
            "l2": [
              0
            ]
          },
          "output": [
            0
          ]
        },
        {
          "input": {
            "l1": [
              9,
              9,
              9,
              9,
              9,
              9,
              9
            ],
            "l2": [
              9,
              9,
              9,
              9
            ]
          },
          "output": [
            8,
            9,
            9,
            9,
            0,
            0,
            0,
            1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "math",
        "recursion"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def addTwoNumbers(self, l1: Optional[ListNode], l2: Optional[ListNode]) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* addTwoNumbers(ListNode* l1, ListNode* l2) {\n        \n    }\n};",
      "methodName": "addTwoNumbers",
      "executionContract": {
        "name": "addTwoNumbers",
        "params": [
          {
            "name": "l1",
            "type": "ListNode"
          },
          {
            "name": "l2",
            "type": "ListNode"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:34.186Z",
      "referenceSolutionHash": "sha256:7b744d9344af843e548bdc586bb2c14f8636291cfb939b3088d20abbe81e64af",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "l1": [
              2,
              4,
              3
            ],
            "l2": [
              5,
              6,
              4
            ]
          },
          "expected": [
            7,
            0,
            8
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,4,3]\n[5,6,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "l1": [
              0
            ],
            "l2": [
              0
            ]
          },
          "expected": [
            0
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0]\n[0]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "l1": [
              9,
              9,
              9,
              9,
              9,
              9,
              9
            ],
            "l2": [
              9,
              9,
              9,
              9
            ]
          },
          "expected": [
            8,
            9,
            9,
            9,
            0,
            0,
            0,
            1
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[9,9,9,9,9,9,9]\n[9,9,9,9]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 21,
      "slug": "merge-two-sorted-lists",
      "title": "Merge Two Sorted Lists",
      "difficulty": "Easy",
      "hot150Order": 59,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/merge-two-sorted-lists/",
      "statementMarkdown": "You are given the heads of two sorted linked lists list1 and list2.\n\nMerge the two lists into one sorted list. The list should be made by splicing together the nodes of the first two lists.\n\nReturn the head of the merged linked list.\n\n \n\nExample 1:\n\n```text\n\nInput: list1 = [1,2,4], list2 = [1,3,4]\nOutput: [1,1,2,3,4,4]\n\n```\n\nExample 2:\n\n```text\n\nInput: list1 = [], list2 = []\nOutput: []\n\n```\n\nExample 3:\n\n```text\n\nInput: list1 = [], list2 = [0]\nOutput: [0]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in both lists is in the range [0, 50].\n\n\t- -100 <= Node.val <= 100\n\n\t- Both list1 and list2 are sorted in non-decreasing order.",
      "examples": [
        {
          "input": {
            "list1": [
              1,
              2,
              4
            ],
            "list2": [
              1,
              3,
              4
            ]
          },
          "output": [
            1,
            1,
            2,
            3,
            4,
            4
          ]
        },
        {
          "input": {
            "list1": [],
            "list2": []
          },
          "output": null
        },
        {
          "input": {
            "list1": [],
            "list2": [
              0
            ]
          },
          "output": [
            0
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "recursion"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def mergeTwoLists(self, list1: Optional[ListNode], list2: Optional[ListNode]) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* mergeTwoLists(ListNode* list1, ListNode* list2) {\n        \n    }\n};",
      "methodName": "mergeTwoLists",
      "executionContract": {
        "name": "mergeTwoLists",
        "params": [
          {
            "name": "list1",
            "type": "ListNode"
          },
          {
            "name": "list2",
            "type": "ListNode"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:34.747Z",
      "referenceSolutionHash": "sha256:6d3879c2d03ec4649641dd130b1b53ee5cb7aa773c20664c10f709147d38c420",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "list1": [
              1,
              2,
              4
            ],
            "list2": [
              1,
              3,
              4
            ]
          },
          "expected": [
            1,
            1,
            2,
            3,
            4,
            4
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,4]\n[1,3,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "list1": [],
            "list2": []
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[]\n[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "list1": [],
            "list2": [
              0
            ]
          },
          "expected": [
            0
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[]\n[0]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 138,
      "slug": "copy-list-with-random-pointer",
      "title": "Copy List with Random Pointer",
      "difficulty": "Medium",
      "hot150Order": 60,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/copy-list-with-random-pointer/",
      "statementMarkdown": "A linked list of length n is given such that each node contains an additional random pointer, which could point to any node in the list, or null.\n\nConstruct a deep copy of the list. The deep copy should consist of exactly n brand new nodes, where each new node has its value set to the value of its corresponding original node. Both the next and random pointer of the new nodes should point to new nodes in the copied list such that the pointers in the original list and copied list represent the same list state. None of the pointers in the new list should point to nodes in the original list.\n\nFor example, if there are two nodes X and Y in the original list, where X.random --> Y, then for the corresponding two nodes x and y in the copied list, x.random --> y.\n\nReturn the head of the copied linked list.\n\nThe linked list is represented in the input/output as a list of n nodes. Each node is represented as a pair of [val, random_index] where:\n\n\t- val: an integer representing Node.val\n\n\t- random_index: the index of the node (range from 0 to n-1) that the random pointer points to, or null if it does not point to any node.\n\nYour code will only be given the head of the original linked list.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [[7,null],[13,0],[11,4],[10,2],[1,0]]\nOutput: [[7,null],[13,0],[11,4],[10,2],[1,0]]\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [[1,1],[2,1]]\nOutput: [[1,1],[2,1]]\n\n```\n\nExample 3:\n\n```text\n\nInput: head = [[3,null],[3,0],[3,null]]\nOutput: [[3,null],[3,0],[3,null]]\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= n <= 1000\n\n\t- -104 <= Node.val <= 104\n\n\t- Node.random is null or is pointing to some node in the linked list.",
      "examples": [
        {
          "input": {
            "head": [
              [
                7,
                null
              ],
              [
                13,
                0
              ],
              [
                11,
                4
              ],
              [
                10,
                2
              ],
              [
                1,
                0
              ]
            ]
          },
          "output": [
            [
              7,
              null
            ],
            [
              13,
              0
            ],
            [
              11,
              4
            ],
            [
              10,
              2
            ],
            [
              1,
              0
            ]
          ]
        },
        {
          "input": {
            "head": [
              [
                1,
                1
              ],
              [
                2,
                1
              ]
            ]
          },
          "output": [
            [
              1,
              1
            ],
            [
              2,
              1
            ]
          ]
        },
        {
          "input": {
            "head": [
              [
                3,
                null
              ],
              [
                3,
                0
              ],
              [
                3,
                null
              ]
            ]
          },
          "output": [
            [
              3,
              null
            ],
            [
              3,
              0
            ],
            [
              3,
              null
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table"
      ],
      "starterCodePython": "\"\"\"\n# Definition for a Node.\nclass Node:\n    def __init__(self, x: int, next: 'Node' = None, random: 'Node' = None):\n        self.val = int(x)\n        self.next = next\n        self.random = random\n\"\"\"\n\nclass Solution:\n    def copyRandomList(self, head: 'Optional[Node]') -> 'Optional[Node]':\n        ",
      "starterCodeCpp": "/*\n// Definition for a Node.\nclass Node {\npublic:\n    int val;\n    Node* next;\n    Node* random;\n    \n    Node(int _val) {\n        val = _val;\n        next = NULL;\n        random = NULL;\n    }\n};\n*/\n\nclass Solution {\npublic:\n    Node* copyRandomList(Node* head) {\n        \n    }\n};",
      "methodName": "copyRandomList",
      "executionContract": {
        "name": "copyRandomList",
        "params": [
          {
            "name": "head",
            "type": "Node"
          }
        ],
        "returnType": "Node",
        "contractKind": "linked_list",
        "inputAdapter": "node_random_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:35.215Z",
      "referenceSolutionHash": "sha256:8eb343a104681b349b38f4d49888e2630a80f9867b528ded49fb2e07b4c25e57",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              [
                7,
                null
              ],
              [
                13,
                0
              ],
              [
                11,
                4
              ],
              [
                10,
                2
              ],
              [
                1,
                0
              ]
            ]
          },
          "expected": [
            [
              7,
              null
            ],
            [
              13,
              0
            ],
            [
              11,
              4
            ],
            [
              10,
              2
            ],
            [
              1,
              0
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[7,null],[13,0],[11,4],[10,2],[1,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              [
                1,
                1
              ],
              [
                2,
                1
              ]
            ]
          },
          "expected": [
            [
              1,
              1
            ],
            [
              2,
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,1],[2,1]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "head": [
              [
                3,
                null
              ],
              [
                3,
                0
              ],
              [
                3,
                null
              ]
            ]
          },
          "expected": [
            [
              3,
              null
            ],
            [
              3,
              0
            ],
            [
              3,
              null
            ]
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[[3,null],[3,0],[3,null]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 92,
      "slug": "reverse-linked-list-ii",
      "title": "Reverse Linked List II",
      "difficulty": "Medium",
      "hot150Order": 61,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/reverse-linked-list-ii/",
      "statementMarkdown": "Given the head of a singly linked list and two integers left and right where left <= right, reverse the nodes of the list from position left to position right, and return the reversed list.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [1,2,3,4,5], left = 2, right = 4\nOutput: [1,4,3,2,5]\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [5], left = 1, right = 1\nOutput: [5]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the list is n.\n\n\t- 1 <= n <= 500\n\n\t- -500 <= Node.val <= 500\n\n\t- 1 <= left <= right <= n\n\n \n\nFollow up: Could you do it in one pass?",
      "examples": [
        {
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "left": 2,
            "right": 4
          },
          "output": [
            1,
            4,
            3,
            2,
            5
          ]
        },
        {
          "input": {
            "head": [
              5
            ],
            "left": 1,
            "right": 1
          },
          "output": [
            5
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def reverseBetween(self, head: Optional[ListNode], left: int, right: int) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* reverseBetween(ListNode* head, int left, int right) {\n        \n    }\n};",
      "methodName": "reverseBetween",
      "executionContract": {
        "name": "reverseBetween",
        "params": [
          {
            "name": "head",
            "type": "ListNode"
          },
          {
            "name": "left",
            "type": "integer"
          },
          {
            "name": "right",
            "type": "integer"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:35.642Z",
      "referenceSolutionHash": "sha256:43adb48bcb68fd33c85ab3da15bbf13749bc5564ccbfed27d4520b7cdf154067",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "left": 2,
            "right": 4
          },
          "expected": [
            1,
            4,
            3,
            2,
            5
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4,5]\n2\n4",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              5
            ],
            "left": 1,
            "right": 1
          },
          "expected": [
            5
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[5]\n1\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 25,
      "slug": "reverse-nodes-in-k-group",
      "title": "Reverse Nodes in k-Group",
      "difficulty": "Hard",
      "hot150Order": 62,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/reverse-nodes-in-k-group/",
      "statementMarkdown": "Given the head of a linked list, reverse the nodes of the list k at a time, and return the modified list.\n\nk is a positive integer and is less than or equal to the length of the linked list. If the number of nodes is not a multiple of k then left-out nodes, in the end, should remain as it is.\n\nYou may not alter the values in the list's nodes, only nodes themselves may be changed.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [1,2,3,4,5], k = 2\nOutput: [2,1,4,3,5]\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [1,2,3,4,5], k = 3\nOutput: [3,2,1,4,5]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the list is n.\n\n\t- 1 <= k <= n <= 5000\n\n\t- 0 <= Node.val <= 1000\n\n \n\nFollow-up: Can you solve the problem in O(1) extra memory space?",
      "examples": [
        {
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "k": 2
          },
          "output": [
            2,
            1,
            4,
            3,
            5
          ]
        },
        {
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "k": 3
          },
          "output": [
            3,
            2,
            1,
            4,
            5
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "recursion"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def reverseKGroup(self, head: Optional[ListNode], k: int) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* reverseKGroup(ListNode* head, int k) {\n        \n    }\n};",
      "methodName": "reverseKGroup",
      "executionContract": {
        "name": "reverseKGroup",
        "params": [
          {
            "name": "head",
            "type": "ListNode"
          },
          {
            "name": "k",
            "type": "integer"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:36.066Z",
      "referenceSolutionHash": "sha256:ef82853fd2c5d732ce0c090488fe9dd4d4357ea60c1a2a206a37e070ef629348",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "k": 2
          },
          "expected": [
            2,
            1,
            4,
            3,
            5
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4,5]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "k": 3
          },
          "expected": [
            3,
            2,
            1,
            4,
            5
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2,3,4,5]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 19,
      "slug": "remove-nth-node-from-end-of-list",
      "title": "Remove Nth Node From End of List",
      "difficulty": "Medium",
      "hot150Order": 63,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/remove-nth-node-from-end-of-list/",
      "statementMarkdown": "Given the head of a linked list, remove the nth node from the end of the list and return its head.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [1,2,3,4,5], n = 2\nOutput: [1,2,3,5]\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [1], n = 1\nOutput: []\n\n```\n\nExample 3:\n\n```text\n\nInput: head = [1,2], n = 1\nOutput: [1]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the list is sz.\n\n\t- 1 <= sz <= 30\n\n\t- 0 <= Node.val <= 100\n\n\t- 1 <= n <= sz\n\n \n\nFollow up: Could you do this in one pass?",
      "examples": [
        {
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "n": 2
          },
          "output": [
            1,
            2,
            3,
            5
          ]
        },
        {
          "input": {
            "head": [
              1
            ],
            "n": 1
          },
          "output": null
        },
        {
          "input": {
            "head": [
              1,
              2
            ],
            "n": 1
          },
          "output": [
            1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def removeNthFromEnd(self, head: Optional[ListNode], n: int) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* removeNthFromEnd(ListNode* head, int n) {\n        \n    }\n};",
      "methodName": "removeNthFromEnd",
      "executionContract": {
        "name": "removeNthFromEnd",
        "params": [
          {
            "name": "head",
            "type": "ListNode"
          },
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:36.465Z",
      "referenceSolutionHash": "sha256:ca3dbfbba1bf3c0cc11e6fb69a10944406a4e16b3ba9ba9dc7a596e40e10cc2a",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "n": 2
          },
          "expected": [
            1,
            2,
            3,
            5
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4,5]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              1
            ],
            "n": 1
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1]\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "head": [
              1,
              2
            ],
            "n": 1
          },
          "expected": [
            1
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1,2]\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 82,
      "slug": "remove-duplicates-from-sorted-list-ii",
      "title": "Remove Duplicates from Sorted List II",
      "difficulty": "Medium",
      "hot150Order": 64,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/remove-duplicates-from-sorted-list-ii/",
      "statementMarkdown": "Given the head of a sorted linked list, delete all nodes that have duplicate numbers, leaving only distinct numbers from the original list. Return the linked list sorted as well.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [1,2,3,3,4,4,5]\nOutput: [1,2,5]\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [1,1,1,2,3]\nOutput: [2,3]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the list is in the range [0, 300].\n\n\t- -100 <= Node.val <= 100\n\n\t- The list is guaranteed to be sorted in ascending order.",
      "examples": [
        {
          "input": {
            "head": [
              1,
              2,
              3,
              3,
              4,
              4,
              5
            ]
          },
          "output": [
            1,
            2,
            5
          ]
        },
        {
          "input": {
            "head": [
              1,
              1,
              1,
              2,
              3
            ]
          },
          "output": [
            2,
            3
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def deleteDuplicates(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* deleteDuplicates(ListNode* head) {\n        \n    }\n};",
      "methodName": "deleteDuplicates",
      "executionContract": {
        "name": "deleteDuplicates",
        "params": [
          {
            "name": "head",
            "type": "ListNode"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:37.192Z",
      "referenceSolutionHash": "sha256:5cbeb09ec555d6870d307faed890d41542401a5d8dccc046cb6651a4daf97658",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              1,
              2,
              3,
              3,
              4,
              4,
              5
            ]
          },
          "expected": [
            1,
            2,
            5
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,3,4,4,5]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              1,
              1,
              1,
              2,
              3
            ]
          },
          "expected": [
            2,
            3
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,1,1,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 61,
      "slug": "rotate-list",
      "title": "Rotate List",
      "difficulty": "Medium",
      "hot150Order": 65,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/rotate-list/",
      "statementMarkdown": "Given the head of a linked list, rotate the list to the right by k places.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [1,2,3,4,5], k = 2\nOutput: [4,5,1,2,3]\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [0,1,2], k = 4\nOutput: [2,0,1]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the list is in the range [0, 500].\n\n\t- -100 <= Node.val <= 100\n\n\t- 0 <= k <= 2 * 109",
      "examples": [
        {
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "k": 2
          },
          "output": [
            4,
            5,
            1,
            2,
            3
          ]
        },
        {
          "input": {
            "head": [
              0,
              1,
              2
            ],
            "k": 4
          },
          "output": [
            2,
            0,
            1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def rotateRight(self, head: Optional[ListNode], k: int) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* rotateRight(ListNode* head, int k) {\n        \n    }\n};",
      "methodName": "rotateRight",
      "executionContract": {
        "name": "rotateRight",
        "params": [
          {
            "name": "head",
            "type": "ListNode"
          },
          {
            "name": "k",
            "type": "integer"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:37.630Z",
      "referenceSolutionHash": "sha256:b2e1f1f95bc7f253da85c27b454b65786e446afbf63752154fd1f01d132c47de",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              1,
              2,
              3,
              4,
              5
            ],
            "k": 2
          },
          "expected": [
            4,
            5,
            1,
            2,
            3
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4,5]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              0,
              1,
              2
            ],
            "k": 4
          },
          "expected": [
            2,
            0,
            1
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,1,2]\n4",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 86,
      "slug": "partition-list",
      "title": "Partition List",
      "difficulty": "Medium",
      "hot150Order": 66,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/partition-list/",
      "statementMarkdown": "Given the head of a linked list and a value x, partition it such that all nodes less than x come before nodes greater than or equal to x.\n\nYou should preserve the original relative order of the nodes in each of the two partitions.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [1,4,3,2,5,2], x = 3\nOutput: [1,2,2,4,3,5]\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [2,1], x = 2\nOutput: [1,2]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the list is in the range [0, 200].\n\n\t- -100 <= Node.val <= 100\n\n\t- -200 <= x <= 200",
      "examples": [
        {
          "input": {
            "head": [
              1,
              4,
              3,
              2,
              5,
              2
            ],
            "x": 3
          },
          "output": [
            1,
            2,
            2,
            4,
            3,
            5
          ]
        },
        {
          "input": {
            "head": [
              2,
              1
            ],
            "x": 2
          },
          "output": [
            1,
            2
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def partition(self, head: Optional[ListNode], x: int) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* partition(ListNode* head, int x) {\n        \n    }\n};",
      "methodName": "partition",
      "executionContract": {
        "name": "partition",
        "params": [
          {
            "name": "head",
            "type": "ListNode"
          },
          {
            "name": "x",
            "type": "integer"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:38.266Z",
      "referenceSolutionHash": "sha256:27965122d877fffdf21d41ac7626f16fde344ab1dd1cef13c0a530dba4e9eb66",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              1,
              4,
              3,
              2,
              5,
              2
            ],
            "x": 3
          },
          "expected": [
            1,
            2,
            2,
            4,
            3,
            5
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,4,3,2,5,2]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              2,
              1
            ],
            "x": 2
          },
          "expected": [
            1,
            2
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2,1]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 146,
      "slug": "lru-cache",
      "title": "LRU Cache",
      "difficulty": "Medium",
      "hot150Order": 67,
      "hot150Section": "Linked List",
      "officialUrl": "https://leetcode.com/problems/lru-cache/",
      "statementMarkdown": "Design a data structure that follows the constraints of a Least Recently Used (LRU) cache.\n\nImplement the LRUCache class:\n\n\t- LRUCache(int capacity) Initialize the LRU cache with positive size capacity.\n\n\t- int get(int key) Return the value of the key if the key exists, otherwise return -1.\n\n\t- void put(int key, int value) Update the value of the key if the key exists. Otherwise, add the key-value pair to the cache. If the number of keys exceeds the capacity from this operation, evict the least recently used key.\n\nThe functions get and put must each run in O(1) average time complexity.\n\n \n\nExample 1:\n\n```text\n\nInput\n[\"LRUCache\", \"put\", \"put\", \"get\", \"put\", \"get\", \"put\", \"get\", \"get\", \"get\"]\n[[2], [1, 1], [2, 2], [1], [3, 3], [2], [4, 4], [1], [3], [4]]\nOutput\n[null, null, null, 1, null, -1, null, -1, 3, 4]\n\nExplanation\nLRUCache lRUCache = new LRUCache(2);\nlRUCache.put(1, 1); // cache is {1=1}\nlRUCache.put(2, 2); // cache is {1=1, 2=2}\nlRUCache.get(1);    // return 1\nlRUCache.put(3, 3); // LRU key was 2, evicts key 2, cache is {1=1, 3=3}\nlRUCache.get(2);    // returns -1 (not found)\nlRUCache.put(4, 4); // LRU key was 1, evicts key 1, cache is {4=4, 3=3}\nlRUCache.get(1);    // return -1 (not found)\nlRUCache.get(3);    // return 3\nlRUCache.get(4);    // return 4\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= capacity <= 3000\n\n\t- 0 <= key <= 104\n\n\t- 0 <= value <= 105\n\n\t- At most 2 * 105 calls will be made to get and put.",
      "examples": [
        {
          "input": {
            "operations": [
              "LRUCache",
              "put",
              "put",
              "get",
              "put",
              "get",
              "put",
              "get",
              "get",
              "get"
            ],
            "arguments": [
              [
                2
              ],
              [
                1,
                1
              ],
              [
                2,
                2
              ],
              [
                1
              ],
              [
                3,
                3
              ],
              [
                2
              ],
              [
                4,
                4
              ],
              [
                1
              ],
              [
                3
              ],
              [
                4
              ]
            ]
          },
          "output": [
            null,
            null,
            null,
            1,
            null,
            -1,
            null,
            -1,
            3,
            4
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "linked-list",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "design",
        "doubly-linked-list"
      ],
      "starterCodePython": "class LRUCache:\n\n    def __init__(self, capacity: int):\n        \n\n    def get(self, key: int) -> int:\n        \n\n    def put(self, key: int, value: int) -> None:\n        \n\n\n# Your LRUCache object will be instantiated and called as such:\n# obj = LRUCache(capacity)\n# param_1 = obj.get(key)\n# obj.put(key,value)",
      "starterCodeCpp": "class LRUCache {\npublic:\n    LRUCache(int capacity) {\n        \n    }\n    \n    int get(int key) {\n        \n    }\n    \n    void put(int key, int value) {\n        \n    }\n};\n\n/**\n * Your LRUCache object will be instantiated and called as such:\n * LRUCache* obj = new LRUCache(capacity);\n * int param_1 = obj->get(key);\n * obj->put(key,value);\n */",
      "methodName": "LRUCache",
      "executionContract": {
        "name": "LRUCache",
        "params": [],
        "returnType": "unknown",
        "contractKind": "design_class"
      },
      "comparisonStrategy": "op_sequence",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:38.671Z",
      "referenceSolutionHash": "sha256:94293f4c390c6cb92afad1b7930059a74a8212804853070058a11789c5a05a8b",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "operations": [
              "LRUCache",
              "put",
              "put",
              "get",
              "put",
              "get",
              "put",
              "get",
              "get",
              "get"
            ],
            "arguments": [
              [
                2
              ],
              [
                1,
                1
              ],
              [
                2,
                2
              ],
              [
                1
              ],
              [
                3,
                3
              ],
              [
                2
              ],
              [
                4,
                4
              ],
              [
                1
              ],
              [
                3
              ],
              [
                4
              ]
            ]
          },
          "expected": [
            null,
            null,
            null,
            1,
            null,
            -1,
            null,
            -1,
            3,
            4
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"LRUCache\",\"put\",\"put\",\"get\",\"put\",\"get\",\"put\",\"get\",\"get\",\"get\"]\n[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 104,
      "slug": "maximum-depth-of-binary-tree",
      "title": "Maximum Depth of Binary Tree",
      "difficulty": "Easy",
      "hot150Order": 68,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/maximum-depth-of-binary-tree/",
      "statementMarkdown": "Given the root of a binary tree, return its maximum depth.\n\nA binary tree's maximum depth is the number of nodes along the longest path from the root node down to the farthest leaf node.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [3,9,20,null,null,15,7]\nOutput: 3\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [1,null,2]\nOutput: 2\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 104].\n\n\t- -100 <= Node.val <= 100",
      "examples": [
        {
          "input": {
            "root": [
              3,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "output": 3
        },
        {
          "input": {
            "root": [
              1,
              null,
              2
            ]
          },
          "output": 2
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def maxDepth(self, root: Optional[TreeNode]) -> int:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    int maxDepth(TreeNode* root) {\n        \n    }\n};",
      "methodName": "maxDepth",
      "executionContract": {
        "name": "maxDepth",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "integer",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:39.040Z",
      "referenceSolutionHash": "sha256:f444de4169f438dea339d5401109cec3dc1c15d6f7fe0248f526895ecd99d694",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              3,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,9,20,null,null,15,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              1,
              null,
              2
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,null,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 100,
      "slug": "same-tree",
      "title": "Same Tree",
      "difficulty": "Easy",
      "hot150Order": 69,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/same-tree/",
      "statementMarkdown": "Given the roots of two binary trees p and q, write a function to check if they are the same or not.\n\nTwo binary trees are considered the same if they are structurally identical, and the nodes have the same value.\n\n \n\nExample 1:\n\n```text\n\nInput: p = [1,2,3], q = [1,2,3]\nOutput: true\n\n```\n\nExample 2:\n\n```text\n\nInput: p = [1,2], q = [1,null,2]\nOutput: false\n\n```\n\nExample 3:\n\n```text\n\nInput: p = [1,2,1], q = [1,1,2]\nOutput: false\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in both trees is in the range [0, 100].\n\n\t- -104 <= Node.val <= 104",
      "examples": [
        {
          "input": {
            "p": [
              1,
              2,
              3
            ],
            "q": [
              1,
              2,
              3
            ]
          },
          "output": true
        },
        {
          "input": {
            "p": [
              1,
              2
            ],
            "q": [
              1,
              null,
              2
            ]
          },
          "output": false
        },
        {
          "input": {
            "p": [
              1,
              2,
              1
            ],
            "q": [
              1,
              1,
              2
            ]
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def isSameTree(self, p: Optional[TreeNode], q: Optional[TreeNode]) -> bool:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    bool isSameTree(TreeNode* p, TreeNode* q) {\n        \n    }\n};",
      "methodName": "isSameTree",
      "executionContract": {
        "name": "isSameTree",
        "params": [
          {
            "name": "p",
            "type": "TreeNode"
          },
          {
            "name": "q",
            "type": "TreeNode"
          }
        ],
        "returnType": "boolean",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:39.401Z",
      "referenceSolutionHash": "sha256:fcabdcb02fb35b9cd0d326bf9c420160bced7008f1a8ce5096313de3ee7c321a",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "p": [
              1,
              2,
              3
            ],
            "q": [
              1,
              2,
              3
            ]
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3]\n[1,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "p": [
              1,
              2
            ],
            "q": [
              1,
              null,
              2
            ]
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2]\n[1,null,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "p": [
              1,
              2,
              1
            ],
            "q": [
              1,
              1,
              2
            ]
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1,2,1]\n[1,1,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 226,
      "slug": "invert-binary-tree",
      "title": "Invert Binary Tree",
      "difficulty": "Easy",
      "hot150Order": 70,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/invert-binary-tree/",
      "statementMarkdown": "Given the root of a binary tree, invert the tree, and return its root.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [4,2,7,1,3,6,9]\nOutput: [4,7,2,9,6,3,1]\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [2,1,3]\nOutput: [2,3,1]\n\n```\n\nExample 3:\n\n```text\n\nInput: root = []\nOutput: []\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 100].\n\n\t- -100 <= Node.val <= 100",
      "examples": [
        {
          "input": {
            "root": [
              4,
              2,
              7,
              1,
              3,
              6,
              9
            ]
          },
          "output": [
            4,
            7,
            2,
            9,
            6,
            3,
            1
          ]
        },
        {
          "input": {
            "root": [
              2,
              1,
              3
            ]
          },
          "output": [
            2,
            3,
            1
          ]
        },
        {
          "input": {
            "root": []
          },
          "output": null
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def invertTree(self, root: Optional[TreeNode]) -> Optional[TreeNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    TreeNode* invertTree(TreeNode* root) {\n        \n    }\n};",
      "methodName": "invertTree",
      "executionContract": {
        "name": "invertTree",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "TreeNode",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:39.817Z",
      "referenceSolutionHash": "sha256:9c352d1529b0f29667ca757ff34b454c5af7036d7940f6431f2659d11a2689e0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              4,
              2,
              7,
              1,
              3,
              6,
              9
            ]
          },
          "expected": [
            4,
            7,
            2,
            9,
            6,
            3,
            1
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[4,2,7,1,3,6,9]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              2,
              1,
              3
            ]
          },
          "expected": [
            2,
            3,
            1
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2,1,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "root": []
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 101,
      "slug": "symmetric-tree",
      "title": "Symmetric Tree",
      "difficulty": "Easy",
      "hot150Order": 71,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/symmetric-tree/",
      "statementMarkdown": "Given the root of a binary tree, check whether it is a mirror of itself (i.e., symmetric around its center).\n\n \n\nExample 1:\n\n```text\n\nInput: root = [1,2,2,3,4,4,3]\nOutput: true\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [1,2,2,null,3,null,3]\nOutput: false\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [1, 1000].\n\n\t- -100 <= Node.val <= 100\n\n \n\nFollow up: Could you solve it both recursively and iteratively?",
      "examples": [
        {
          "input": {
            "root": [
              1,
              2,
              2,
              3,
              4,
              4,
              3
            ]
          },
          "output": true
        },
        {
          "input": {
            "root": [
              1,
              2,
              2,
              null,
              3,
              null,
              3
            ]
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def isSymmetric(self, root: Optional[TreeNode]) -> bool:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    bool isSymmetric(TreeNode* root) {\n        \n    }\n};",
      "methodName": "isSymmetric",
      "executionContract": {
        "name": "isSymmetric",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "boolean",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:40.295Z",
      "referenceSolutionHash": "sha256:eade28ebd496dcbf4176be03645fcf80397e15e3ea7f75ef5ffed7091a7b33d3",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              1,
              2,
              2,
              3,
              4,
              4,
              3
            ]
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,2,3,4,4,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              1,
              2,
              2,
              null,
              3,
              null,
              3
            ]
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2,2,null,3,null,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 105,
      "slug": "construct-binary-tree-from-preorder-and-inorder-traversal",
      "title": "Construct Binary Tree from Preorder and Inorder Traversal",
      "difficulty": "Medium",
      "hot150Order": 72,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/construct-binary-tree-from-preorder-and-inorder-traversal/",
      "statementMarkdown": "Given two integer arrays preorder and inorder where preorder is the preorder traversal of a binary tree and inorder is the inorder traversal of the same tree, construct and return the binary tree.\n\n \n\nExample 1:\n\n```text\n\nInput: preorder = [3,9,20,15,7], inorder = [9,3,15,20,7]\nOutput: [3,9,20,null,null,15,7]\n\n```\n\nExample 2:\n\n```text\n\nInput: preorder = [-1], inorder = [-1]\nOutput: [-1]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= preorder.length <= 3000\n\n\t- inorder.length == preorder.length\n\n\t- -3000 <= preorder[i], inorder[i] <= 3000\n\n\t- preorder and inorder consist of unique values.\n\n\t- Each value of inorder also appears in preorder.\n\n\t- preorder is guaranteed to be the preorder traversal of the tree.\n\n\t- inorder is guaranteed to be the inorder traversal of the tree.",
      "examples": [
        {
          "input": {
            "preorder": [
              3,
              9,
              20,
              15,
              7
            ],
            "inorder": [
              9,
              3,
              15,
              20,
              7
            ]
          },
          "output": [
            3,
            9,
            20,
            null,
            null,
            15,
            7
          ]
        },
        {
          "input": {
            "preorder": [
              -1
            ],
            "inorder": [
              -1
            ]
          },
          "output": [
            -1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "hash-table",
        "divide-and-conquer"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def buildTree(self, preorder: List[int], inorder: List[int]) -> Optional[TreeNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    TreeNode* buildTree(vector<int>& preorder, vector<int>& inorder) {\n        \n    }\n};",
      "methodName": "buildTree",
      "executionContract": {
        "name": "buildTree",
        "params": [
          {
            "name": "preorder",
            "type": "integer[]"
          },
          {
            "name": "inorder",
            "type": "integer[]"
          }
        ],
        "returnType": "TreeNode",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:40.838Z",
      "referenceSolutionHash": "sha256:4d49744d2561c7fdc78e5fd645fa6f2c27c593f3c840a7dbafaa48670c24fd6b",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "preorder": [
              3,
              9,
              20,
              15,
              7
            ],
            "inorder": [
              9,
              3,
              15,
              20,
              7
            ]
          },
          "expected": [
            3,
            9,
            20,
            null,
            null,
            15,
            7
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,9,20,15,7]\n[9,3,15,20,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "preorder": [
              -1
            ],
            "inorder": [
              -1
            ]
          },
          "expected": [
            -1
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[-1]\n[-1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 106,
      "slug": "construct-binary-tree-from-inorder-and-postorder-traversal",
      "title": "Construct Binary Tree from Inorder and Postorder Traversal",
      "difficulty": "Medium",
      "hot150Order": 73,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/construct-binary-tree-from-inorder-and-postorder-traversal/",
      "statementMarkdown": "Given two integer arrays inorder and postorder where inorder is the inorder traversal of a binary tree and postorder is the postorder traversal of the same tree, construct and return the binary tree.\n\n \n\nExample 1:\n\n```text\n\nInput: inorder = [9,3,15,20,7], postorder = [9,15,7,20,3]\nOutput: [3,9,20,null,null,15,7]\n\n```\n\nExample 2:\n\n```text\n\nInput: inorder = [-1], postorder = [-1]\nOutput: [-1]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= inorder.length <= 3000\n\n\t- postorder.length == inorder.length\n\n\t- -3000 <= inorder[i], postorder[i] <= 3000\n\n\t- inorder and postorder consist of unique values.\n\n\t- Each value of postorder also appears in inorder.\n\n\t- inorder is guaranteed to be the inorder traversal of the tree.\n\n\t- postorder is guaranteed to be the postorder traversal of the tree.",
      "examples": [
        {
          "input": {
            "inorder": [
              9,
              3,
              15,
              20,
              7
            ],
            "postorder": [
              9,
              15,
              7,
              20,
              3
            ]
          },
          "output": [
            3,
            9,
            20,
            null,
            null,
            15,
            7
          ]
        },
        {
          "input": {
            "inorder": [
              -1
            ],
            "postorder": [
              -1
            ]
          },
          "output": [
            -1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "hash-table",
        "divide-and-conquer"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def buildTree(self, inorder: List[int], postorder: List[int]) -> Optional[TreeNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    TreeNode* buildTree(vector<int>& inorder, vector<int>& postorder) {\n        \n    }\n};",
      "methodName": "buildTree",
      "executionContract": {
        "name": "buildTree",
        "params": [
          {
            "name": "inorder",
            "type": "integer[]"
          },
          {
            "name": "postorder",
            "type": "integer[]"
          }
        ],
        "returnType": "TreeNode",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:41.205Z",
      "referenceSolutionHash": "sha256:c6e050c3488964f6b1e0ecb5989a85aeab2400a0d71da3f98da9fdb851ea27e0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "inorder": [
              9,
              3,
              15,
              20,
              7
            ],
            "postorder": [
              9,
              15,
              7,
              20,
              3
            ]
          },
          "expected": [
            3,
            9,
            20,
            null,
            null,
            15,
            7
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[9,3,15,20,7]\n[9,15,7,20,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "inorder": [
              -1
            ],
            "postorder": [
              -1
            ]
          },
          "expected": [
            -1
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[-1]\n[-1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 117,
      "slug": "populating-next-right-pointers-in-each-node-ii",
      "title": "Populating Next Right Pointers in Each Node II",
      "difficulty": "Medium",
      "hot150Order": 74,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/populating-next-right-pointers-in-each-node-ii/",
      "statementMarkdown": "Given a binary tree\n\n```text\n\nstruct Node {\n  int val;\n  Node *left;\n  Node *right;\n  Node *next;\n}\n\n```\n\nPopulate each next pointer to point to its next right node. If there is no next right node, the next pointer should be set to NULL.\n\nInitially, all next pointers are set to NULL.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [1,2,3,4,5,null,7]\nOutput: [1,#,2,3,#,4,5,7,#]\nExplanation: Given the above binary tree (Figure A), your function should populate each next pointer to point to its next right node, just like in Figure B. The serialized output is in level order as connected by the next pointers, with '#' signifying the end of each level.\n\n```\n\nExample 2:\n\n```text\n\nInput: root = []\nOutput: []\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 6000].\n\n\t- -100 <= Node.val <= 100\n\n \n\nFollow-up:\n\n\t- You may only use constant extra space.\n\n\t- The recursive approach is fine. You may assume implicit stack space does not count as extra space for this problem.",
      "examples": [
        {
          "input": {
            "root": [
              1,
              2,
              3,
              4,
              5,
              null,
              7
            ]
          },
          "output": [
            1,
            "#",
            2,
            3,
            "#",
            4,
            5,
            7,
            "#"
          ]
        },
        {
          "input": {
            "root": []
          },
          "output": null
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "linked-list",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "\"\"\"\n# Definition for a Node.\nclass Node:\n    def __init__(self, val: int = 0, left: 'Node' = None, right: 'Node' = None, next: 'Node' = None):\n        self.val = val\n        self.left = left\n        self.right = right\n        self.next = next\n\"\"\"\n\nclass Solution:\n    def connect(self, root: 'Node') -> 'Node':\n        ",
      "starterCodeCpp": "/*\n// Definition for a Node.\nclass Node {\npublic:\n    int val;\n    Node* left;\n    Node* right;\n    Node* next;\n\n    Node() : val(0), left(NULL), right(NULL), next(NULL) {}\n\n    Node(int _val) : val(_val), left(NULL), right(NULL), next(NULL) {}\n\n    Node(int _val, Node* _left, Node* _right, Node* _next)\n        : val(_val), left(_left), right(_right), next(_next) {}\n};\n*/\n\nclass Solution {\npublic:\n    Node* connect(Node* root) {\n        \n    }\n};",
      "methodName": "connect",
      "executionContract": {
        "name": "connect",
        "params": [
          {
            "name": "root",
            "type": "Node"
          }
        ],
        "returnType": "Node",
        "contractKind": "binary_tree",
        "inputAdapter": "node_next_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:41.590Z",
      "referenceSolutionHash": "sha256:e43d4b6cd88796ff57ed33fe716ed9511b22441d00fcc85ab416bdac5e8e7de6",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              1,
              2,
              3,
              4,
              5,
              null,
              7
            ]
          },
          "expected": [
            1,
            "#",
            2,
            3,
            "#",
            4,
            5,
            7,
            "#"
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4,5,null,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": []
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 114,
      "slug": "flatten-binary-tree-to-linked-list",
      "title": "Flatten Binary Tree to Linked List",
      "difficulty": "Medium",
      "hot150Order": 75,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/flatten-binary-tree-to-linked-list/",
      "statementMarkdown": "Given the root of a binary tree, flatten the tree into a \"linked list\":\n\n\t- The \"linked list\" should use the same TreeNode class where the right child pointer points to the next node in the list and the left child pointer is always null.\n\n\t- The \"linked list\" should be in the same order as a pre-order traversal of the binary tree.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [1,2,5,3,4,null,6]\nOutput: [1,null,2,null,3,null,4,null,5,null,6]\n\n```\n\nExample 2:\n\n```text\n\nInput: root = []\nOutput: []\n\n```\n\nExample 3:\n\n```text\n\nInput: root = [0]\nOutput: [0]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 2000].\n\n\t- -100 <= Node.val <= 100\n\n \n\nFollow up: Can you flatten the tree in-place (with O(1) extra space)?",
      "examples": [
        {
          "input": {
            "root": [
              1,
              2,
              5,
              3,
              4,
              null,
              6
            ]
          },
          "output": [
            1,
            null,
            2,
            null,
            3,
            null,
            4,
            null,
            5,
            null,
            6
          ]
        },
        {
          "input": {
            "root": []
          },
          "output": null
        },
        {
          "input": {
            "root": [
              0
            ]
          },
          "output": [
            0
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "linked-list",
        "stack",
        "depth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def flatten(self, root: Optional[TreeNode]) -> None:\n        \"\"\"\n        Do not return anything, modify root in-place instead.\n        \"\"\"\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    void flatten(TreeNode* root) {\n        \n    }\n};",
      "methodName": "flatten",
      "executionContract": {
        "name": "flatten",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "void",
        "contractKind": "inplace_arg"
      },
      "comparisonStrategy": "inplace_arg",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:42.010Z",
      "referenceSolutionHash": "sha256:cd322bbd968ac9b53e3dc7b3f720410c0e7807dc96c0d56121238cb02d697b21",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              1,
              2,
              5,
              3,
              4,
              null,
              6
            ]
          },
          "expected": [
            1,
            null,
            2,
            null,
            3,
            null,
            4,
            null,
            5,
            null,
            6
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,5,3,4,null,6]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": []
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "root": [
              0
            ]
          },
          "expected": [
            0
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[0]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 112,
      "slug": "path-sum",
      "title": "Path Sum",
      "difficulty": "Easy",
      "hot150Order": 76,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/path-sum/",
      "statementMarkdown": "Given the root of a binary tree and an integer targetSum, return true if the tree has a root-to-leaf path such that adding up all the values along the path equals targetSum.\n\nA leaf is a node with no children.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [5,4,8,11,null,13,4,7,2,null,null,null,1], targetSum = 22\nOutput: true\nExplanation: The root-to-leaf path with the target sum is shown.\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [1,2,3], targetSum = 5\nOutput: false\nExplanation: There are two root-to-leaf paths in the tree:\n(1 --> 2): The sum is 3.\n(1 --> 3): The sum is 4.\nThere is no root-to-leaf path with sum = 5.\n\n```\n\nExample 3:\n\n```text\n\nInput: root = [], targetSum = 0\nOutput: false\nExplanation: Since the tree is empty, there are no root-to-leaf paths.\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 5000].\n\n\t- -1000 <= Node.val <= 1000\n\n\t- -1000 <= targetSum <= 1000",
      "examples": [
        {
          "input": {
            "root": [
              5,
              4,
              8,
              11,
              null,
              13,
              4,
              7,
              2,
              null,
              null,
              null,
              1
            ],
            "targetSum": 22
          },
          "output": true
        },
        {
          "input": {
            "root": [
              1,
              2,
              3
            ],
            "targetSum": 5
          },
          "output": false
        },
        {
          "input": {
            "root": [],
            "targetSum": 0
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def hasPathSum(self, root: Optional[TreeNode], targetSum: int) -> bool:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    bool hasPathSum(TreeNode* root, int targetSum) {\n        \n    }\n};",
      "methodName": "hasPathSum",
      "executionContract": {
        "name": "hasPathSum",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          },
          {
            "name": "targetSum",
            "type": "integer"
          }
        ],
        "returnType": "boolean",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:42.579Z",
      "referenceSolutionHash": "sha256:d3ba5cda39691d34f577ffb77e66a7c3a389158c8352bc2f3ebfab3da5e16553",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              5,
              4,
              8,
              11,
              null,
              13,
              4,
              7,
              2,
              null,
              null,
              null,
              1
            ],
            "targetSum": 22
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[5,4,8,11,null,13,4,7,2,null,null,null,1]\n22",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              1,
              2,
              3
            ],
            "targetSum": 5
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2,3]\n5",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "root": [],
            "targetSum": 0
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[]\n0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 129,
      "slug": "sum-root-to-leaf-numbers",
      "title": "Sum Root to Leaf Numbers",
      "difficulty": "Medium",
      "hot150Order": 77,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/sum-root-to-leaf-numbers/",
      "statementMarkdown": "You are given the root of a binary tree containing digits from 0 to 9 only.\n\nEach root-to-leaf path in the tree represents a number.\n\n\t- For example, the root-to-leaf path 1 -> 2 -> 3 represents the number 123.\n\nReturn the total sum of all root-to-leaf numbers. Test cases are generated so that the answer will fit in a 32-bit integer.\n\nA leaf node is a node with no children.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [1,2,3]\nOutput: 25\nExplanation:\nThe root-to-leaf path 1->2 represents the number 12.\nThe root-to-leaf path 1->3 represents the number 13.\nTherefore, sum = 12 + 13 = 25.\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [4,9,0,5,1]\nOutput: 1026\nExplanation:\nThe root-to-leaf path 4->9->5 represents the number 495.\nThe root-to-leaf path 4->9->1 represents the number 491.\nThe root-to-leaf path 4->0 represents the number 40.\nTherefore, sum = 495 + 491 + 40 = 1026.\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [1, 1000].\n\n\t- 0 <= Node.val <= 9\n\n\t- The depth of the tree will not exceed 10.",
      "examples": [
        {
          "input": {
            "root": [
              1,
              2,
              3
            ]
          },
          "output": 25
        },
        {
          "input": {
            "root": [
              4,
              9,
              0,
              5,
              1
            ]
          },
          "output": 1026
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def sumNumbers(self, root: Optional[TreeNode]) -> int:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    int sumNumbers(TreeNode* root) {\n        \n    }\n};",
      "methodName": "sumNumbers",
      "executionContract": {
        "name": "sumNumbers",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "integer",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:42.964Z",
      "referenceSolutionHash": "sha256:0bf134a449d27a39815d481002acc28c6b2430ac7e8470a53eb45721f9418f19",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              1,
              2,
              3
            ]
          },
          "expected": 25,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              4,
              9,
              0,
              5,
              1
            ]
          },
          "expected": 1026,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[4,9,0,5,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 124,
      "slug": "binary-tree-maximum-path-sum",
      "title": "Binary Tree Maximum Path Sum",
      "difficulty": "Hard",
      "hot150Order": 78,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/binary-tree-maximum-path-sum/",
      "statementMarkdown": "A path in a binary tree is a sequence of nodes where each pair of adjacent nodes in the sequence has an edge connecting them. A node can only appear in the sequence at most once. Note that the path does not need to pass through the root.\n\nThe path sum of a path is the sum of the node's values in the path.\n\nGiven the root of a binary tree, return the maximum path sum of any non-empty path.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [1,2,3]\nOutput: 6\nExplanation: The optimal path is 2 -> 1 -> 3 with a path sum of 2 + 1 + 3 = 6.\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [-10,9,20,null,null,15,7]\nOutput: 42\nExplanation: The optimal path is 15 -> 20 -> 7 with a path sum of 15 + 20 + 7 = 42.\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [1, 3 * 104].\n\n\t- -1000 <= Node.val <= 1000",
      "examples": [
        {
          "input": {
            "root": [
              1,
              2,
              3
            ]
          },
          "output": 6
        },
        {
          "input": {
            "root": [
              -10,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "output": 42
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "dynamic-programming",
        "depth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def maxPathSum(self, root: Optional[TreeNode]) -> int:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    int maxPathSum(TreeNode* root) {\n        \n    }\n};",
      "methodName": "maxPathSum",
      "executionContract": {
        "name": "maxPathSum",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "integer",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:43.539Z",
      "referenceSolutionHash": "sha256:307a50ecaed1ffe6ada3ae253cba9cce867e7ded7c39953f33eb3d62fd67fe95",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              1,
              2,
              3
            ]
          },
          "expected": 6,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              -10,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "expected": 42,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[-10,9,20,null,null,15,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 173,
      "slug": "binary-search-tree-iterator",
      "title": "Binary Search Tree Iterator",
      "difficulty": "Medium",
      "hot150Order": 79,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/binary-search-tree-iterator/",
      "statementMarkdown": "Implement the BSTIterator class that represents an iterator over the in-order traversal of a binary search tree (BST):\n\n\t- BSTIterator(TreeNode root) Initializes an object of the BSTIterator class. The root of the BST is given as part of the constructor. The pointer should be initialized to a non-existent number smaller than any element in the BST.\n\n\t- boolean hasNext() Returns true if there exists a number in the traversal to the right of the pointer, otherwise returns false.\n\n\t- int next() Moves the pointer to the right, then returns the number at the pointer.\n\nNotice that by initializing the pointer to a non-existent smallest number, the first call to next() will return the smallest element in the BST.\n\nYou may assume that next() calls will always be valid. That is, there will be at least a next number in the in-order traversal when next() is called.\n\n \n\nExample 1:\n\n```text\n\nInput\n[\"BSTIterator\", \"next\", \"next\", \"hasNext\", \"next\", \"hasNext\", \"next\", \"hasNext\", \"next\", \"hasNext\"]\n[[[7, 3, 15, null, null, 9, 20]], [], [], [], [], [], [], [], [], []]\nOutput\n[null, 3, 7, true, 9, true, 15, true, 20, false]\n\nExplanation\nBSTIterator bSTIterator = new BSTIterator([7, 3, 15, null, null, 9, 20]);\nbSTIterator.next();    // return 3\nbSTIterator.next();    // return 7\nbSTIterator.hasNext(); // return True\nbSTIterator.next();    // return 9\nbSTIterator.hasNext(); // return True\nbSTIterator.next();    // return 15\nbSTIterator.hasNext(); // return True\nbSTIterator.next();    // return 20\nbSTIterator.hasNext(); // return False\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [1, 105].\n\n\t- 0 <= Node.val <= 106\n\n\t- At most 105 calls will be made to hasNext, and next.\n\n \n\nFollow up:\n\n\t- Could you implement next() and hasNext() to run in average O(1) time and use O(h) memory, where h is the height of the tree?",
      "examples": [
        {
          "input": {
            "operations": [
              "BSTIterator",
              "next",
              "next",
              "hasNext",
              "next",
              "hasNext",
              "next",
              "hasNext",
              "next",
              "hasNext"
            ],
            "arguments": [
              [
                [
                  7,
                  3,
                  15,
                  null,
                  null,
                  9,
                  20
                ]
              ],
              [],
              [],
              [],
              [],
              [],
              [],
              [],
              [],
              []
            ]
          },
          "output": [
            null,
            3,
            7,
            true,
            9,
            true,
            15,
            true,
            20,
            false
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "stack",
        "design",
        "binary-search-tree",
        "iterator"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass BSTIterator:\n\n    def __init__(self, root: Optional[TreeNode]):\n        \n\n    def next(self) -> int:\n        \n\n    def hasNext(self) -> bool:\n        \n\n\n# Your BSTIterator object will be instantiated and called as such:\n# obj = BSTIterator(root)\n# param_1 = obj.next()\n# param_2 = obj.hasNext()",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass BSTIterator {\npublic:\n    BSTIterator(TreeNode* root) {\n        \n    }\n    \n    int next() {\n        \n    }\n    \n    bool hasNext() {\n        \n    }\n};\n\n/**\n * Your BSTIterator object will be instantiated and called as such:\n * BSTIterator* obj = new BSTIterator(root);\n * int param_1 = obj->next();\n * bool param_2 = obj->hasNext();\n */",
      "methodName": "BSTIterator",
      "executionContract": {
        "name": "BSTIterator",
        "params": [],
        "returnType": "unknown",
        "contractKind": "design_class"
      },
      "comparisonStrategy": "op_sequence",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:43.894Z",
      "referenceSolutionHash": "sha256:7e6a655d93da49f3917bd3d626c83a3979ea1d3ca7a7479aaa406e60280a638f",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "operations": [
              "BSTIterator",
              "next",
              "next",
              "hasNext",
              "next",
              "hasNext",
              "next",
              "hasNext",
              "next",
              "hasNext"
            ],
            "arguments": [
              [
                [
                  7,
                  3,
                  15,
                  null,
                  null,
                  9,
                  20
                ]
              ],
              [],
              [],
              [],
              [],
              [],
              [],
              [],
              [],
              []
            ]
          },
          "expected": [
            null,
            3,
            7,
            true,
            9,
            true,
            15,
            true,
            20,
            false
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"BSTIterator\",\"next\",\"next\",\"hasNext\",\"next\",\"hasNext\",\"next\",\"hasNext\",\"next\",\"hasNext\"]\n[[[7,3,15,null,null,9,20]],[],[],[],[],[],[],[],[],[]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 222,
      "slug": "count-complete-tree-nodes",
      "title": "Count Complete Tree Nodes",
      "difficulty": "Easy",
      "hot150Order": 80,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/count-complete-tree-nodes/",
      "statementMarkdown": "Given the root of a complete binary tree, return the number of the nodes in the tree.\n\nAccording to Wikipedia, every level, except possibly the last, is completely filled in a complete binary tree, and all nodes in the last level are as far left as possible. It can have between 1 and 2h nodes inclusive at the last level h.\n\nDesign an algorithm that runs in less than O(n) time complexity.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [1,2,3,4,5,6]\nOutput: 6\n\n```\n\nExample 2:\n\n```text\n\nInput: root = []\nOutput: 0\n\n```\n\nExample 3:\n\n```text\n\nInput: root = [1]\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 5 * 104].\n\n\t- 0 <= Node.val <= 5 * 104\n\n\t- The tree is guaranteed to be complete.",
      "examples": [
        {
          "input": {
            "root": [
              1,
              2,
              3,
              4,
              5,
              6
            ]
          },
          "output": 6
        },
        {
          "input": {
            "root": []
          },
          "output": 0
        },
        {
          "input": {
            "root": [
              1
            ]
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "binary-search",
        "bit-manipulation"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def countNodes(self, root: Optional[TreeNode]) -> int:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    int countNodes(TreeNode* root) {\n        \n    }\n};",
      "methodName": "countNodes",
      "executionContract": {
        "name": "countNodes",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "integer",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:44.281Z",
      "referenceSolutionHash": "sha256:8a6d06d077285490536f8bc1699bfaf02f005ee40a5e85be1aecc92a4ddc8082",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              1,
              2,
              3,
              4,
              5,
              6
            ]
          },
          "expected": 6,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,4,5,6]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": []
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "root": [
              1
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 236,
      "slug": "lowest-common-ancestor-of-a-binary-tree",
      "title": "Lowest Common Ancestor of a Binary Tree",
      "difficulty": "Medium",
      "hot150Order": 81,
      "hot150Section": "Binary Tree General",
      "officialUrl": "https://leetcode.com/problems/lowest-common-ancestor-of-a-binary-tree/",
      "statementMarkdown": "Given a binary tree, find the lowest common ancestor (LCA) of two given nodes in the tree.\n\nAccording to the definition of LCA on Wikipedia: &ldquo;The lowest common ancestor is defined between two nodes p and q as the lowest node in T that has both p and q as descendants (where we allow a node to be a descendant of itself).&rdquo;\n\n \n\nExample 1:\n\n```text\n\nInput: root = [3,5,1,6,2,0,8,null,null,7,4], p = 5, q = 1\nOutput: 3\nExplanation: The LCA of nodes 5 and 1 is 3.\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [3,5,1,6,2,0,8,null,null,7,4], p = 5, q = 4\nOutput: 5\nExplanation: The LCA of nodes 5 and 4 is 5, since a node can be a descendant of itself according to the LCA definition.\n\n```\n\nExample 3:\n\n```text\n\nInput: root = [1,2], p = 1, q = 2\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [2, 105].\n\n\t- -109 <= Node.val <= 109\n\n\t- All Node.val are unique.\n\n\t- p != q\n\n\t- p and q will exist in the tree.",
      "examples": [
        {
          "input": {
            "root": [
              3,
              5,
              1,
              6,
              2,
              0,
              8,
              null,
              null,
              7,
              4
            ],
            "p": 5,
            "q": 1
          },
          "output": null
        },
        {
          "input": {
            "root": [
              3,
              5,
              1,
              6,
              2,
              0,
              8,
              null,
              null,
              7,
              4
            ],
            "p": 5,
            "q": 4
          },
          "output": null
        },
        {
          "input": {
            "root": [
              1,
              2
            ],
            "p": 1,
            "q": 2
          },
          "output": null
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "dfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, x):\n#         self.val = x\n#         self.left = None\n#         self.right = None\n\nclass Solution:\n    def lowestCommonAncestor(self, root: 'TreeNode', p: 'TreeNode', q: 'TreeNode') -> 'TreeNode':\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode(int x) : val(x), left(NULL), right(NULL) {}\n * };\n */\nclass Solution {\npublic:\n    TreeNode* lowestCommonAncestor(TreeNode* root, TreeNode* p, TreeNode* q) {\n        \n    }\n};",
      "methodName": "lowestCommonAncestor",
      "executionContract": {
        "name": "lowestCommonAncestor",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          },
          {
            "name": "p",
            "type": "integer"
          },
          {
            "name": "q",
            "type": "integer"
          }
        ],
        "returnType": "TreeNode",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:44.670Z",
      "referenceSolutionHash": "sha256:6e24d6d258168d6369f150643a9b4d5726db058157367657ce8cd93c5dc641cd",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              3,
              5,
              1,
              6,
              2,
              0,
              8,
              null,
              null,
              7,
              4
            ],
            "p": 5,
            "q": 1
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,5,1,6,2,0,8,null,null,7,4]\n5\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              3,
              5,
              1,
              6,
              2,
              0,
              8,
              null,
              null,
              7,
              4
            ],
            "p": 5,
            "q": 4
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[3,5,1,6,2,0,8,null,null,7,4]\n5\n4",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "root": [
              1,
              2
            ],
            "p": 1,
            "q": 2
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1,2]\n1\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 199,
      "slug": "binary-tree-right-side-view",
      "title": "Binary Tree Right Side View",
      "difficulty": "Medium",
      "hot150Order": 82,
      "hot150Section": "Binary Tree BFS",
      "officialUrl": "https://leetcode.com/problems/binary-tree-right-side-view/",
      "statementMarkdown": "Given the root of a binary tree, imagine yourself standing on the right side of it, return the values of the nodes you can see ordered from top to bottom.\n\n \n\nExample 1:\n\nInput: root = [1,2,3,null,5,null,4]\n\nOutput: [1,3,4]\n\nExplanation:\n\nExample 2:\n\nInput: root = [1,2,3,4,null,null,null,5]\n\nOutput: [1,3,4,5]\n\nExplanation:\n\nExample 3:\n\nInput: root = [1,null,3]\n\nOutput: [1,3]\n\nExample 4:\n\nInput: root = []\n\nOutput: []\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 100].\n\n\t- -100 <= Node.val <= 100",
      "examples": [
        {
          "input": {
            "root": [
              1,
              2,
              3,
              null,
              5,
              null,
              4
            ]
          },
          "output": [
            1,
            3,
            4
          ]
        },
        {
          "input": {
            "root": [
              1,
              2,
              3,
              4,
              null,
              null,
              null,
              5
            ]
          },
          "output": [
            1,
            3,
            4,
            5
          ]
        },
        {
          "input": {
            "root": [
              1,
              null,
              3
            ]
          },
          "output": [
            1,
            3
          ]
        },
        {
          "input": {
            "root": []
          },
          "output": []
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def rightSideView(self, root: Optional[TreeNode]) -> List[int]:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    vector<int> rightSideView(TreeNode* root) {\n        \n    }\n};",
      "methodName": "rightSideView",
      "executionContract": {
        "name": "rightSideView",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "list<integer>",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:45.063Z",
      "referenceSolutionHash": "sha256:48094c4c1f4f95d8d241ea602defb6f500c6f7c13030a413f00ead5e93c90be9",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              1,
              2,
              3,
              null,
              5,
              null,
              4
            ]
          },
          "expected": [
            1,
            3,
            4
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,null,5,null,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              1,
              2,
              3,
              4,
              null,
              null,
              null,
              5
            ]
          },
          "expected": [
            1,
            3,
            4,
            5
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2,3,4,null,null,null,5]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "root": [
              1,
              null,
              3
            ]
          },
          "expected": [
            1,
            3
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1,null,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 4",
          "input": {
            "root": []
          },
          "expected": [],
          "source": "local_sample",
          "sortOrder": 3,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 637,
      "slug": "average-of-levels-in-binary-tree",
      "title": "Average of Levels in Binary Tree",
      "difficulty": "Easy",
      "hot150Order": 83,
      "hot150Section": "Binary Tree BFS",
      "officialUrl": "https://leetcode.com/problems/average-of-levels-in-binary-tree/",
      "statementMarkdown": "Given the root of a binary tree, return the average value of the nodes on each level in the form of an array. Answers within 10-5 of the actual answer will be accepted.\n \n\nExample 1:\n\n```text\n\nInput: root = [3,9,20,null,null,15,7]\nOutput: [3.00000,14.50000,11.00000]\nExplanation: The average value of nodes on level 0 is 3, on level 1 is 14.5, and on level 2 is 11.\nHence return [3, 14.5, 11].\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [3,9,20,15,7]\nOutput: [3.00000,14.50000,11.00000]\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [1, 104].\n\n\t- -231 <= Node.val <= 231 - 1",
      "examples": [
        {
          "input": {
            "root": [
              3,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "output": [
            3,
            14.5,
            11
          ]
        },
        {
          "input": {
            "root": [
              3,
              9,
              20,
              15,
              7
            ]
          },
          "output": [
            3,
            14.5,
            11
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def averageOfLevels(self, root: Optional[TreeNode]) -> List[float]:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    vector<double> averageOfLevels(TreeNode* root) {\n        \n    }\n};",
      "methodName": "averageOfLevels",
      "executionContract": {
        "name": "averageOfLevels",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "list<double>",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "float_tol",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:45.444Z",
      "referenceSolutionHash": "sha256:ebd0844a0d0a0dc7b8b47392cc64f321ca89139595fb9b884f40c091ea75eae8",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              3,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "expected": [
            3,
            14.5,
            11
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,9,20,null,null,15,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              3,
              9,
              20,
              15,
              7
            ]
          },
          "expected": [
            3,
            14.5,
            11
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[3,9,20,15,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 102,
      "slug": "binary-tree-level-order-traversal",
      "title": "Binary Tree Level Order Traversal",
      "difficulty": "Medium",
      "hot150Order": 84,
      "hot150Section": "Binary Tree BFS",
      "officialUrl": "https://leetcode.com/problems/binary-tree-level-order-traversal/",
      "statementMarkdown": "Given the root of a binary tree, return the level order traversal of its nodes' values. (i.e., from left to right, level by level).\n\n \n\nExample 1:\n\n```text\n\nInput: root = [3,9,20,null,null,15,7]\nOutput: [[3],[9,20],[15,7]]\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [1]\nOutput: [[1]]\n\n```\n\nExample 3:\n\n```text\n\nInput: root = []\nOutput: []\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 2000].\n\n\t- -1000 <= Node.val <= 1000",
      "examples": [
        {
          "input": {
            "root": [
              3,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "output": [
            [
              3
            ],
            [
              9,
              20
            ],
            [
              15,
              7
            ]
          ]
        },
        {
          "input": {
            "root": [
              1
            ]
          },
          "output": [
            [
              1
            ]
          ]
        },
        {
          "input": {
            "root": []
          },
          "output": []
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def levelOrder(self, root: Optional[TreeNode]) -> List[List[int]]:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    vector<vector<int>> levelOrder(TreeNode* root) {\n        \n    }\n};",
      "methodName": "levelOrder",
      "executionContract": {
        "name": "levelOrder",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "list<list<integer>>",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:45.818Z",
      "referenceSolutionHash": "sha256:2a232e82405afe68524c45b0d8cb745ad0b1e78afc8d840aff59792b5f104b87",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              3,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "expected": [
            [
              3
            ],
            [
              9,
              20
            ],
            [
              15,
              7
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,9,20,null,null,15,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              1
            ]
          },
          "expected": [
            [
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "root": []
          },
          "expected": [],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 103,
      "slug": "binary-tree-zigzag-level-order-traversal",
      "title": "Binary Tree Zigzag Level Order Traversal",
      "difficulty": "Medium",
      "hot150Order": 85,
      "hot150Section": "Binary Tree BFS",
      "officialUrl": "https://leetcode.com/problems/binary-tree-zigzag-level-order-traversal/",
      "statementMarkdown": "Given the root of a binary tree, return the zigzag level order traversal of its nodes' values. (i.e., from left to right, then right to left for the next level and alternate between).\n\n \n\nExample 1:\n\n```text\n\nInput: root = [3,9,20,null,null,15,7]\nOutput: [[3],[20,9],[15,7]]\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [1]\nOutput: [[1]]\n\n```\n\nExample 3:\n\n```text\n\nInput: root = []\nOutput: []\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [0, 2000].\n\n\t- -100 <= Node.val <= 100",
      "examples": [
        {
          "input": {
            "root": [
              3,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "output": [
            [
              3
            ],
            [
              20,
              9
            ],
            [
              15,
              7
            ]
          ]
        },
        {
          "input": {
            "root": [
              1
            ]
          },
          "output": [
            [
              1
            ]
          ]
        },
        {
          "input": {
            "root": []
          },
          "output": []
        }
      ],
      "constraints": [],
      "tags": [
        "binary-tree",
        "tree",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "breadth-first-search"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def zigzagLevelOrder(self, root: Optional[TreeNode]) -> List[List[int]]:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    vector<vector<int>> zigzagLevelOrder(TreeNode* root) {\n        \n    }\n};",
      "methodName": "zigzagLevelOrder",
      "executionContract": {
        "name": "zigzagLevelOrder",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "list<list<integer>>",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:46.202Z",
      "referenceSolutionHash": "sha256:845cf5f056feff1d5adb3a07e5a9f5ce17cf74c5fcb6f390763f5ecca5d544b6",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              3,
              9,
              20,
              null,
              null,
              15,
              7
            ]
          },
          "expected": [
            [
              3
            ],
            [
              20,
              9
            ],
            [
              15,
              7
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,9,20,null,null,15,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              1
            ]
          },
          "expected": [
            [
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "root": []
          },
          "expected": [],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 530,
      "slug": "minimum-absolute-difference-in-bst",
      "title": "Minimum Absolute Difference in BST",
      "difficulty": "Easy",
      "hot150Order": 86,
      "hot150Section": "Binary Search Tree",
      "officialUrl": "https://leetcode.com/problems/minimum-absolute-difference-in-bst/",
      "statementMarkdown": "Given the root of a Binary Search Tree (BST), return the minimum absolute difference between the values of any two different nodes in the tree.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [4,2,6,1,3]\nOutput: 1\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [1,0,48,null,null,12,49]\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [2, 104].\n\n\t- 0 <= Node.val <= 105\n\n \n\nNote: This question is the same as 783: https://leetcode.com/problems/minimum-distance-between-bst-nodes/",
      "examples": [
        {
          "input": {
            "root": [
              4,
              2,
              6,
              1,
              3
            ]
          },
          "output": 1
        },
        {
          "input": {
            "root": [
              1,
              0,
              48,
              null,
              null,
              12,
              49
            ]
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search-tree",
        "bst",
        "tree",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search",
        "binary-tree"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def getMinimumDifference(self, root: Optional[TreeNode]) -> int:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    int getMinimumDifference(TreeNode* root) {\n        \n    }\n};",
      "methodName": "getMinimumDifference",
      "executionContract": {
        "name": "getMinimumDifference",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "integer",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:46.648Z",
      "referenceSolutionHash": "sha256:26bcbbdda03467c6c44f5fbf6113588f51baee77aa0c8d56937287041be281db",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              4,
              2,
              6,
              1,
              3
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[4,2,6,1,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              1,
              0,
              48,
              null,
              null,
              12,
              49
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,0,48,null,null,12,49]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 230,
      "slug": "kth-smallest-element-in-a-bst",
      "title": "Kth Smallest Element in a BST",
      "difficulty": "Medium",
      "hot150Order": 87,
      "hot150Section": "Binary Search Tree",
      "officialUrl": "https://leetcode.com/problems/kth-smallest-element-in-a-bst/",
      "statementMarkdown": "Given the root of a binary search tree, and an integer k, return the kth smallest value (1-indexed) of all the values of the nodes in the tree.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [3,1,4,null,2], k = 1\nOutput: 1\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [5,3,6,2,4,null,null,1], k = 3\nOutput: 3\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is n.\n\n\t- 1 <= k <= n <= 104\n\n\t- 0 <= Node.val <= 104\n\n \n\nFollow up: If the BST is modified often (i.e., we can do insert and delete operations) and you need to find the kth smallest frequently, how would you optimize?",
      "examples": [
        {
          "input": {
            "root": [
              3,
              1,
              4,
              null,
              2
            ],
            "k": 1
          },
          "output": 1
        },
        {
          "input": {
            "root": [
              5,
              3,
              6,
              2,
              4,
              null,
              null,
              1
            ],
            "k": 3
          },
          "output": 3
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search-tree",
        "bst",
        "tree",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "binary-tree"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def kthSmallest(self, root: Optional[TreeNode], k: int) -> int:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    int kthSmallest(TreeNode* root, int k) {\n        \n    }\n};",
      "methodName": "kthSmallest",
      "executionContract": {
        "name": "kthSmallest",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          },
          {
            "name": "k",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:47.020Z",
      "referenceSolutionHash": "sha256:75cad2fd277968d654bb22a3c30fa1725e552d01bfdf53f15c6faee5fff28cea",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              3,
              1,
              4,
              null,
              2
            ],
            "k": 1
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,1,4,null,2]\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              5,
              3,
              6,
              2,
              4,
              null,
              null,
              1
            ],
            "k": 3
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[5,3,6,2,4,null,null,1]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 98,
      "slug": "validate-binary-search-tree",
      "title": "Validate Binary Search Tree",
      "difficulty": "Medium",
      "hot150Order": 88,
      "hot150Section": "Binary Search Tree",
      "officialUrl": "https://leetcode.com/problems/validate-binary-search-tree/",
      "statementMarkdown": "Given the root of a binary tree, determine if it is a valid binary search tree (BST).\n\nA valid BST is defined as follows:\n\n\t- The left subtree of a node contains only nodes with keys strictly less than the node's key.\n\n\t- The right subtree of a node contains only nodes with keys strictly greater than the node's key.\n\n\t- Both the left and right subtrees must also be binary search trees.\n\n \n\nExample 1:\n\n```text\n\nInput: root = [2,1,3]\nOutput: true\n\n```\n\nExample 2:\n\n```text\n\nInput: root = [5,1,4,null,null,3,6]\nOutput: false\nExplanation: The root node's value is 5 but its right child's value is 4.\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the tree is in the range [1, 104].\n\n\t- -231 <= Node.val <= 231 - 1",
      "examples": [
        {
          "input": {
            "root": [
              2,
              1,
              3
            ]
          },
          "output": true
        },
        {
          "input": {
            "root": [
              5,
              1,
              4,
              null,
              null,
              3,
              6
            ]
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search-tree",
        "bst",
        "tree",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "binary-tree"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def isValidBST(self, root: Optional[TreeNode]) -> bool:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    bool isValidBST(TreeNode* root) {\n        \n    }\n};",
      "methodName": "isValidBST",
      "executionContract": {
        "name": "isValidBST",
        "params": [
          {
            "name": "root",
            "type": "TreeNode"
          }
        ],
        "returnType": "boolean",
        "contractKind": "binary_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:47.500Z",
      "referenceSolutionHash": "sha256:db792a916aa88a081d3f9b01321ff2f75780223868211482ceaa6eca35b86d17",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "root": [
              2,
              1,
              3
            ]
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,1,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "root": [
              5,
              1,
              4,
              null,
              null,
              3,
              6
            ]
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[5,1,4,null,null,3,6]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 200,
      "slug": "number-of-islands",
      "title": "Number of Islands",
      "difficulty": "Medium",
      "hot150Order": 89,
      "hot150Section": "Graph General",
      "officialUrl": "https://leetcode.com/problems/number-of-islands/",
      "statementMarkdown": "Given an m x n 2D binary grid grid which represents a map of '1's (land) and '0's (water), return the number of islands.\n\nAn island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically. You may assume all four edges of the grid are all surrounded by water.\n\n \n\nExample 1:\n\n```text\n\nInput: grid = [\n  [\"1\",\"1\",\"1\",\"1\",\"0\"],\n  [\"1\",\"1\",\"0\",\"1\",\"0\"],\n  [\"1\",\"1\",\"0\",\"0\",\"0\"],\n  [\"0\",\"0\",\"0\",\"0\",\"0\"]\n]\nOutput: 1\n\n```\n\nExample 2:\n\n```text\n\nInput: grid = [\n  [\"1\",\"1\",\"0\",\"0\",\"0\"],\n  [\"1\",\"1\",\"0\",\"0\",\"0\"],\n  [\"0\",\"0\",\"1\",\"0\",\"0\"],\n  [\"0\",\"0\",\"0\",\"1\",\"1\"]\n]\nOutput: 3\n\n```\n\n \n\nConstraints:\n\n\t- m == grid.length\n\n\t- n == grid[i].length\n\n\t- 1 <= m, n <= 300\n\n\t- grid[i][j] is '0' or '1'.",
      "examples": [
        {
          "input": {
            "grid": [
              [
                "1",
                "1",
                "1",
                "1",
                "0"
              ],
              [
                "1",
                "1",
                "0",
                "1",
                "0"
              ],
              [
                "1",
                "1",
                "0",
                "0",
                "0"
              ],
              [
                "0",
                "0",
                "0",
                "0",
                "0"
              ]
            ]
          },
          "output": 1
        },
        {
          "input": {
            "grid": [
              [
                "1",
                "1",
                "0",
                "0",
                "0"
              ],
              [
                "1",
                "1",
                "0",
                "0",
                "0"
              ],
              [
                "0",
                "0",
                "1",
                "0",
                "0"
              ],
              [
                "0",
                "0",
                "0",
                "1",
                "1"
              ]
            ]
          },
          "output": 3
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "dfs",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "depth-first-search",
        "breadth-first-search",
        "union-find",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def numIslands(self, grid: List[List[str]]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int numIslands(vector<vector<char>>& grid) {\n        \n    }\n};",
      "methodName": "numIslands",
      "executionContract": {
        "name": "numIslands",
        "params": [
          {
            "name": "grid",
            "type": "character[][]"
          }
        ],
        "returnType": "integer",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:47.860Z",
      "referenceSolutionHash": "sha256:93ca51d8aab14b92b6de935c92924a6bdceadb889ec4f0e9211731700b538e76",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "grid": [
              [
                "1",
                "1",
                "1",
                "1",
                "0"
              ],
              [
                "1",
                "1",
                "0",
                "1",
                "0"
              ],
              [
                "1",
                "1",
                "0",
                "0",
                "0"
              ],
              [
                "0",
                "0",
                "0",
                "0",
                "0"
              ]
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[\"1\",\"1\",\"1\",\"1\",\"0\"],[\"1\",\"1\",\"0\",\"1\",\"0\"],[\"1\",\"1\",\"0\",\"0\",\"0\"],[\"0\",\"0\",\"0\",\"0\",\"0\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "grid": [
              [
                "1",
                "1",
                "0",
                "0",
                "0"
              ],
              [
                "1",
                "1",
                "0",
                "0",
                "0"
              ],
              [
                "0",
                "0",
                "1",
                "0",
                "0"
              ],
              [
                "0",
                "0",
                "0",
                "1",
                "1"
              ]
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[\"1\",\"1\",\"0\",\"0\",\"0\"],[\"1\",\"1\",\"0\",\"0\",\"0\"],[\"0\",\"0\",\"1\",\"0\",\"0\"],[\"0\",\"0\",\"0\",\"1\",\"1\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 130,
      "slug": "surrounded-regions",
      "title": "Surrounded Regions",
      "difficulty": "Medium",
      "hot150Order": 90,
      "hot150Section": "Graph General",
      "officialUrl": "https://leetcode.com/problems/surrounded-regions/",
      "statementMarkdown": "You are given an m x n matrix board containing letters 'X' and 'O', capture regions that are surrounded:\n\n\t- Connect: A cell is connected to adjacent cells horizontally or vertically.\n\n\t- Region: To form a region connect every 'O' cell.\n\n\t- Surround: A region is surrounded if none of the 'O' cells in that region are on the edge of the board. Such regions are completely enclosed by 'X' cells.\n\nTo capture a surrounded region, replace all 'O's with 'X's in-place within the original board. You do not need to return anything.\n\n \n\nExample 1:\n\nInput: board = [[\"X\",\"X\",\"X\",\"X\"],[\"X\",\"O\",\"O\",\"X\"],[\"X\",\"X\",\"O\",\"X\"],[\"X\",\"O\",\"X\",\"X\"]]\n\nOutput: [[\"X\",\"X\",\"X\",\"X\"],[\"X\",\"X\",\"X\",\"X\"],[\"X\",\"X\",\"X\",\"X\"],[\"X\",\"O\",\"X\",\"X\"]]\n\nExplanation:\n\nIn the above diagram, the bottom region is not captured because it is on the edge of the board and cannot be surrounded.\n\nExample 2:\n\nInput: board = [[\"X\"]]\n\nOutput: [[\"X\"]]\n\n \n\nConstraints:\n\n\t- m == board.length\n\n\t- n == board[i].length\n\n\t- 1 <= m, n <= 200\n\n\t- board[i][j] is 'X' or 'O'.",
      "examples": [
        {
          "input": {
            "board": [
              [
                "X",
                "X",
                "X",
                "X"
              ],
              [
                "X",
                "O",
                "O",
                "X"
              ],
              [
                "X",
                "X",
                "O",
                "X"
              ],
              [
                "X",
                "O",
                "X",
                "X"
              ]
            ]
          },
          "output": [
            [
              "X",
              "X",
              "X",
              "X"
            ],
            [
              "X",
              "X",
              "X",
              "X"
            ],
            [
              "X",
              "X",
              "X",
              "X"
            ],
            [
              "X",
              "O",
              "X",
              "X"
            ]
          ]
        },
        {
          "input": {
            "board": [
              [
                "X"
              ]
            ]
          },
          "output": [
            [
              "X"
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "dfs",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "depth-first-search",
        "breadth-first-search",
        "union-find",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def solve(self, board: List[List[str]]) -> None:\n        \"\"\"\n        Do not return anything, modify board in-place instead.\n        \"\"\"\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    void solve(vector<vector<char>>& board) {\n        \n    }\n};",
      "methodName": "solve",
      "executionContract": {
        "name": "solve",
        "params": [
          {
            "name": "board",
            "type": "character[][]"
          }
        ],
        "returnType": "void",
        "contractKind": "inplace_arg"
      },
      "comparisonStrategy": "inplace_arg",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:48.251Z",
      "referenceSolutionHash": "sha256:932406b83196c20c58f57533ab31bb1a5af7013f8999cc3b50eace2fce81bc1f",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "board": [
              [
                "X",
                "X",
                "X",
                "X"
              ],
              [
                "X",
                "O",
                "O",
                "X"
              ],
              [
                "X",
                "X",
                "O",
                "X"
              ],
              [
                "X",
                "O",
                "X",
                "X"
              ]
            ]
          },
          "expected": [
            [
              "X",
              "X",
              "X",
              "X"
            ],
            [
              "X",
              "X",
              "X",
              "X"
            ],
            [
              "X",
              "X",
              "X",
              "X"
            ],
            [
              "X",
              "O",
              "X",
              "X"
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[\"X\",\"X\",\"X\",\"X\"],[\"X\",\"O\",\"O\",\"X\"],[\"X\",\"X\",\"O\",\"X\"],[\"X\",\"O\",\"X\",\"X\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "board": [
              [
                "X"
              ]
            ]
          },
          "expected": [
            [
              "X"
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[\"X\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 133,
      "slug": "clone-graph",
      "title": "Clone Graph",
      "difficulty": "Medium",
      "hot150Order": 91,
      "hot150Section": "Graph General",
      "officialUrl": "https://leetcode.com/problems/clone-graph/",
      "statementMarkdown": "Given a reference of a node in a connected undirected graph.\n\nReturn a deep copy (clone) of the graph.\n\nEach node in the graph contains a value (int) and a list (List[Node]) of its neighbors.\n\n```text\n\nclass Node {\n    public int val;\n    public List<Node> neighbors;\n}\n\n```\n\n \n\nTest case format:\n\nFor simplicity, each node's value is the same as the node's index (1-indexed). For example, the first node with val == 1, the second node with val == 2, and so on. The graph is represented in the test case using an adjacency list.\n\nAn adjacency list is a collection of unordered lists used to represent a finite graph. Each list describes the set of neighbors of a node in the graph.\n\nThe given node will always be the first node with val = 1. You must return the copy of the given node as a reference to the cloned graph.\n\n \n\nExample 1:\n\n```text\n\nInput: adjList = [[2,4],[1,3],[2,4],[1,3]]\nOutput: [[2,4],[1,3],[2,4],[1,3]]\nExplanation: There are 4 nodes in the graph.\n1st node (val = 1)'s neighbors are 2nd node (val = 2) and 4th node (val = 4).\n2nd node (val = 2)'s neighbors are 1st node (val = 1) and 3rd node (val = 3).\n3rd node (val = 3)'s neighbors are 2nd node (val = 2) and 4th node (val = 4).\n4th node (val = 4)'s neighbors are 1st node (val = 1) and 3rd node (val = 3).\n\n```\n\nExample 2:\n\n```text\n\nInput: adjList = [[]]\nOutput: [[]]\nExplanation: Note that the input contains one empty list. The graph consists of only one node with val = 1 and it does not have any neighbors.\n\n```\n\nExample 3:\n\n```text\n\nInput: adjList = []\nOutput: []\nExplanation: This an empty graph, it does not have any nodes.\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the graph is in the range [0, 100].\n\n\t- 1 <= Node.val <= 100\n\n\t- Node.val is unique for each node.\n\n\t- There are no repeated edges and no self-loops in the graph.\n\n\t- The Graph is connected and all nodes can be visited starting from the given node.",
      "examples": [
        {
          "input": {
            "node": [
              [
                2,
                4
              ],
              [
                1,
                3
              ],
              [
                2,
                4
              ],
              [
                1,
                3
              ]
            ]
          },
          "output": [
            [
              2,
              4
            ],
            [
              1,
              3
            ],
            [
              2,
              4
            ],
            [
              1,
              3
            ]
          ]
        },
        {
          "input": {
            "node": [
              []
            ]
          },
          "output": [
            []
          ]
        },
        {
          "input": {
            "node": []
          },
          "output": null
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "dfs",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "depth-first-search",
        "breadth-first-search"
      ],
      "starterCodePython": "\"\"\"\n# Definition for a Node.\nclass Node:\n    def __init__(self, val = 0, neighbors = None):\n        self.val = val\n        self.neighbors = neighbors if neighbors is not None else []\n\"\"\"\n\nfrom typing import Optional\nclass Solution:\n    def cloneGraph(self, node: Optional['Node']) -> Optional['Node']:\n        ",
      "starterCodeCpp": "/*\n// Definition for a Node.\nclass Node {\npublic:\n    int val;\n    vector<Node*> neighbors;\n    Node() {\n        val = 0;\n        neighbors = vector<Node*>();\n    }\n    Node(int _val) {\n        val = _val;\n        neighbors = vector<Node*>();\n    }\n    Node(int _val, vector<Node*> _neighbors) {\n        val = _val;\n        neighbors = _neighbors;\n    }\n};\n*/\n\nclass Solution {\npublic:\n    Node* cloneGraph(Node* node) {\n        \n    }\n};",
      "methodName": "cloneGraph",
      "executionContract": {
        "name": "cloneGraph",
        "params": [
          {
            "name": "node",
            "type": "Node"
          }
        ],
        "returnType": "Node",
        "contractKind": "pure_function",
        "inputAdapter": "node_graph"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:48.644Z",
      "referenceSolutionHash": "sha256:56d043b85d61e48290a965c36008c430cf990bca213229f34ba7bd9e735ebffd",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "node": [
              [
                2,
                4
              ],
              [
                1,
                3
              ],
              [
                2,
                4
              ],
              [
                1,
                3
              ]
            ]
          },
          "expected": [
            [
              2,
              4
            ],
            [
              1,
              3
            ],
            [
              2,
              4
            ],
            [
              1,
              3
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[2,4],[1,3],[2,4],[1,3]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "node": [
              []
            ]
          },
          "expected": [
            []
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "node": []
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 399,
      "slug": "evaluate-division",
      "title": "Evaluate Division",
      "difficulty": "Medium",
      "hot150Order": 92,
      "hot150Section": "Graph General",
      "officialUrl": "https://leetcode.com/problems/evaluate-division/",
      "statementMarkdown": "You are given an array of variable pairs equations and an array of real numbers values, where equations[i] = [Ai, Bi] and values[i] represent the equation Ai / Bi = values[i]. Each Ai or Bi is a string that represents a single variable.\n\nYou are also given some queries, where queries[j] = [Cj, Dj] represents the jth query where you must find the answer for Cj / Dj = ?.\n\nReturn the answers to all queries. If a single answer cannot be determined, return -1.0.\n\nNote: The input is always valid. You may assume that evaluating the queries will not result in division by zero and that there is no contradiction.\n\nNote: The variables that do not occur in the list of equations are undefined, so the answer cannot be determined for them.\n\n \n\nExample 1:\n\n```text\n\nInput: equations = [[\"a\",\"b\"],[\"b\",\"c\"]], values = [2.0,3.0], queries = [[\"a\",\"c\"],[\"b\",\"a\"],[\"a\",\"e\"],[\"a\",\"a\"],[\"x\",\"x\"]]\nOutput: [6.00000,0.50000,-1.00000,1.00000,-1.00000]\nExplanation: \nGiven: a / b = 2.0, b / c = 3.0\nqueries are: a / c = ?, b / a = ?, a / e = ?, a / a = ?, x / x = ? \nreturn: [6.0, 0.5, -1.0, 1.0, -1.0 ]\nnote: x is undefined => -1.0\n```\n\nExample 2:\n\n```text\n\nInput: equations = [[\"a\",\"b\"],[\"b\",\"c\"],[\"bc\",\"cd\"]], values = [1.5,2.5,5.0], queries = [[\"a\",\"c\"],[\"c\",\"b\"],[\"bc\",\"cd\"],[\"cd\",\"bc\"]]\nOutput: [3.75000,0.40000,5.00000,0.20000]\n\n```\n\nExample 3:\n\n```text\n\nInput: equations = [[\"a\",\"b\"]], values = [0.5], queries = [[\"a\",\"b\"],[\"b\",\"a\"],[\"a\",\"c\"],[\"x\",\"y\"]]\nOutput: [0.50000,2.00000,-1.00000,-1.00000]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= equations.length <= 20\n\n\t- equations[i].length == 2\n\n\t- 1 <= Ai.length, Bi.length <= 5\n\n\t- values.length == equations.length\n\n\t- 0.0 < values[i] <= 20.0\n\n\t- 1 <= queries.length <= 20\n\n\t- queries[i].length == 2\n\n\t- 1 <= Cj.length, Dj.length <= 5\n\n\t- Ai, Bi, Cj, Dj consist of lower case English letters and digits.",
      "examples": [
        {
          "input": {
            "equations": [
              [
                "a",
                "b"
              ],
              [
                "b",
                "c"
              ]
            ],
            "values": [
              2,
              3
            ],
            "queries": [
              [
                "a",
                "c"
              ],
              [
                "b",
                "a"
              ],
              [
                "a",
                "e"
              ],
              [
                "a",
                "a"
              ],
              [
                "x",
                "x"
              ]
            ]
          },
          "output": [
            6,
            0.5,
            -1,
            1,
            -1
          ]
        },
        {
          "input": {
            "equations": [
              [
                "a",
                "b"
              ],
              [
                "b",
                "c"
              ],
              [
                "bc",
                "cd"
              ]
            ],
            "values": [
              1.5,
              2.5,
              5
            ],
            "queries": [
              [
                "a",
                "c"
              ],
              [
                "c",
                "b"
              ],
              [
                "bc",
                "cd"
              ],
              [
                "cd",
                "bc"
              ]
            ]
          },
          "output": [
            3.75,
            0.4,
            5,
            0.2
          ]
        },
        {
          "input": {
            "equations": [
              [
                "a",
                "b"
              ]
            ],
            "values": [
              0.5
            ],
            "queries": [
              [
                "a",
                "b"
              ],
              [
                "b",
                "a"
              ],
              [
                "a",
                "c"
              ],
              [
                "x",
                "y"
              ]
            ]
          },
          "output": [
            0.5,
            2,
            -1,
            -1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "dfs",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "string",
        "depth-first-search",
        "breadth-first-search",
        "union-find",
        "shortest-path"
      ],
      "starterCodePython": "class Solution:\n    def calcEquation(self, equations: List[List[str]], values: List[float], queries: List[List[str]]) -> List[float]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<double> calcEquation(vector<vector<string>>& equations, vector<double>& values, vector<vector<string>>& queries) {\n        \n    }\n};",
      "methodName": "calcEquation",
      "executionContract": {
        "name": "calcEquation",
        "params": [
          {
            "name": "equations",
            "type": "list<list<string>>"
          },
          {
            "name": "values",
            "type": "double[]"
          },
          {
            "name": "queries",
            "type": "list<list<string>>"
          }
        ],
        "returnType": "double[]",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "float_tol",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:49.028Z",
      "referenceSolutionHash": "sha256:29be4fc18a1d28dc5cd0e3dbd561d92dc8b5854b400964a735aa84c2576f6ee6",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "equations": [
              [
                "a",
                "b"
              ],
              [
                "b",
                "c"
              ]
            ],
            "values": [
              2,
              3
            ],
            "queries": [
              [
                "a",
                "c"
              ],
              [
                "b",
                "a"
              ],
              [
                "a",
                "e"
              ],
              [
                "a",
                "a"
              ],
              [
                "x",
                "x"
              ]
            ]
          },
          "expected": [
            6,
            0.5,
            -1,
            1,
            -1
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[\"a\",\"b\"],[\"b\",\"c\"]]\n[2.0,3.0]\n[[\"a\",\"c\"],[\"b\",\"a\"],[\"a\",\"e\"],[\"a\",\"a\"],[\"x\",\"x\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "equations": [
              [
                "a",
                "b"
              ],
              [
                "b",
                "c"
              ],
              [
                "bc",
                "cd"
              ]
            ],
            "values": [
              1.5,
              2.5,
              5
            ],
            "queries": [
              [
                "a",
                "c"
              ],
              [
                "c",
                "b"
              ],
              [
                "bc",
                "cd"
              ],
              [
                "cd",
                "bc"
              ]
            ]
          },
          "expected": [
            3.75,
            0.4,
            5,
            0.2
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[\"a\",\"b\"],[\"b\",\"c\"],[\"bc\",\"cd\"]]\n[1.5,2.5,5.0]\n[[\"a\",\"c\"],[\"c\",\"b\"],[\"bc\",\"cd\"],[\"cd\",\"bc\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "equations": [
              [
                "a",
                "b"
              ]
            ],
            "values": [
              0.5
            ],
            "queries": [
              [
                "a",
                "b"
              ],
              [
                "b",
                "a"
              ],
              [
                "a",
                "c"
              ],
              [
                "x",
                "y"
              ]
            ]
          },
          "expected": [
            0.5,
            2,
            -1,
            -1
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[[\"a\",\"b\"]]\n[0.5]\n[[\"a\",\"b\"],[\"b\",\"a\"],[\"a\",\"c\"],[\"x\",\"y\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 207,
      "slug": "course-schedule",
      "title": "Course Schedule",
      "difficulty": "Medium",
      "hot150Order": 93,
      "hot150Section": "Graph General",
      "officialUrl": "https://leetcode.com/problems/course-schedule/",
      "statementMarkdown": "There are a total of numCourses courses you have to take, labeled from 0 to numCourses - 1. You are given an array prerequisites where prerequisites[i] = [ai, bi] indicates that you must take course bi first if you want to take course ai.\n\n\t- For example, the pair [0, 1], indicates that to take course 0 you have to first take course 1.\n\nReturn true if you can finish all courses. Otherwise, return false.\n\n \n\nExample 1:\n\n```text\n\nInput: numCourses = 2, prerequisites = [[1,0]]\nOutput: true\nExplanation: There are a total of 2 courses to take. \nTo take course 1 you should have finished course 0. So it is possible.\n\n```\n\nExample 2:\n\n```text\n\nInput: numCourses = 2, prerequisites = [[1,0],[0,1]]\nOutput: false\nExplanation: There are a total of 2 courses to take. \nTo take course 1 you should have finished course 0, and to take course 0 you should also have finished course 1. So it is impossible.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= numCourses <= 2000\n\n\t- 0 <= prerequisites.length <= 5000\n\n\t- prerequisites[i].length == 2\n\n\t- 0 <= ai, bi < numCourses\n\n\t- All the pairs prerequisites[i] are unique.",
      "examples": [
        {
          "input": {
            "numCourses": 2,
            "prerequisites": [
              [
                1,
                0
              ]
            ]
          },
          "output": true
        },
        {
          "input": {
            "numCourses": 2,
            "prerequisites": [
              [
                1,
                0
              ],
              [
                0,
                1
              ]
            ]
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "dfs",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search",
        "topological-sort"
      ],
      "starterCodePython": "class Solution:\n    def canFinish(self, numCourses: int, prerequisites: List[List[int]]) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool canFinish(int numCourses, vector<vector<int>>& prerequisites) {\n        \n    }\n};",
      "methodName": "canFinish",
      "executionContract": {
        "name": "canFinish",
        "params": [
          {
            "name": "numCourses",
            "type": "integer"
          },
          {
            "name": "prerequisites",
            "type": "integer[][]"
          }
        ],
        "returnType": "boolean",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:49.417Z",
      "referenceSolutionHash": "sha256:ca56e7a7e808c6f608dc41910f8b3c7dfce1f36a8a6986d5eff5275c02f5f4ef",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "numCourses": 2,
            "prerequisites": [
              [
                1,
                0
              ]
            ]
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "2\n[[1,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "numCourses": 2,
            "prerequisites": [
              [
                1,
                0
              ],
              [
                0,
                1
              ]
            ]
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "2\n[[1,0],[0,1]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 210,
      "slug": "course-schedule-ii",
      "title": "Course Schedule II",
      "difficulty": "Medium",
      "hot150Order": 94,
      "hot150Section": "Graph General",
      "officialUrl": "https://leetcode.com/problems/course-schedule-ii/",
      "statementMarkdown": "There are a total of numCourses courses you have to take, labeled from 0 to numCourses - 1. You are given an array prerequisites where prerequisites[i] = [ai, bi] indicates that you must take course bi first if you want to take course ai.\n\n\t- For example, the pair [0, 1], indicates that to take course 0 you have to first take course 1.\n\nReturn the ordering of courses you should take to finish all courses. If there are many valid answers, return any of them. If it is impossible to finish all courses, return an empty array.\n\n \n\nExample 1:\n\n```text\n\nInput: numCourses = 2, prerequisites = [[1,0]]\nOutput: [0,1]\nExplanation: There are a total of 2 courses to take. To take course 1 you should have finished course 0. So the correct course order is [0,1].\n\n```\n\nExample 2:\n\n```text\n\nInput: numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]\nOutput: [0,2,1,3]\nExplanation: There are a total of 4 courses to take. To take course 3 you should have finished both courses 1 and 2. Both courses 1 and 2 should be taken after you finished course 0.\nSo one correct course order is [0,1,2,3]. Another correct ordering is [0,2,1,3].\n\n```\n\nExample 3:\n\n```text\n\nInput: numCourses = 1, prerequisites = []\nOutput: [0]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= numCourses <= 2000\n\n\t- 0 <= prerequisites.length <= numCourses * (numCourses - 1)\n\n\t- prerequisites[i].length == 2\n\n\t- 0 <= ai, bi < numCourses\n\n\t- ai != bi\n\n\t- All the pairs [ai, bi] are distinct.",
      "examples": [
        {
          "input": {
            "numCourses": 2,
            "prerequisites": [
              [
                1,
                0
              ]
            ]
          },
          "output": null
        },
        {
          "input": {
            "numCourses": 4,
            "prerequisites": [
              [
                1,
                0
              ],
              [
                2,
                0
              ],
              [
                3,
                1
              ],
              [
                3,
                2
              ]
            ]
          },
          "output": null
        },
        {
          "input": {
            "numCourses": 1,
            "prerequisites": []
          },
          "output": null
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "dfs",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "depth-first-search",
        "breadth-first-search",
        "topological-sort"
      ],
      "starterCodePython": "class Solution:\n    def findOrder(self, numCourses: int, prerequisites: List[List[int]]) -> List[int]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<int> findOrder(int numCourses, vector<vector<int>>& prerequisites) {\n        \n    }\n};",
      "methodName": "findOrder",
      "executionContract": {
        "name": "findOrder",
        "params": [
          {
            "name": "numCourses",
            "type": "integer"
          },
          {
            "name": "prerequisites",
            "type": "integer[][]"
          }
        ],
        "returnType": "integer[]",
        "contractKind": "grid"
      },
      "comparisonStrategy": "special_judge",
      "comparisonConfig": {
        "kind": "topological_order",
        "numCoursesParam": "numCourses",
        "prerequisitesParam": "prerequisites"
      },
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:49.803Z",
      "referenceSolutionHash": "sha256:a77b8862b4dfa91d0e86260d410e5cb5a30673885cab2df49031c67c3b26bba2",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "numCourses": 2,
            "prerequisites": [
              [
                1,
                0
              ]
            ]
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "2\n[[1,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "numCourses": 4,
            "prerequisites": [
              [
                1,
                0
              ],
              [
                2,
                0
              ],
              [
                3,
                1
              ],
              [
                3,
                2
              ]
            ]
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "4\n[[1,0],[2,0],[3,1],[3,2]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "numCourses": 1,
            "prerequisites": []
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "1\n[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 909,
      "slug": "snakes-and-ladders",
      "title": "Snakes and Ladders",
      "difficulty": "Medium",
      "hot150Order": 95,
      "hot150Section": "Graph BFS",
      "officialUrl": "https://leetcode.com/problems/snakes-and-ladders/",
      "statementMarkdown": "You are given an n x n integer matrix board where the cells are labeled from 1 to n2 in a Boustrophedon style starting from the bottom left of the board (i.e. board[n - 1][0]) and alternating direction each row.\n\nYou start on square 1 of the board. In each move, starting from square curr, do the following:\n\n\t- Choose a destination square next with a label in the range [curr + 1, min(curr + 6, n2)].\n\n\t\n\t\t- This choice simulates the result of a standard 6-sided die roll: i.e., there are always at most 6 destinations, regardless of the size of the board.\n\n\t\n\t\n\n\t- If next has a snake or ladder, you must move to the destination of that snake or ladder. Otherwise, you move to next.\n\n\t- The game ends when you reach the square n2.\n\nA board square on row r and column c has a snake or ladder if board[r][c] != -1. The destination of that snake or ladder is board[r][c]. Squares 1 and n2 are not the starting points of any snake or ladder.\n\nNote that you only take a snake or ladder at most once per dice roll. If the destination to a snake or ladder is the start of another snake or ladder, you do not follow the subsequent snake or ladder.\n\n\t- For example, suppose the board is [[-1,4],[-1,3]], and on the first move, your destination square is 2. You follow the ladder to square 3, but do not follow the subsequent ladder to 4.\n\nReturn the least number of dice rolls required to reach the square n2. If it is not possible to reach the square, return -1.\n\n \n\nExample 1:\n\n```text\n\nInput: board = [[-1,-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1,-1],[-1,35,-1,-1,13,-1],[-1,-1,-1,-1,-1,-1],[-1,15,-1,-1,-1,-1]]\nOutput: 4\nExplanation: \nIn the beginning, you start at square 1 (at row 5, column 0).\nYou decide to move to square 2 and must take the ladder to square 15.\nYou then decide to move to square 17 and must take the snake to square 13.\nYou then decide to move to square 14 and must take the ladder to square 35.\nYou then decide to move to square 36, ending the game.\nThis is the lowest possible number of moves to reach the last square, so return 4.\n\n```\n\nExample 2:\n\n```text\n\nInput: board = [[-1,-1],[-1,3]]\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- n == board.length == board[i].length\n\n\t- 2 <= n <= 20\n\n\t- board[i][j] is either -1 or in the range [1, n2].\n\n\t- The squares labeled 1 and n2 are not the starting points of any snake or ladder.",
      "examples": [
        {
          "input": {
            "board": [
              [
                -1,
                -1,
                -1,
                -1,
                -1,
                -1
              ],
              [
                -1,
                -1,
                -1,
                -1,
                -1,
                -1
              ],
              [
                -1,
                -1,
                -1,
                -1,
                -1,
                -1
              ],
              [
                -1,
                35,
                -1,
                -1,
                13,
                -1
              ],
              [
                -1,
                -1,
                -1,
                -1,
                -1,
                -1
              ],
              [
                -1,
                15,
                -1,
                -1,
                -1,
                -1
              ]
            ]
          },
          "output": 4
        },
        {
          "input": {
            "board": [
              [
                -1,
                -1
              ],
              [
                -1,
                3
              ]
            ]
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "breadth-first-search",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def snakesAndLadders(self, board: List[List[int]]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int snakesAndLadders(vector<vector<int>>& board) {\n        \n    }\n};",
      "methodName": "snakesAndLadders",
      "executionContract": {
        "name": "snakesAndLadders",
        "params": [
          {
            "name": "board",
            "type": "integer[][]"
          }
        ],
        "returnType": "integer",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:50.218Z",
      "referenceSolutionHash": "sha256:62f26719bac912bc0882775855fc658cda70b5ab3dad88c2987e905d170583f0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "board": [
              [
                -1,
                -1,
                -1,
                -1,
                -1,
                -1
              ],
              [
                -1,
                -1,
                -1,
                -1,
                -1,
                -1
              ],
              [
                -1,
                -1,
                -1,
                -1,
                -1,
                -1
              ],
              [
                -1,
                35,
                -1,
                -1,
                13,
                -1
              ],
              [
                -1,
                -1,
                -1,
                -1,
                -1,
                -1
              ],
              [
                -1,
                15,
                -1,
                -1,
                -1,
                -1
              ]
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[-1,-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1,-1],[-1,-1,-1,-1,-1,-1],[-1,35,-1,-1,13,-1],[-1,-1,-1,-1,-1,-1],[-1,15,-1,-1,-1,-1]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "board": [
              [
                -1,
                -1
              ],
              [
                -1,
                3
              ]
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[-1,-1],[-1,3]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 433,
      "slug": "minimum-genetic-mutation",
      "title": "Minimum Genetic Mutation",
      "difficulty": "Medium",
      "hot150Order": 96,
      "hot150Section": "Graph BFS",
      "officialUrl": "https://leetcode.com/problems/minimum-genetic-mutation/",
      "statementMarkdown": "A gene string can be represented by an 8-character long string, with choices from 'A', 'C', 'G', and 'T'.\n\nSuppose we need to investigate a mutation from a gene string startGene to a gene string endGene where one mutation is defined as one single character changed in the gene string.\n\n\t- For example, \"AACCGGTT\" --> \"AACCGGTA\" is one mutation.\n\nThere is also a gene bank bank that records all the valid gene mutations. A gene must be in bank to make it a valid gene string.\n\nGiven the two gene strings startGene and endGene and the gene bank bank, return the minimum number of mutations needed to mutate from startGene to endGene. If there is no such a mutation, return -1.\n\nNote that the starting point is assumed to be valid, so it might not be included in the bank.\n\n \n\nExample 1:\n\n```text\n\nInput: startGene = \"AACCGGTT\", endGene = \"AACCGGTA\", bank = [\"AACCGGTA\"]\nOutput: 1\n\n```\n\nExample 2:\n\n```text\n\nInput: startGene = \"AACCGGTT\", endGene = \"AAACGGTA\", bank = [\"AACCGGTA\",\"AACCGCTA\",\"AAACGGTA\"]\nOutput: 2\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= bank.length <= 10\n\n\t- startGene.length == endGene.length == bank[i].length == 8\n\n\t- startGene, endGene, and bank[i] consist of only the characters ['A', 'C', 'G', 'T'].",
      "examples": [
        {
          "input": {
            "startGene": "AACCGGTT",
            "endGene": "AACCGGTA",
            "bank": [
              "AACCGGTA"
            ]
          },
          "output": 1
        },
        {
          "input": {
            "startGene": "AACCGGTT",
            "endGene": "AAACGGTA",
            "bank": [
              "AACCGGTA",
              "AACCGCTA",
              "AAACGGTA"
            ]
          },
          "output": 2
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "string",
        "breadth-first-search"
      ],
      "starterCodePython": "class Solution:\n    def minMutation(self, startGene: str, endGene: str, bank: List[str]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int minMutation(string startGene, string endGene, vector<string>& bank) {\n        \n    }\n};",
      "methodName": "minMutation",
      "executionContract": {
        "name": "minMutation",
        "params": [
          {
            "name": "startGene",
            "type": "string"
          },
          {
            "name": "endGene",
            "type": "string"
          },
          {
            "name": "bank",
            "type": "string[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:50.637Z",
      "referenceSolutionHash": "sha256:817569fdda709fd46c37562faa4e7b8767ad8d9e003b768ffa76ff4cac1cfe79",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "startGene": "AACCGGTT",
            "endGene": "AACCGGTA",
            "bank": [
              "AACCGGTA"
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"AACCGGTT\"\n\"AACCGGTA\"\n[\"AACCGGTA\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "startGene": "AACCGGTT",
            "endGene": "AAACGGTA",
            "bank": [
              "AACCGGTA",
              "AACCGCTA",
              "AAACGGTA"
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"AACCGGTT\"\n\"AAACGGTA\"\n[\"AACCGGTA\",\"AACCGCTA\",\"AAACGGTA\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 127,
      "slug": "word-ladder",
      "title": "Word Ladder",
      "difficulty": "Hard",
      "hot150Order": 97,
      "hot150Section": "Graph BFS",
      "officialUrl": "https://leetcode.com/problems/word-ladder/",
      "statementMarkdown": "A transformation sequence from word beginWord to word endWord using a dictionary wordList is a sequence of words beginWord -> s1 -> s2 -> ... -> sk such that:\n\n\t- Every adjacent pair of words differs by a single letter.\n\n\t- Every si for 1 <= i <= k is in wordList. Note that beginWord does not need to be in wordList.\n\n\t- sk == endWord\n\nGiven two words, beginWord and endWord, and a dictionary wordList, return the number of words in the shortest transformation sequence from beginWord to endWord, or 0 if no such sequence exists.\n\n \n\nExample 1:\n\n```text\n\nInput: beginWord = \"hit\", endWord = \"cog\", wordList = [\"hot\",\"dot\",\"dog\",\"lot\",\"log\",\"cog\"]\nOutput: 5\nExplanation: One shortest transformation sequence is \"hit\" -> \"hot\" -> \"dot\" -> \"dog\" -> cog\", which is 5 words long.\n\n```\n\nExample 2:\n\n```text\n\nInput: beginWord = \"hit\", endWord = \"cog\", wordList = [\"hot\",\"dot\",\"dog\",\"lot\",\"log\"]\nOutput: 0\nExplanation: The endWord \"cog\" is not in wordList, therefore there is no valid transformation sequence.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= beginWord.length <= 10\n\n\t- endWord.length == beginWord.length\n\n\t- 1 <= wordList.length <= 5000\n\n\t- wordList[i].length == beginWord.length\n\n\t- beginWord, endWord, and wordList[i] consist of lowercase English letters.\n\n\t- beginWord != endWord\n\n\t- All the words in wordList are unique.",
      "examples": [
        {
          "input": {
            "beginWord": "hit",
            "endWord": "cog",
            "wordList": [
              "hot",
              "dot",
              "dog",
              "lot",
              "log",
              "cog"
            ]
          },
          "output": 5
        },
        {
          "input": {
            "beginWord": "hit",
            "endWord": "cog",
            "wordList": [
              "hot",
              "dot",
              "dog",
              "lot",
              "log"
            ]
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "graph",
        "bfs",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "string",
        "breadth-first-search"
      ],
      "starterCodePython": "class Solution:\n    def ladderLength(self, beginWord: str, endWord: str, wordList: List[str]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int ladderLength(string beginWord, string endWord, vector<string>& wordList) {\n        \n    }\n};",
      "methodName": "ladderLength",
      "executionContract": {
        "name": "ladderLength",
        "params": [
          {
            "name": "beginWord",
            "type": "string"
          },
          {
            "name": "endWord",
            "type": "string"
          },
          {
            "name": "wordList",
            "type": "list<string>"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:51.023Z",
      "referenceSolutionHash": "sha256:c118b47e9039106e4f804d70045b0742c5e8dfc1cd53739f106aeb194df20caa",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "beginWord": "hit",
            "endWord": "cog",
            "wordList": [
              "hot",
              "dot",
              "dog",
              "lot",
              "log",
              "cog"
            ]
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"hit\"\n\"cog\"\n[\"hot\",\"dot\",\"dog\",\"lot\",\"log\",\"cog\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "beginWord": "hit",
            "endWord": "cog",
            "wordList": [
              "hot",
              "dot",
              "dog",
              "lot",
              "log"
            ]
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"hit\"\n\"cog\"\n[\"hot\",\"dot\",\"dog\",\"lot\",\"log\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 208,
      "slug": "implement-trie-prefix-tree",
      "title": "Implement Trie (Prefix Tree)",
      "difficulty": "Medium",
      "hot150Order": 98,
      "hot150Section": "Trie",
      "officialUrl": "https://leetcode.com/problems/implement-trie-prefix-tree/",
      "statementMarkdown": "A trie (pronounced as \"try\") or prefix tree is a tree data structure used to efficiently store and retrieve keys in a dataset of strings. There are various applications of this data structure, such as autocomplete and spellchecker.\n\nImplement the Trie class:\n\n\t- Trie() Initializes the trie object.\n\n\t- void insert(String word) Inserts the string word into the trie.\n\n\t- boolean search(String word) Returns true if the string word is in the trie (i.e., was inserted before), and false otherwise.\n\n\t- boolean startsWith(String prefix) Returns true if there is a previously inserted string word that has the prefix prefix, and false otherwise.\n\n \n\nExample 1:\n\n```text\n\nInput\n[\"Trie\", \"insert\", \"search\", \"search\", \"startsWith\", \"insert\", \"search\"]\n[[], [\"apple\"], [\"apple\"], [\"app\"], [\"app\"], [\"app\"], [\"app\"]]\nOutput\n[null, null, true, false, true, null, true]\n\nExplanation\nTrie trie = new Trie();\ntrie.insert(\"apple\");\ntrie.search(\"apple\");   // return True\ntrie.search(\"app\");     // return False\ntrie.startsWith(\"app\"); // return True\ntrie.insert(\"app\");\ntrie.search(\"app\");     // return True\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= word.length, prefix.length <= 2000\n\n\t- word and prefix consist only of lowercase English letters.\n\n\t- At most 3 * 104 calls in total will be made to insert, search, and startsWith.",
      "examples": [
        {
          "input": {
            "operations": [
              "Trie",
              "insert",
              "search",
              "search",
              "startsWith",
              "insert",
              "search"
            ],
            "arguments": [
              [],
              [
                "apple"
              ],
              [
                "apple"
              ],
              [
                "app"
              ],
              [
                "app"
              ],
              [
                "app"
              ],
              [
                "app"
              ]
            ]
          },
          "output": [
            null,
            null,
            true,
            false,
            true,
            null,
            true
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "trie",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "string",
        "design"
      ],
      "starterCodePython": "class Trie:\n\n    def __init__(self):\n        \n\n    def insert(self, word: str) -> None:\n        \n\n    def search(self, word: str) -> bool:\n        \n\n    def startsWith(self, prefix: str) -> bool:\n        \n\n\n# Your Trie object will be instantiated and called as such:\n# obj = Trie()\n# obj.insert(word)\n# param_2 = obj.search(word)\n# param_3 = obj.startsWith(prefix)",
      "starterCodeCpp": "class Trie {\npublic:\n    Trie() {\n        \n    }\n    \n    void insert(string word) {\n        \n    }\n    \n    bool search(string word) {\n        \n    }\n    \n    bool startsWith(string prefix) {\n        \n    }\n};\n\n/**\n * Your Trie object will be instantiated and called as such:\n * Trie* obj = new Trie();\n * obj->insert(word);\n * bool param_2 = obj->search(word);\n * bool param_3 = obj->startsWith(prefix);\n */",
      "methodName": "Trie",
      "executionContract": {
        "name": "Trie",
        "params": [],
        "returnType": "unknown",
        "contractKind": "design_class"
      },
      "comparisonStrategy": "op_sequence",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:51.488Z",
      "referenceSolutionHash": "sha256:c305305bce7cf48d278e6f3a889c716f841c901b13c04cbe1cb00ffbb6ddf6da",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "operations": [
              "Trie",
              "insert",
              "search",
              "search",
              "startsWith",
              "insert",
              "search"
            ],
            "arguments": [
              [],
              [
                "apple"
              ],
              [
                "apple"
              ],
              [
                "app"
              ],
              [
                "app"
              ],
              [
                "app"
              ],
              [
                "app"
              ]
            ]
          },
          "expected": [
            null,
            null,
            true,
            false,
            true,
            null,
            true
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"Trie\",\"insert\",\"search\",\"search\",\"startsWith\",\"insert\",\"search\"]\n[[],[\"apple\"],[\"apple\"],[\"app\"],[\"app\"],[\"app\"],[\"app\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 211,
      "slug": "design-add-and-search-words-data-structure",
      "title": "Design Add and Search Words Data Structure",
      "difficulty": "Medium",
      "hot150Order": 99,
      "hot150Section": "Trie",
      "officialUrl": "https://leetcode.com/problems/design-add-and-search-words-data-structure/",
      "statementMarkdown": "Design a data structure that supports adding new words and finding if a string matches any previously added string.\n\nImplement the WordDictionary class:\n\n\t- WordDictionary() Initializes the object.\n\n\t- void addWord(word) Adds word to the data structure, it can be matched later.\n\n\t- bool search(word) Returns true if there is any string in the data structure that matches word or false otherwise. word may contain dots '.' where dots can be matched with any letter.\n\n \n\nExample:\n\n```text\n\nInput\n[\"WordDictionary\",\"addWord\",\"addWord\",\"addWord\",\"search\",\"search\",\"search\",\"search\"]\n[[],[\"bad\"],[\"dad\"],[\"mad\"],[\"pad\"],[\"bad\"],[\".ad\"],[\"b..\"]]\nOutput\n[null,null,null,null,false,true,true,true]\n\nExplanation\nWordDictionary wordDictionary = new WordDictionary();\nwordDictionary.addWord(\"bad\");\nwordDictionary.addWord(\"dad\");\nwordDictionary.addWord(\"mad\");\nwordDictionary.search(\"pad\"); // return False\nwordDictionary.search(\"bad\"); // return True\nwordDictionary.search(\".ad\"); // return True\nwordDictionary.search(\"b..\"); // return True\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= word.length <= 25\n\n\t- word in addWord consists of lowercase English letters.\n\n\t- word in search consist of '.' or lowercase English letters.\n\n\t- There will be at most 2 dots in word for search queries.\n\n\t- At most 104 calls will be made to addWord and search.",
      "examples": [
        {
          "input": {
            "operations": [
              "WordDictionary",
              "addWord",
              "addWord",
              "addWord",
              "search",
              "search",
              "search",
              "search"
            ],
            "arguments": [
              [],
              [
                "bad"
              ],
              [
                "dad"
              ],
              [
                "mad"
              ],
              [
                "pad"
              ],
              [
                "bad"
              ],
              [
                ".ad"
              ],
              [
                "b.."
              ]
            ]
          },
          "output": [
            null,
            null,
            null,
            null,
            false,
            true,
            true,
            true
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "trie",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string",
        "depth-first-search",
        "design"
      ],
      "starterCodePython": "class WordDictionary:\n\n    def __init__(self):\n        \n\n    def addWord(self, word: str) -> None:\n        \n\n    def search(self, word: str) -> bool:\n        \n\n\n# Your WordDictionary object will be instantiated and called as such:\n# obj = WordDictionary()\n# obj.addWord(word)\n# param_2 = obj.search(word)",
      "starterCodeCpp": "class WordDictionary {\npublic:\n    WordDictionary() {\n        \n    }\n    \n    void addWord(string word) {\n        \n    }\n    \n    bool search(string word) {\n        \n    }\n};\n\n/**\n * Your WordDictionary object will be instantiated and called as such:\n * WordDictionary* obj = new WordDictionary();\n * obj->addWord(word);\n * bool param_2 = obj->search(word);\n */",
      "methodName": "WordDictionary",
      "executionContract": {
        "name": "WordDictionary",
        "params": [],
        "returnType": "unknown",
        "contractKind": "design_class"
      },
      "comparisonStrategy": "op_sequence",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:51.926Z",
      "referenceSolutionHash": "sha256:2442a561990f4001eff57026faf51d9bd7226b7b4191da2e215516d4d6ef9b6c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "operations": [
              "WordDictionary",
              "addWord",
              "addWord",
              "addWord",
              "search",
              "search",
              "search",
              "search"
            ],
            "arguments": [
              [],
              [
                "bad"
              ],
              [
                "dad"
              ],
              [
                "mad"
              ],
              [
                "pad"
              ],
              [
                "bad"
              ],
              [
                ".ad"
              ],
              [
                "b.."
              ]
            ]
          },
          "expected": [
            null,
            null,
            null,
            null,
            false,
            true,
            true,
            true
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"WordDictionary\",\"addWord\",\"addWord\",\"addWord\",\"search\",\"search\",\"search\",\"search\"]\n[[],[\"bad\"],[\"dad\"],[\"mad\"],[\"pad\"],[\"bad\"],[\".ad\"],[\"b..\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 212,
      "slug": "word-search-ii",
      "title": "Word Search II",
      "difficulty": "Hard",
      "hot150Order": 100,
      "hot150Section": "Trie",
      "officialUrl": "https://leetcode.com/problems/word-search-ii/",
      "statementMarkdown": "Given an m x n board of characters and a list of strings words, return all words on the board.\n\nEach word must be constructed from letters of sequentially adjacent cells, where adjacent cells are horizontally or vertically neighboring. The same letter cell may not be used more than once in a word.\n\n \n\nExample 1:\n\n```text\n\nInput: board = [[\"o\",\"a\",\"a\",\"n\"],[\"e\",\"t\",\"a\",\"e\"],[\"i\",\"h\",\"k\",\"r\"],[\"i\",\"f\",\"l\",\"v\"]], words = [\"oath\",\"pea\",\"eat\",\"rain\"]\nOutput: [\"eat\",\"oath\"]\n\n```\n\nExample 2:\n\n```text\n\nInput: board = [[\"a\",\"b\"],[\"c\",\"d\"]], words = [\"abcb\"]\nOutput: []\n\n```\n\n \n\nConstraints:\n\n\t- m == board.length\n\n\t- n == board[i].length\n\n\t- 1 <= m, n <= 12\n\n\t- board[i][j] is a lowercase English letter.\n\n\t- 1 <= words.length <= 3 * 104\n\n\t- 1 <= words[i].length <= 10\n\n\t- words[i] consists of lowercase English letters.\n\n\t- All the strings of words are unique.",
      "examples": [
        {
          "input": {
            "board": [
              [
                "o",
                "a",
                "a",
                "n"
              ],
              [
                "e",
                "t",
                "a",
                "e"
              ],
              [
                "i",
                "h",
                "k",
                "r"
              ],
              [
                "i",
                "f",
                "l",
                "v"
              ]
            ],
            "words": [
              "oath",
              "pea",
              "eat",
              "rain"
            ]
          },
          "output": [
            "oath",
            "eat"
          ]
        },
        {
          "input": {
            "board": [
              [
                "a",
                "b"
              ],
              [
                "c",
                "d"
              ]
            ],
            "words": [
              "abcb"
            ]
          },
          "output": []
        }
      ],
      "constraints": [],
      "tags": [
        "trie",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "string",
        "backtracking",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def findWords(self, board: List[List[str]], words: List[str]) -> List[str]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<string> findWords(vector<vector<char>>& board, vector<string>& words) {\n        \n    }\n};",
      "methodName": "findWords",
      "executionContract": {
        "name": "findWords",
        "params": [
          {
            "name": "board",
            "type": "character[][]"
          },
          {
            "name": "words",
            "type": "string[]"
          }
        ],
        "returnType": "list<string>",
        "contractKind": "grid"
      },
      "comparisonStrategy": "multiset_top",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:52.322Z",
      "referenceSolutionHash": "sha256:b157b5152a562007d6f860371cb2c1d7d880d6c7618b9bb675b09021f122d396",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "board": [
              [
                "o",
                "a",
                "a",
                "n"
              ],
              [
                "e",
                "t",
                "a",
                "e"
              ],
              [
                "i",
                "h",
                "k",
                "r"
              ],
              [
                "i",
                "f",
                "l",
                "v"
              ]
            ],
            "words": [
              "oath",
              "pea",
              "eat",
              "rain"
            ]
          },
          "expected": [
            "oath",
            "eat"
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[\"o\",\"a\",\"a\",\"n\"],[\"e\",\"t\",\"a\",\"e\"],[\"i\",\"h\",\"k\",\"r\"],[\"i\",\"f\",\"l\",\"v\"]]\n[\"oath\",\"pea\",\"eat\",\"rain\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "board": [
              [
                "a",
                "b"
              ],
              [
                "c",
                "d"
              ]
            ],
            "words": [
              "abcb"
            ]
          },
          "expected": [],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[\"a\",\"b\"],[\"c\",\"d\"]]\n[\"abcb\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 17,
      "slug": "letter-combinations-of-a-phone-number",
      "title": "Letter Combinations of a Phone Number",
      "difficulty": "Medium",
      "hot150Order": 101,
      "hot150Section": "Backtracking",
      "officialUrl": "https://leetcode.com/problems/letter-combinations-of-a-phone-number/",
      "statementMarkdown": "Given a string containing digits from 2-9 inclusive, return all possible letter combinations that the number could represent. Return the answer in any order.\n\nA mapping of digits to letters (just like on the telephone buttons) is given below. Note that 1 does not map to any letters.\n\n \n\nExample 1:\n\n```text\n\nInput: digits = \"23\"\nOutput: [\"ad\",\"ae\",\"af\",\"bd\",\"be\",\"bf\",\"cd\",\"ce\",\"cf\"]\n\n```\n\nExample 2:\n\n```text\n\nInput: digits = \"2\"\nOutput: [\"a\",\"b\",\"c\"]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= digits.length <= 4\n\n\t- digits[i] is a digit in the range ['2', '9'].",
      "examples": [
        {
          "input": {
            "digits": "23"
          },
          "output": [
            "ad",
            "ae",
            "af",
            "bd",
            "be",
            "bf",
            "cd",
            "ce",
            "cf"
          ]
        },
        {
          "input": {
            "digits": "2"
          },
          "output": [
            "a",
            "b",
            "c"
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "backtracking",
        "top-interview-150",
        "interview-150",
        "hot150",
        "hash-table",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def letterCombinations(self, digits: str) -> List[str]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<string> letterCombinations(string digits) {\n        \n    }\n};",
      "methodName": "letterCombinations",
      "executionContract": {
        "name": "letterCombinations",
        "params": [
          {
            "name": "digits",
            "type": "string"
          }
        ],
        "returnType": "list<string>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_top",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:52.716Z",
      "referenceSolutionHash": "sha256:b06b575effd665da020caa8cb0377530d11d4cdf2838982ebb453d05cda11ee7",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "digits": "23"
          },
          "expected": [
            "ad",
            "ae",
            "af",
            "bd",
            "be",
            "bf",
            "cd",
            "ce",
            "cf"
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"23\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "digits": "2"
          },
          "expected": [
            "a",
            "b",
            "c"
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"2\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 77,
      "slug": "combinations",
      "title": "Combinations",
      "difficulty": "Medium",
      "hot150Order": 102,
      "hot150Section": "Backtracking",
      "officialUrl": "https://leetcode.com/problems/combinations/",
      "statementMarkdown": "Given two integers n and k, return all possible combinations of k numbers chosen from the range [1, n].\n\nYou may return the answer in any order.\n\n \n\nExample 1:\n\n```text\n\nInput: n = 4, k = 2\nOutput: [[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]]\nExplanation: There are 4 choose 2 = 6 total combinations.\nNote that combinations are unordered, i.e., [1,2] and [2,1] are considered to be the same combination.\n\n```\n\nExample 2:\n\n```text\n\nInput: n = 1, k = 1\nOutput: [[1]]\nExplanation: There is 1 choose 1 = 1 total combination.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= n <= 20\n\n\t- 1 <= k <= n",
      "examples": [
        {
          "input": {
            "n": 4,
            "k": 2
          },
          "output": [
            [
              1,
              2
            ],
            [
              1,
              3
            ],
            [
              1,
              4
            ],
            [
              2,
              3
            ],
            [
              2,
              4
            ],
            [
              3,
              4
            ]
          ]
        },
        {
          "input": {
            "n": 1,
            "k": 1
          },
          "output": [
            [
              1
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "backtracking",
        "top-interview-150",
        "interview-150",
        "hot150"
      ],
      "starterCodePython": "class Solution:\n    def combine(self, n: int, k: int) -> List[List[int]]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<vector<int>> combine(int n, int k) {\n        \n    }\n};",
      "methodName": "combine",
      "executionContract": {
        "name": "combine",
        "params": [
          {
            "name": "n",
            "type": "integer"
          },
          {
            "name": "k",
            "type": "integer"
          }
        ],
        "returnType": "list<list<integer>>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_deep",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:53.155Z",
      "referenceSolutionHash": "sha256:29ce40e43a0bde38b00fd229c51b0923f3ad1b73ac0894291a41385d6aa503ea",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "n": 4,
            "k": 2
          },
          "expected": [
            [
              1,
              2
            ],
            [
              1,
              3
            ],
            [
              1,
              4
            ],
            [
              2,
              3
            ],
            [
              2,
              4
            ],
            [
              3,
              4
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "4\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "n": 1,
            "k": 1
          },
          "expected": [
            [
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "1\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 46,
      "slug": "permutations",
      "title": "Permutations",
      "difficulty": "Medium",
      "hot150Order": 103,
      "hot150Section": "Backtracking",
      "officialUrl": "https://leetcode.com/problems/permutations/",
      "statementMarkdown": "Given an array nums of distinct integers, return all the possible permutations. You can return the answer in any order.\n\n \n\nExample 1:\n\n```text\nInput: nums = [1,2,3]\nOutput: [[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]\n\n```\nExample 2:\n\n```text\nInput: nums = [0,1]\nOutput: [[0,1],[1,0]]\n\n```\nExample 3:\n\n```text\nInput: nums = [1]\nOutput: [[1]]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 6\n\n\t- -10 <= nums[i] <= 10\n\n\t- All the integers of nums are unique.",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              2,
              3
            ]
          },
          "output": [
            [
              1,
              2,
              3
            ],
            [
              1,
              3,
              2
            ],
            [
              2,
              1,
              3
            ],
            [
              2,
              3,
              1
            ],
            [
              3,
              1,
              2
            ],
            [
              3,
              2,
              1
            ]
          ]
        },
        {
          "input": {
            "nums": [
              0,
              1
            ]
          },
          "output": [
            [
              0,
              1
            ],
            [
              1,
              0
            ]
          ]
        },
        {
          "input": {
            "nums": [
              1
            ]
          },
          "output": [
            [
              1
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "backtracking",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def permute(self, nums: List[int]) -> List[List[int]]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<vector<int>> permute(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "permute",
      "executionContract": {
        "name": "permute",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "list<list<integer>>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_top",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:53.536Z",
      "referenceSolutionHash": "sha256:777a3f838318d3c602876518e545ebf226deced624fa7881536ea6ebabc32411",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              2,
              3
            ]
          },
          "expected": [
            [
              1,
              2,
              3
            ],
            [
              1,
              3,
              2
            ],
            [
              2,
              1,
              3
            ],
            [
              2,
              3,
              1
            ],
            [
              3,
              1,
              2
            ],
            [
              3,
              2,
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              1
            ]
          },
          "expected": [
            [
              0,
              1
            ],
            [
              1,
              0
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              1
            ]
          },
          "expected": [
            [
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 39,
      "slug": "combination-sum",
      "title": "Combination Sum",
      "difficulty": "Medium",
      "hot150Order": 104,
      "hot150Section": "Backtracking",
      "officialUrl": "https://leetcode.com/problems/combination-sum/",
      "statementMarkdown": "Given an array of distinct integers candidates and a target integer target, return a list of all unique combinations of candidates where the chosen numbers sum to target. You may return the combinations in any order.\n\nThe same number may be chosen from candidates an unlimited number of times. Two combinations are unique if the frequency of at least one of the chosen numbers is different.\n\nThe test cases are generated such that the number of unique combinations that sum up to target is less than 150 combinations for the given input.\n\n \n\nExample 1:\n\n```text\n\nInput: candidates = [2,3,6,7], target = 7\nOutput: [[2,2,3],[7]]\nExplanation:\n2 and 3 are candidates, and 2 + 2 + 3 = 7. Note that 2 can be used multiple times.\n7 is a candidate, and 7 = 7.\nThese are the only two combinations.\n\n```\n\nExample 2:\n\n```text\n\nInput: candidates = [2,3,5], target = 8\nOutput: [[2,2,2,2],[2,3,3],[3,5]]\n\n```\n\nExample 3:\n\n```text\n\nInput: candidates = [2], target = 1\nOutput: []\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= candidates.length <= 30\n\n\t- 2 <= candidates[i] <= 40\n\n\t- All elements of candidates are distinct.\n\n\t- 1 <= target <= 40",
      "examples": [
        {
          "input": {
            "candidates": [
              2,
              3,
              6,
              7
            ],
            "target": 7
          },
          "output": [
            [
              2,
              2,
              3
            ],
            [
              7
            ]
          ]
        },
        {
          "input": {
            "candidates": [
              2,
              3,
              5
            ],
            "target": 8
          },
          "output": [
            [
              2,
              2,
              2,
              2
            ],
            [
              2,
              3,
              3
            ],
            [
              3,
              5
            ]
          ]
        },
        {
          "input": {
            "candidates": [
              2
            ],
            "target": 1
          },
          "output": []
        }
      ],
      "constraints": [],
      "tags": [
        "backtracking",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def combinationSum(self, candidates: List[int], target: int) -> List[List[int]]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<vector<int>> combinationSum(vector<int>& candidates, int target) {\n        \n    }\n};",
      "methodName": "combinationSum",
      "executionContract": {
        "name": "combinationSum",
        "params": [
          {
            "name": "candidates",
            "type": "integer[]"
          },
          {
            "name": "target",
            "type": "integer"
          }
        ],
        "returnType": "list<list<integer>>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_deep",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:53.987Z",
      "referenceSolutionHash": "sha256:9b48cfe79fa3510223d746f69cc3ecf614191b9536029ce13d6adad0a7e6cb37",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "candidates": [
              2,
              3,
              6,
              7
            ],
            "target": 7
          },
          "expected": [
            [
              2,
              2,
              3
            ],
            [
              7
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,3,6,7]\n7",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "candidates": [
              2,
              3,
              5
            ],
            "target": 8
          },
          "expected": [
            [
              2,
              2,
              2,
              2
            ],
            [
              2,
              3,
              3
            ],
            [
              3,
              5
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2,3,5]\n8",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "candidates": [
              2
            ],
            "target": 1
          },
          "expected": [],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[2]\n1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 52,
      "slug": "n-queens-ii",
      "title": "N-Queens II",
      "difficulty": "Hard",
      "hot150Order": 105,
      "hot150Section": "Backtracking",
      "officialUrl": "https://leetcode.com/problems/n-queens-ii/",
      "statementMarkdown": "The n-queens puzzle is the problem of placing n queens on an n x n chessboard such that no two queens attack each other.\n\nGiven an integer n, return the number of distinct solutions to the n-queens puzzle.\n\n \n\nExample 1:\n\n```text\n\nInput: n = 4\nOutput: 2\nExplanation: There are two distinct solutions to the 4-queens puzzle as shown.\n\n```\n\nExample 2:\n\n```text\n\nInput: n = 1\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= n <= 9",
      "examples": [
        {
          "input": {
            "n": 4
          },
          "output": 2
        },
        {
          "input": {
            "n": 1
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "backtracking",
        "top-interview-150",
        "interview-150",
        "hot150"
      ],
      "starterCodePython": "class Solution:\n    def totalNQueens(self, n: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int totalNQueens(int n) {\n        \n    }\n};",
      "methodName": "totalNQueens",
      "executionContract": {
        "name": "totalNQueens",
        "params": [
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:54.389Z",
      "referenceSolutionHash": "sha256:f9c383a59ab18e46bc03e0fe60d8f902328e77b4c61ebdeada1b122d92525e62",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "n": 4
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "4",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "n": 1
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 22,
      "slug": "generate-parentheses",
      "title": "Generate Parentheses",
      "difficulty": "Medium",
      "hot150Order": 106,
      "hot150Section": "Backtracking",
      "officialUrl": "https://leetcode.com/problems/generate-parentheses/",
      "statementMarkdown": "Given n pairs of parentheses, write a function to generate all combinations of well-formed parentheses.\n\n \n\nExample 1:\n\n```text\nInput: n = 3\nOutput: [\"((()))\",\"(()())\",\"(())()\",\"()(())\",\"()()()\"]\n\n```\nExample 2:\n\n```text\nInput: n = 1\nOutput: [\"()\"]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= n <= 8",
      "examples": [
        {
          "input": {
            "n": 3
          },
          "output": [
            "((()))",
            "(()())",
            "(())()",
            "()(())",
            "()()()"
          ]
        },
        {
          "input": {
            "n": 1
          },
          "output": [
            "()"
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "backtracking",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string",
        "dynamic-programming"
      ],
      "starterCodePython": "class Solution:\n    def generateParenthesis(self, n: int) -> List[str]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<string> generateParenthesis(int n) {\n        \n    }\n};",
      "methodName": "generateParenthesis",
      "executionContract": {
        "name": "generateParenthesis",
        "params": [
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "list<string>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_top",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:54.758Z",
      "referenceSolutionHash": "sha256:1b27ce2167c0c0091bf1207ddba5068e4f687346a27164ec2c9c7fa2339e7ced",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "n": 3
          },
          "expected": [
            "((()))",
            "(()())",
            "(())()",
            "()(())",
            "()()()"
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "n": 1
          },
          "expected": [
            "()"
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "1",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 79,
      "slug": "word-search",
      "title": "Word Search",
      "difficulty": "Medium",
      "hot150Order": 107,
      "hot150Section": "Backtracking",
      "officialUrl": "https://leetcode.com/problems/word-search/",
      "statementMarkdown": "Given an m x n grid of characters board and a string word, return true if word exists in the grid.\n\nThe word can be constructed from letters of sequentially adjacent cells, where adjacent cells are horizontally or vertically neighboring. The same letter cell may not be used more than once.\n\n \n\nExample 1:\n\n```text\n\nInput: board = [[\"A\",\"B\",\"C\",\"E\"],[\"S\",\"F\",\"C\",\"S\"],[\"A\",\"D\",\"E\",\"E\"]], word = \"ABCCED\"\nOutput: true\n\n```\n\nExample 2:\n\n```text\n\nInput: board = [[\"A\",\"B\",\"C\",\"E\"],[\"S\",\"F\",\"C\",\"S\"],[\"A\",\"D\",\"E\",\"E\"]], word = \"SEE\"\nOutput: true\n\n```\n\nExample 3:\n\n```text\n\nInput: board = [[\"A\",\"B\",\"C\",\"E\"],[\"S\",\"F\",\"C\",\"S\"],[\"A\",\"D\",\"E\",\"E\"]], word = \"ABCB\"\nOutput: false\n\n```\n\n \n\nConstraints:\n\n\t- m == board.length\n\n\t- n = board[i].length\n\n\t- 1 <= m, n <= 6\n\n\t- 1 <= word.length <= 15\n\n\t- board and word consists of only lowercase and uppercase English letters.\n\n \n\nFollow up: Could you use search pruning to make your solution faster with a larger board?",
      "examples": [
        {
          "input": {
            "board": [
              [
                "A",
                "B",
                "C",
                "E"
              ],
              [
                "S",
                "F",
                "C",
                "S"
              ],
              [
                "A",
                "D",
                "E",
                "E"
              ]
            ],
            "word": "ABCCED"
          },
          "output": true
        },
        {
          "input": {
            "board": [
              [
                "A",
                "B",
                "C",
                "E"
              ],
              [
                "S",
                "F",
                "C",
                "S"
              ],
              [
                "A",
                "D",
                "E",
                "E"
              ]
            ],
            "word": "SEE"
          },
          "output": true
        },
        {
          "input": {
            "board": [
              [
                "A",
                "B",
                "C",
                "E"
              ],
              [
                "S",
                "F",
                "C",
                "S"
              ],
              [
                "A",
                "D",
                "E",
                "E"
              ]
            ],
            "word": "ABCB"
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "backtracking",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "string",
        "depth-first-search",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def exist(self, board: List[List[str]], word: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool exist(vector<vector<char>>& board, string word) {\n        \n    }\n};",
      "methodName": "exist",
      "executionContract": {
        "name": "exist",
        "params": [
          {
            "name": "board",
            "type": "character[][]"
          },
          {
            "name": "word",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:55.582Z",
      "referenceSolutionHash": "sha256:9f69ec82fabd4c7a496631d210927753f5aae4757d2ba7483f8328e6e601d9ed",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "board": [
              [
                "A",
                "B",
                "C",
                "E"
              ],
              [
                "S",
                "F",
                "C",
                "S"
              ],
              [
                "A",
                "D",
                "E",
                "E"
              ]
            ],
            "word": "ABCCED"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[\"A\",\"B\",\"C\",\"E\"],[\"S\",\"F\",\"C\",\"S\"],[\"A\",\"D\",\"E\",\"E\"]]\n\"ABCCED\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "board": [
              [
                "A",
                "B",
                "C",
                "E"
              ],
              [
                "S",
                "F",
                "C",
                "S"
              ],
              [
                "A",
                "D",
                "E",
                "E"
              ]
            ],
            "word": "SEE"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[\"A\",\"B\",\"C\",\"E\"],[\"S\",\"F\",\"C\",\"S\"],[\"A\",\"D\",\"E\",\"E\"]]\n\"SEE\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "board": [
              [
                "A",
                "B",
                "C",
                "E"
              ],
              [
                "S",
                "F",
                "C",
                "S"
              ],
              [
                "A",
                "D",
                "E",
                "E"
              ]
            ],
            "word": "ABCB"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[[\"A\",\"B\",\"C\",\"E\"],[\"S\",\"F\",\"C\",\"S\"],[\"A\",\"D\",\"E\",\"E\"]]\n\"ABCB\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 108,
      "slug": "convert-sorted-array-to-binary-search-tree",
      "title": "Convert Sorted Array to Binary Search Tree",
      "difficulty": "Easy",
      "hot150Order": 108,
      "hot150Section": "Divide & Conquer",
      "officialUrl": "https://leetcode.com/problems/convert-sorted-array-to-binary-search-tree/",
      "statementMarkdown": "Given an integer array nums where the elements are sorted in ascending order, convert it to a height-balanced binary search tree.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [-10,-3,0,5,9]\nOutput: [0,-3,9,-10,null,5]\nExplanation: [0,-10,5,null,-3,null,9] is also accepted:\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [1,3]\nOutput: [3,1]\nExplanation: [1,null,3] and [3,1] are both height-balanced BSTs.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 104\n\n\t- -104 <= nums[i] <= 104\n\n\t- nums is sorted in a strictly increasing order.",
      "examples": [
        {
          "input": {
            "nums": [
              -10,
              -3,
              0,
              5,
              9
            ]
          },
          "output": [
            0,
            -10,
            5,
            null,
            -3,
            null,
            9
          ]
        },
        {
          "input": {
            "nums": [
              1,
              3
            ]
          },
          "output": [
            1,
            null,
            3
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "divide-and-conquer",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "tree",
        "binary-search-tree",
        "binary-tree"
      ],
      "starterCodePython": "# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\nclass Solution:\n    def sortedArrayToBST(self, nums: List[int]) -> Optional[TreeNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for a binary tree node.\n * struct TreeNode {\n *     int val;\n *     TreeNode *left;\n *     TreeNode *right;\n *     TreeNode() : val(0), left(nullptr), right(nullptr) {}\n *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}\n *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}\n * };\n */\nclass Solution {\npublic:\n    TreeNode* sortedArrayToBST(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "sortedArrayToBST",
      "executionContract": {
        "name": "sortedArrayToBST",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "TreeNode",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:56.066Z",
      "referenceSolutionHash": "sha256:c25d926349fd9487c8c01847d2e13b0db0166fa851840b54b594d411ae218d86",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              -10,
              -3,
              0,
              5,
              9
            ]
          },
          "expected": [
            0,
            -10,
            5,
            null,
            -3,
            null,
            9
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[-10,-3,0,5,9]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              1,
              3
            ]
          },
          "expected": [
            1,
            null,
            3
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 148,
      "slug": "sort-list",
      "title": "Sort List",
      "difficulty": "Medium",
      "hot150Order": 109,
      "hot150Section": "Divide & Conquer",
      "officialUrl": "https://leetcode.com/problems/sort-list/",
      "statementMarkdown": "Given the head of a linked list, return the list after sorting it in ascending order.\n\n \n\nExample 1:\n\n```text\n\nInput: head = [4,2,1,3]\nOutput: [1,2,3,4]\n\n```\n\nExample 2:\n\n```text\n\nInput: head = [-1,5,3,4,0]\nOutput: [-1,0,3,4,5]\n\n```\n\nExample 3:\n\n```text\n\nInput: head = []\nOutput: []\n\n```\n\n \n\nConstraints:\n\n\t- The number of nodes in the list is in the range [0, 5 * 104].\n\n\t- -105 <= Node.val <= 105\n\n \n\nFollow up: Can you sort the linked list in O(n logn) time and O(1) memory (i.e. constant space)?",
      "examples": [
        {
          "input": {
            "head": [
              4,
              2,
              1,
              3
            ]
          },
          "output": [
            1,
            2,
            3,
            4
          ]
        },
        {
          "input": {
            "head": [
              -1,
              5,
              3,
              4,
              0
            ]
          },
          "output": [
            -1,
            0,
            3,
            4,
            5
          ]
        },
        {
          "input": {
            "head": []
          },
          "output": null
        }
      ],
      "constraints": [],
      "tags": [
        "divide-and-conquer",
        "top-interview-150",
        "interview-150",
        "hot150",
        "linked-list",
        "two-pointers",
        "sorting",
        "merge-sort"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def sortList(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* sortList(ListNode* head) {\n        \n    }\n};",
      "methodName": "sortList",
      "executionContract": {
        "name": "sortList",
        "params": [
          {
            "name": "head",
            "type": "ListNode"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:56.455Z",
      "referenceSolutionHash": "sha256:46e860ddd0c8c5c721a9dabf76e911f962fc12cea0d6ce8a481ca9d3d8308929",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "head": [
              4,
              2,
              1,
              3
            ]
          },
          "expected": [
            1,
            2,
            3,
            4
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[4,2,1,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "head": [
              -1,
              5,
              3,
              4,
              0
            ]
          },
          "expected": [
            -1,
            0,
            3,
            4,
            5
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[-1,5,3,4,0]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "head": []
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 427,
      "slug": "construct-quad-tree",
      "title": "Construct Quad Tree",
      "difficulty": "Medium",
      "hot150Order": 110,
      "hot150Section": "Divide & Conquer",
      "officialUrl": "https://leetcode.com/problems/construct-quad-tree/",
      "statementMarkdown": "Given a n * n matrix grid of 0's and 1's only. We want to represent grid with a Quad-Tree.\n\nReturn the root of the Quad-Tree representing grid.\n\nA Quad-Tree is a tree data structure in which each internal node has exactly four children. Besides, each node has two attributes:\n\n\t- val: True if the node represents a grid of 1's or False if the node represents a grid of 0's. Notice that you can assign the val to True or False when isLeaf is False, and both are accepted in the answer.\n\n\t- isLeaf: True if the node is a leaf node on the tree or False if the node has four children.\n\n```text\n\nclass Node {\n    public boolean val;\n    public boolean isLeaf;\n    public Node topLeft;\n    public Node topRight;\n    public Node bottomLeft;\n    public Node bottomRight;\n}\n```\n\nWe can construct a Quad-Tree from a two-dimensional area using the following steps:\n\n\t- If the current grid has the same value (i.e all 1's or all 0's) set isLeaf True and set val to the value of the grid and set the four children to Null and stop.\n\n\t- If the current grid has different values, set isLeaf to False and set val to any value and divide the current grid into four sub-grids as shown in the photo.\n\n\t- Recurse for each of the children with the proper sub-grid.\n\nIf you want to know more about the Quad-Tree, you can refer to the wiki.\n\nQuad-Tree format:\n\nYou don't need to read this section for solving the problem. This is only if you want to understand the output format here. The output represents the serialized format of a Quad-Tree using level order traversal, where null signifies a path terminator where no node exists below.\n\nIt is very similar to the serialization of the binary tree. The only difference is that the node is represented as a list [isLeaf, val].\n\nIf the value of isLeaf or val is True we represent it as 1 in the list [isLeaf, val] and if the value of isLeaf or val is False we represent it as 0.\n\n \n\nExample 1:\n\n```text\n\nInput: grid = [[0,1],[1,0]]\nOutput: [[0,1],[1,0],[1,1],[1,1],[1,0]]\nExplanation: The explanation of this example is shown below:\nNotice that 0 represents False and 1 represents True in the photo representing the Quad-Tree.\n\n```\n\nExample 2:\n\n```text\n\nInput: grid = [[1,1,1,1,0,0,0,0],[1,1,1,1,0,0,0,0],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[1,1,1,1,0,0,0,0],[1,1,1,1,0,0,0,0],[1,1,1,1,0,0,0,0],[1,1,1,1,0,0,0,0]]\nOutput: [[0,1],[1,1],[0,1],[1,1],[1,0],null,null,null,null,[1,0],[1,0],[1,1],[1,1]]\nExplanation: All values in the grid are not the same. We divide the grid into four sub-grids.\nThe topLeft, bottomLeft and bottomRight each has the same value.\nThe topRight have different values so we divide it into 4 sub-grids where each has the same value.\nExplanation is shown in the photo below:\n\n```\n\n \n\nConstraints:\n\n\t- n == grid.length == grid[i].length\n\n\t- n == 2x where 0 <= x <= 6",
      "examples": [
        {
          "input": {
            "grid": [
              [
                0,
                1
              ],
              [
                1,
                0
              ]
            ]
          },
          "output": [
            [
              0,
              1
            ],
            [
              1,
              0
            ],
            [
              1,
              1
            ],
            [
              1,
              1
            ],
            [
              1,
              0
            ]
          ]
        },
        {
          "input": {
            "grid": [
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                1,
                1,
                1,
                1
              ],
              [
                1,
                1,
                1,
                1,
                1,
                1,
                1,
                1
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ]
            ]
          },
          "output": [
            [
              0,
              1
            ],
            [
              1,
              1
            ],
            [
              0,
              1
            ],
            [
              1,
              1
            ],
            [
              1,
              0
            ],
            [
              1,
              0
            ],
            [
              1,
              0
            ],
            [
              1,
              1
            ],
            [
              1,
              1
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "divide-and-conquer",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "tree",
        "matrix"
      ],
      "starterCodePython": "\"\"\"\n# Definition for a QuadTree node.\nclass Node:\n    def __init__(self, val, isLeaf, topLeft, topRight, bottomLeft, bottomRight):\n        self.val = val\n        self.isLeaf = isLeaf\n        self.topLeft = topLeft\n        self.topRight = topRight\n        self.bottomLeft = bottomLeft\n        self.bottomRight = bottomRight\n\"\"\"\n\nclass Solution:\n    def construct(self, grid: List[List[int]]) -> 'Node':\n        ",
      "starterCodeCpp": "/*\n// Definition for a QuadTree node.\nclass Node {\npublic:\n    bool val;\n    bool isLeaf;\n    Node* topLeft;\n    Node* topRight;\n    Node* bottomLeft;\n    Node* bottomRight;\n    \n    Node() {\n        val = false;\n        isLeaf = false;\n        topLeft = NULL;\n        topRight = NULL;\n        bottomLeft = NULL;\n        bottomRight = NULL;\n    }\n    \n    Node(bool _val, bool _isLeaf) {\n        val = _val;\n        isLeaf = _isLeaf;\n        topLeft = NULL;\n        topRight = NULL;\n        bottomLeft = NULL;\n        bottomRight = NULL;\n    }\n    \n    Node(bool _val, bool _isLeaf, Node* _topLeft, Node* _topRight, Node* _bottomLeft, Node* _bottomRight) {\n        val = _val;\n        isLeaf = _isLeaf;\n        topLeft = _topLeft;\n        topRight = _topRight;\n        bottomLeft = _bottomLeft;\n        bottomRight = _bottomRight;\n    }\n};\n*/\n\nclass Solution {\npublic:\n    Node* construct(vector<vector<int>>& grid) {\n        \n    }\n};",
      "methodName": "construct",
      "executionContract": {
        "name": "construct",
        "params": [
          {
            "name": "grid",
            "type": "integer[][]"
          }
        ],
        "returnType": "Node",
        "contractKind": "grid",
        "inputAdapter": "quad_tree"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:56.824Z",
      "referenceSolutionHash": "sha256:f50db152cb5173db42020a73dc055ffefeea087248faca832435860fb86f8aa0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "grid": [
              [
                0,
                1
              ],
              [
                1,
                0
              ]
            ]
          },
          "expected": [
            [
              0,
              1
            ],
            [
              1,
              0
            ],
            [
              1,
              1
            ],
            [
              1,
              1
            ],
            [
              1,
              0
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[0,1],[1,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "grid": [
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                1,
                1,
                1,
                1
              ],
              [
                1,
                1,
                1,
                1,
                1,
                1,
                1,
                1
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ],
              [
                1,
                1,
                1,
                1,
                0,
                0,
                0,
                0
              ]
            ]
          },
          "expected": [
            [
              0,
              1
            ],
            [
              1,
              1
            ],
            [
              0,
              1
            ],
            [
              1,
              1
            ],
            [
              1,
              0
            ],
            [
              1,
              0
            ],
            [
              1,
              0
            ],
            [
              1,
              1
            ],
            [
              1,
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,1,1,1,0,0,0,0],[1,1,1,1,0,0,0,0],[1,1,1,1,1,1,1,1],[1,1,1,1,1,1,1,1],[1,1,1,1,0,0,0,0],[1,1,1,1,0,0,0,0],[1,1,1,1,0,0,0,0],[1,1,1,1,0,0,0,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 23,
      "slug": "merge-k-sorted-lists",
      "title": "Merge k Sorted Lists",
      "difficulty": "Hard",
      "hot150Order": 111,
      "hot150Section": "Divide & Conquer",
      "officialUrl": "https://leetcode.com/problems/merge-k-sorted-lists/",
      "statementMarkdown": "You are given an array of k linked-lists lists, each linked-list is sorted in ascending order.\n\nMerge all the linked-lists into one sorted linked-list and return it.\n\n \n\nExample 1:\n\n```text\n\nInput: lists = [[1,4,5],[1,3,4],[2,6]]\nOutput: [1,1,2,3,4,4,5,6]\nExplanation: The linked-lists are:\n[\n  1->4->5,\n  1->3->4,\n  2->6\n]\nmerging them into one sorted linked list:\n1->1->2->3->4->4->5->6\n\n```\n\nExample 2:\n\n```text\n\nInput: lists = []\nOutput: []\n\n```\n\nExample 3:\n\n```text\n\nInput: lists = [[]]\nOutput: []\n\n```\n\n \n\nConstraints:\n\n\t- k == lists.length\n\n\t- 0 <= k <= 104\n\n\t- 0 <= lists[i].length <= 500\n\n\t- -104 <= lists[i][j] <= 104\n\n\t- lists[i] is sorted in ascending order.\n\n\t- The sum of lists[i].length will not exceed 104.",
      "examples": [
        {
          "input": {
            "lists": [
              [
                1,
                4,
                5
              ],
              [
                1,
                3,
                4
              ],
              [
                2,
                6
              ]
            ]
          },
          "output": [
            1,
            1,
            2,
            3,
            4,
            4,
            5,
            6
          ]
        },
        {
          "input": {
            "lists": []
          },
          "output": null
        },
        {
          "input": {
            "lists": [
              []
            ]
          },
          "output": null
        }
      ],
      "constraints": [],
      "tags": [
        "divide-and-conquer",
        "top-interview-150",
        "interview-150",
        "hot150",
        "linked-list",
        "heap-priority-queue",
        "merge-sort"
      ],
      "starterCodePython": "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def mergeKLists(self, lists: List[Optional[ListNode]]) -> Optional[ListNode]:\n        ",
      "starterCodeCpp": "/**\n * Definition for singly-linked list.\n * struct ListNode {\n *     int val;\n *     ListNode *next;\n *     ListNode() : val(0), next(nullptr) {}\n *     ListNode(int x) : val(x), next(nullptr) {}\n *     ListNode(int x, ListNode *next) : val(x), next(next) {}\n * };\n */\nclass Solution {\npublic:\n    ListNode* mergeKLists(vector<ListNode*>& lists) {\n        \n    }\n};",
      "methodName": "mergeKLists",
      "executionContract": {
        "name": "mergeKLists",
        "params": [
          {
            "name": "lists",
            "type": "ListNode[]"
          }
        ],
        "returnType": "ListNode",
        "contractKind": "linked_list"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:57.278Z",
      "referenceSolutionHash": "sha256:9eb8f1f9de6155416d16ef6ab5a70cdca70534c26f798f316edbdb9eb4d15bf1",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "lists": [
              [
                1,
                4,
                5
              ],
              [
                1,
                3,
                4
              ],
              [
                2,
                6
              ]
            ]
          },
          "expected": [
            1,
            1,
            2,
            3,
            4,
            4,
            5,
            6
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,4,5],[1,3,4],[2,6]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "lists": []
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "lists": [
              []
            ]
          },
          "expected": null,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[[]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 53,
      "slug": "maximum-subarray",
      "title": "Maximum Subarray",
      "difficulty": "Medium",
      "hot150Order": 112,
      "hot150Section": "Kadane's Algorithm",
      "officialUrl": "https://leetcode.com/problems/maximum-subarray/",
      "statementMarkdown": "Given an integer array nums, find the subarray with the largest sum, and return its sum.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [-2,1,-3,4,-1,2,1,-5,4]\nOutput: 6\nExplanation: The subarray [4,-1,2,1] has the largest sum 6.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [1]\nOutput: 1\nExplanation: The subarray [1] has the largest sum 1.\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [5,4,-1,7,8]\nOutput: 23\nExplanation: The subarray [5,4,-1,7,8] has the largest sum 23.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 105\n\n\t- -104 <= nums[i] <= 104\n\n \n\nFollow up: If you have figured out the O(n) solution, try coding another solution using the divide and conquer approach, which is more subtle.",
      "examples": [
        {
          "input": {
            "nums": [
              -2,
              1,
              -3,
              4,
              -1,
              2,
              1,
              -5,
              4
            ]
          },
          "output": 6
        },
        {
          "input": {
            "nums": [
              1
            ]
          },
          "output": 1
        },
        {
          "input": {
            "nums": [
              5,
              4,
              -1,
              7,
              8
            ]
          },
          "output": 23
        }
      ],
      "constraints": [],
      "tags": [
        "kadane",
        "array",
        "dynamic-programming",
        "top-interview-150",
        "interview-150",
        "hot150",
        "divide-and-conquer"
      ],
      "starterCodePython": "class Solution:\n    def maxSubArray(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maxSubArray(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "maxSubArray",
      "executionContract": {
        "name": "maxSubArray",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:57.719Z",
      "referenceSolutionHash": "sha256:7f5a813307fb3e6917c58adfea42e06a28e871bcebc095c26dace42534b56b05",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              -2,
              1,
              -3,
              4,
              -1,
              2,
              1,
              -5,
              4
            ]
          },
          "expected": 6,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[-2,1,-3,4,-1,2,1,-5,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              1
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              5,
              4,
              -1,
              7,
              8
            ]
          },
          "expected": 23,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[5,4,-1,7,8]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 918,
      "slug": "maximum-sum-circular-subarray",
      "title": "Maximum Sum Circular Subarray",
      "difficulty": "Medium",
      "hot150Order": 113,
      "hot150Section": "Kadane's Algorithm",
      "officialUrl": "https://leetcode.com/problems/maximum-sum-circular-subarray/",
      "statementMarkdown": "Given a circular integer array nums of length n, return the maximum possible sum of a non-empty subarray of nums.\n\nA circular array means the end of the array connects to the beginning of the array. Formally, the next element of nums[i] is nums[(i + 1) % n] and the previous element of nums[i] is nums[(i - 1 + n) % n].\n\nA subarray may only include each element of the fixed buffer nums at most once. Formally, for a subarray nums[i], nums[i + 1], ..., nums[j], there does not exist i <= k1, k2 <= j with k1 % n == k2 % n.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [1,-2,3,-2]\nOutput: 3\nExplanation: Subarray [3] has maximum sum 3.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [5,-3,5]\nOutput: 10\nExplanation: Subarray [5,5] has maximum sum 5 + 5 = 10.\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [-3,-2,-3]\nOutput: -2\nExplanation: Subarray [-2] has maximum sum -2.\n\n```\n\n \n\nConstraints:\n\n\t- n == nums.length\n\n\t- 1 <= n <= 3 * 104\n\n\t- -3 * 104 <= nums[i] <= 3 * 104",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              -2,
              3,
              -2
            ]
          },
          "output": 3
        },
        {
          "input": {
            "nums": [
              5,
              -3,
              5
            ]
          },
          "output": 10
        },
        {
          "input": {
            "nums": [
              -3,
              -2,
              -3
            ]
          },
          "output": -2
        }
      ],
      "constraints": [],
      "tags": [
        "kadane",
        "array",
        "dynamic-programming",
        "top-interview-150",
        "interview-150",
        "hot150",
        "divide-and-conquer",
        "queue",
        "monotonic-queue"
      ],
      "starterCodePython": "class Solution:\n    def maxSubarraySumCircular(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maxSubarraySumCircular(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "maxSubarraySumCircular",
      "executionContract": {
        "name": "maxSubarraySumCircular",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:58.068Z",
      "referenceSolutionHash": "sha256:6fbb0f1a48636a7e04c8fc811bd169277ab508fecb5508e2eaeea325ccf2f5f1",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              -2,
              3,
              -2
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,-2,3,-2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              5,
              -3,
              5
            ]
          },
          "expected": 10,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[5,-3,5]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              -3,
              -2,
              -3
            ]
          },
          "expected": -2,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[-3,-2,-3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 35,
      "slug": "search-insert-position",
      "title": "Search Insert Position",
      "difficulty": "Easy",
      "hot150Order": 114,
      "hot150Section": "Binary Search",
      "officialUrl": "https://leetcode.com/problems/search-insert-position/",
      "statementMarkdown": "Given a sorted array of distinct integers and a target value, return the index if the target is found. If not, return the index where it would be if it were inserted in order.\n\nYou must write an algorithm with O(log n) runtime complexity.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [1,3,5,6], target = 5\nOutput: 2\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [1,3,5,6], target = 2\nOutput: 1\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [1,3,5,6], target = 7\nOutput: 4\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 104\n\n\t- -104 <= nums[i] <= 104\n\n\t- nums contains distinct values sorted in ascending order.\n\n\t- -104 <= target <= 104",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              3,
              5,
              6
            ],
            "target": 5
          },
          "output": 2
        },
        {
          "input": {
            "nums": [
              1,
              3,
              5,
              6
            ],
            "target": 2
          },
          "output": 1
        },
        {
          "input": {
            "nums": [
              1,
              3,
              5,
              6
            ],
            "target": 7
          },
          "output": 4
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def searchInsert(self, nums: List[int], target: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int searchInsert(vector<int>& nums, int target) {\n        \n    }\n};",
      "methodName": "searchInsert",
      "executionContract": {
        "name": "searchInsert",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          },
          {
            "name": "target",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:58.407Z",
      "referenceSolutionHash": "sha256:cff41b1250dd2caf75d4ced3a3ac4fe0d137e034be6f704ab91c48fe0aa0fe1a",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              3,
              5,
              6
            ],
            "target": 5
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,3,5,6]\n5",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              1,
              3,
              5,
              6
            ],
            "target": 2
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,3,5,6]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              1,
              3,
              5,
              6
            ],
            "target": 7
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1,3,5,6]\n7",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 74,
      "slug": "search-a-2d-matrix",
      "title": "Search a 2D Matrix",
      "difficulty": "Medium",
      "hot150Order": 115,
      "hot150Section": "Binary Search",
      "officialUrl": "https://leetcode.com/problems/search-a-2d-matrix/",
      "statementMarkdown": "You are given an m x n integer matrix matrix with the following two properties:\n\n\t- Each row is sorted in non-decreasing order.\n\n\t- The first integer of each row is greater than the last integer of the previous row.\n\nGiven an integer target, return true if target is in matrix or false otherwise.\n\nYou must write a solution in O(log(m * n)) time complexity.\n\n \n\nExample 1:\n\n```text\n\nInput: matrix = [[1,3,5,7],[10,11,16,20],[23,30,34,60]], target = 3\nOutput: true\n\n```\n\nExample 2:\n\n```text\n\nInput: matrix = [[1,3,5,7],[10,11,16,20],[23,30,34,60]], target = 13\nOutput: false\n\n```\n\n \n\nConstraints:\n\n\t- m == matrix.length\n\n\t- n == matrix[i].length\n\n\t- 1 <= m, n <= 100\n\n\t- -104 <= matrix[i][j], target <= 104",
      "examples": [
        {
          "input": {
            "matrix": [
              [
                1,
                3,
                5,
                7
              ],
              [
                10,
                11,
                16,
                20
              ],
              [
                23,
                30,
                34,
                60
              ]
            ],
            "target": 3
          },
          "output": true
        },
        {
          "input": {
            "matrix": [
              [
                1,
                3,
                5,
                7
              ],
              [
                10,
                11,
                16,
                20
              ],
              [
                23,
                30,
                34,
                60
              ]
            ],
            "target": 13
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def searchMatrix(self, matrix: List[List[int]], target: int) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool searchMatrix(vector<vector<int>>& matrix, int target) {\n        \n    }\n};",
      "methodName": "searchMatrix",
      "executionContract": {
        "name": "searchMatrix",
        "params": [
          {
            "name": "matrix",
            "type": "integer[][]"
          },
          {
            "name": "target",
            "type": "integer"
          }
        ],
        "returnType": "boolean",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:58.797Z",
      "referenceSolutionHash": "sha256:85b7a402dd9ed71339ff08e4c556c7972dd54903ddea14dbcc0681158f8a8857",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "matrix": [
              [
                1,
                3,
                5,
                7
              ],
              [
                10,
                11,
                16,
                20
              ],
              [
                23,
                30,
                34,
                60
              ]
            ],
            "target": 3
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,3,5,7],[10,11,16,20],[23,30,34,60]]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "matrix": [
              [
                1,
                3,
                5,
                7
              ],
              [
                10,
                11,
                16,
                20
              ],
              [
                23,
                30,
                34,
                60
              ]
            ],
            "target": 13
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,3,5,7],[10,11,16,20],[23,30,34,60]]\n13",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 162,
      "slug": "find-peak-element",
      "title": "Find Peak Element",
      "difficulty": "Medium",
      "hot150Order": 116,
      "hot150Section": "Binary Search",
      "officialUrl": "https://leetcode.com/problems/find-peak-element/",
      "statementMarkdown": "A peak element is an element that is strictly greater than its neighbors.\n\nGiven a 0-indexed integer array nums, find a peak element, and return its index. If the array contains multiple peaks, return the index to any of the peaks.\n\nYou may imagine that nums[-1] = nums[n] = -&infin;. In other words, an element is always considered to be strictly greater than a neighbor that is outside the array.\n\nYou must write an algorithm that runs in O(log n) time.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [1,2,3,1]\nOutput: 2\nExplanation: 3 is a peak element and your function should return the index number 2.\n```\n\nExample 2:\n\n```text\n\nInput: nums = [1,2,1,3,5,6,4]\nOutput: 5\nExplanation: Your function can return either index number 1 where the peak element is 2, or index number 5 where the peak element is 6.\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 1000\n\n\t- -231 <= nums[i] <= 231 - 1\n\n\t- nums[i] != nums[i + 1] for all valid i.",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              2,
              3,
              1
            ]
          },
          "output": 2
        },
        {
          "input": {
            "nums": [
              1,
              2,
              1,
              3,
              5,
              6,
              4
            ]
          },
          "output": 5
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def findPeakElement(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int findPeakElement(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "findPeakElement",
      "executionContract": {
        "name": "findPeakElement",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:59.141Z",
      "referenceSolutionHash": "sha256:1679f4b0563055f5306fd9f201c1a0b72ec7654572f508d82580eea101190209",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              2,
              3,
              1
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              1,
              2,
              1,
              3,
              5,
              6,
              4
            ]
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2,1,3,5,6,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 33,
      "slug": "search-in-rotated-sorted-array",
      "title": "Search in Rotated Sorted Array",
      "difficulty": "Medium",
      "hot150Order": 117,
      "hot150Section": "Binary Search",
      "officialUrl": "https://leetcode.com/problems/search-in-rotated-sorted-array/",
      "statementMarkdown": "There is an integer array nums sorted in ascending order (with distinct values).\n\nPrior to being passed to your function, nums is possibly left rotated at an unknown index k (1 <= k < nums.length) such that the resulting array is [nums[k], nums[k+1], ..., nums[n-1], nums[0], nums[1], ..., nums[k-1]] (0-indexed). For example, [0,1,2,4,5,6,7] might be left rotated by 3 indices and become [4,5,6,7,0,1,2].\n\nGiven the array nums after the possible rotation and an integer target, return the index of target if it is in nums, or -1 if it is not in nums.\n\nYou must write an algorithm with O(log n) runtime complexity.\n\n \n\nExample 1:\n\n```text\nInput: nums = [4,5,6,7,0,1,2], target = 0\nOutput: 4\n\n```\nExample 2:\n\n```text\nInput: nums = [4,5,6,7,0,1,2], target = 3\nOutput: -1\n\n```\nExample 3:\n\n```text\nInput: nums = [1], target = 0\nOutput: -1\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 5000\n\n\t- -104 <= nums[i] <= 104\n\n\t- All values of nums are unique.\n\n\t- nums is an ascending array that is possibly rotated.\n\n\t- -104 <= target <= 104",
      "examples": [
        {
          "input": {
            "nums": [
              4,
              5,
              6,
              7,
              0,
              1,
              2
            ],
            "target": 0
          },
          "output": 4
        },
        {
          "input": {
            "nums": [
              4,
              5,
              6,
              7,
              0,
              1,
              2
            ],
            "target": 3
          },
          "output": -1
        },
        {
          "input": {
            "nums": [
              1
            ],
            "target": 0
          },
          "output": -1
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def search(self, nums: List[int], target: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int search(vector<int>& nums, int target) {\n        \n    }\n};",
      "methodName": "search",
      "executionContract": {
        "name": "search",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          },
          {
            "name": "target",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:16:59.658Z",
      "referenceSolutionHash": "sha256:eb30aa3cc3aeb0d511a8827fc66fd020ddcd21f6c27f994067c124946ff713d4",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              4,
              5,
              6,
              7,
              0,
              1,
              2
            ],
            "target": 0
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[4,5,6,7,0,1,2]\n0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              4,
              5,
              6,
              7,
              0,
              1,
              2
            ],
            "target": 3
          },
          "expected": -1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[4,5,6,7,0,1,2]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              1
            ],
            "target": 0
          },
          "expected": -1,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1]\n0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 34,
      "slug": "find-first-and-last-position-of-element-in-sorted-array",
      "title": "Find First and Last Position of Element in Sorted Array",
      "difficulty": "Medium",
      "hot150Order": 118,
      "hot150Section": "Binary Search",
      "officialUrl": "https://leetcode.com/problems/find-first-and-last-position-of-element-in-sorted-array/",
      "statementMarkdown": "Given an array of integers nums sorted in non-decreasing order, find the starting and ending position of a given target value.\n\nIf target is not found in the array, return [-1, -1].\n\nYou must write an algorithm with O(log n) runtime complexity.\n\n \n\nExample 1:\n\n```text\nInput: nums = [5,7,7,8,8,10], target = 8\nOutput: [3,4]\n\n```\nExample 2:\n\n```text\nInput: nums = [5,7,7,8,8,10], target = 6\nOutput: [-1,-1]\n\n```\nExample 3:\n\n```text\nInput: nums = [], target = 0\nOutput: [-1,-1]\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= nums.length <= 105\n\n\t- -109 <= nums[i] <= 109\n\n\t- nums is a non-decreasing array.\n\n\t- -109 <= target <= 109",
      "examples": [
        {
          "input": {
            "nums": [
              5,
              7,
              7,
              8,
              8,
              10
            ],
            "target": 8
          },
          "output": [
            3,
            4
          ]
        },
        {
          "input": {
            "nums": [
              5,
              7,
              7,
              8,
              8,
              10
            ],
            "target": 6
          },
          "output": [
            -1,
            -1
          ]
        },
        {
          "input": {
            "nums": [],
            "target": 0
          },
          "output": [
            -1,
            -1
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def searchRange(self, nums: List[int], target: int) -> List[int]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<int> searchRange(vector<int>& nums, int target) {\n        \n    }\n};",
      "methodName": "searchRange",
      "executionContract": {
        "name": "searchRange",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          },
          {
            "name": "target",
            "type": "integer"
          }
        ],
        "returnType": "integer[]",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:00.033Z",
      "referenceSolutionHash": "sha256:3b48b4769ab6c266de06b69102adb99229b77c949486526a8bc3624af0ae423c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              5,
              7,
              7,
              8,
              8,
              10
            ],
            "target": 8
          },
          "expected": [
            3,
            4
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[5,7,7,8,8,10]\n8",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              5,
              7,
              7,
              8,
              8,
              10
            ],
            "target": 6
          },
          "expected": [
            -1,
            -1
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[5,7,7,8,8,10]\n6",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [],
            "target": 0
          },
          "expected": [
            -1,
            -1
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[]\n0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 153,
      "slug": "find-minimum-in-rotated-sorted-array",
      "title": "Find Minimum in Rotated Sorted Array",
      "difficulty": "Medium",
      "hot150Order": 119,
      "hot150Section": "Binary Search",
      "officialUrl": "https://leetcode.com/problems/find-minimum-in-rotated-sorted-array/",
      "statementMarkdown": "Suppose an array of length n sorted in ascending order is rotated between 1 and n times. For example, the array nums = [0,1,2,4,5,6,7] might become:\n\n\t- [4,5,6,7,0,1,2] if it was rotated 4 times.\n\n\t- [0,1,2,4,5,6,7] if it was rotated 7 times.\n\nNotice that rotating an array [a[0], a[1], a[2], ..., a[n-1]] 1 time results in the array [a[n-1], a[0], a[1], a[2], ..., a[n-2]].\n\nGiven the sorted rotated array nums of unique elements, return the minimum element of this array.\n\nYou must write an algorithm that runs in O(log n) time.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [3,4,5,1,2]\nOutput: 1\nExplanation: The original array was [1,2,3,4,5] rotated 3 times.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [4,5,6,7,0,1,2]\nOutput: 0\nExplanation: The original array was [0,1,2,4,5,6,7] and it was rotated 4 times.\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [11,13,15,17]\nOutput: 11\nExplanation: The original array was [11,13,15,17] and it was rotated 4 times. \n\n```\n\n \n\nConstraints:\n\n\t- n == nums.length\n\n\t- 1 <= n <= 5000\n\n\t- -5000 <= nums[i] <= 5000\n\n\t- All the integers of nums are unique.\n\n\t- nums is sorted and rotated between 1 and n times.",
      "examples": [
        {
          "input": {
            "nums": [
              3,
              4,
              5,
              1,
              2
            ]
          },
          "output": 1
        },
        {
          "input": {
            "nums": [
              4,
              5,
              6,
              7,
              0,
              1,
              2
            ]
          },
          "output": 0
        },
        {
          "input": {
            "nums": [
              11,
              13,
              15,
              17
            ]
          },
          "output": 11
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def findMin(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int findMin(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "findMin",
      "executionContract": {
        "name": "findMin",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:00.387Z",
      "referenceSolutionHash": "sha256:58401472a14a4e313cd60d83d571cb0051cad85e587735e509eab9e224cd90af",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              3,
              4,
              5,
              1,
              2
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,4,5,1,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              4,
              5,
              6,
              7,
              0,
              1,
              2
            ]
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[4,5,6,7,0,1,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              11,
              13,
              15,
              17
            ]
          },
          "expected": 11,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[11,13,15,17]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 4,
      "slug": "median-of-two-sorted-arrays",
      "title": "Median of Two Sorted Arrays",
      "difficulty": "Hard",
      "hot150Order": 120,
      "hot150Section": "Binary Search",
      "officialUrl": "https://leetcode.com/problems/median-of-two-sorted-arrays/",
      "statementMarkdown": "Given two sorted arrays nums1 and nums2 of size m and n respectively, return the median of the two sorted arrays.\n\nThe overall run time complexity should be O(log (m+n)).\n\n \n\nExample 1:\n\n```text\n\nInput: nums1 = [1,3], nums2 = [2]\nOutput: 2.00000\nExplanation: merged array = [1,2,3] and median is 2.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums1 = [1,2], nums2 = [3,4]\nOutput: 2.50000\nExplanation: merged array = [1,2,3,4] and median is (2 + 3) / 2 = 2.5.\n\n```\n\n \n\nConstraints:\n\n\t- nums1.length == m\n\n\t- nums2.length == n\n\n\t- 0 <= m <= 1000\n\n\t- 0 <= n <= 1000\n\n\t- 1 <= m + n <= 2000\n\n\t- -106 <= nums1[i], nums2[i] <= 106",
      "examples": [
        {
          "input": {
            "nums1": [
              1,
              3
            ],
            "nums2": [
              2
            ]
          },
          "output": 2
        },
        {
          "input": {
            "nums1": [
              1,
              2
            ],
            "nums2": [
              3,
              4
            ]
          },
          "output": 2.5
        }
      ],
      "constraints": [],
      "tags": [
        "binary-search",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "divide-and-conquer"
      ],
      "starterCodePython": "class Solution:\n    def findMedianSortedArrays(self, nums1: List[int], nums2: List[int]) -> float:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    double findMedianSortedArrays(vector<int>& nums1, vector<int>& nums2) {\n        \n    }\n};",
      "methodName": "findMedianSortedArrays",
      "executionContract": {
        "name": "findMedianSortedArrays",
        "params": [
          {
            "name": "nums1",
            "type": "integer[]"
          },
          {
            "name": "nums2",
            "type": "integer[]"
          }
        ],
        "returnType": "double",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "float_tol",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:00.750Z",
      "referenceSolutionHash": "sha256:66900ff21bb3fb3cecfb313be5a5511c03d795d43a6f762cbb091ca40cdb9185",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums1": [
              1,
              3
            ],
            "nums2": [
              2
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,3]\n[2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums1": [
              1,
              2
            ],
            "nums2": [
              3,
              4
            ]
          },
          "expected": 2.5,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2]\n[3,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 215,
      "slug": "kth-largest-element-in-an-array",
      "title": "Kth Largest Element in an Array",
      "difficulty": "Medium",
      "hot150Order": 121,
      "hot150Section": "Heap",
      "officialUrl": "https://leetcode.com/problems/kth-largest-element-in-an-array/",
      "statementMarkdown": "Given an integer array nums and an integer k, return the kth largest element in the array.\n\nNote that it is the kth largest element in the sorted order, not the kth distinct element.\n\nCan you solve it without sorting?\n\n \n\nExample 1:\n\n```text\nInput: nums = [3,2,1,5,6,4], k = 2\nOutput: 5\n\n```\nExample 2:\n\n```text\nInput: nums = [3,2,3,1,2,4,5,5,6], k = 4\nOutput: 4\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= k <= nums.length <= 105\n\n\t- -104 <= nums[i] <= 104",
      "examples": [
        {
          "input": {
            "nums": [
              3,
              2,
              1,
              5,
              6,
              4
            ],
            "k": 2
          },
          "output": 5
        },
        {
          "input": {
            "nums": [
              3,
              2,
              3,
              1,
              2,
              4,
              5,
              5,
              6
            ],
            "k": 4
          },
          "output": 4
        }
      ],
      "constraints": [],
      "tags": [
        "heap",
        "priority-queue",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "divide-and-conquer",
        "sorting",
        "heap-priority-queue",
        "quickselect"
      ],
      "starterCodePython": "class Solution:\n    def findKthLargest(self, nums: List[int], k: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int findKthLargest(vector<int>& nums, int k) {\n        \n    }\n};",
      "methodName": "findKthLargest",
      "executionContract": {
        "name": "findKthLargest",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          },
          {
            "name": "k",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:01.155Z",
      "referenceSolutionHash": "sha256:f77891b89979c8bfebc001ef7ff0210032f1e2f446fe529a395ce57a2c5bf04b",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              3,
              2,
              1,
              5,
              6,
              4
            ],
            "k": 2
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,2,1,5,6,4]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              3,
              2,
              3,
              1,
              2,
              4,
              5,
              5,
              6
            ],
            "k": 4
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[3,2,3,1,2,4,5,5,6]\n4",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 502,
      "slug": "ipo",
      "title": "IPO",
      "difficulty": "Hard",
      "hot150Order": 122,
      "hot150Section": "Heap",
      "officialUrl": "https://leetcode.com/problems/ipo/",
      "statementMarkdown": "Suppose LeetCode will start its IPO soon. In order to sell a good price of its shares to Venture Capital, LeetCode would like to work on some projects to increase its capital before the IPO. Since it has limited resources, it can only finish at most k distinct projects before the IPO. Help LeetCode design the best way to maximize its total capital after finishing at most k distinct projects.\n\nYou are given n projects where the ith project has a pure profit profits[i] and a minimum capital of capital[i] is needed to start it.\n\nInitially, you have w capital. When you finish a project, you will obtain its pure profit and the profit will be added to your total capital.\n\nPick a list of at most k distinct projects from given projects to maximize your final capital, and return the final maximized capital.\n\nThe answer is guaranteed to fit in a 32-bit signed integer.\n\n \n\nExample 1:\n\n```text\n\nInput: k = 2, w = 0, profits = [1,2,3], capital = [0,1,1]\nOutput: 4\nExplanation: Since your initial capital is 0, you can only start the project indexed 0.\nAfter finishing it you will obtain profit 1 and your capital becomes 1.\nWith capital 1, you can either start the project indexed 1 or the project indexed 2.\nSince you can choose at most 2 projects, you need to finish the project indexed 2 to get the maximum capital.\nTherefore, output the final maximized capital, which is 0 + 1 + 3 = 4.\n\n```\n\nExample 2:\n\n```text\n\nInput: k = 3, w = 0, profits = [1,2,3], capital = [0,1,2]\nOutput: 6\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= k <= 105\n\n\t- 0 <= w <= 109\n\n\t- n == profits.length\n\n\t- n == capital.length\n\n\t- 1 <= n <= 105\n\n\t- 0 <= profits[i] <= 104\n\n\t- 0 <= capital[i] <= 109",
      "examples": [
        {
          "input": {
            "k": 2,
            "w": 0,
            "profits": [
              1,
              2,
              3
            ],
            "capital": [
              0,
              1,
              1
            ]
          },
          "output": 4
        },
        {
          "input": {
            "k": 3,
            "w": 0,
            "profits": [
              1,
              2,
              3
            ],
            "capital": [
              0,
              1,
              2
            ]
          },
          "output": 6
        }
      ],
      "constraints": [],
      "tags": [
        "heap",
        "priority-queue",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "greedy",
        "sorting",
        "heap-priority-queue"
      ],
      "starterCodePython": "class Solution:\n    def findMaximizedCapital(self, k: int, w: int, profits: List[int], capital: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int findMaximizedCapital(int k, int w, vector<int>& profits, vector<int>& capital) {\n        \n    }\n};",
      "methodName": "findMaximizedCapital",
      "executionContract": {
        "name": "findMaximizedCapital",
        "params": [
          {
            "name": "k",
            "type": "integer"
          },
          {
            "name": "w",
            "type": "integer"
          },
          {
            "name": "profits",
            "type": "integer[]"
          },
          {
            "name": "capital",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:01.563Z",
      "referenceSolutionHash": "sha256:021c2ad9343dab2dc81202a5b51cb97c84420403739b38ed9581e18f45092ba5",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "k": 2,
            "w": 0,
            "profits": [
              1,
              2,
              3
            ],
            "capital": [
              0,
              1,
              1
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "2\n0\n[1,2,3]\n[0,1,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "k": 3,
            "w": 0,
            "profits": [
              1,
              2,
              3
            ],
            "capital": [
              0,
              1,
              2
            ]
          },
          "expected": 6,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "3\n0\n[1,2,3]\n[0,1,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 373,
      "slug": "find-k-pairs-with-smallest-sums",
      "title": "Find K Pairs with Smallest Sums",
      "difficulty": "Medium",
      "hot150Order": 123,
      "hot150Section": "Heap",
      "officialUrl": "https://leetcode.com/problems/find-k-pairs-with-smallest-sums/",
      "statementMarkdown": "You are given two integer arrays nums1 and nums2 sorted in non-decreasing order and an integer k.\n\nDefine a pair (u, v) which consists of one element from the first array and one element from the second array.\n\nReturn the k pairs (u1, v1), (u2, v2), ..., (uk, vk) with the smallest sums.\n\n \n\nExample 1:\n\n```text\n\nInput: nums1 = [1,7,11], nums2 = [2,4,6], k = 3\nOutput: [[1,2],[1,4],[1,6]]\nExplanation: The first 3 pairs are returned from the sequence: [1,2],[1,4],[1,6],[7,2],[7,4],[11,2],[7,6],[11,4],[11,6]\n\n```\n\nExample 2:\n\n```text\n\nInput: nums1 = [1,1,2], nums2 = [1,2,3], k = 2\nOutput: [[1,1],[1,1]]\nExplanation: The first 2 pairs are returned from the sequence: [1,1],[1,1],[1,2],[2,1],[1,2],[2,2],[1,3],[1,3],[2,3]\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums1.length, nums2.length <= 105\n\n\t- -109 <= nums1[i], nums2[i] <= 109\n\n\t- nums1 and nums2 both are sorted in non-decreasing order.\n\n\t- 1 <= k <= 104\n\n\t- k <= nums1.length * nums2.length",
      "examples": [
        {
          "input": {
            "nums1": [
              1,
              7,
              11
            ],
            "nums2": [
              2,
              4,
              6
            ],
            "k": 3
          },
          "output": [
            [
              1,
              2
            ],
            [
              1,
              4
            ],
            [
              1,
              6
            ]
          ]
        },
        {
          "input": {
            "nums1": [
              1,
              1,
              2
            ],
            "nums2": [
              1,
              2,
              3
            ],
            "k": 2
          },
          "output": [
            [
              1,
              1
            ],
            [
              1,
              1
            ]
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "heap",
        "priority-queue",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "heap-priority-queue"
      ],
      "starterCodePython": "class Solution:\n    def kSmallestPairs(self, nums1: List[int], nums2: List[int], k: int) -> List[List[int]]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<vector<int>> kSmallestPairs(vector<int>& nums1, vector<int>& nums2, int k) {\n        \n    }\n};",
      "methodName": "kSmallestPairs",
      "executionContract": {
        "name": "kSmallestPairs",
        "params": [
          {
            "name": "nums1",
            "type": "integer[]"
          },
          {
            "name": "nums2",
            "type": "integer[]"
          },
          {
            "name": "k",
            "type": "integer"
          }
        ],
        "returnType": "list<list<integer>>",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "multiset_top",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:02.098Z",
      "referenceSolutionHash": "sha256:2297898b7465feb7c2fc5ec2477feafa2ed91b43a49d147fed34032158565777",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums1": [
              1,
              7,
              11
            ],
            "nums2": [
              2,
              4,
              6
            ],
            "k": 3
          },
          "expected": [
            [
              1,
              2
            ],
            [
              1,
              4
            ],
            [
              1,
              6
            ]
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,7,11]\n[2,4,6]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums1": [
              1,
              1,
              2
            ],
            "nums2": [
              1,
              2,
              3
            ],
            "k": 2
          },
          "expected": [
            [
              1,
              1
            ],
            [
              1,
              1
            ]
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,1,2]\n[1,2,3]\n2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 295,
      "slug": "find-median-from-data-stream",
      "title": "Find Median from Data Stream",
      "difficulty": "Hard",
      "hot150Order": 124,
      "hot150Section": "Heap",
      "officialUrl": "https://leetcode.com/problems/find-median-from-data-stream/",
      "statementMarkdown": "The median is the middle value in an ordered integer list. If the size of the list is even, there is no middle value, and the median is the mean of the two middle values.\n\n\t- For example, for arr = [2,3,4], the median is 3.\n\n\t- For example, for arr = [2,3], the median is (2 + 3) / 2 = 2.5.\n\nImplement the MedianFinder class:\n\n\t- MedianFinder() initializes the MedianFinder object.\n\n\t- void addNum(int num) adds the integer num from the data stream to the data structure.\n\n\t- double findMedian() returns the median of all elements so far. Answers within 10-5 of the actual answer will be accepted.\n\n \n\nExample 1:\n\n```text\n\nInput\n[\"MedianFinder\", \"addNum\", \"addNum\", \"findMedian\", \"addNum\", \"findMedian\"]\n[[], [1], [2], [], [3], []]\nOutput\n[null, null, null, 1.5, null, 2.0]\n\nExplanation\nMedianFinder medianFinder = new MedianFinder();\nmedianFinder.addNum(1);    // arr = [1]\nmedianFinder.addNum(2);    // arr = [1, 2]\nmedianFinder.findMedian(); // return 1.5 (i.e., (1 + 2) / 2)\nmedianFinder.addNum(3);    // arr[1, 2, 3]\nmedianFinder.findMedian(); // return 2.0\n\n```\n\n \n\nConstraints:\n\n\t- -105 <= num <= 105\n\n\t- There will be at least one element in the data structure before calling findMedian.\n\n\t- At most 5 * 104 calls will be made to addNum and findMedian.\n\n \n\nFollow up:\n\n\t- If all integer numbers from the stream are in the range [0, 100], how would you optimize your solution?\n\n\t- If 99% of all integer numbers from the stream are in the range [0, 100], how would you optimize your solution?",
      "examples": [
        {
          "input": {
            "operations": [
              "MedianFinder",
              "addNum",
              "addNum",
              "findMedian",
              "addNum",
              "findMedian"
            ],
            "arguments": [
              [],
              [
                1
              ],
              [
                2
              ],
              [],
              [
                3
              ],
              []
            ]
          },
          "output": [
            null,
            null,
            null,
            1.5,
            null,
            2
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "heap",
        "priority-queue",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers",
        "design",
        "sorting",
        "heap-priority-queue",
        "data-stream"
      ],
      "starterCodePython": "class MedianFinder:\n\n    def __init__(self):\n        \n\n    def addNum(self, num: int) -> None:\n        \n\n    def findMedian(self) -> float:\n        \n\n\n# Your MedianFinder object will be instantiated and called as such:\n# obj = MedianFinder()\n# obj.addNum(num)\n# param_2 = obj.findMedian()",
      "starterCodeCpp": "class MedianFinder {\npublic:\n    MedianFinder() {\n        \n    }\n    \n    void addNum(int num) {\n        \n    }\n    \n    double findMedian() {\n        \n    }\n};\n\n/**\n * Your MedianFinder object will be instantiated and called as such:\n * MedianFinder* obj = new MedianFinder();\n * obj->addNum(num);\n * double param_2 = obj->findMedian();\n */",
      "methodName": "MedianFinder",
      "executionContract": {
        "name": "MedianFinder",
        "params": [],
        "returnType": "unknown",
        "contractKind": "design_class"
      },
      "comparisonStrategy": "op_sequence",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:02.534Z",
      "referenceSolutionHash": "sha256:03aa56ec7f89a6137dbac459fae63b87851b251eb33fe0567049e9a14416d67a",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "operations": [
              "MedianFinder",
              "addNum",
              "addNum",
              "findMedian",
              "addNum",
              "findMedian"
            ],
            "arguments": [
              [],
              [
                1
              ],
              [
                2
              ],
              [],
              [
                3
              ],
              []
            ]
          },
          "expected": [
            null,
            null,
            null,
            1.5,
            null,
            2
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[\"MedianFinder\",\"addNum\",\"addNum\",\"findMedian\",\"addNum\",\"findMedian\"]\n[[],[1],[2],[],[3],[]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 67,
      "slug": "add-binary",
      "title": "Add Binary",
      "difficulty": "Easy",
      "hot150Order": 125,
      "hot150Section": "Bit Manipulation",
      "officialUrl": "https://leetcode.com/problems/add-binary/",
      "statementMarkdown": "Given two binary strings a and b, return their sum as a binary string.\n\n \n\nExample 1:\n\n```text\nInput: a = \"11\", b = \"1\"\nOutput: \"100\"\n\n```\nExample 2:\n\n```text\nInput: a = \"1010\", b = \"1011\"\nOutput: \"10101\"\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= a.length, b.length <= 104\n\n\t- a and b consist only of '0' or '1' characters.\n\n\t- Each string does not contain leading zeros except for the zero itself.",
      "examples": [
        {
          "input": {
            "a": "11",
            "b": "1"
          },
          "output": "100"
        },
        {
          "input": {
            "a": "1010",
            "b": "1011"
          },
          "output": "10101"
        }
      ],
      "constraints": [],
      "tags": [
        "bit-manipulation",
        "top-interview-150",
        "interview-150",
        "hot150",
        "math",
        "string",
        "simulation"
      ],
      "starterCodePython": "class Solution:\n    def addBinary(self, a: str, b: str) -> str:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    string addBinary(string a, string b) {\n        \n    }\n};",
      "methodName": "addBinary",
      "executionContract": {
        "name": "addBinary",
        "params": [
          {
            "name": "a",
            "type": "string"
          },
          {
            "name": "b",
            "type": "string"
          }
        ],
        "returnType": "string",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:02.927Z",
      "referenceSolutionHash": "sha256:9dc8e22d5cc8a13a6271d8aefa7072014d3089181a2133a2018cc26817438c17",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "a": "11",
            "b": "1"
          },
          "expected": "100",
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"11\"\n\"1\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "a": "1010",
            "b": "1011"
          },
          "expected": "10101",
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"1010\"\n\"1011\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 190,
      "slug": "reverse-bits",
      "title": "Reverse Bits",
      "difficulty": "Easy",
      "hot150Order": 126,
      "hot150Section": "Bit Manipulation",
      "officialUrl": "https://leetcode.com/problems/reverse-bits/",
      "statementMarkdown": "Reverse bits of a given 32 bits signed integer.\n\n \n\nExample 1:\n\nInput: n = 43261596\n\nOutput: 964176192\n\nExplanation:\n\n\t\n\t\t\n\t\t\tInteger\n\t\t\tBinary\n\t\t\n\t\t\n\t\t\t43261596\n\t\t\t00000010100101000001111010011100\n\t\t\n\t\t\n\t\t\t964176192\n\t\t\t00111001011110000010100101000000\n\t\t\n\t\n\nExample 2:\n\nInput: n = 2147483644\n\nOutput: 1073741822\n\nExplanation:\n\n\t\n\t\t\n\t\t\tInteger\n\t\t\tBinary\n\t\t\n\t\t\n\t\t\t2147483644\n\t\t\t01111111111111111111111111111100\n\t\t\n\t\t\n\t\t\t1073741822\n\t\t\t00111111111111111111111111111110\n\t\t\n\t\n\n \n\nConstraints:\n\n\t- 0 <= n <= 231 - 2\n\n\t- n is even.\n\n \n\nFollow up: If this function is called many times, how would you optimize it?",
      "examples": [
        {
          "input": {
            "n": 43261596
          },
          "output": 964176192
        },
        {
          "input": {
            "n": 2147483644
          },
          "output": 1073741822
        }
      ],
      "constraints": [],
      "tags": [
        "bit-manipulation",
        "top-interview-150",
        "interview-150",
        "hot150",
        "divide-and-conquer"
      ],
      "starterCodePython": "class Solution:\n    def reverseBits(self, n: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int reverseBits(int n) {\n        \n    }\n};",
      "methodName": "reverseBits",
      "executionContract": {
        "name": "reverseBits",
        "params": [
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:03.293Z",
      "referenceSolutionHash": "sha256:03ff9f60b15430df353ddaf7544ccb8f3f6432e7e43cb60626bde06acf985652",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "n": 43261596
          },
          "expected": 964176192,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "43261596",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "n": 2147483644
          },
          "expected": 1073741822,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "2147483644",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 191,
      "slug": "number-of-1-bits",
      "title": "Number of 1 Bits",
      "difficulty": "Easy",
      "hot150Order": 127,
      "hot150Section": "Bit Manipulation",
      "officialUrl": "https://leetcode.com/problems/number-of-1-bits/",
      "statementMarkdown": "Given a positive integer n, write a function that returns the number of set bits in its binary representation (also known as the Hamming weight).\n\n \n\nExample 1:\n\nInput: n = 11\n\nOutput: 3\n\nExplanation:\n\nThe input binary string 1011 has a total of three set bits.\n\nExample 2:\n\nInput: n = 128\n\nOutput: 1\n\nExplanation:\n\nThe input binary string 10000000 has a total of one set bit.\n\nExample 3:\n\nInput: n = 2147483645\n\nOutput: 30\n\nExplanation:\n\nThe input binary string 1111111111111111111111111111101 has a total of thirty set bits.\n\n \n\nConstraints:\n\n\t- 1 <= n <= 231 - 1\n\n \n\nFollow up: If this function is called many times, how would you optimize it?",
      "examples": [
        {
          "input": {
            "n": 11
          },
          "output": 3
        },
        {
          "input": {
            "n": 128
          },
          "output": 1
        },
        {
          "input": {
            "n": 2147483645
          },
          "output": 30
        }
      ],
      "constraints": [],
      "tags": [
        "bit-manipulation",
        "top-interview-150",
        "interview-150",
        "hot150",
        "divide-and-conquer"
      ],
      "starterCodePython": "class Solution:\n    def hammingWeight(self, n: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int hammingWeight(int n) {\n        \n    }\n};",
      "methodName": "hammingWeight",
      "executionContract": {
        "name": "hammingWeight",
        "params": [
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:03.649Z",
      "referenceSolutionHash": "sha256:4af3d67ae41a2dcb7d2504c1b344e4cdfe9e20e1f7674f50380a570da75a4e85",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "n": 11
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "11",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "n": 128
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "128",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "n": 2147483645
          },
          "expected": 30,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "2147483645",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 136,
      "slug": "single-number",
      "title": "Single Number",
      "difficulty": "Easy",
      "hot150Order": 128,
      "hot150Section": "Bit Manipulation",
      "officialUrl": "https://leetcode.com/problems/single-number/",
      "statementMarkdown": "Given a non-empty array of integers nums, every element appears twice except for one. Find that single one.\n\nYou must implement a solution with a linear runtime complexity and use only constant extra space.\n\n \n\nExample 1:\n\nInput: nums = [2,2,1]\n\nOutput: 1\n\nExample 2:\n\nInput: nums = [4,1,2,1,2]\n\nOutput: 4\n\nExample 3:\n\nInput: nums = [1]\n\nOutput: 1\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 3 * 104\n\n\t- -3 * 104 <= nums[i] <= 3 * 104\n\n\t- Each element in the array appears twice except for one element which appears only once.",
      "examples": [
        {
          "input": {
            "nums": [
              2,
              2,
              1
            ]
          },
          "output": 1
        },
        {
          "input": {
            "nums": [
              4,
              1,
              2,
              1,
              2
            ]
          },
          "output": 4
        },
        {
          "input": {
            "nums": [
              1
            ]
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "bit-manipulation",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def singleNumber(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int singleNumber(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "singleNumber",
      "executionContract": {
        "name": "singleNumber",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:04.035Z",
      "referenceSolutionHash": "sha256:7f58a8a9bf694ddea5f60accd3439500306bd0c383d38637766594642c073dbe",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              2,
              2,
              1
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,2,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              4,
              1,
              2,
              1,
              2
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[4,1,2,1,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              1
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 137,
      "slug": "single-number-ii",
      "title": "Single Number II",
      "difficulty": "Medium",
      "hot150Order": 129,
      "hot150Section": "Bit Manipulation",
      "officialUrl": "https://leetcode.com/problems/single-number-ii/",
      "statementMarkdown": "Given an integer array nums where every element appears three times except for one, which appears exactly once. Find the single element and return it.\n\nYou must implement a solution with a linear runtime complexity and use only constant extra space.\n\n \n\nExample 1:\n\n```text\nInput: nums = [2,2,3,2]\nOutput: 3\n\n```\nExample 2:\n\n```text\nInput: nums = [0,1,0,1,0,1,99]\nOutput: 99\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 3 * 104\n\n\t- -231 <= nums[i] <= 231 - 1\n\n\t- Each element in nums appears exactly three times except for one element which appears once.",
      "examples": [
        {
          "input": {
            "nums": [
              2,
              2,
              3,
              2
            ]
          },
          "output": 3
        },
        {
          "input": {
            "nums": [
              0,
              1,
              0,
              1,
              0,
              1,
              99
            ]
          },
          "output": 99
        }
      ],
      "constraints": [],
      "tags": [
        "bit-manipulation",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def singleNumber(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int singleNumber(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "singleNumber",
      "executionContract": {
        "name": "singleNumber",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:04.392Z",
      "referenceSolutionHash": "sha256:fc7f13d81c51b469aaeaf3706c9673ee66715e325b03d90e4fe1983bf5e3c153",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              2,
              2,
              3,
              2
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[2,2,3,2]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              1,
              0,
              1,
              0,
              1,
              99
            ]
          },
          "expected": 99,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,1,0,1,0,1,99]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 201,
      "slug": "bitwise-and-of-numbers-range",
      "title": "Bitwise AND of Numbers Range",
      "difficulty": "Medium",
      "hot150Order": 130,
      "hot150Section": "Bit Manipulation",
      "officialUrl": "https://leetcode.com/problems/bitwise-and-of-numbers-range/",
      "statementMarkdown": "Given two integers left and right that represent the range [left, right], return the bitwise AND of all numbers in this range, inclusive.\n\n \n\nExample 1:\n\n```text\n\nInput: left = 5, right = 7\nOutput: 4\n\n```\n\nExample 2:\n\n```text\n\nInput: left = 0, right = 0\nOutput: 0\n\n```\n\nExample 3:\n\n```text\n\nInput: left = 1, right = 2147483647\nOutput: 0\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= left <= right <= 231 - 1",
      "examples": [
        {
          "input": {
            "left": 5,
            "right": 7
          },
          "output": 4
        },
        {
          "input": {
            "left": 0,
            "right": 0
          },
          "output": 0
        },
        {
          "input": {
            "left": 1,
            "right": 2147483647
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "bit-manipulation",
        "top-interview-150",
        "interview-150",
        "hot150"
      ],
      "starterCodePython": "class Solution:\n    def rangeBitwiseAnd(self, left: int, right: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int rangeBitwiseAnd(int left, int right) {\n        \n    }\n};",
      "methodName": "rangeBitwiseAnd",
      "executionContract": {
        "name": "rangeBitwiseAnd",
        "params": [
          {
            "name": "left",
            "type": "integer"
          },
          {
            "name": "right",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:04.723Z",
      "referenceSolutionHash": "sha256:f62523cd5a9174708a60a355cf8bf21181fb02f46c6a755225e0a52f75a099c0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "left": 5,
            "right": 7
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "5\n7",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "left": 0,
            "right": 0
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "0\n0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "left": 1,
            "right": 2147483647
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "1\n2147483647",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 9,
      "slug": "palindrome-number",
      "title": "Palindrome Number",
      "difficulty": "Easy",
      "hot150Order": 131,
      "hot150Section": "Math",
      "officialUrl": "https://leetcode.com/problems/palindrome-number/",
      "statementMarkdown": "Given an integer x, return true if x is a palindrome, and false otherwise.\n\n \n\nExample 1:\n\n```text\n\nInput: x = 121\nOutput: true\nExplanation: 121 reads as 121 from left to right and from right to left.\n\n```\n\nExample 2:\n\n```text\n\nInput: x = -121\nOutput: false\nExplanation: From left to right, it reads -121. From right to left, it becomes 121-. Therefore it is not a palindrome.\n\n```\n\nExample 3:\n\n```text\n\nInput: x = 10\nOutput: false\nExplanation: Reads 01 from right to left. Therefore it is not a palindrome.\n\n```\n\n \n\nConstraints:\n\n\t- -231 <= x <= 231 - 1\n\n \n\nFollow up: Could you solve it without converting the integer to a string?",
      "examples": [
        {
          "input": {
            "x": 121
          },
          "output": true
        },
        {
          "input": {
            "x": -121
          },
          "output": false
        },
        {
          "input": {
            "x": 10
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "math",
        "top-interview-150",
        "interview-150",
        "hot150"
      ],
      "starterCodePython": "class Solution:\n    def isPalindrome(self, x: int) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isPalindrome(int x) {\n        \n    }\n};",
      "methodName": "isPalindrome",
      "executionContract": {
        "name": "isPalindrome",
        "params": [
          {
            "name": "x",
            "type": "integer"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:05.079Z",
      "referenceSolutionHash": "sha256:21bdcd666facf32cb58cfafc47327eae20ec7a22aabed1cf0db068766138d632",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "x": 121
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "121",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "x": -121
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "-121",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "x": 10
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "10",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 66,
      "slug": "plus-one",
      "title": "Plus One",
      "difficulty": "Easy",
      "hot150Order": 132,
      "hot150Section": "Math",
      "officialUrl": "https://leetcode.com/problems/plus-one/",
      "statementMarkdown": "You are given a large integer represented as an integer array digits, where each digits[i] is the ith digit of the integer. The digits are ordered from most significant to least significant in left-to-right order. The large integer does not contain any leading 0's.\n\nIncrement the large integer by one and return the resulting array of digits.\n\n \n\nExample 1:\n\n```text\n\nInput: digits = [1,2,3]\nOutput: [1,2,4]\nExplanation: The array represents the integer 123.\nIncrementing by one gives 123 + 1 = 124.\nThus, the result should be [1,2,4].\n\n```\n\nExample 2:\n\n```text\n\nInput: digits = [4,3,2,1]\nOutput: [4,3,2,2]\nExplanation: The array represents the integer 4321.\nIncrementing by one gives 4321 + 1 = 4322.\nThus, the result should be [4,3,2,2].\n\n```\n\nExample 3:\n\n```text\n\nInput: digits = [9]\nOutput: [1,0]\nExplanation: The array represents the integer 9.\nIncrementing by one gives 9 + 1 = 10.\nThus, the result should be [1,0].\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= digits.length <= 100\n\n\t- 0 <= digits[i] <= 9\n\n\t- digits does not contain any leading 0's.",
      "examples": [
        {
          "input": {
            "digits": [
              1,
              2,
              3
            ]
          },
          "output": [
            1,
            2,
            4
          ]
        },
        {
          "input": {
            "digits": [
              4,
              3,
              2,
              1
            ]
          },
          "output": [
            4,
            3,
            2,
            2
          ]
        },
        {
          "input": {
            "digits": [
              9
            ]
          },
          "output": [
            1,
            0
          ]
        }
      ],
      "constraints": [],
      "tags": [
        "math",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def plusOne(self, digits: List[int]) -> List[int]:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    vector<int> plusOne(vector<int>& digits) {\n        \n    }\n};",
      "methodName": "plusOne",
      "executionContract": {
        "name": "plusOne",
        "params": [
          {
            "name": "digits",
            "type": "integer[]"
          }
        ],
        "returnType": "integer[]",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:05.424Z",
      "referenceSolutionHash": "sha256:c1306a494b4f58f4f95a3d599c760d263d088c9f92898a4af44da7e6ccea9ff0",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "digits": [
              1,
              2,
              3
            ]
          },
          "expected": [
            1,
            2,
            4
          ],
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "digits": [
              4,
              3,
              2,
              1
            ]
          },
          "expected": [
            4,
            3,
            2,
            2
          ],
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[4,3,2,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "digits": [
              9
            ]
          },
          "expected": [
            1,
            0
          ],
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[9]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 172,
      "slug": "factorial-trailing-zeroes",
      "title": "Factorial Trailing Zeroes",
      "difficulty": "Medium",
      "hot150Order": 133,
      "hot150Section": "Math",
      "officialUrl": "https://leetcode.com/problems/factorial-trailing-zeroes/",
      "statementMarkdown": "Given an integer n, return the number of trailing zeroes in n!.\n\nNote that n! = n * (n - 1) * (n - 2) * ... * 3 * 2 * 1.\n\n \n\nExample 1:\n\n```text\n\nInput: n = 3\nOutput: 0\nExplanation: 3! = 6, no trailing zero.\n\n```\n\nExample 2:\n\n```text\n\nInput: n = 5\nOutput: 1\nExplanation: 5! = 120, one trailing zero.\n\n```\n\nExample 3:\n\n```text\n\nInput: n = 0\nOutput: 0\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= n <= 104\n\n \n\nFollow up: Could you write a solution that works in logarithmic time complexity?",
      "examples": [
        {
          "input": {
            "n": 3
          },
          "output": 0
        },
        {
          "input": {
            "n": 5
          },
          "output": 1
        },
        {
          "input": {
            "n": 0
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "math",
        "top-interview-150",
        "interview-150",
        "hot150"
      ],
      "starterCodePython": "class Solution:\n    def trailingZeroes(self, n: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int trailingZeroes(int n) {\n        \n    }\n};",
      "methodName": "trailingZeroes",
      "executionContract": {
        "name": "trailingZeroes",
        "params": [
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:05.792Z",
      "referenceSolutionHash": "sha256:0c4d44dc3daa0cd0ee458db8d910dfc9a9debc05918ae2280c98df0e9cf26b8c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "n": 3
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "n": 5
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "5",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "n": 0
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 69,
      "slug": "sqrtx",
      "title": "Sqrt(x)",
      "difficulty": "Easy",
      "hot150Order": 134,
      "hot150Section": "Math",
      "officialUrl": "https://leetcode.com/problems/sqrtx/",
      "statementMarkdown": "Given a non-negative integer x, return the square root of x rounded down to the nearest integer. The returned integer should be non-negative as well.\n\nYou must not use any built-in exponent function or operator.\n\n\t- For example, do not use pow(x, 0.5) in c++ or x ** 0.5 in python.\n\n \n\nExample 1:\n\n```text\n\nInput: x = 4\nOutput: 2\nExplanation: The square root of 4 is 2, so we return 2.\n\n```\n\nExample 2:\n\n```text\n\nInput: x = 8\nOutput: 2\nExplanation: The square root of 8 is 2.82842..., and since we round it down to the nearest integer, 2 is returned.\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= x <= 231 - 1",
      "examples": [
        {
          "input": {
            "x": 4
          },
          "output": 2
        },
        {
          "input": {
            "x": 8
          },
          "output": 2
        }
      ],
      "constraints": [],
      "tags": [
        "math",
        "top-interview-150",
        "interview-150",
        "hot150",
        "binary-search"
      ],
      "starterCodePython": "class Solution:\n    def mySqrt(self, x: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int mySqrt(int x) {\n        \n    }\n};",
      "methodName": "mySqrt",
      "executionContract": {
        "name": "mySqrt",
        "params": [
          {
            "name": "x",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:06.440Z",
      "referenceSolutionHash": "sha256:009a59825f2308af476e2a111679670b6a4cad0f13bf235aaeb4cffc0044de42",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "x": 4
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "4",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "x": 8
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "8",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 50,
      "slug": "powx-n",
      "title": "Pow(x, n)",
      "difficulty": "Medium",
      "hot150Order": 135,
      "hot150Section": "Math",
      "officialUrl": "https://leetcode.com/problems/powx-n/",
      "statementMarkdown": "Implement pow(x, n), which calculates x raised to the power n (i.e., xn).\n\n \n\nExample 1:\n\n```text\n\nInput: x = 2.00000, n = 10\nOutput: 1024.00000\n\n```\n\nExample 2:\n\n```text\n\nInput: x = 2.10000, n = 3\nOutput: 9.26100\n\n```\n\nExample 3:\n\n```text\n\nInput: x = 2.00000, n = -2\nOutput: 0.25000\nExplanation: 2-2 = 1/22 = 1/4 = 0.25\n\n```\n\n \n\nConstraints:\n\n\t- -100.0 < x < 100.0\n\n\t- -231 <= n <= 231-1\n\n\t- n is an integer.\n\n\t- Either x is not zero or n > 0.\n\n\t- -104 <= xn <= 104",
      "examples": [
        {
          "input": {
            "x": 2,
            "n": 10
          },
          "output": 1024
        },
        {
          "input": {
            "x": 2.1,
            "n": 3
          },
          "output": 9.261000000000001
        },
        {
          "input": {
            "x": 2,
            "n": -2
          },
          "output": 0.25
        }
      ],
      "constraints": [],
      "tags": [
        "math",
        "top-interview-150",
        "interview-150",
        "hot150",
        "recursion"
      ],
      "starterCodePython": "class Solution:\n    def myPow(self, x: float, n: int) -> float:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    double myPow(double x, int n) {\n        \n    }\n};",
      "methodName": "myPow",
      "executionContract": {
        "name": "myPow",
        "params": [
          {
            "name": "x",
            "type": "double"
          },
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "double",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "float_tol",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:06.864Z",
      "referenceSolutionHash": "sha256:c045175906ab54b09033939facbda018cd3a7b8490cc86c8dcf6095c52b7027e",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "x": 2,
            "n": 10
          },
          "expected": 1024,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "2.00000\n10",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "x": 2.1,
            "n": 3
          },
          "expected": 9.261000000000001,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "2.10000\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "x": 2,
            "n": -2
          },
          "expected": 0.25,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "2.00000\n-2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 149,
      "slug": "max-points-on-a-line",
      "title": "Max Points on a Line",
      "difficulty": "Hard",
      "hot150Order": 136,
      "hot150Section": "Math",
      "officialUrl": "https://leetcode.com/problems/max-points-on-a-line/",
      "statementMarkdown": "Given an array of points where points[i] = [xi, yi] represents a point on the X-Y plane, return the maximum number of points that lie on the same straight line.\n\n \n\nExample 1:\n\n```text\n\nInput: points = [[1,1],[2,2],[3,3]]\nOutput: 3\n\n```\n\nExample 2:\n\n```text\n\nInput: points = [[1,1],[3,2],[5,3],[4,1],[2,3],[1,4]]\nOutput: 4\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= points.length <= 300\n\n\t- points[i].length == 2\n\n\t- -104 <= xi, yi <= 104\n\n\t- All the points are unique.",
      "examples": [
        {
          "input": {
            "points": [
              [
                1,
                1
              ],
              [
                2,
                2
              ],
              [
                3,
                3
              ]
            ]
          },
          "output": 3
        },
        {
          "input": {
            "points": [
              [
                1,
                1
              ],
              [
                3,
                2
              ],
              [
                5,
                3
              ],
              [
                4,
                1
              ],
              [
                2,
                3
              ],
              [
                1,
                4
              ]
            ]
          },
          "output": 4
        }
      ],
      "constraints": [],
      "tags": [
        "math",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "hash-table",
        "geometry"
      ],
      "starterCodePython": "class Solution:\n    def maxPoints(self, points: List[List[int]]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maxPoints(vector<vector<int>>& points) {\n        \n    }\n};",
      "methodName": "maxPoints",
      "executionContract": {
        "name": "maxPoints",
        "params": [
          {
            "name": "points",
            "type": "integer[][]"
          }
        ],
        "returnType": "integer",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:07.290Z",
      "referenceSolutionHash": "sha256:d841e12d9c1a4da1a96ccd91f85788a35c412cb7680fc877b5116f20599e9d5c",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "points": [
              [
                1,
                1
              ],
              [
                2,
                2
              ],
              [
                3,
                3
              ]
            ]
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,1],[2,2],[3,3]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "points": [
              [
                1,
                1
              ],
              [
                3,
                2
              ],
              [
                5,
                3
              ],
              [
                4,
                1
              ],
              [
                2,
                3
              ],
              [
                1,
                4
              ]
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,1],[3,2],[5,3],[4,1],[2,3],[1,4]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 70,
      "slug": "climbing-stairs",
      "title": "Climbing Stairs",
      "difficulty": "Easy",
      "hot150Order": 137,
      "hot150Section": "1D DP",
      "officialUrl": "https://leetcode.com/problems/climbing-stairs/",
      "statementMarkdown": "You are climbing a staircase. It takes n steps to reach the top.\n\nEach time you can either climb 1 or 2 steps. In how many distinct ways can you climb to the top?\n\n \n\nExample 1:\n\n```text\n\nInput: n = 2\nOutput: 2\nExplanation: There are two ways to climb to the top.\n1. 1 step + 1 step\n2. 2 steps\n\n```\n\nExample 2:\n\n```text\n\nInput: n = 3\nOutput: 3\nExplanation: There are three ways to climb to the top.\n1. 1 step + 1 step + 1 step\n2. 1 step + 2 steps\n3. 2 steps + 1 step\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= n <= 45",
      "examples": [
        {
          "input": {
            "n": 2
          },
          "output": 2
        },
        {
          "input": {
            "n": 3
          },
          "output": 3
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "1d-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "math",
        "memoization"
      ],
      "starterCodePython": "class Solution:\n    def climbStairs(self, n: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int climbStairs(int n) {\n        \n    }\n};",
      "methodName": "climbStairs",
      "executionContract": {
        "name": "climbStairs",
        "params": [
          {
            "name": "n",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:08.151Z",
      "referenceSolutionHash": "sha256:e67027d6a303961f3edcb1d367364770ca114719036130e8f0a48b9a31107e7b",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "n": 2
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "2",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "n": 3
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 198,
      "slug": "house-robber",
      "title": "House Robber",
      "difficulty": "Medium",
      "hot150Order": 138,
      "hot150Section": "1D DP",
      "officialUrl": "https://leetcode.com/problems/house-robber/",
      "statementMarkdown": "You are a professional robber planning to rob houses along a street. Each house has a certain amount of money stashed, the only constraint stopping you from robbing each of them is that adjacent houses have security systems connected and it will automatically contact the police if two adjacent houses were broken into on the same night.\n\nGiven an integer array nums representing the amount of money of each house, return the maximum amount of money you can rob tonight without alerting the police.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [1,2,3,1]\nOutput: 4\nExplanation: Rob house 1 (money = 1) and then rob house 3 (money = 3).\nTotal amount you can rob = 1 + 3 = 4.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [2,7,9,3,1]\nOutput: 12\nExplanation: Rob house 1 (money = 2), rob house 3 (money = 9) and rob house 5 (money = 1).\nTotal amount you can rob = 2 + 9 + 1 = 12.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 100\n\n\t- 0 <= nums[i] <= 400",
      "examples": [
        {
          "input": {
            "nums": [
              1,
              2,
              3,
              1
            ]
          },
          "output": 4
        },
        {
          "input": {
            "nums": [
              2,
              7,
              9,
              3,
              1
            ]
          },
          "output": 12
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "1d-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def rob(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int rob(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "rob",
      "executionContract": {
        "name": "rob",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:08.602Z",
      "referenceSolutionHash": "sha256:c7bc9d3b712fbb29a4ced9346857496c070d98a1c83fb00281bc088da9427e52",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              1,
              2,
              3,
              1
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,3,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              2,
              7,
              9,
              3,
              1
            ]
          },
          "expected": 12,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2,7,9,3,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 139,
      "slug": "word-break",
      "title": "Word Break",
      "difficulty": "Medium",
      "hot150Order": 139,
      "hot150Section": "1D DP",
      "officialUrl": "https://leetcode.com/problems/word-break/",
      "statementMarkdown": "Given a string s and a dictionary of strings wordDict, return true if s can be segmented into a space-separated sequence of one or more dictionary words.\n\nNote that the same word in the dictionary may be reused multiple times in the segmentation.\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"leetcode\", wordDict = [\"leet\",\"code\"]\nOutput: true\nExplanation: Return true because \"leetcode\" can be segmented as \"leet code\".\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"applepenapple\", wordDict = [\"apple\",\"pen\"]\nOutput: true\nExplanation: Return true because \"applepenapple\" can be segmented as \"apple pen apple\".\nNote that you are allowed to reuse a dictionary word.\n\n```\n\nExample 3:\n\n```text\n\nInput: s = \"catsandog\", wordDict = [\"cats\",\"dog\",\"sand\",\"and\",\"cat\"]\nOutput: false\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 300\n\n\t- 1 <= wordDict.length <= 1000\n\n\t- 1 <= wordDict[i].length <= 20\n\n\t- s and wordDict[i] consist of only lowercase English letters.\n\n\t- All the strings of wordDict are unique.",
      "examples": [
        {
          "input": {
            "s": "leetcode",
            "wordDict": [
              "leet",
              "code"
            ]
          },
          "output": true
        },
        {
          "input": {
            "s": "applepenapple",
            "wordDict": [
              "apple",
              "pen"
            ]
          },
          "output": true
        },
        {
          "input": {
            "s": "catsandog",
            "wordDict": [
              "cats",
              "dog",
              "sand",
              "and",
              "cat"
            ]
          },
          "output": false
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "1d-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "hash-table",
        "string",
        "trie",
        "memoization"
      ],
      "starterCodePython": "class Solution:\n    def wordBreak(self, s: str, wordDict: List[str]) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool wordBreak(string s, vector<string>& wordDict) {\n        \n    }\n};",
      "methodName": "wordBreak",
      "executionContract": {
        "name": "wordBreak",
        "params": [
          {
            "name": "s",
            "type": "string"
          },
          {
            "name": "wordDict",
            "type": "list<string>"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:09.081Z",
      "referenceSolutionHash": "sha256:f90aa9ff7a1ca467892d2191b9f60c48ad9d66954ecb2a16648ce2db2efce233",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "leetcode",
            "wordDict": [
              "leet",
              "code"
            ]
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"leetcode\"\n[\"leet\",\"code\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "applepenapple",
            "wordDict": [
              "apple",
              "pen"
            ]
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"applepenapple\"\n[\"apple\",\"pen\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s": "catsandog",
            "wordDict": [
              "cats",
              "dog",
              "sand",
              "and",
              "cat"
            ]
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"catsandog\"\n[\"cats\",\"dog\",\"sand\",\"and\",\"cat\"]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 322,
      "slug": "coin-change",
      "title": "Coin Change",
      "difficulty": "Medium",
      "hot150Order": 140,
      "hot150Section": "1D DP",
      "officialUrl": "https://leetcode.com/problems/coin-change/",
      "statementMarkdown": "You are given an integer array coins representing coins of different denominations and an integer amount representing a total amount of money.\n\nReturn the fewest number of coins that you need to make up that amount. If that amount of money cannot be made up by any combination of the coins, return -1.\n\nYou may assume that you have an infinite number of each kind of coin.\n\n \n\nExample 1:\n\n```text\n\nInput: coins = [1,2,5], amount = 11\nOutput: 3\nExplanation: 11 = 5 + 5 + 1\n\n```\n\nExample 2:\n\n```text\n\nInput: coins = [2], amount = 3\nOutput: -1\n\n```\n\nExample 3:\n\n```text\n\nInput: coins = [1], amount = 0\nOutput: 0\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= coins.length <= 12\n\n\t- 1 <= coins[i] <= 231 - 1\n\n\t- 0 <= amount <= 104",
      "examples": [
        {
          "input": {
            "coins": [
              1,
              2,
              5
            ],
            "amount": 11
          },
          "output": 3
        },
        {
          "input": {
            "coins": [
              2
            ],
            "amount": 3
          },
          "output": -1
        },
        {
          "input": {
            "coins": [
              1
            ],
            "amount": 0
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "1d-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "breadth-first-search"
      ],
      "starterCodePython": "class Solution:\n    def coinChange(self, coins: List[int], amount: int) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int coinChange(vector<int>& coins, int amount) {\n        \n    }\n};",
      "methodName": "coinChange",
      "executionContract": {
        "name": "coinChange",
        "params": [
          {
            "name": "coins",
            "type": "integer[]"
          },
          {
            "name": "amount",
            "type": "integer"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:09.471Z",
      "referenceSolutionHash": "sha256:cfc13caef3145bc1092b784035641e1b66d73bb6e9a651ac59976284d7070114",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "coins": [
              1,
              2,
              5
            ],
            "amount": 11
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[1,2,5]\n11",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "coins": [
              2
            ],
            "amount": 3
          },
          "expected": -1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[2]\n3",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "coins": [
              1
            ],
            "amount": 0
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[1]\n0",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 300,
      "slug": "longest-increasing-subsequence",
      "title": "Longest Increasing Subsequence",
      "difficulty": "Medium",
      "hot150Order": 141,
      "hot150Section": "1D DP",
      "officialUrl": "https://leetcode.com/problems/longest-increasing-subsequence/",
      "statementMarkdown": "Given an integer array nums, return the length of the longest strictly increasing subsequence.\n\n \n\nExample 1:\n\n```text\n\nInput: nums = [10,9,2,5,3,7,101,18]\nOutput: 4\nExplanation: The longest increasing subsequence is [2,3,7,101], therefore the length is 4.\n\n```\n\nExample 2:\n\n```text\n\nInput: nums = [0,1,0,3,2,3]\nOutput: 4\n\n```\n\nExample 3:\n\n```text\n\nInput: nums = [7,7,7,7,7,7,7]\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= nums.length <= 2500\n\n\t- -104 <= nums[i] <= 104\n\n \n\nFollow up: Can you come up with an algorithm that runs in O(n log(n)) time complexity?",
      "examples": [
        {
          "input": {
            "nums": [
              10,
              9,
              2,
              5,
              3,
              7,
              101,
              18
            ]
          },
          "output": 4
        },
        {
          "input": {
            "nums": [
              0,
              1,
              0,
              3,
              2,
              3
            ]
          },
          "output": 4
        },
        {
          "input": {
            "nums": [
              7,
              7,
              7,
              7,
              7,
              7,
              7
            ]
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "1d-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "binary-search"
      ],
      "starterCodePython": "class Solution:\n    def lengthOfLIS(self, nums: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int lengthOfLIS(vector<int>& nums) {\n        \n    }\n};",
      "methodName": "lengthOfLIS",
      "executionContract": {
        "name": "lengthOfLIS",
        "params": [
          {
            "name": "nums",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:10.091Z",
      "referenceSolutionHash": "sha256:02213fd56e61493c4b119869f3772ded959ab83304128cf333df8c7ba2d48d09",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "nums": [
              10,
              9,
              2,
              5,
              3,
              7,
              101,
              18
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[10,9,2,5,3,7,101,18]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "nums": [
              0,
              1,
              0,
              3,
              2,
              3
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[0,1,0,3,2,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "nums": [
              7,
              7,
              7,
              7,
              7,
              7,
              7
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[7,7,7,7,7,7,7]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 120,
      "slug": "triangle",
      "title": "Triangle",
      "difficulty": "Medium",
      "hot150Order": 142,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/triangle/",
      "statementMarkdown": "Given a triangle array, return the minimum path sum from top to bottom.\n\nFor each step, you may move to an adjacent number of the row below. More formally, if you are on index i on the current row, you may move to either index i or index i + 1 on the next row.\n\n \n\nExample 1:\n\n```text\n\nInput: triangle = [[2],[3,4],[6,5,7],[4,1,8,3]]\nOutput: 11\nExplanation: The triangle looks like:\n   2\n  3 4\n 6 5 7\n4 1 8 3\nThe minimum path sum from top to bottom is 2 + 3 + 5 + 1 = 11 (underlined above).\n\n```\n\nExample 2:\n\n```text\n\nInput: triangle = [[-10]]\nOutput: -10\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= triangle.length <= 200\n\n\t- triangle[0].length == 1\n\n\t- triangle[i].length == triangle[i - 1].length + 1\n\n\t- -104 <= triangle[i][j] <= 104\n\n \n\nFollow up: Could you do this using only O(n) extra space, where n is the total number of rows in the triangle?",
      "examples": [
        {
          "input": {
            "triangle": [
              [
                2
              ],
              [
                3,
                4
              ],
              [
                6,
                5,
                7
              ],
              [
                4,
                1,
                8,
                3
              ]
            ]
          },
          "output": 11
        },
        {
          "input": {
            "triangle": [
              [
                -10
              ]
            ]
          },
          "output": -10
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def minimumTotal(self, triangle: List[List[int]]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int minimumTotal(vector<vector<int>>& triangle) {\n        \n    }\n};",
      "methodName": "minimumTotal",
      "executionContract": {
        "name": "minimumTotal",
        "params": [
          {
            "name": "triangle",
            "type": "list<list<integer>>"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:10.441Z",
      "referenceSolutionHash": "sha256:fd2da6f5b062e23ddb8bf4b7f13adc038b405058dd668629073678951c6fc1f2",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "triangle": [
              [
                2
              ],
              [
                3,
                4
              ],
              [
                6,
                5,
                7
              ],
              [
                4,
                1,
                8,
                3
              ]
            ]
          },
          "expected": 11,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[2],[3,4],[6,5,7],[4,1,8,3]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "triangle": [
              [
                -10
              ]
            ]
          },
          "expected": -10,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[-10]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 64,
      "slug": "minimum-path-sum",
      "title": "Minimum Path Sum",
      "difficulty": "Medium",
      "hot150Order": 143,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/minimum-path-sum/",
      "statementMarkdown": "Given a m x n grid filled with non-negative numbers, find a path from top left to bottom right, which minimizes the sum of all numbers along its path.\n\nNote: You can only move either down or right at any point in time.\n\n \n\nExample 1:\n\n```text\n\nInput: grid = [[1,3,1],[1,5,1],[4,2,1]]\nOutput: 7\nExplanation: Because the path 1 &rarr; 3 &rarr; 1 &rarr; 1 &rarr; 1 minimizes the sum.\n\n```\n\nExample 2:\n\n```text\n\nInput: grid = [[1,2,3],[4,5,6]]\nOutput: 12\n\n```\n\n \n\nConstraints:\n\n\t- m == grid.length\n\n\t- n == grid[i].length\n\n\t- 1 <= m, n <= 200\n\n\t- 0 <= grid[i][j] <= 200",
      "examples": [
        {
          "input": {
            "grid": [
              [
                1,
                3,
                1
              ],
              [
                1,
                5,
                1
              ],
              [
                4,
                2,
                1
              ]
            ]
          },
          "output": 7
        },
        {
          "input": {
            "grid": [
              [
                1,
                2,
                3
              ],
              [
                4,
                5,
                6
              ]
            ]
          },
          "output": 12
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def minPathSum(self, grid: List[List[int]]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int minPathSum(vector<vector<int>>& grid) {\n        \n    }\n};",
      "methodName": "minPathSum",
      "executionContract": {
        "name": "minPathSum",
        "params": [
          {
            "name": "grid",
            "type": "integer[][]"
          }
        ],
        "returnType": "integer",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:10.984Z",
      "referenceSolutionHash": "sha256:2d5e0332b626e21728a931c9927693fb5d6e72ebd62b7ce5a7f64f58dc956470",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "grid": [
              [
                1,
                3,
                1
              ],
              [
                1,
                5,
                1
              ],
              [
                4,
                2,
                1
              ]
            ]
          },
          "expected": 7,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[1,3,1],[1,5,1],[4,2,1]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "grid": [
              [
                1,
                2,
                3
              ],
              [
                4,
                5,
                6
              ]
            ]
          },
          "expected": 12,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[1,2,3],[4,5,6]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 63,
      "slug": "unique-paths-ii",
      "title": "Unique Paths II",
      "difficulty": "Medium",
      "hot150Order": 144,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/unique-paths-ii/",
      "statementMarkdown": "You are given an m x n integer array grid. There is a robot initially located at the top-left corner (i.e., grid[0][0]). The robot tries to move to the bottom-right corner (i.e., grid[m - 1][n - 1]). The robot can only move either down or right at any point in time.\n\nAn obstacle and space are marked as 1 or 0 respectively in grid. A path that the robot takes cannot include any square that is an obstacle.\n\nReturn the number of possible unique paths that the robot can take to reach the bottom-right corner.\n\nThe testcases are generated so that the answer will be less than or equal to 2 * 109.\n\n \n\nExample 1:\n\n```text\n\nInput: obstacleGrid = [[0,0,0],[0,1,0],[0,0,0]]\nOutput: 2\nExplanation: There is one obstacle in the middle of the 3x3 grid above.\nThere are two ways to reach the bottom-right corner:\n1. Right -> Right -> Down -> Down\n2. Down -> Down -> Right -> Right\n\n```\n\nExample 2:\n\n```text\n\nInput: obstacleGrid = [[0,1],[0,0]]\nOutput: 1\n\n```\n\n \n\nConstraints:\n\n\t- m == obstacleGrid.length\n\n\t- n == obstacleGrid[i].length\n\n\t- 1 <= m, n <= 100\n\n\t- obstacleGrid[i][j] is 0 or 1.",
      "examples": [
        {
          "input": {
            "obstacleGrid": [
              [
                0,
                0,
                0
              ],
              [
                0,
                1,
                0
              ],
              [
                0,
                0,
                0
              ]
            ]
          },
          "output": 2
        },
        {
          "input": {
            "obstacleGrid": [
              [
                0,
                1
              ],
              [
                0,
                0
              ]
            ]
          },
          "output": 1
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def uniquePathsWithObstacles(self, obstacleGrid: List[List[int]]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int uniquePathsWithObstacles(vector<vector<int>>& obstacleGrid) {\n        \n    }\n};",
      "methodName": "uniquePathsWithObstacles",
      "executionContract": {
        "name": "uniquePathsWithObstacles",
        "params": [
          {
            "name": "obstacleGrid",
            "type": "integer[][]"
          }
        ],
        "returnType": "integer",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:11.372Z",
      "referenceSolutionHash": "sha256:b65afa79ee3797e5d0f995f704fa57858c566d624e8d1fdefde3afaac7f0748f",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "obstacleGrid": [
              [
                0,
                0,
                0
              ],
              [
                0,
                1,
                0
              ],
              [
                0,
                0,
                0
              ]
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[0,0,0],[0,1,0],[0,0,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "obstacleGrid": [
              [
                0,
                1
              ],
              [
                0,
                0
              ]
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[0,1],[0,0]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 5,
      "slug": "longest-palindromic-substring",
      "title": "Longest Palindromic Substring",
      "difficulty": "Medium",
      "hot150Order": 145,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/longest-palindromic-substring/",
      "statementMarkdown": "Given a string s, return the longest palindromic substring in s.\n\n \n\nExample 1:\n\n```text\n\nInput: s = \"babad\"\nOutput: \"bab\"\nExplanation: \"aba\" is also a valid answer.\n\n```\n\nExample 2:\n\n```text\n\nInput: s = \"cbbd\"\nOutput: \"bb\"\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= s.length <= 1000\n\n\t- s consist of only digits and English letters.",
      "examples": [
        {
          "input": {
            "s": "babad"
          },
          "output": "bab"
        },
        {
          "input": {
            "s": "cbbd"
          },
          "output": "bb"
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "two-pointers",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def longestPalindrome(self, s: str) -> str:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    string longestPalindrome(string s) {\n        \n    }\n};",
      "methodName": "longestPalindrome",
      "executionContract": {
        "name": "longestPalindrome",
        "params": [
          {
            "name": "s",
            "type": "string"
          }
        ],
        "returnType": "string",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:11.747Z",
      "referenceSolutionHash": "sha256:ea9f28e50e2e1fb19bf1824f53e594a53c2628e22f3ad6460756505eca988a95",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s": "babad"
          },
          "expected": "bab",
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"babad\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s": "cbbd"
          },
          "expected": "bb",
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"cbbd\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 97,
      "slug": "interleaving-string",
      "title": "Interleaving String",
      "difficulty": "Medium",
      "hot150Order": 146,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/interleaving-string/",
      "statementMarkdown": "Given strings s1, s2, and s3, find whether s3 is formed by an interleaving of s1 and s2.\n\nAn interleaving of two strings s and t is a configuration where s and t are divided into n and m substrings respectively, such that:\n\n\t- s = s1 + s2 + ... + sn\n\n\t- t = t1 + t2 + ... + tm\n\n\t- |n - m| <= 1\n\n\t- The interleaving is s1 + t1 + s2 + t2 + s3 + t3 + ... or t1 + s1 + t2 + s2 + t3 + s3 + ...\n\nNote: a + b is the concatenation of strings a and b.\n\n \n\nExample 1:\n\n```text\n\nInput: s1 = \"aabcc\", s2 = \"dbbca\", s3 = \"aadbbcbcac\"\nOutput: true\nExplanation: One way to obtain s3 is:\nSplit s1 into s1 = \"aa\" + \"bc\" + \"c\", and s2 into s2 = \"dbbc\" + \"a\".\nInterleaving the two splits, we get \"aa\" + \"dbbc\" + \"bc\" + \"a\" + \"c\" = \"aadbbcbcac\".\nSince s3 can be obtained by interleaving s1 and s2, we return true.\n\n```\n\nExample 2:\n\n```text\n\nInput: s1 = \"aabcc\", s2 = \"dbbca\", s3 = \"aadbbbaccc\"\nOutput: false\nExplanation: Notice how it is impossible to interleave s2 with any other string to obtain s3.\n\n```\n\nExample 3:\n\n```text\n\nInput: s1 = \"\", s2 = \"\", s3 = \"\"\nOutput: true\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= s1.length, s2.length <= 100\n\n\t- 0 <= s3.length <= 200\n\n\t- s1, s2, and s3 consist of lowercase English letters.\n\n \n\nFollow up: Could you solve it using only O(s2.length) additional memory space?",
      "examples": [
        {
          "input": {
            "s1": "aabcc",
            "s2": "dbbca",
            "s3": "aadbbcbcac"
          },
          "output": true
        },
        {
          "input": {
            "s1": "aabcc",
            "s2": "dbbca",
            "s3": "aadbbbaccc"
          },
          "output": false
        },
        {
          "input": {
            "s1": "",
            "s2": "",
            "s3": ""
          },
          "output": true
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def isInterleave(self, s1: str, s2: str, s3: str) -> bool:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    bool isInterleave(string s1, string s2, string s3) {\n        \n    }\n};",
      "methodName": "isInterleave",
      "executionContract": {
        "name": "isInterleave",
        "params": [
          {
            "name": "s1",
            "type": "string"
          },
          {
            "name": "s2",
            "type": "string"
          },
          {
            "name": "s3",
            "type": "string"
          }
        ],
        "returnType": "boolean",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:12.162Z",
      "referenceSolutionHash": "sha256:3c799f59e3874d71d49f6b9ffd08df0ec8645473067811a5308c533120d6dc25",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "s1": "aabcc",
            "s2": "dbbca",
            "s3": "aadbbcbcac"
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"aabcc\"\n\"dbbca\"\n\"aadbbcbcac\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "s1": "aabcc",
            "s2": "dbbca",
            "s3": "aadbbbaccc"
          },
          "expected": false,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"aabcc\"\n\"dbbca\"\n\"aadbbbaccc\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "s1": "",
            "s2": "",
            "s3": ""
          },
          "expected": true,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "\"\"\n\"\"\n\"\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 72,
      "slug": "edit-distance",
      "title": "Edit Distance",
      "difficulty": "Medium",
      "hot150Order": 147,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/edit-distance/",
      "statementMarkdown": "Given two strings word1 and word2, return the minimum number of operations required to convert word1 to word2.\n\nYou have the following three operations permitted on a word:\n\n\t- Insert a character\n\n\t- Delete a character\n\n\t- Replace a character\n\n \n\nExample 1:\n\n```text\n\nInput: word1 = \"horse\", word2 = \"ros\"\nOutput: 3\nExplanation: \nhorse -> rorse (replace 'h' with 'r')\nrorse -> rose (remove 'r')\nrose -> ros (remove 'e')\n\n```\n\nExample 2:\n\n```text\n\nInput: word1 = \"intention\", word2 = \"execution\"\nOutput: 5\nExplanation: \nintention -> inention (remove 't')\ninention -> enention (replace 'i' with 'e')\nenention -> exention (replace 'n' with 'x')\nexention -> exection (replace 'n' with 'c')\nexection -> execution (insert 'u')\n\n```\n\n \n\nConstraints:\n\n\t- 0 <= word1.length, word2.length <= 500\n\n\t- word1 and word2 consist of lowercase English letters.",
      "examples": [
        {
          "input": {
            "word1": "horse",
            "word2": "ros"
          },
          "output": 3
        },
        {
          "input": {
            "word1": "intention",
            "word2": "execution"
          },
          "output": 5
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "string"
      ],
      "starterCodePython": "class Solution:\n    def minDistance(self, word1: str, word2: str) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int minDistance(string word1, string word2) {\n        \n    }\n};",
      "methodName": "minDistance",
      "executionContract": {
        "name": "minDistance",
        "params": [
          {
            "name": "word1",
            "type": "string"
          },
          {
            "name": "word2",
            "type": "string"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:12.558Z",
      "referenceSolutionHash": "sha256:719d965adec7eadfc43db7e35daf3892123e2b3fb0a7f63c8cab9fc83b693372",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "word1": "horse",
            "word2": "ros"
          },
          "expected": 3,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "\"horse\"\n\"ros\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "word1": "intention",
            "word2": "execution"
          },
          "expected": 5,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "\"intention\"\n\"execution\"",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 123,
      "slug": "best-time-to-buy-and-sell-stock-iii",
      "title": "Best Time to Buy and Sell Stock III",
      "difficulty": "Hard",
      "hot150Order": 148,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/best-time-to-buy-and-sell-stock-iii/",
      "statementMarkdown": "You are given an array prices where prices[i] is the price of a given stock on the ith day.\n\nFind the maximum profit you can achieve. You may complete at most two transactions.\n\nNote: You may not engage in multiple transactions simultaneously (i.e., you must sell the stock before you buy again).\n\n \n\nExample 1:\n\n```text\n\nInput: prices = [3,3,5,0,0,3,1,4]\nOutput: 6\nExplanation: Buy on day 4 (price = 0) and sell on day 6 (price = 3), profit = 3-0 = 3.\nThen buy on day 7 (price = 1) and sell on day 8 (price = 4), profit = 4-1 = 3.\n```\n\nExample 2:\n\n```text\n\nInput: prices = [1,2,3,4,5]\nOutput: 4\nExplanation: Buy on day 1 (price = 1) and sell on day 5 (price = 5), profit = 5-1 = 4.\nNote that you cannot buy on day 1, buy on day 2 and sell them later, as you are engaging multiple transactions at the same time. You must sell before buying again.\n\n```\n\nExample 3:\n\n```text\n\nInput: prices = [7,6,4,3,1]\nOutput: 0\nExplanation: In this case, no transaction is done, i.e. max profit = 0.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= prices.length <= 105\n\n\t- 0 <= prices[i] <= 105",
      "examples": [
        {
          "input": {
            "prices": [
              3,
              3,
              5,
              0,
              0,
              3,
              1,
              4
            ]
          },
          "output": 6
        },
        {
          "input": {
            "prices": [
              1,
              2,
              3,
              4,
              5
            ]
          },
          "output": 4
        },
        {
          "input": {
            "prices": [
              7,
              6,
              4,
              3,
              1
            ]
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def maxProfit(self, prices: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maxProfit(vector<int>& prices) {\n        \n    }\n};",
      "methodName": "maxProfit",
      "executionContract": {
        "name": "maxProfit",
        "params": [
          {
            "name": "prices",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:13.001Z",
      "referenceSolutionHash": "sha256:69de7a46a56e83ea04a242742da404a7a79bd8443a5dd4dbdda0fc009e846d9e",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "prices": [
              3,
              3,
              5,
              0,
              0,
              3,
              1,
              4
            ]
          },
          "expected": 6,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[3,3,5,0,0,3,1,4]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "prices": [
              1,
              2,
              3,
              4,
              5
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[1,2,3,4,5]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "prices": [
              7,
              6,
              4,
              3,
              1
            ]
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[7,6,4,3,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 188,
      "slug": "best-time-to-buy-and-sell-stock-iv",
      "title": "Best Time to Buy and Sell Stock IV",
      "difficulty": "Hard",
      "hot150Order": 149,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/best-time-to-buy-and-sell-stock-iv/",
      "statementMarkdown": "You are given an integer array prices where prices[i] is the price of a given stock on the ith day, and an integer k.\n\nFind the maximum profit you can achieve. You may complete at most k transactions: i.e. you may buy at most k times and sell at most k times.\n\nNote: You may not engage in multiple transactions simultaneously (i.e., you must sell the stock before you buy again).\n\n \n\nExample 1:\n\n```text\n\nInput: k = 2, prices = [2,4,1]\nOutput: 2\nExplanation: Buy on day 1 (price = 2) and sell on day 2 (price = 4), profit = 4-2 = 2.\n\n```\n\nExample 2:\n\n```text\n\nInput: k = 2, prices = [3,2,6,5,0,3]\nOutput: 7\nExplanation: Buy on day 2 (price = 2) and sell on day 3 (price = 6), profit = 6-2 = 4. Then buy on day 5 (price = 0) and sell on day 6 (price = 3), profit = 3-0 = 3.\n\n```\n\n \n\nConstraints:\n\n\t- 1 <= k <= 100\n\n\t- 1 <= prices.length <= 1000\n\n\t- 0 <= prices[i] <= 1000",
      "examples": [
        {
          "input": {
            "k": 2,
            "prices": [
              2,
              4,
              1
            ]
          },
          "output": 2
        },
        {
          "input": {
            "k": 2,
            "prices": [
              3,
              2,
              6,
              5,
              0,
              3
            ]
          },
          "output": 7
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array"
      ],
      "starterCodePython": "class Solution:\n    def maxProfit(self, k: int, prices: List[int]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maxProfit(int k, vector<int>& prices) {\n        \n    }\n};",
      "methodName": "maxProfit",
      "executionContract": {
        "name": "maxProfit",
        "params": [
          {
            "name": "k",
            "type": "integer"
          },
          {
            "name": "prices",
            "type": "integer[]"
          }
        ],
        "returnType": "integer",
        "contractKind": "pure_function"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:13.420Z",
      "referenceSolutionHash": "sha256:0e2d55a8ed171e15646ef12fcf5a4575c40e66e606d5b2dbe269585ae0594c0e",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "k": 2,
            "prices": [
              2,
              4,
              1
            ]
          },
          "expected": 2,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "2\n[2,4,1]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "k": 2,
            "prices": [
              3,
              2,
              6,
              5,
              0,
              3
            ]
          },
          "expected": 7,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "2\n[3,2,6,5,0,3]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    },
    {
      "leetcodeNumber": 221,
      "slug": "maximal-square",
      "title": "Maximal Square",
      "difficulty": "Medium",
      "hot150Order": 150,
      "hot150Section": "Multidimensional DP",
      "officialUrl": "https://leetcode.com/problems/maximal-square/",
      "statementMarkdown": "Given an m x n binary matrix filled with 0's and 1's, find the largest square containing only 1's and return its area.\n\n \n\nExample 1:\n\n```text\n\nInput: matrix = [[\"1\",\"0\",\"1\",\"0\",\"0\"],[\"1\",\"0\",\"1\",\"1\",\"1\"],[\"1\",\"1\",\"1\",\"1\",\"1\"],[\"1\",\"0\",\"0\",\"1\",\"0\"]]\nOutput: 4\n\n```\n\nExample 2:\n\n```text\n\nInput: matrix = [[\"0\",\"1\"],[\"1\",\"0\"]]\nOutput: 1\n\n```\n\nExample 3:\n\n```text\n\nInput: matrix = [[\"0\"]]\nOutput: 0\n\n```\n\n \n\nConstraints:\n\n\t- m == matrix.length\n\n\t- n == matrix[i].length\n\n\t- 1 <= m, n <= 300\n\n\t- matrix[i][j] is '0' or '1'.",
      "examples": [
        {
          "input": {
            "matrix": [
              [
                "1",
                "0",
                "1",
                "0",
                "0"
              ],
              [
                "1",
                "0",
                "1",
                "1",
                "1"
              ],
              [
                "1",
                "1",
                "1",
                "1",
                "1"
              ],
              [
                "1",
                "0",
                "0",
                "1",
                "0"
              ]
            ]
          },
          "output": 4
        },
        {
          "input": {
            "matrix": [
              [
                "0",
                "1"
              ],
              [
                "1",
                "0"
              ]
            ]
          },
          "output": 1
        },
        {
          "input": {
            "matrix": [
              [
                "0"
              ]
            ]
          },
          "output": 0
        }
      ],
      "constraints": [],
      "tags": [
        "dynamic-programming",
        "multidimensional-dp",
        "top-interview-150",
        "interview-150",
        "hot150",
        "array",
        "matrix"
      ],
      "starterCodePython": "class Solution:\n    def maximalSquare(self, matrix: List[List[str]]) -> int:\n        ",
      "starterCodeCpp": "class Solution {\npublic:\n    int maximalSquare(vector<vector<char>>& matrix) {\n        \n    }\n};",
      "methodName": "maximalSquare",
      "executionContract": {
        "name": "maximalSquare",
        "params": [
          {
            "name": "matrix",
            "type": "character[][]"
          }
        ],
        "returnType": "integer",
        "contractKind": "grid"
      },
      "comparisonStrategy": "exact",
      "comparisonConfig": {},
      "localRunStatus": "runnable",
      "localRunStatusMessage": "Local Python Run is available with reference-solution-generated visible tests.",
      "localRunValidatedAt": "2026-06-18T15:17:13.834Z",
      "referenceSolutionHash": "sha256:542746fa125fa2718d7da0a41d6a6815857568ad7cfd951eb7675eb5d8c549ec",
      "tests": [
        {
          "label": "local sample 1",
          "input": {
            "matrix": [
              [
                "1",
                "0",
                "1",
                "0",
                "0"
              ],
              [
                "1",
                "0",
                "1",
                "1",
                "1"
              ],
              [
                "1",
                "1",
                "1",
                "1",
                "1"
              ],
              [
                "1",
                "0",
                "0",
                "1",
                "0"
              ]
            ]
          },
          "expected": 4,
          "source": "local_sample",
          "sortOrder": 0,
          "metadata": {
            "dataInput": "[[\"1\",\"0\",\"1\",\"0\",\"0\"],[\"1\",\"0\",\"1\",\"1\",\"1\"],[\"1\",\"1\",\"1\",\"1\",\"1\"],[\"1\",\"0\",\"0\",\"1\",\"0\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 2",
          "input": {
            "matrix": [
              [
                "0",
                "1"
              ],
              [
                "1",
                "0"
              ]
            ]
          },
          "expected": 1,
          "source": "local_sample",
          "sortOrder": 1,
          "metadata": {
            "dataInput": "[[\"0\",\"1\"],[\"1\",\"0\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        },
        {
          "label": "local sample 3",
          "input": {
            "matrix": [
              [
                "0"
              ]
            ]
          },
          "expected": 0,
          "source": "local_sample",
          "sortOrder": 2,
          "metadata": {
            "dataInput": "[[\"0\"]]",
            "gtGeneratedBy": "ac_solution_piston",
            "referenceProvider": "local_hot150",
            "referenceRunStatus": "gt_emitted"
          },
          "expectedSource": "generated",
          "gtProvenance": "ac_solution",
          "validationStatus": "validated"
        }
      ]
    }
  ]
});
