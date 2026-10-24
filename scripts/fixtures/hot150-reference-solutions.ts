export const hot150ReferenceSolutions = [
  {
    "leetcodeNumber": 88,
    "title": "Merge Sorted Array",
    "idea": "从两个数组尾部向前填充 `nums1`，避免覆盖还没用过的元素。",
    "code": "from typing import List\n\n\nclass Solution:\n    def merge(self, nums1: List[int], m: int, nums2: List[int], n: int) -> None:\n        i, j, k = m - 1, n - 1, m + n - 1\n        while j >= 0:\n            if i >= 0 and nums1[i] > nums2[j]:\n                nums1[k] = nums1[i]\n                i -= 1\n            else:\n                nums1[k] = nums2[j]\n                j -= 1\n            k -= 1"
  },
  {
    "leetcodeNumber": 27,
    "title": "Remove Element",
    "idea": "双指针原地保留所有不等于 `val` 的元素。",
    "code": "from typing import List\n\n\nclass Solution:\n    def removeElement(self, nums: List[int], val: int) -> int:\n        k = 0\n        for x in nums:\n            if x != val:\n                nums[k] = x\n                k += 1\n        return k"
  },
  {
    "leetcodeNumber": 26,
    "title": "Remove Duplicates from Sorted Array",
    "idea": "有序数组中只把和上一个保留值不同的数写到慢指针位置。",
    "code": "from typing import List\n\n\nclass Solution:\n    def removeDuplicates(self, nums: List[int]) -> int:\n        if not nums:\n            return 0\n        k = 1\n        for i in range(1, len(nums)):\n            if nums[i] != nums[k - 1]:\n                nums[k] = nums[i]\n                k += 1\n        return k"
  },
  {
    "leetcodeNumber": 80,
    "title": "Remove Duplicates from Sorted Array II",
    "idea": "每个数最多保留两个；写入前比较 `nums[k-2]` 即可。",
    "code": "from typing import List\n\n\nclass Solution:\n    def removeDuplicates(self, nums: List[int]) -> int:\n        k = 0\n        for x in nums:\n            if k < 2 or x != nums[k - 2]:\n                nums[k] = x\n                k += 1\n        return k"
  },
  {
    "leetcodeNumber": 169,
    "title": "Majority Element",
    "idea": "Boyer-Moore 投票；多数元素和其他元素抵消后仍会留下。",
    "code": "from typing import List\n\n\nclass Solution:\n    def majorityElement(self, nums: List[int]) -> int:\n        candidate = None\n        count = 0\n        for x in nums:\n            if count == 0:\n                candidate = x\n            count += 1 if x == candidate else -1\n        return candidate"
  },
  {
    "leetcodeNumber": 189,
    "title": "Rotate Array",
    "idea": "三次翻转，先整体翻转，再分别翻转前 `k` 个和后半段。",
    "code": "from typing import List\n\n\nclass Solution:\n    def rotate(self, nums: List[int], k: int) -> None:\n        n = len(nums)\n        k %= n\n\n        def reverse(left: int, right: int) -> None:\n            while left < right:\n                nums[left], nums[right] = nums[right], nums[left]\n                left += 1\n                right -= 1\n\n        reverse(0, n - 1)\n        reverse(0, k - 1)\n        reverse(k, n - 1)"
  },
  {
    "leetcodeNumber": 121,
    "title": "Best Time to Buy and Sell Stock",
    "idea": "维护历史最低买入价，用当前价格更新最大收益。",
    "code": "from typing import List\n\n\nclass Solution:\n    def maxProfit(self, prices: List[int]) -> int:\n        best_buy = prices[0]\n        ans = 0\n        for price in prices:\n            best_buy = min(best_buy, price)\n            ans = max(ans, price - best_buy)\n        return ans"
  },
  {
    "leetcodeNumber": 122,
    "title": "Best Time to Buy and Sell Stock II",
    "idea": "所有上涨区间的差价都可以吃到，累加相邻正收益。",
    "code": "from typing import List\n\n\nclass Solution:\n    def maxProfit(self, prices: List[int]) -> int:\n        profit = 0\n        for i in range(1, len(prices)):\n            if prices[i] > prices[i - 1]:\n                profit += prices[i] - prices[i - 1]\n        return profit"
  },
  {
    "leetcodeNumber": 55,
    "title": "Jump Game",
    "idea": "贪心维护当前能到达的最远下标，遇到超过最远下标的位置则失败。",
    "code": "from typing import List\n\n\nclass Solution:\n    def canJump(self, nums: List[int]) -> bool:\n        farthest = 0\n        for i, step in enumerate(nums):\n            if i > farthest:\n                return False\n            farthest = max(farthest, i + step)\n        return True"
  },
  {
    "leetcodeNumber": 45,
    "title": "Jump Game II",
    "idea": "按层贪心；当前跳跃覆盖范围结束时，必须增加一次跳跃，并扩展到下一层最远位置。",
    "code": "from typing import List\n\n\nclass Solution:\n    def jump(self, nums: List[int]) -> int:\n        jumps = 0\n        cur_end = 0\n        farthest = 0\n        for i in range(len(nums) - 1):\n            farthest = max(farthest, i + nums[i])\n            if i == cur_end:\n                jumps += 1\n                cur_end = farthest\n        return jumps"
  },
  {
    "leetcodeNumber": 274,
    "title": "H-Index",
    "idea": "计数桶统计引用数，超过 `n` 的都放入第 `n` 桶；从高到低累计论文数。",
    "code": "from typing import List\n\n\nclass Solution:\n    def hIndex(self, citations: List[int]) -> int:\n        n = len(citations)\n        buckets = [0] * (n + 1)\n        for c in citations:\n            buckets[min(c, n)] += 1\n        papers = 0\n        for h in range(n, -1, -1):\n            papers += buckets[h]\n            if papers >= h:\n                return h\n        return 0"
  },
  {
    "leetcodeNumber": 380,
    "title": "Insert Delete GetRandom O(1)",
    "idea": "数组存元素，哈希表存元素下标；删除时用末尾元素覆盖被删位置。",
    "code": "import random\n\n\nclass RandomizedSet:\n    def __init__(self):\n        self.values = []\n        self.index = {}\n\n    def insert(self, val: int) -> bool:\n        if val in self.index:\n            return False\n        self.index[val] = len(self.values)\n        self.values.append(val)\n        return True\n\n    def remove(self, val: int) -> bool:\n        if val not in self.index:\n            return False\n        i = self.index[val]\n        last = self.values[-1]\n        self.values[i] = last\n        self.index[last] = i\n        self.values.pop()\n        del self.index[val]\n        return True\n\n    def getRandom(self) -> int:\n        return random.choice(self.values)"
  },
  {
    "leetcodeNumber": 238,
    "title": "Product of Array Except Self",
    "idea": "答案先存左侧乘积，再从右向左乘上右侧乘积。",
    "code": "from typing import List\n\n\nclass Solution:\n    def productExceptSelf(self, nums: List[int]) -> List[int]:\n        ans = [1] * len(nums)\n        prefix = 1\n        for i, x in enumerate(nums):\n            ans[i] = prefix\n            prefix *= x\n        suffix = 1\n        for i in range(len(nums) - 1, -1, -1):\n            ans[i] *= suffix\n            suffix *= nums[i]\n        return ans"
  },
  {
    "leetcodeNumber": 134,
    "title": "Gas Station",
    "idea": "总油量不足必无解；若从当前起点到某站油量为负，则当前起点到该站都不能作为起点。",
    "code": "from typing import List\n\n\nclass Solution:\n    def canCompleteCircuit(self, gas: List[int], cost: List[int]) -> int:\n        if sum(gas) < sum(cost):\n            return -1\n        start = 0\n        tank = 0\n        for i, (g, c) in enumerate(zip(gas, cost)):\n            tank += g - c\n            if tank < 0:\n                start = i + 1\n                tank = 0\n        return start"
  },
  {
    "leetcodeNumber": 135,
    "title": "Candy",
    "idea": "左到右保证比左邻大时糖更多，右到左保证比右邻大时糖更多。",
    "code": "from typing import List\n\n\nclass Solution:\n    def candy(self, ratings: List[int]) -> int:\n        n = len(ratings)\n        candies = [1] * n\n        for i in range(1, n):\n            if ratings[i] > ratings[i - 1]:\n                candies[i] = candies[i - 1] + 1\n        for i in range(n - 2, -1, -1):\n            if ratings[i] > ratings[i + 1]:\n                candies[i] = max(candies[i], candies[i + 1] + 1)\n        return sum(candies)"
  },
  {
    "leetcodeNumber": 42,
    "title": "Trapping Rain Water",
    "idea": "双指针维护左右最高墙，较矮一侧决定当前位置能接多少水。",
    "code": "from typing import List\n\n\nclass Solution:\n    def trap(self, height: List[int]) -> int:\n        left, right = 0, len(height) - 1\n        left_max = right_max = 0\n        water = 0\n        while left < right:\n            if height[left] < height[right]:\n                left_max = max(left_max, height[left])\n                water += left_max - height[left]\n                left += 1\n            else:\n                right_max = max(right_max, height[right])\n                water += right_max - height[right]\n                right -= 1\n        return water"
  },
  {
    "leetcodeNumber": 13,
    "title": "Roman to Integer",
    "idea": "从左到右扫描，若当前值小于右侧值则减，否则加。",
    "code": "class Solution:\n    def romanToInt(self, s: str) -> int:\n        value = {\"I\": 1, \"V\": 5, \"X\": 10, \"L\": 50, \"C\": 100, \"D\": 500, \"M\": 1000}\n        ans = 0\n        for i, ch in enumerate(s):\n            if i + 1 < len(s) and value[ch] < value[s[i + 1]]:\n                ans -= value[ch]\n            else:\n                ans += value[ch]\n        return ans"
  },
  {
    "leetcodeNumber": 12,
    "title": "Integer to Roman",
    "idea": "按从大到小的罗马数值贪心拼接。",
    "code": "class Solution:\n    def intToRoman(self, num: int) -> str:\n        pairs = [\n            (1000, \"M\"), (900, \"CM\"), (500, \"D\"), (400, \"CD\"),\n            (100, \"C\"), (90, \"XC\"), (50, \"L\"), (40, \"XL\"),\n            (10, \"X\"), (9, \"IX\"), (5, \"V\"), (4, \"IV\"), (1, \"I\"),\n        ]\n        ans = []\n        for value, symbol in pairs:\n            count, num = divmod(num, value)\n            ans.append(symbol * count)\n        return \"\".join(ans)"
  },
  {
    "leetcodeNumber": 58,
    "title": "Length of Last Word",
    "idea": "去掉末尾空格后，最后一个单词长度就是按空格分割后的最后段长度。",
    "code": "class Solution:\n    def lengthOfLastWord(self, s: str) -> int:\n        i = len(s) - 1\n        while i >= 0 and s[i] == \" \":\n            i -= 1\n        length = 0\n        while i >= 0 and s[i] != \" \":\n            length += 1\n            i -= 1\n        return length"
  },
  {
    "leetcodeNumber": 14,
    "title": "Longest Common Prefix",
    "idea": "逐步缩短前缀，直到每个字符串都以它开头。",
    "code": "from typing import List\n\n\nclass Solution:\n    def longestCommonPrefix(self, strs: List[str]) -> str:\n        prefix = strs[0]\n        for s in strs[1:]:\n            while not s.startswith(prefix):\n                prefix = prefix[:-1]\n                if not prefix:\n                    return \"\"\n        return prefix"
  },
  {
    "leetcodeNumber": 151,
    "title": "Reverse Words in a String",
    "idea": "按空白分割会自动去掉多余空格，再反转单词列表。",
    "code": "class Solution:\n    def reverseWords(self, s: str) -> str:\n        return \" \".join(reversed(s.split()))"
  },
  {
    "leetcodeNumber": 6,
    "title": "Zigzag Conversion",
    "idea": "模拟每个字符所在行，走到首行或末行时改变方向。",
    "code": "class Solution:\n    def convert(self, s: str, numRows: int) -> str:\n        if numRows == 1 or numRows >= len(s):\n            return s\n        rows = [\"\"] * numRows\n        row = 0\n        step = 1\n        for ch in s:\n            rows[row] += ch\n            if row == 0:\n                step = 1\n            elif row == numRows - 1:\n                step = -1\n            row += step\n        return \"\".join(rows)"
  },
  {
    "leetcodeNumber": 28,
    "title": "Find the Index of the First Occurrence in a String",
    "idea": "KMP 先构造模式串的最长相等前后缀数组，再在线性扫描中匹配。",
    "code": "class Solution:\n    def strStr(self, haystack: str, needle: str) -> int:\n        if not needle:\n            return 0\n\n        lps = [0] * len(needle)\n        j = 0\n        for i in range(1, len(needle)):\n            while j and needle[i] != needle[j]:\n                j = lps[j - 1]\n            if needle[i] == needle[j]:\n                j += 1\n                lps[i] = j\n\n        j = 0\n        for i, ch in enumerate(haystack):\n            while j and ch != needle[j]:\n                j = lps[j - 1]\n            if ch == needle[j]:\n                j += 1\n                if j == len(needle):\n                    return i - j + 1\n        return -1"
  },
  {
    "leetcodeNumber": 68,
    "title": "Text Justification",
    "idea": "贪心装入每一行；普通行均匀分配空格，最后一行左对齐。",
    "code": "from typing import List\n\n\nclass Solution:\n    def fullJustify(self, words: List[str], maxWidth: int) -> List[str]:\n        ans = []\n        i = 0\n        while i < len(words):\n            line_len = len(words[i])\n            j = i + 1\n            while j < len(words) and line_len + 1 + len(words[j]) <= maxWidth:\n                line_len += 1 + len(words[j])\n                j += 1\n\n            gaps = j - i - 1\n            if j == len(words) or gaps == 0:\n                line = \" \".join(words[i:j])\n                line += \" \" * (maxWidth - len(line))\n            else:\n                words_len = sum(len(w) for w in words[i:j])\n                spaces = maxWidth - words_len\n                even, extra = divmod(spaces, gaps)\n                parts = []\n                for k in range(i, j - 1):\n                    parts.append(words[k])\n                    parts.append(\" \" * (even + (1 if k - i < extra else 0)))\n                parts.append(words[j - 1])\n                line = \"\".join(parts)\n            ans.append(line)\n            i = j\n        return ans"
  },
  {
    "leetcodeNumber": 125,
    "title": "Valid Palindrome",
    "idea": "左右指针跳过非字母数字字符，比较小写形式。",
    "code": "class Solution:\n    def isPalindrome(self, s: str) -> bool:\n        left, right = 0, len(s) - 1\n        while left < right:\n            while left < right and not s[left].isalnum():\n                left += 1\n            while left < right and not s[right].isalnum():\n                right -= 1\n            if s[left].lower() != s[right].lower():\n                return False\n            left += 1\n            right -= 1\n        return True"
  },
  {
    "leetcodeNumber": 392,
    "title": "Is Subsequence",
    "idea": "双指针扫描 `t`，按顺序匹配 `s` 的字符。",
    "code": "class Solution:\n    def isSubsequence(self, s: str, t: str) -> bool:\n        i = 0\n        for ch in t:\n            if i < len(s) and s[i] == ch:\n                i += 1\n        return i == len(s)"
  },
  {
    "leetcodeNumber": 167,
    "title": "Two Sum II - Input Array Is Sorted",
    "idea": "有序数组用左右指针；和小了左移，大了右移。",
    "code": "from typing import List\n\n\nclass Solution:\n    def twoSum(self, numbers: List[int], target: int) -> List[int]:\n        left, right = 0, len(numbers) - 1\n        while left < right:\n            total = numbers[left] + numbers[right]\n            if total == target:\n                return [left + 1, right + 1]\n            if total < target:\n                left += 1\n            else:\n                right -= 1\n        return []"
  },
  {
    "leetcodeNumber": 11,
    "title": "Container With Most Water",
    "idea": "面积由短板决定，每次移动较短的一侧才可能变好。",
    "code": "from typing import List\n\n\nclass Solution:\n    def maxArea(self, height: List[int]) -> int:\n        left, right = 0, len(height) - 1\n        ans = 0\n        while left < right:\n            ans = max(ans, (right - left) * min(height[left], height[right]))\n            if height[left] < height[right]:\n                left += 1\n            else:\n                right -= 1\n        return ans"
  },
  {
    "leetcodeNumber": 15,
    "title": "3Sum",
    "idea": "排序后枚举第一个数，剩下两个数用双指针，同时跳过重复值。",
    "code": "from typing import List\n\n\nclass Solution:\n    def threeSum(self, nums: List[int]) -> List[List[int]]:\n        nums.sort()\n        ans = []\n        n = len(nums)\n        for i in range(n - 2):\n            if i > 0 and nums[i] == nums[i - 1]:\n                continue\n            if nums[i] > 0:\n                break\n            left, right = i + 1, n - 1\n            while left < right:\n                total = nums[i] + nums[left] + nums[right]\n                if total == 0:\n                    ans.append([nums[i], nums[left], nums[right]])\n                    left += 1\n                    right -= 1\n                    while left < right and nums[left] == nums[left - 1]:\n                        left += 1\n                    while left < right and nums[right] == nums[right + 1]:\n                        right -= 1\n                elif total < 0:\n                    left += 1\n                else:\n                    right -= 1\n        return ans"
  },
  {
    "leetcodeNumber": 209,
    "title": "Minimum Size Subarray Sum",
    "idea": "正整数数组可用滑动窗口；窗口和达到目标后不断收缩左边界。",
    "code": "from typing import List\n\n\nclass Solution:\n    def minSubArrayLen(self, target: int, nums: List[int]) -> int:\n        left = 0\n        total = 0\n        ans = len(nums) + 1\n        for right, x in enumerate(nums):\n            total += x\n            while total >= target:\n                ans = min(ans, right - left + 1)\n                total -= nums[left]\n                left += 1\n        return 0 if ans == len(nums) + 1 else ans"
  },
  {
    "leetcodeNumber": 3,
    "title": "Longest Substring Without Repeating Characters",
    "idea": "记录字符最近出现位置，遇到重复时把左边界跳到重复字符右侧。",
    "code": "class Solution:\n    def lengthOfLongestSubstring(self, s: str) -> int:\n        last = {}\n        left = 0\n        ans = 0\n        for right, ch in enumerate(s):\n            if ch in last and last[ch] >= left:\n                left = last[ch] + 1\n            last[ch] = right\n            ans = max(ans, right - left + 1)\n        return ans"
  },
  {
    "leetcodeNumber": 30,
    "title": "Substring with Concatenation of All Words",
    "idea": "按单词长度分组滑动窗口，维护窗口内每个单词出现次数。",
    "code": "from collections import Counter, defaultdict\nfrom typing import List\n\n\nclass Solution:\n    def findSubstring(self, s: str, words: List[str]) -> List[int]:\n        if not s or not words:\n            return []\n        word_len = len(words[0])\n        total_len = word_len * len(words)\n        need = Counter(words)\n        ans = []\n\n        for offset in range(word_len):\n            left = offset\n            window = defaultdict(int)\n            used = 0\n            for right in range(offset, len(s) - word_len + 1, word_len):\n                word = s[right:right + word_len]\n                if word in need:\n                    window[word] += 1\n                    used += 1\n                    while window[word] > need[word]:\n                        left_word = s[left:left + word_len]\n                        window[left_word] -= 1\n                        used -= 1\n                        left += word_len\n                    if used == len(words):\n                        ans.append(left)\n                        left_word = s[left:left + word_len]\n                        window[left_word] -= 1\n                        used -= 1\n                        left += word_len\n                else:\n                    window.clear()\n                    used = 0\n                    left = right + word_len\n        return ans"
  },
  {
    "leetcodeNumber": 76,
    "title": "Minimum Window Substring",
    "idea": "滑动窗口覆盖 `t` 的计数后，尽量收缩左边界更新最短答案。",
    "code": "from collections import Counter, defaultdict\n\n\nclass Solution:\n    def minWindow(self, s: str, t: str) -> str:\n        need = Counter(t)\n        window = defaultdict(int)\n        formed = 0\n        required = len(need)\n        left = 0\n        best = (float(\"inf\"), 0, 0)\n\n        for right, ch in enumerate(s):\n            window[ch] += 1\n            if ch in need and window[ch] == need[ch]:\n                formed += 1\n\n            while formed == required:\n                if right - left + 1 < best[0]:\n                    best = (right - left + 1, left, right)\n                drop = s[left]\n                window[drop] -= 1\n                if drop in need and window[drop] < need[drop]:\n                    formed -= 1\n                left += 1\n\n        return \"\" if best[0] == float(\"inf\") else s[best[1]:best[2] + 1]"
  },
  {
    "leetcodeNumber": 36,
    "title": "Valid Sudoku",
    "idea": "每个数字在对应行、列、宫中只能出现一次，用集合记录。",
    "code": "from typing import List\n\n\nclass Solution:\n    def isValidSudoku(self, board: List[List[str]]) -> bool:\n        rows = [set() for _ in range(9)]\n        cols = [set() for _ in range(9)]\n        boxes = [set() for _ in range(9)]\n        for r in range(9):\n            for c in range(9):\n                val = board[r][c]\n                if val == \".\":\n                    continue\n                b = (r // 3) * 3 + c // 3\n                if val in rows[r] or val in cols[c] or val in boxes[b]:\n                    return False\n                rows[r].add(val)\n                cols[c].add(val)\n                boxes[b].add(val)\n        return True"
  },
  {
    "leetcodeNumber": 54,
    "title": "Spiral Matrix",
    "idea": "维护上下左右边界，按右、下、左、上四个方向逐圈遍历。",
    "code": "from typing import List\n\n\nclass Solution:\n    def spiralOrder(self, matrix: List[List[int]]) -> List[int]:\n        top, bottom = 0, len(matrix) - 1\n        left, right = 0, len(matrix[0]) - 1\n        ans = []\n        while top <= bottom and left <= right:\n            for c in range(left, right + 1):\n                ans.append(matrix[top][c])\n            top += 1\n            for r in range(top, bottom + 1):\n                ans.append(matrix[r][right])\n            right -= 1\n            if top <= bottom:\n                for c in range(right, left - 1, -1):\n                    ans.append(matrix[bottom][c])\n                bottom -= 1\n            if left <= right:\n                for r in range(bottom, top - 1, -1):\n                    ans.append(matrix[r][left])\n                left += 1\n        return ans"
  },
  {
    "leetcodeNumber": 48,
    "title": "Rotate Image",
    "idea": "先沿主对角线转置，再反转每一行。",
    "code": "from typing import List\n\n\nclass Solution:\n    def rotate(self, matrix: List[List[int]]) -> None:\n        n = len(matrix)\n        for r in range(n):\n            for c in range(r + 1, n):\n                matrix[r][c], matrix[c][r] = matrix[c][r], matrix[r][c]\n        for row in matrix:\n            row.reverse()"
  },
  {
    "leetcodeNumber": 73,
    "title": "Set Matrix Zeroes",
    "idea": "用第一行和第一列作为标记区，额外记录它们本身是否需要清零。",
    "code": "from typing import List\n\n\nclass Solution:\n    def setZeroes(self, matrix: List[List[int]]) -> None:\n        m, n = len(matrix), len(matrix[0])\n        first_row_zero = any(matrix[0][c] == 0 for c in range(n))\n        first_col_zero = any(matrix[r][0] == 0 for r in range(m))\n\n        for r in range(1, m):\n            for c in range(1, n):\n                if matrix[r][c] == 0:\n                    matrix[r][0] = matrix[0][c] = 0\n\n        for r in range(1, m):\n            for c in range(1, n):\n                if matrix[r][0] == 0 or matrix[0][c] == 0:\n                    matrix[r][c] = 0\n\n        if first_row_zero:\n            for c in range(n):\n                matrix[0][c] = 0\n        if first_col_zero:\n            for r in range(m):\n                matrix[r][0] = 0"
  },
  {
    "leetcodeNumber": 289,
    "title": "Game of Life",
    "idea": "原地编码状态变化；`1 -> 0` 标记为 `-1`，`0 -> 1` 标记为 `2`，最后归一化。",
    "code": "from typing import List\n\n\nclass Solution:\n    def gameOfLife(self, board: List[List[int]]) -> None:\n        m, n = len(board), len(board[0])\n        dirs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]\n\n        for r in range(m):\n            for c in range(n):\n                live = 0\n                for dr, dc in dirs:\n                    nr, nc = r + dr, c + dc\n                    if 0 <= nr < m and 0 <= nc < n and abs(board[nr][nc]) == 1:\n                        live += 1\n                if board[r][c] == 1 and (live < 2 or live > 3):\n                    board[r][c] = -1\n                elif board[r][c] == 0 and live == 3:\n                    board[r][c] = 2\n\n        for r in range(m):\n            for c in range(n):\n                board[r][c] = 1 if board[r][c] > 0 else 0"
  },
  {
    "leetcodeNumber": 383,
    "title": "Ransom Note",
    "idea": "比较两个字符串的字符计数，保证杂志中每个字符都足够。",
    "code": "from collections import Counter\n\n\nclass Solution:\n    def canConstruct(self, ransomNote: str, magazine: str) -> bool:\n        need = Counter(ransomNote)\n        have = Counter(magazine)\n        for ch, cnt in need.items():\n            if have[ch] < cnt:\n                return False\n        return True"
  },
  {
    "leetcodeNumber": 205,
    "title": "Isomorphic Strings",
    "idea": "维护双向映射，确保一个字符只能映射到一个字符且不能被多个字符复用。",
    "code": "class Solution:\n    def isIsomorphic(self, s: str, t: str) -> bool:\n        st = {}\n        ts = {}\n        for a, b in zip(s, t):\n            if st.get(a, b) != b or ts.get(b, a) != a:\n                return False\n            st[a] = b\n            ts[b] = a\n        return True"
  },
  {
    "leetcodeNumber": 290,
    "title": "Word Pattern",
    "idea": "和同构字符串一样做双向映射，pattern 字符对应单词。",
    "code": "class Solution:\n    def wordPattern(self, pattern: str, s: str) -> bool:\n        words = s.split()\n        if len(pattern) != len(words):\n            return False\n        p_to_w = {}\n        w_to_p = {}\n        for p, w in zip(pattern, words):\n            if p_to_w.get(p, w) != w or w_to_p.get(w, p) != p:\n                return False\n            p_to_w[p] = w\n            w_to_p[w] = p\n        return True"
  },
  {
    "leetcodeNumber": 242,
    "title": "Valid Anagram",
    "idea": "两个字符串字符计数相同即为异位词。",
    "code": "from collections import Counter\n\n\nclass Solution:\n    def isAnagram(self, s: str, t: str) -> bool:\n        return Counter(s) == Counter(t)"
  },
  {
    "leetcodeNumber": 49,
    "title": "Group Anagrams",
    "idea": "排序后的字符串作为分组 key。",
    "code": "from collections import defaultdict\nfrom typing import List\n\n\nclass Solution:\n    def groupAnagrams(self, strs: List[str]) -> List[List[str]]:\n        groups = defaultdict(list)\n        for s in strs:\n            groups[\"\".join(sorted(s))].append(s)\n        return list(groups.values())"
  },
  {
    "leetcodeNumber": 1,
    "title": "Two Sum",
    "idea": "哈希表存已见数字下标，遇到补数直接返回。",
    "code": "from typing import List\n\n\nclass Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, x in enumerate(nums):\n            if target - x in seen:\n                return [seen[target - x], i]\n            seen[x] = i\n        return []"
  },
  {
    "leetcodeNumber": 202,
    "title": "Happy Number",
    "idea": "不断替换为各位平方和，出现 1 成功，出现循环失败。",
    "code": "class Solution:\n    def isHappy(self, n: int) -> bool:\n        def next_num(x: int) -> int:\n            total = 0\n            while x:\n                x, d = divmod(x, 10)\n                total += d * d\n            return total\n\n        seen = set()\n        while n != 1 and n not in seen:\n            seen.add(n)\n            n = next_num(n)\n        return n == 1"
  },
  {
    "leetcodeNumber": 219,
    "title": "Contains Duplicate II （ok）",
    "idea": "记录每个数字最近下标，距离不超过 `k` 则返回真。",
    "code": "from typing import List\n\n\nclass Solution:\n    def containsNearbyDuplicate(self, nums: List[int], k: int) -> bool:\n        last = {}\n        for i, x in enumerate(nums):\n            if x in last and i - last[x] <= k:\n                return True\n            last[x] = i\n        return False"
  },
  {
    "leetcodeNumber": 128,
    "title": "Longest Consecutive Sequence",
    "idea": "用集合去重，只从没有前驱的数开始向后数连续长度。",
    "code": "from typing import List\n\n\nclass Solution:\n    def longestConsecutive(self, nums: List[int]) -> int:\n        values = set(nums)\n        best = 0\n        for x in values:\n            if x - 1 not in values:\n                y = x\n                while y in values:\n                    y += 1\n                best = max(best, y - x)\n        return best"
  },
  {
    "leetcodeNumber": 228,
    "title": "Summary Ranges",
    "idea": "扫描连续段，段长为 1 输出单点，否则输出 `start->end`。",
    "code": "from typing import List\n\n\nclass Solution:\n    def summaryRanges(self, nums: List[int]) -> List[str]:\n        ans = []\n        i = 0\n        while i < len(nums):\n            start = nums[i]\n            while i + 1 < len(nums) and nums[i + 1] == nums[i] + 1:\n                i += 1\n            end = nums[i]\n            ans.append(str(start) if start == end else f\"{start}->{end}\")\n            i += 1\n        return ans"
  },
  {
    "leetcodeNumber": 56,
    "title": "Merge Intervals",
    "idea": "按起点排序，当前区间能接上最后区间则合并，否则追加。",
    "code": "from typing import List\n\n\nclass Solution:\n    def merge(self, intervals: List[List[int]]) -> List[List[int]]:\n        intervals.sort()\n        ans = []\n        for start, end in intervals:\n            if not ans or start > ans[-1][1]:\n                ans.append([start, end])\n            else:\n                ans[-1][1] = max(ans[-1][1], end)\n        return ans"
  },
  {
    "leetcodeNumber": 57,
    "title": "Insert Interval",
    "idea": "先加入所有在新区间左侧的区间，再合并重叠区间，最后加入右侧区间。",
    "code": "from typing import List\n\n\nclass Solution:\n    def insert(self, intervals: List[List[int]], newInterval: List[int]) -> List[List[int]]:\n        ans = []\n        i = 0\n        n = len(intervals)\n        while i < n and intervals[i][1] < newInterval[0]:\n            ans.append(intervals[i])\n            i += 1\n        while i < n and intervals[i][0] <= newInterval[1]:\n            newInterval[0] = min(newInterval[0], intervals[i][0])\n            newInterval[1] = max(newInterval[1], intervals[i][1])\n            i += 1\n        ans.append(newInterval)\n        ans.extend(intervals[i:])\n        return ans"
  },
  {
    "leetcodeNumber": 452,
    "title": "Minimum Number of Arrows to Burst Balloons",
    "idea": "按右端点排序，一支箭射在当前最早结束位置，遇到不覆盖的气球才增加箭。",
    "code": "from typing import List\n\n\nclass Solution:\n    def findMinArrowShots(self, points: List[List[int]]) -> int:\n        points.sort(key=lambda p: p[1])\n        arrows = 0\n        end = None\n        for start, finish in points:\n            if end is None or start > end:\n                arrows += 1\n                end = finish\n        return arrows"
  },
  {
    "leetcodeNumber": 20,
    "title": "Valid Parentheses",
    "idea": "左括号入栈，右括号必须匹配栈顶。",
    "code": "class Solution:\n    def isValid(self, s: str) -> bool:\n        pairs = {\")\": \"(\", \"]\": \"[\", \"}\": \"{\"}\n        stack = []\n        for ch in s:\n            if ch in pairs:\n                if not stack or stack.pop() != pairs[ch]:\n                    return False\n            else:\n                stack.append(ch)\n        return not stack"
  },
  {
    "leetcodeNumber": 71,
    "title": "Simplify Path",
    "idea": "按 `/` 分割路径，忽略空和 `.`, 遇到 `..` 弹出上一级。",
    "code": "class Solution:\n    def simplifyPath(self, path: str) -> str:\n        stack = []\n        for part in path.split(\"/\"):\n            if part == \"\" or part == \".\":\n                continue\n            if part == \"..\":\n                if stack:\n                    stack.pop()\n            else:\n                stack.append(part)\n        return \"/\" + \"/\".join(stack)"
  },
  {
    "leetcodeNumber": 155,
    "title": "Min Stack",
    "idea": "主栈存值，辅助栈同步存当前位置的最小值。",
    "code": "class MinStack:\n    def __init__(self):\n        self.stack = []\n        self.min_stack = []\n\n    def push(self, val: int) -> None:\n        self.stack.append(val)\n        if self.min_stack:\n            self.min_stack.append(min(val, self.min_stack[-1]))\n        else:\n            self.min_stack.append(val)\n\n    def pop(self) -> None:\n        self.stack.pop()\n        self.min_stack.pop()\n\n    def top(self) -> int:\n        return self.stack[-1]\n\n    def getMin(self) -> int:\n        return self.min_stack[-1]"
  },
  {
    "leetcodeNumber": 150,
    "title": "Evaluate Reverse Polish Notation",
    "idea": "数字入栈，遇到运算符弹出两个数计算；除法要向零截断。",
    "code": "from typing import List\n\n\nclass Solution:\n    def evalRPN(self, tokens: List[str]) -> int:\n        stack = []\n        for token in tokens:\n            if token not in {\"+\", \"-\", \"*\", \"/\"}:\n                stack.append(int(token))\n                continue\n            b = stack.pop()\n            a = stack.pop()\n            if token == \"+\":\n                stack.append(a + b)\n            elif token == \"-\":\n                stack.append(a - b)\n            elif token == \"*\":\n                stack.append(a * b)\n            else:\n                sign = -1 if (a < 0) ^ (b < 0) else 1\n                stack.append(sign * (abs(a) // abs(b)))\n        return stack[-1]"
  },
  {
    "leetcodeNumber": 224,
    "title": "Basic Calculator",
    "idea": "维护当前符号和结果；遇到左括号把外层结果与符号入栈，右括号时合并。",
    "code": "class Solution:\n    def calculate(self, s: str) -> int:\n        ans = 0\n        num = 0\n        sign = 1\n        stack = []\n        for ch in s:\n            if ch.isdigit():\n                num = num * 10 + int(ch)\n            elif ch in \"+-\":\n                ans += sign * num\n                num = 0\n                sign = 1 if ch == \"+\" else -1\n            elif ch == \"(\":\n                stack.append(ans)\n                stack.append(sign)\n                ans = 0\n                sign = 1\n            elif ch == \")\":\n                ans += sign * num\n                num = 0\n                ans *= stack.pop()\n                ans += stack.pop()\n        return ans + sign * num"
  },
  {
    "leetcodeNumber": 141,
    "title": "Linked List Cycle",
    "idea": "快慢指针，若链表有环二者最终相遇。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def hasCycle(self, head: Optional[ListNode]) -> bool:\n        slow = fast = head\n        while fast and fast.next:\n            slow = slow.next\n            fast = fast.next.next\n            if slow is fast:\n                return True\n        return False"
  },
  {
    "leetcodeNumber": 2,
    "title": "Add Two Numbers",
    "idea": "逐位相加并维护进位，用虚拟头节点串起结果链表。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def addTwoNumbers(self, l1: Optional[ListNode], l2: Optional[ListNode]) -> Optional[ListNode]:\n        dummy = ListNode(0)\n        cur = dummy\n        carry = 0\n        while l1 or l2 or carry:\n            total = carry\n            if l1:\n                total += l1.val\n                l1 = l1.next\n            if l2:\n                total += l2.val\n                l2 = l2.next\n            carry, digit = divmod(total, 10)\n            cur.next = ListNode(digit)\n            cur = cur.next\n        return dummy.next"
  },
  {
    "leetcodeNumber": 21,
    "title": "Merge Two Sorted Lists",
    "idea": "双指针选择较小节点接到结果链表，最后接上剩余部分。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def mergeTwoLists(self, list1: Optional[ListNode], list2: Optional[ListNode]) -> Optional[ListNode]:\n        dummy = ListNode(0)\n        cur = dummy\n        while list1 and list2:\n            if list1.val <= list2.val:\n                cur.next = list1\n                list1 = list1.next\n            else:\n                cur.next = list2\n                list2 = list2.next\n            cur = cur.next\n        cur.next = list1 or list2\n        return dummy.next"
  },
  {
    "leetcodeNumber": 138,
    "title": "Copy List with Random Pointer",
    "idea": "哈希表把原节点映射到新节点，再第二轮补齐 `next` 和 `random`。",
    "code": "class Solution:\n    def copyRandomList(self, head: \"Optional[Node]\") -> \"Optional[Node]\":\n        old_to_new = {None: None}\n        cur = head\n        while cur:\n            old_to_new[cur] = Node(cur.val)\n            cur = cur.next\n        cur = head\n        while cur:\n            old_to_new[cur].next = old_to_new[cur.next]\n            old_to_new[cur].random = old_to_new[cur.random]\n            cur = cur.next\n        return old_to_new[head]"
  },
  {
    "leetcodeNumber": 92,
    "title": "Reverse Linked List II",
    "idea": "找到反转区间前一个节点，用头插法把区间内节点逐个移到区间头。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def reverseBetween(self, head: Optional[ListNode], left: int, right: int) -> Optional[ListNode]:\n        dummy = ListNode(0, head)\n        prev = dummy\n        for _ in range(left - 1):\n            prev = prev.next\n\n        cur = prev.next\n        for _ in range(right - left):\n            move = cur.next\n            cur.next = move.next\n            move.next = prev.next\n            prev.next = move\n        return dummy.next"
  },
  {
    "leetcodeNumber": 25,
    "title": "Reverse Nodes in k-Group",
    "idea": "每次检查是否有完整 `k` 个节点，有则原地反转这一组并接回链表。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def reverseKGroup(self, head: Optional[ListNode], k: int) -> Optional[ListNode]:\n        dummy = ListNode(0, head)\n        group_prev = dummy\n\n        while True:\n            kth = group_prev\n            for _ in range(k):\n                kth = kth.next\n                if not kth:\n                    return dummy.next\n\n            group_next = kth.next\n            prev, cur = group_next, group_prev.next\n            while cur is not group_next:\n                nxt = cur.next\n                cur.next = prev\n                prev = cur\n                cur = nxt\n\n            old_head = group_prev.next\n            group_prev.next = kth\n            group_prev = old_head"
  },
  {
    "leetcodeNumber": 19,
    "title": "Remove Nth Node From End of List",
    "idea": "快指针先走 `n` 步，然后快慢一起走，慢指针停在待删节点前。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def removeNthFromEnd(self, head: Optional[ListNode], n: int) -> Optional[ListNode]:\n        dummy = ListNode(0, head)\n        fast = slow = dummy\n        for _ in range(n):\n            fast = fast.next\n        while fast.next:\n            fast = fast.next\n            slow = slow.next\n        slow.next = slow.next.next\n        return dummy.next"
  },
  {
    "leetcodeNumber": 82,
    "title": "Remove Duplicates from Sorted List II",
    "idea": "虚拟头节点处理头部重复；遇到一段重复值时整段跳过。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def deleteDuplicates(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        dummy = ListNode(0, head)\n        prev = dummy\n        cur = head\n        while cur:\n            if cur.next and cur.val == cur.next.val:\n                val = cur.val\n                while cur and cur.val == val:\n                    cur = cur.next\n                prev.next = cur\n            else:\n                prev = cur\n                cur = cur.next\n        return dummy.next"
  },
  {
    "leetcodeNumber": 61,
    "title": "Rotate List",
    "idea": "先求链表长度并连成环，再在新尾节点处断开。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def rotateRight(self, head: Optional[ListNode], k: int) -> Optional[ListNode]:\n        if not head or not head.next or k == 0:\n            return head\n        n = 1\n        tail = head\n        while tail.next:\n            tail = tail.next\n            n += 1\n        k %= n\n        if k == 0:\n            return head\n        tail.next = head\n        steps_to_new_tail = n - k - 1\n        new_tail = head\n        for _ in range(steps_to_new_tail):\n            new_tail = new_tail.next\n        new_head = new_tail.next\n        new_tail.next = None\n        return new_head"
  },
  {
    "leetcodeNumber": 86,
    "title": "Partition List",
    "idea": "分别维护小于 `x` 和大于等于 `x` 的两条链，最后拼接。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def partition(self, head: Optional[ListNode], x: int) -> Optional[ListNode]:\n        small_dummy = ListNode(0)\n        large_dummy = ListNode(0)\n        small = small_dummy\n        large = large_dummy\n        while head:\n            if head.val < x:\n                small.next = head\n                small = small.next\n            else:\n                large.next = head\n                large = large.next\n            head = head.next\n        large.next = None\n        small.next = large_dummy.next\n        return small_dummy.next"
  },
  {
    "leetcodeNumber": 146,
    "title": "LRU Cache",
    "idea": "`OrderedDict` 保持访问顺序；访问或更新后移到末尾，超容量弹出最旧项。",
    "code": "from collections import OrderedDict\n\n\nclass LRUCache:\n    def __init__(self, capacity: int):\n        self.capacity = capacity\n        self.cache = OrderedDict()\n\n    def get(self, key: int) -> int:\n        if key not in self.cache:\n            return -1\n        self.cache.move_to_end(key)\n        return self.cache[key]\n\n    def put(self, key: int, value: int) -> None:\n        if key in self.cache:\n            self.cache.move_to_end(key)\n        self.cache[key] = value\n        if len(self.cache) > self.capacity:\n            self.cache.popitem(last=False)"
  },
  {
    "leetcodeNumber": 104,
    "title": "Maximum Depth of Binary Tree",
    "idea": "树高等于左右子树最大高度加一。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def maxDepth(self, root: Optional[TreeNode]) -> int:\n        if not root:\n            return 0\n        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))"
  },
  {
    "leetcodeNumber": 100,
    "title": "Same Tree",
    "idea": "两棵树当前节点值相同，且左右子树都相同。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def isSameTree(self, p: Optional[TreeNode], q: Optional[TreeNode]) -> bool:\n        if not p or not q:\n            return p is q\n        return p.val == q.val and self.isSameTree(p.left, q.left) and self.isSameTree(p.right, q.right)"
  },
  {
    "leetcodeNumber": 226,
    "title": "Invert Binary Tree",
    "idea": "递归交换每个节点的左右孩子。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def invertTree(self, root: Optional[TreeNode]) -> Optional[TreeNode]:\n        if not root:\n            return None\n        root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)\n        return root"
  },
  {
    "leetcodeNumber": 101,
    "title": "Symmetric Tree",
    "idea": "判断左子树和右子树是否互为镜像。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def isSymmetric(self, root: Optional[TreeNode]) -> bool:\n        if not root:\n            return True\n\n        def mirror(a, b) -> bool:\n            if not a or not b:\n                return a is b\n            return a.val == b.val and mirror(a.left, b.right) and mirror(a.right, b.left)\n\n        return mirror(root.left, root.right)"
  },
  {
    "leetcodeNumber": 105,
    "title": "Construct Binary Tree from Preorder and Inorder Traversal",
    "idea": "前序首元素是根；用哈希表快速定位根在中序中的位置并递归构造左右子树。",
    "code": "from typing import List, Optional\n\n\nclass Solution:\n    def buildTree(self, preorder: List[int], inorder: List[int]) -> Optional[TreeNode]:\n        pos = {v: i for i, v in enumerate(inorder)}\n        pre_i = 0\n\n        def build(left: int, right: int) -> Optional[TreeNode]:\n            nonlocal pre_i\n            if left > right:\n                return None\n            root_val = preorder[pre_i]\n            pre_i += 1\n            root = TreeNode(root_val)\n            mid = pos[root_val]\n            root.left = build(left, mid - 1)\n            root.right = build(mid + 1, right)\n            return root\n\n        return build(0, len(inorder) - 1)"
  },
  {
    "leetcodeNumber": 106,
    "title": "Construct Binary Tree from Inorder and Postorder Traversal",
    "idea": "后序末元素是根；从后往前取根，递归时先构造右子树再构造左子树。",
    "code": "from typing import List, Optional\n\n\nclass Solution:\n    def buildTree(self, inorder: List[int], postorder: List[int]) -> Optional[TreeNode]:\n        pos = {v: i for i, v in enumerate(inorder)}\n        post_i = len(postorder) - 1\n\n        def build(left: int, right: int) -> Optional[TreeNode]:\n            nonlocal post_i\n            if left > right:\n                return None\n            root_val = postorder[post_i]\n            post_i -= 1\n            root = TreeNode(root_val)\n            mid = pos[root_val]\n            root.right = build(mid + 1, right)\n            root.left = build(left, mid - 1)\n            return root\n\n        return build(0, len(inorder) - 1)"
  },
  {
    "leetcodeNumber": 117,
    "title": "Populating Next Right Pointers in Each Node II",
    "idea": "按层使用已建立的 `next` 指针遍历当前层，同时串起下一层。",
    "code": "class Solution:\n    def connect(self, root: \"Node\") -> \"Node\":\n        cur = root\n        while cur:\n            dummy = Node(0)\n            tail = dummy\n            while cur:\n                if cur.left:\n                    tail.next = cur.left\n                    tail = tail.next\n                if cur.right:\n                    tail.next = cur.right\n                    tail = tail.next\n                cur = cur.next\n            cur = dummy.next\n        return root"
  },
  {
    "leetcodeNumber": 114,
    "title": "Flatten Binary Tree to Linked List",
    "idea": "反向前序遍历，维护上一个处理过的节点作为当前节点的右孩子。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def flatten(self, root: Optional[TreeNode]) -> None:\n        prev = None\n\n        def dfs(node):\n            nonlocal prev\n            if not node:\n                return\n            dfs(node.right)\n            dfs(node.left)\n            node.right = prev\n            node.left = None\n            prev = node\n\n        dfs(root)"
  },
  {
    "leetcodeNumber": 112,
    "title": "Path Sum",
    "idea": "递归向下扣减目标值，到叶子时判断剩余值是否等于叶子值。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def hasPathSum(self, root: Optional[TreeNode], targetSum: int) -> bool:\n        if not root:\n            return False\n        if not root.left and not root.right:\n            return root.val == targetSum\n        return (\n            self.hasPathSum(root.left, targetSum - root.val)\n            or self.hasPathSum(root.right, targetSum - root.val)\n        )"
  },
  {
    "leetcodeNumber": 129,
    "title": "Sum Root to Leaf Numbers",
    "idea": "DFS 过程中把路径数字累积为 `cur * 10 + node.val`，到叶子计入答案。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def sumNumbers(self, root: Optional[TreeNode]) -> int:\n        def dfs(node, cur: int) -> int:\n            if not node:\n                return 0\n            cur = cur * 10 + node.val\n            if not node.left and not node.right:\n                return cur\n            return dfs(node.left, cur) + dfs(node.right, cur)\n\n        return dfs(root, 0)"
  },
  {
    "leetcodeNumber": 124,
    "title": "Binary Tree Maximum Path Sum",
    "idea": "每个节点向父节点贡献一条最大单边路径，同时用左右贡献加当前节点更新全局答案。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def maxPathSum(self, root: Optional[TreeNode]) -> int:\n        ans = -10**18\n\n        def gain(node) -> int:\n            nonlocal ans\n            if not node:\n                return 0\n            left = max(gain(node.left), 0)\n            right = max(gain(node.right), 0)\n            ans = max(ans, node.val + left + right)\n            return node.val + max(left, right)\n\n        gain(root)\n        return ans"
  },
  {
    "leetcodeNumber": 173,
    "title": "Binary Search Tree Iterator",
    "idea": "栈中维护当前路径上的左链，`next` 弹出最小节点后压入其右子树左链。",
    "code": "from typing import Optional\n\n\nclass BSTIterator:\n    def __init__(self, root: Optional[TreeNode]):\n        self.stack = []\n        self._push_left(root)\n\n    def _push_left(self, node) -> None:\n        while node:\n            self.stack.append(node)\n            node = node.left\n\n    def next(self) -> int:\n        node = self.stack.pop()\n        self._push_left(node.right)\n        return node.val\n\n    def hasNext(self) -> bool:\n        return bool(self.stack)"
  },
  {
    "leetcodeNumber": 222,
    "title": "Count Complete Tree Nodes",
    "idea": "完全二叉树若最左高度等于最右高度，则是满二叉树，可直接返回节点数；否则递归统计。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def countNodes(self, root: Optional[TreeNode]) -> int:\n        if not root:\n            return 0\n\n        def left_height(node) -> int:\n            h = 0\n            while node:\n                h += 1\n                node = node.left\n            return h\n\n        def right_height(node) -> int:\n            h = 0\n            while node:\n                h += 1\n                node = node.right\n            return h\n\n        lh = left_height(root)\n        rh = right_height(root)\n        if lh == rh:\n            return (1 << lh) - 1\n        return 1 + self.countNodes(root.left) + self.countNodes(root.right)"
  },
  {
    "leetcodeNumber": 236,
    "title": "Lowest Common Ancestor of a Binary Tree",
    "idea": "若当前节点是空、`p` 或 `q` 直接返回；左右子树都找到则当前节点是 LCA。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def lowestCommonAncestor(self, root: \"TreeNode\", p: \"TreeNode\", q: \"TreeNode\") -> \"TreeNode\":\n        if not root or root is p or root is q:\n            return root\n        left = self.lowestCommonAncestor(root.left, p, q)\n        right = self.lowestCommonAncestor(root.right, p, q)\n        if left and right:\n            return root\n        return left or right"
  },
  {
    "leetcodeNumber": 199,
    "title": "Binary Tree Right Side View",
    "idea": "层序遍历，每层最后一个节点就是右视图节点。",
    "code": "from collections import deque\nfrom typing import List, Optional\n\n\nclass Solution:\n    def rightSideView(self, root: Optional[TreeNode]) -> List[int]:\n        if not root:\n            return []\n        ans = []\n        q = deque([root])\n        while q:\n            for i in range(len(q)):\n                node = q.popleft()\n                if i == 0:\n                    ans.append(node.val)\n                if node.right:\n                    q.append(node.right)\n                if node.left:\n                    q.append(node.left)\n        return ans"
  },
  {
    "leetcodeNumber": 637,
    "title": "Average of Levels in Binary Tree",
    "idea": "层序遍历，统计每层节点值之和与节点数。",
    "code": "from collections import deque\nfrom typing import List, Optional\n\n\nclass Solution:\n    def averageOfLevels(self, root: Optional[TreeNode]) -> List[float]:\n        if not root:\n            return []\n        ans = []\n        q = deque([root])\n        while q:\n            total = 0\n            size = len(q)\n            for _ in range(size):\n                node = q.popleft()\n                total += node.val\n                if node.left:\n                    q.append(node.left)\n                if node.right:\n                    q.append(node.right)\n            ans.append(total / size)\n        return ans"
  },
  {
    "leetcodeNumber": 102,
    "title": "Binary Tree Level Order Traversal",
    "idea": "标准 BFS，每次处理一整层并收集该层值。",
    "code": "from collections import deque\nfrom typing import List, Optional\n\n\nclass Solution:\n    def levelOrder(self, root: Optional[TreeNode]) -> List[List[int]]:\n        if not root:\n            return []\n        ans = []\n        q = deque([root])\n        while q:\n            level = []\n            for _ in range(len(q)):\n                node = q.popleft()\n                level.append(node.val)\n                if node.left:\n                    q.append(node.left)\n                if node.right:\n                    q.append(node.right)\n            ans.append(level)\n        return ans"
  },
  {
    "leetcodeNumber": 103,
    "title": "Binary Tree Zigzag Level Order Traversal",
    "idea": "层序遍历后根据层号决定是否反转当前层。",
    "code": "from collections import deque\nfrom typing import List, Optional\n\n\nclass Solution:\n    def zigzagLevelOrder(self, root: Optional[TreeNode]) -> List[List[int]]:\n        if not root:\n            return []\n        ans = []\n        q = deque([root])\n        left_to_right = True\n        while q:\n            level = []\n            for _ in range(len(q)):\n                node = q.popleft()\n                level.append(node.val)\n                if node.left:\n                    q.append(node.left)\n                if node.right:\n                    q.append(node.right)\n            ans.append(level if left_to_right else level[::-1])\n            left_to_right = not left_to_right\n        return ans"
  },
  {
    "leetcodeNumber": 530,
    "title": "Minimum Absolute Difference in BST",
    "idea": "BST 中序遍历递增，相邻值差的最小值就是答案。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def getMinimumDifference(self, root: Optional[TreeNode]) -> int:\n        prev = None\n        ans = float(\"inf\")\n\n        def inorder(node):\n            nonlocal prev, ans\n            if not node:\n                return\n            inorder(node.left)\n            if prev is not None:\n                ans = min(ans, node.val - prev)\n            prev = node.val\n            inorder(node.right)\n\n        inorder(root)\n        return ans"
  },
  {
    "leetcodeNumber": 230,
    "title": "Kth Smallest Element in a BST",
    "idea": "BST 中序遍历是升序，第 `k` 个访问到的节点即答案。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def kthSmallest(self, root: Optional[TreeNode], k: int) -> int:\n        stack = []\n        cur = root\n        while True:\n            while cur:\n                stack.append(cur)\n                cur = cur.left\n            cur = stack.pop()\n            k -= 1\n            if k == 0:\n                return cur.val\n            cur = cur.right"
  },
  {
    "leetcodeNumber": 98,
    "title": "Validate Binary Search Tree",
    "idea": "递归传递当前节点允许的开区间 `(low, high)`。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def isValidBST(self, root: Optional[TreeNode]) -> bool:\n        def valid(node, low, high) -> bool:\n            if not node:\n                return True\n            if not (low < node.val < high):\n                return False\n            return valid(node.left, low, node.val) and valid(node.right, node.val, high)\n\n        return valid(root, float(\"-inf\"), float(\"inf\"))"
  },
  {
    "leetcodeNumber": 200,
    "title": "Number of Islands",
    "idea": "遇到陆地就 DFS/BFS 淹掉整个岛屿，岛屿数加一。",
    "code": "from typing import List\n\n\nclass Solution:\n    def numIslands(self, grid: List[List[str]]) -> int:\n        m, n = len(grid), len(grid[0])\n\n        def flood(sr: int, sc: int) -> None:\n            stack = [(sr, sc)]\n            grid[sr][sc] = \"0\"\n            while stack:\n                r, c = stack.pop()\n                for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):\n                    if 0 <= nr < m and 0 <= nc < n and grid[nr][nc] == \"1\":\n                        grid[nr][nc] = \"0\"\n                        stack.append((nr, nc))\n\n        ans = 0\n        for r in range(m):\n            for c in range(n):\n                if grid[r][c] == \"1\":\n                    ans += 1\n                    flood(r, c)\n        return ans"
  },
  {
    "leetcodeNumber": 130,
    "title": "Surrounded Regions",
    "idea": "从边界上的 `O` 出发标记所有不该被翻转的区域，最后翻转剩余 `O`。",
    "code": "from typing import List\n\n\nclass Solution:\n    def solve(self, board: List[List[str]]) -> None:\n        if not board or not board[0]:\n            return\n        m, n = len(board), len(board[0])\n\n        def mark(sr: int, sc: int) -> None:\n            if board[sr][sc] != \"O\":\n                return\n            stack = [(sr, sc)]\n            board[sr][sc] = \"S\"\n            while stack:\n                r, c = stack.pop()\n                for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):\n                    if 0 <= nr < m and 0 <= nc < n and board[nr][nc] == \"O\":\n                        board[nr][nc] = \"S\"\n                        stack.append((nr, nc))\n\n        for r in range(m):\n            mark(r, 0)\n            mark(r, n - 1)\n        for c in range(n):\n            mark(0, c)\n            mark(m - 1, c)\n\n        for r in range(m):\n            for c in range(n):\n                if board[r][c] == \"O\":\n                    board[r][c] = \"X\"\n                elif board[r][c] == \"S\":\n                    board[r][c] = \"O\""
  },
  {
    "leetcodeNumber": 133,
    "title": "Clone Graph",
    "idea": "DFS/BFS 克隆节点；哈希表记录原节点到克隆节点，避免重复克隆和死循环。",
    "code": "class Solution:\n    def cloneGraph(self, node: \"Node\") -> \"Node\":\n        if not node:\n            return None\n        cloned = {}\n\n        def dfs(cur):\n            if cur in cloned:\n                return cloned[cur]\n            copy = Node(cur.val)\n            cloned[cur] = copy\n            copy.neighbors = [dfs(nei) for nei in cur.neighbors]\n            return copy\n\n        return dfs(node)"
  },
  {
    "leetcodeNumber": 399,
    "title": "Evaluate Division",
    "idea": "把变量当图节点，等式 `a/b=v` 建双向带权边；查询时 DFS 找乘积路径。",
    "code": "from collections import defaultdict\nfrom typing import List\n\n\nclass Solution:\n    def calcEquation(\n        self,\n        equations: List[List[str]],\n        values: List[float],\n        queries: List[List[str]],\n    ) -> List[float]:\n        graph = defaultdict(list)\n        for (a, b), v in zip(equations, values):\n            graph[a].append((b, v))\n            graph[b].append((a, 1.0 / v))\n\n        def dfs(cur: str, target: str, seen: set) -> float:\n            if cur == target:\n                return 1.0\n            seen.add(cur)\n            for nxt, weight in graph[cur]:\n                if nxt in seen:\n                    continue\n                res = dfs(nxt, target, seen)\n                if res != -1.0:\n                    return weight * res\n            return -1.0\n\n        ans = []\n        for a, b in queries:\n            if a not in graph or b not in graph:\n                ans.append(-1.0)\n            else:\n                ans.append(dfs(a, b, set()))\n        return ans"
  },
  {
    "leetcodeNumber": 207,
    "title": "Course Schedule",
    "idea": "拓扑排序；入度为 0 的课程可先学，最终能学完所有课程则无环。",
    "code": "from collections import deque\nfrom typing import List\n\n\nclass Solution:\n    def canFinish(self, numCourses: int, prerequisites: List[List[int]]) -> bool:\n        graph = [[] for _ in range(numCourses)]\n        indeg = [0] * numCourses\n        for a, b in prerequisites:\n            graph[b].append(a)\n            indeg[a] += 1\n\n        q = deque(i for i in range(numCourses) if indeg[i] == 0)\n        taken = 0\n        while q:\n            cur = q.popleft()\n            taken += 1\n            for nxt in graph[cur]:\n                indeg[nxt] -= 1\n                if indeg[nxt] == 0:\n                    q.append(nxt)\n        return taken == numCourses"
  },
  {
    "leetcodeNumber": 210,
    "title": "Course Schedule II",
    "idea": "同样拓扑排序，弹出入度为 0 的节点时加入答案；若有环返回空列表。",
    "code": "from collections import deque\nfrom typing import List\n\n\nclass Solution:\n    def findOrder(self, numCourses: int, prerequisites: List[List[int]]) -> List[int]:\n        graph = [[] for _ in range(numCourses)]\n        indeg = [0] * numCourses\n        for a, b in prerequisites:\n            graph[b].append(a)\n            indeg[a] += 1\n\n        q = deque(i for i in range(numCourses) if indeg[i] == 0)\n        order = []\n        while q:\n            cur = q.popleft()\n            order.append(cur)\n            for nxt in graph[cur]:\n                indeg[nxt] -= 1\n                if indeg[nxt] == 0:\n                    q.append(nxt)\n        return order if len(order) == numCourses else []"
  },
  {
    "leetcodeNumber": 909,
    "title": "Snakes and Ladders",
    "idea": "把棋盘编号映射到坐标后做 BFS，每次最多掷出 1 到 6。",
    "code": "from collections import deque\nfrom typing import List\n\n\nclass Solution:\n    def snakesAndLadders(self, board: List[List[int]]) -> int:\n        n = len(board)\n\n        def pos(num: int) -> tuple[int, int]:\n            row_from_bottom, col = divmod(num - 1, n)\n            r = n - 1 - row_from_bottom\n            c = col if row_from_bottom % 2 == 0 else n - 1 - col\n            return r, c\n\n        target = n * n\n        q = deque([(1, 0)])\n        seen = {1}\n        while q:\n            cur, moves = q.popleft()\n            if cur == target:\n                return moves\n            for nxt in range(cur + 1, min(cur + 6, target) + 1):\n                r, c = pos(nxt)\n                dest = board[r][c] if board[r][c] != -1 else nxt\n                if dest not in seen:\n                    seen.add(dest)\n                    q.append((dest, moves + 1))\n        return -1"
  },
  {
    "leetcodeNumber": 433,
    "title": "Minimum Genetic Mutation",
    "idea": "BFS，每次尝试把当前基因某位替换为 `A/C/G/T`，只走基因库中的状态。",
    "code": "from collections import deque\nfrom typing import List\n\n\nclass Solution:\n    def minMutation(self, startGene: str, endGene: str, bank: List[str]) -> int:\n        bank_set = set(bank)\n        if endGene not in bank_set:\n            return -1\n        q = deque([(startGene, 0)])\n        seen = {startGene}\n        letters = \"ACGT\"\n        while q:\n            gene, steps = q.popleft()\n            if gene == endGene:\n                return steps\n            for i in range(len(gene)):\n                for ch in letters:\n                    nxt = gene[:i] + ch + gene[i + 1:]\n                    if nxt in bank_set and nxt not in seen:\n                        seen.add(nxt)\n                        q.append((nxt, steps + 1))\n        return -1"
  },
  {
    "leetcodeNumber": 127,
    "title": "Word Ladder",
    "idea": "预处理通配模式到单词列表的映射，BFS 每次走到只差一个字符的单词。",
    "code": "from collections import defaultdict, deque\nfrom typing import List\n\n\nclass Solution:\n    def ladderLength(self, beginWord: str, endWord: str, wordList: List[str]) -> int:\n        words = set(wordList)\n        if endWord not in words:\n            return 0\n        words.add(beginWord)\n        patterns = defaultdict(list)\n        L = len(beginWord)\n        for word in words:\n            for i in range(L):\n                patterns[word[:i] + \"*\" + word[i + 1:]].append(word)\n\n        q = deque([(beginWord, 1)])\n        seen = {beginWord}\n        while q:\n            word, dist = q.popleft()\n            if word == endWord:\n                return dist\n            for i in range(L):\n                pat = word[:i] + \"*\" + word[i + 1:]\n                for nxt in patterns[pat]:\n                    if nxt not in seen:\n                        seen.add(nxt)\n                        q.append((nxt, dist + 1))\n                patterns[pat] = []\n        return 0"
  },
  {
    "leetcodeNumber": 208,
    "title": "Implement Trie (Prefix Tree)",
    "idea": "每个节点用字典存子节点，并用布尔值标记是否为单词结尾。",
    "code": "class Trie:\n    def __init__(self):\n        self.children = {}\n        self.end = False\n\n    def insert(self, word: str) -> None:\n        node = self\n        for ch in word:\n            node = node.children.setdefault(ch, Trie())\n        node.end = True\n\n    def search(self, word: str) -> bool:\n        node = self._find(word)\n        return bool(node and node.end)\n\n    def startsWith(self, prefix: str) -> bool:\n        return self._find(prefix) is not None\n\n    def _find(self, s: str):\n        node = self\n        for ch in s:\n            if ch not in node.children:\n                return None\n            node = node.children[ch]\n        return node"
  },
  {
    "leetcodeNumber": 211,
    "title": "Design Add and Search Words Data Structure",
    "idea": "Trie 存单词；查询时普通字符沿边走，`.` 分支递归尝试所有子节点。",
    "code": "class WordDictionary:\n    def __init__(self):\n        self.root = {}\n\n    def addWord(self, word: str) -> None:\n        node = self.root\n        for ch in word:\n            node = node.setdefault(ch, {})\n        node[\"#\"] = True\n\n    def search(self, word: str) -> bool:\n        def dfs(i: int, node: dict) -> bool:\n            if i == len(word):\n                return \"#\" in node\n            ch = word[i]\n            if ch == \".\":\n                return any(key != \"#\" and dfs(i + 1, child) for key, child in node.items())\n            return ch in node and dfs(i + 1, node[ch])\n\n        return dfs(0, self.root)"
  },
  {
    "leetcodeNumber": 212,
    "title": "Word Search II",
    "idea": "把单词放入 Trie，然后从每个格子 DFS；找到单词后加入答案并剪枝空节点。",
    "code": "from typing import List\n\n\nclass Solution:\n    def findWords(self, board: List[List[str]], words: List[str]) -> List[str]:\n        trie = {}\n        for word in words:\n            node = trie\n            for ch in word:\n                node = node.setdefault(ch, {})\n            node[\"#\"] = word\n\n        m, n = len(board), len(board[0])\n        ans = []\n\n        def dfs(r: int, c: int, parent: dict) -> None:\n            ch = board[r][c]\n            node = parent[ch]\n            word = node.pop(\"#\", None)\n            if word:\n                ans.append(word)\n\n            board[r][c] = \"@\"\n            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n                nr, nc = r + dr, c + dc\n                if 0 <= nr < m and 0 <= nc < n and board[nr][nc] in node:\n                    dfs(nr, nc, node)\n            board[r][c] = ch\n\n            if not node:\n                parent.pop(ch)\n\n        for r in range(m):\n            for c in range(n):\n                if board[r][c] in trie:\n                    dfs(r, c, trie)\n        return ans"
  },
  {
    "leetcodeNumber": 17,
    "title": "Letter Combinations of a Phone Number",
    "idea": "按数字逐位回溯，每位选择对应字母。",
    "code": "from typing import List\n\n\nclass Solution:\n    def letterCombinations(self, digits: str) -> List[str]:\n        if not digits:\n            return []\n        mp = {\n            \"2\": \"abc\", \"3\": \"def\", \"4\": \"ghi\", \"5\": \"jkl\",\n            \"6\": \"mno\", \"7\": \"pqrs\", \"8\": \"tuv\", \"9\": \"wxyz\",\n        }\n        ans = []\n        path = []\n\n        def backtrack(i: int) -> None:\n            if i == len(digits):\n                ans.append(\"\".join(path))\n                return\n            for ch in mp[digits[i]]:\n                path.append(ch)\n                backtrack(i + 1)\n                path.pop()\n\n        backtrack(0)\n        return ans"
  },
  {
    "leetcodeNumber": 77,
    "title": "Combinations",
    "idea": "回溯选择数字，利用剩余数量剪枝。",
    "code": "from typing import List\n\n\nclass Solution:\n    def combine(self, n: int, k: int) -> List[List[int]]:\n        ans = []\n        path = []\n\n        def backtrack(start: int) -> None:\n            if len(path) == k:\n                ans.append(path[:])\n                return\n            need = k - len(path)\n            for x in range(start, n - need + 2):\n                path.append(x)\n                backtrack(x + 1)\n                path.pop()\n\n        backtrack(1)\n        return ans"
  },
  {
    "leetcodeNumber": 46,
    "title": "Permutations",
    "idea": "用 `used` 标记已放入路径的数字，路径长度到 `n` 时收集。",
    "code": "from typing import List\n\n\nclass Solution:\n    def permute(self, nums: List[int]) -> List[List[int]]:\n        ans = []\n        path = []\n        used = [False] * len(nums)\n\n        def backtrack() -> None:\n            if len(path) == len(nums):\n                ans.append(path[:])\n                return\n            for i, x in enumerate(nums):\n                if used[i]:\n                    continue\n                used[i] = True\n                path.append(x)\n                backtrack()\n                path.pop()\n                used[i] = False\n\n        backtrack()\n        return ans"
  },
  {
    "leetcodeNumber": 39,
    "title": "Combination Sum",
    "idea": "排序后回溯；每个数可重复使用，下一层仍从当前下标开始。",
    "code": "from typing import List\n\n\nclass Solution:\n    def combinationSum(self, candidates: List[int], target: int) -> List[List[int]]:\n        candidates.sort()\n        ans = []\n        path = []\n\n        def backtrack(start: int, remain: int) -> None:\n            if remain == 0:\n                ans.append(path[:])\n                return\n            for i in range(start, len(candidates)):\n                x = candidates[i]\n                if x > remain:\n                    break\n                path.append(x)\n                backtrack(i, remain - x)\n                path.pop()\n\n        backtrack(0, target)\n        return ans"
  },
  {
    "leetcodeNumber": 52,
    "title": "N-Queens II",
    "idea": "逐行放皇后，用列、主对角线、副对角线集合判断冲突。",
    "code": "class Solution:\n    def totalNQueens(self, n: int) -> int:\n        cols = set()\n        diag1 = set()\n        diag2 = set()\n        ans = 0\n\n        def backtrack(r: int) -> None:\n            nonlocal ans\n            if r == n:\n                ans += 1\n                return\n            for c in range(n):\n                if c in cols or r - c in diag1 or r + c in diag2:\n                    continue\n                cols.add(c)\n                diag1.add(r - c)\n                diag2.add(r + c)\n                backtrack(r + 1)\n                cols.remove(c)\n                diag1.remove(r - c)\n                diag2.remove(r + c)\n\n        backtrack(0)\n        return ans"
  },
  {
    "leetcodeNumber": 22,
    "title": "Generate Parentheses",
    "idea": "回溯维护已放左括号和右括号数量；右括号数不能超过左括号。",
    "code": "from typing import List\n\n\nclass Solution:\n    def generateParenthesis(self, n: int) -> List[str]:\n        ans = []\n        path = []\n\n        def backtrack(left: int, right: int) -> None:\n            if len(path) == 2 * n:\n                ans.append(\"\".join(path))\n                return\n            if left < n:\n                path.append(\"(\")\n                backtrack(left + 1, right)\n                path.pop()\n            if right < left:\n                path.append(\")\")\n                backtrack(left, right + 1)\n                path.pop()\n\n        backtrack(0, 0)\n        return ans"
  },
  {
    "leetcodeNumber": 79,
    "title": "Word Search",
    "idea": "从每个匹配首字符的格子出发 DFS，临时标记访问过的格子避免重复使用。",
    "code": "from typing import List\n\n\nclass Solution:\n    def exist(self, board: List[List[str]], word: str) -> bool:\n        m, n = len(board), len(board[0])\n\n        def dfs(r: int, c: int, i: int) -> bool:\n            if i == len(word):\n                return True\n            if r < 0 or r >= m or c < 0 or c >= n or board[r][c] != word[i]:\n                return False\n            ch = board[r][c]\n            board[r][c] = \"#\"\n            found = (\n                dfs(r + 1, c, i + 1)\n                or dfs(r - 1, c, i + 1)\n                or dfs(r, c + 1, i + 1)\n                or dfs(r, c - 1, i + 1)\n            )\n            board[r][c] = ch\n            return found\n\n        for r in range(m):\n            for c in range(n):\n                if dfs(r, c, 0):\n                    return True\n        return False"
  },
  {
    "leetcodeNumber": 108,
    "title": "Convert Sorted Array to Binary Search Tree",
    "idea": "每次取中点作为根，左右两边递归构造子树，天然高度平衡。",
    "code": "from typing import List, Optional\n\n\nclass Solution:\n    def sortedArrayToBST(self, nums: List[int]) -> Optional[TreeNode]:\n        def build(left: int, right: int) -> Optional[TreeNode]:\n            if left > right:\n                return None\n            mid = (left + right) // 2\n            root = TreeNode(nums[mid])\n            root.left = build(left, mid - 1)\n            root.right = build(mid + 1, right)\n            return root\n\n        return build(0, len(nums) - 1)"
  },
  {
    "leetcodeNumber": 148,
    "title": "Sort List",
    "idea": "链表归并排序；快慢指针找中点，递归排序后合并。",
    "code": "from typing import Optional\n\n\nclass Solution:\n    def sortList(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        if not head or not head.next:\n            return head\n\n        slow, fast = head, head.next\n        while fast and fast.next:\n            slow = slow.next\n            fast = fast.next.next\n        second = slow.next\n        slow.next = None\n\n        left = self.sortList(head)\n        right = self.sortList(second)\n        return self.merge(left, right)\n\n    def merge(self, a, b):\n        dummy = ListNode(0)\n        cur = dummy\n        while a and b:\n            if a.val <= b.val:\n                cur.next = a\n                a = a.next\n            else:\n                cur.next = b\n                b = b.next\n            cur = cur.next\n        cur.next = a or b\n        return dummy.next"
  },
  {
    "leetcodeNumber": 427,
    "title": "Construct Quad Tree",
    "idea": "若当前区域全相同则创建叶子；否则四等分递归构造四个子节点。",
    "code": "from typing import List\n\n\nclass Solution:\n    def construct(self, grid: List[List[int]]) -> \"Node\":\n        n = len(grid)\n\n        def build(r: int, c: int, size: int) -> \"Node\":\n            val = grid[r][c]\n            same = True\n            for i in range(r, r + size):\n                for j in range(c, c + size):\n                    if grid[i][j] != val:\n                        same = False\n                        break\n                if not same:\n                    break\n            if same:\n                return Node(bool(val), True)\n\n            half = size // 2\n            return Node(\n                True,\n                False,\n                build(r, c, half),\n                build(r, c + half, half),\n                build(r + half, c, half),\n                build(r + half, c + half, half),\n            )\n\n        return build(0, 0, n)"
  },
  {
    "leetcodeNumber": 23,
    "title": "Merge k Sorted Lists",
    "idea": "最小堆维护每条链表当前节点，弹出最小节点后压入它的后继。",
    "code": "import heapq\nfrom typing import List, Optional\n\n\nclass Solution:\n    def mergeKLists(self, lists: List[Optional[ListNode]]) -> Optional[ListNode]:\n        heap = []\n        for i, node in enumerate(lists):\n            if node:\n                heapq.heappush(heap, (node.val, i, node))\n\n        dummy = ListNode(0)\n        cur = dummy\n        while heap:\n            _, i, node = heapq.heappop(heap)\n            cur.next = node\n            cur = cur.next\n            if node.next:\n                heapq.heappush(heap, (node.next.val, i, node.next))\n        cur.next = None\n        return dummy.next"
  },
  {
    "leetcodeNumber": 53,
    "title": "Maximum Subarray",
    "idea": "当前最大子数组要么接上前一段，要么从当前数重新开始。",
    "code": "from typing import List\n\n\nclass Solution:\n    def maxSubArray(self, nums: List[int]) -> int:\n        cur = ans = nums[0]\n        for x in nums[1:]:\n            cur = max(x, cur + x)\n            ans = max(ans, cur)\n        return ans"
  },
  {
    "leetcodeNumber": 918,
    "title": "Maximum Sum Circular Subarray",
    "idea": "答案要么是普通最大子数组，要么是总和减去中间最小子数组；全负数时不能取空数组。",
    "code": "from typing import List\n\n\nclass Solution:\n    def maxSubarraySumCircular(self, nums: List[int]) -> int:\n        total = sum(nums)\n        max_cur = min_cur = 0\n        max_sum = nums[0]\n        min_sum = nums[0]\n        for x in nums:\n            max_cur = max(x, max_cur + x)\n            max_sum = max(max_sum, max_cur)\n            min_cur = min(x, min_cur + x)\n            min_sum = min(min_sum, min_cur)\n        if max_sum < 0:\n            return max_sum\n        return max(max_sum, total - min_sum)"
  },
  {
    "leetcodeNumber": 35,
    "title": "Search Insert Position",
    "idea": "二分寻找第一个大于等于 `target` 的位置。",
    "code": "from typing import List\n\n\nclass Solution:\n    def searchInsert(self, nums: List[int], target: int) -> int:\n        left, right = 0, len(nums)\n        while left < right:\n            mid = (left + right) // 2\n            if nums[mid] < target:\n                left = mid + 1\n            else:\n                right = mid\n        return left"
  },
  {
    "leetcodeNumber": 74,
    "title": "Search a 2D Matrix",
    "idea": "把矩阵视为长度 `m*n` 的有序数组，对虚拟下标二分。",
    "code": "from typing import List\n\n\nclass Solution:\n    def searchMatrix(self, matrix: List[List[int]], target: int) -> bool:\n        m, n = len(matrix), len(matrix[0])\n        left, right = 0, m * n - 1\n        while left <= right:\n            mid = (left + right) // 2\n            val = matrix[mid // n][mid % n]\n            if val == target:\n                return True\n            if val < target:\n                left = mid + 1\n            else:\n                right = mid - 1\n        return False"
  },
  {
    "leetcodeNumber": 162,
    "title": "Find Peak Element",
    "idea": "比较 `nums[mid]` 与右邻；若上坡，峰值在右侧，否则在左侧含 mid。",
    "code": "from typing import List\n\n\nclass Solution:\n    def findPeakElement(self, nums: List[int]) -> int:\n        left, right = 0, len(nums) - 1\n        while left < right:\n            mid = (left + right) // 2\n            if nums[mid] < nums[mid + 1]:\n                left = mid + 1\n            else:\n                right = mid\n        return left"
  },
  {
    "leetcodeNumber": 33,
    "title": "Search in Rotated Sorted Array",
    "idea": "每次二分至少有一侧有序，判断目标是否落在有序侧。",
    "code": "from typing import List\n\n\nclass Solution:\n    def search(self, nums: List[int], target: int) -> int:\n        left, right = 0, len(nums) - 1\n        while left <= right:\n            mid = (left + right) // 2\n            if nums[mid] == target:\n                return mid\n            if nums[left] <= nums[mid]:\n                if nums[left] <= target < nums[mid]:\n                    right = mid - 1\n                else:\n                    left = mid + 1\n            else:\n                if nums[mid] < target <= nums[right]:\n                    left = mid + 1\n                else:\n                    right = mid - 1\n        return -1"
  },
  {
    "leetcodeNumber": 34,
    "title": "Find First and Last Position of Element in Sorted Array",
    "idea": "两次二分分别找左边界和右边界。",
    "code": "from typing import List\n\n\nclass Solution:\n    def searchRange(self, nums: List[int], target: int) -> List[int]:\n        def lower_bound(x: int) -> int:\n            left, right = 0, len(nums)\n            while left < right:\n                mid = (left + right) // 2\n                if nums[mid] < x:\n                    left = mid + 1\n                else:\n                    right = mid\n            return left\n\n        left = lower_bound(target)\n        right = lower_bound(target + 1) - 1\n        if left <= right and right < len(nums) and nums[left] == target:\n            return [left, right]\n        return [-1, -1]"
  },
  {
    "leetcodeNumber": 153,
    "title": "Find Minimum in Rotated Sorted Array",
    "idea": "比较 `mid` 和右端，若 `mid` 更大最小值在右侧，否则在左侧含 mid。",
    "code": "from typing import List\n\n\nclass Solution:\n    def findMin(self, nums: List[int]) -> int:\n        left, right = 0, len(nums) - 1\n        while left < right:\n            mid = (left + right) // 2\n            if nums[mid] > nums[right]:\n                left = mid + 1\n            else:\n                right = mid\n        return nums[left]"
  },
  {
    "leetcodeNumber": 4,
    "title": "Median of Two Sorted Arrays",
    "idea": "在较短数组上二分切分位置，使左右两侧元素数量相等且左侧都不大于右侧。",
    "code": "from typing import List\n\n\nclass Solution:\n    def findMedianSortedArrays(self, nums1: List[int], nums2: List[int]) -> float:\n        if len(nums1) > len(nums2):\n            nums1, nums2 = nums2, nums1\n        m, n = len(nums1), len(nums2)\n        half = (m + n + 1) // 2\n        left, right = 0, m\n\n        while left <= right:\n            i = (left + right) // 2\n            j = half - i\n            a_left = float(\"-inf\") if i == 0 else nums1[i - 1]\n            a_right = float(\"inf\") if i == m else nums1[i]\n            b_left = float(\"-inf\") if j == 0 else nums2[j - 1]\n            b_right = float(\"inf\") if j == n else nums2[j]\n\n            if a_left <= b_right and b_left <= a_right:\n                if (m + n) % 2:\n                    return float(max(a_left, b_left))\n                return (max(a_left, b_left) + min(a_right, b_right)) / 2\n            if a_left > b_right:\n                right = i - 1\n            else:\n                left = i + 1\n        return 0.0"
  },
  {
    "leetcodeNumber": 215,
    "title": "Kth Largest Element in an Array",
    "idea": "维护大小为 `k` 的最小堆，堆顶就是第 `k` 大。",
    "code": "import heapq\nfrom typing import List\n\n\nclass Solution:\n    def findKthLargest(self, nums: List[int], k: int) -> int:\n        heap = []\n        for x in nums:\n            heapq.heappush(heap, x)\n            if len(heap) > k:\n                heapq.heappop(heap)\n        return heap[0]"
  },
  {
    "leetcodeNumber": 502,
    "title": "IPO",
    "idea": "按所需资本排序项目；每轮把当前资本能做的项目利润放入最大堆，选择利润最高者。",
    "code": "import heapq\nfrom typing import List\n\n\nclass Solution:\n    def findMaximizedCapital(self, k: int, w: int, profits: List[int], capital: List[int]) -> int:\n        projects = sorted(zip(capital, profits))\n        heap = []\n        i = 0\n        for _ in range(k):\n            while i < len(projects) and projects[i][0] <= w:\n                heapq.heappush(heap, -projects[i][1])\n                i += 1\n            if not heap:\n                break\n            w -= heapq.heappop(heap)\n        return w"
  },
  {
    "leetcodeNumber": 373,
    "title": "Find K Pairs with Smallest Sums",
    "idea": "先把每个 `nums1[i]` 与 `nums2[0]` 的组合入堆，弹出后推进同一行的下一个 `nums2`。",
    "code": "import heapq\nfrom typing import List\n\n\nclass Solution:\n    def kSmallestPairs(self, nums1: List[int], nums2: List[int], k: int) -> List[List[int]]:\n        if not nums1 or not nums2 or k == 0:\n            return []\n        heap = []\n        for i in range(min(k, len(nums1))):\n            heapq.heappush(heap, (nums1[i] + nums2[0], i, 0))\n        ans = []\n        while heap and len(ans) < k:\n            _, i, j = heapq.heappop(heap)\n            ans.append([nums1[i], nums2[j]])\n            if j + 1 < len(nums2):\n                heapq.heappush(heap, (nums1[i] + nums2[j + 1], i, j + 1))\n        return ans"
  },
  {
    "leetcodeNumber": 295,
    "title": "Find Median from Data Stream",
    "idea": "两个堆维护较小一半和较大一半；小顶堆存大半，大顶堆用负数模拟。",
    "code": "import heapq\n\n\nclass MedianFinder:\n    def __init__(self):\n        self.small = []\n        self.large = []\n\n    def addNum(self, num: int) -> None:\n        heapq.heappush(self.small, -num)\n        heapq.heappush(self.large, -heapq.heappop(self.small))\n        if len(self.large) > len(self.small):\n            heapq.heappush(self.small, -heapq.heappop(self.large))\n\n    def findMedian(self) -> float:\n        if len(self.small) > len(self.large):\n            return float(-self.small[0])\n        return (-self.small[0] + self.large[0]) / 2"
  },
  {
    "leetcodeNumber": 67,
    "title": "Add Binary",
    "idea": "从末尾开始逐位相加，维护进位。",
    "code": "class Solution:\n    def addBinary(self, a: str, b: str) -> str:\n        i, j = len(a) - 1, len(b) - 1\n        carry = 0\n        ans = []\n        while i >= 0 or j >= 0 or carry:\n            total = carry\n            if i >= 0:\n                total += int(a[i])\n                i -= 1\n            if j >= 0:\n                total += int(b[j])\n                j -= 1\n            ans.append(str(total % 2))\n            carry = total // 2\n        return \"\".join(reversed(ans))"
  },
  {
    "leetcodeNumber": 190,
    "title": "Reverse Bits",
    "idea": "循环 32 次，每次取 `n` 的最低位追加到结果右侧。",
    "code": "class Solution:\n    def reverseBits(self, n: int) -> int:\n        ans = 0\n        for _ in range(32):\n            ans = (ans << 1) | (n & 1)\n            n >>= 1\n        return ans"
  },
  {
    "leetcodeNumber": 191,
    "title": "Number of 1 Bits",
    "idea": "`n & (n-1)` 每次消掉最低位的 1。",
    "code": "class Solution:\n    def hammingWeight(self, n: int) -> int:\n        count = 0\n        while n:\n            n &= n - 1\n            count += 1\n        return count"
  },
  {
    "leetcodeNumber": 136,
    "title": "Single Number",
    "idea": "相同数字异或为 0，所有数异或后只剩出现一次的数。",
    "code": "from typing import List\n\n\nclass Solution:\n    def singleNumber(self, nums: List[int]) -> int:\n        ans = 0\n        for x in nums:\n            ans ^= x\n        return ans"
  },
  {
    "leetcodeNumber": 137,
    "title": "Single Number II",
    "idea": "用两个位掩码记录每一位出现次数模 3 的状态。",
    "code": "from typing import List\n\n\nclass Solution:\n    def singleNumber(self, nums: List[int]) -> int:\n        ones = twos = 0\n        for x in nums:\n            ones = (ones ^ x) & ~twos\n            twos = (twos ^ x) & ~ones\n        return ones"
  },
  {
    "leetcodeNumber": 201,
    "title": "Bitwise AND of Numbers Range",
    "idea": "区间按位与只保留左右端点的公共高位，不断右移直到相等。",
    "code": "class Solution:\n    def rangeBitwiseAnd(self, left: int, right: int) -> int:\n        shift = 0\n        while left < right:\n            left >>= 1\n            right >>= 1\n            shift += 1\n        return left << shift"
  },
  {
    "leetcodeNumber": 9,
    "title": "Palindrome Number",
    "idea": "负数不是回文；只反转后一半数字，与前一半比较。",
    "code": "class Solution:\n    def isPalindrome(self, x: int) -> bool:\n        if x < 0 or (x % 10 == 0 and x != 0):\n            return False\n        rev = 0\n        while x > rev:\n            rev = rev * 10 + x % 10\n            x //= 10\n        return x == rev or x == rev // 10"
  },
  {
    "leetcodeNumber": 66,
    "title": "Plus One",
    "idea": "从末尾处理进位；遇到非 9 加一返回，全是 9 则前面补 1。",
    "code": "from typing import List\n\n\nclass Solution:\n    def plusOne(self, digits: List[int]) -> List[int]:\n        for i in range(len(digits) - 1, -1, -1):\n            if digits[i] != 9:\n                digits[i] += 1\n                return digits\n            digits[i] = 0\n        return [1] + digits"
  },
  {
    "leetcodeNumber": 172,
    "title": "Factorial Trailing Zeroes",
    "idea": "尾随零来自因子 10，而 5 的数量少于 2；累计 `n//5 + n//25 + ...`。",
    "code": "class Solution:\n    def trailingZeroes(self, n: int) -> int:\n        ans = 0\n        while n:\n            n //= 5\n            ans += n\n        return ans"
  },
  {
    "leetcodeNumber": 69,
    "title": "Sqrt(x)",
    "idea": "二分寻找最大平方不超过 `x` 的整数。",
    "code": "class Solution:\n    def mySqrt(self, x: int) -> int:\n        left, right = 0, x\n        while left <= right:\n            mid = (left + right) // 2\n            sq = mid * mid\n            if sq == x:\n                return mid\n            if sq < x:\n                left = mid + 1\n            else:\n                right = mid - 1\n        return right"
  },
  {
    "leetcodeNumber": 50,
    "title": "Pow(x, n)",
    "idea": "快速幂；指数为负时先取倒数并转为正指数。",
    "code": "class Solution:\n    def myPow(self, x: float, n: int) -> float:\n        if n < 0:\n            x = 1 / x\n            n = -n\n        ans = 1.0\n        while n:\n            if n & 1:\n                ans *= x\n            x *= x\n            n >>= 1\n        return ans"
  },
  {
    "leetcodeNumber": 149,
    "title": "Max Points on a Line",
    "idea": "枚举每个点作为基准，统计其它点相对它的规范化斜率。",
    "code": "from collections import defaultdict\nfrom math import gcd\nfrom typing import List\n\n\nclass Solution:\n    def maxPoints(self, points: List[List[int]]) -> int:\n        n = len(points)\n        if n <= 2:\n            return n\n        ans = 0\n        for i in range(n):\n            slopes = defaultdict(int)\n            duplicates = 1\n            x1, y1 = points[i]\n            for j in range(i + 1, n):\n                x2, y2 = points[j]\n                dx = x2 - x1\n                dy = y2 - y1\n                if dx == 0 and dy == 0:\n                    duplicates += 1\n                    continue\n                if dx == 0:\n                    key = (1, 0)\n                elif dy == 0:\n                    key = (0, 1)\n                else:\n                    g = gcd(dx, dy)\n                    dx //= g\n                    dy //= g\n                    if dx < 0:\n                        dx = -dx\n                        dy = -dy\n                    key = (dy, dx)\n                slopes[key] += 1\n            ans = max(ans, duplicates + max(slopes.values(), default=0))\n        return ans"
  },
  {
    "leetcodeNumber": 70,
    "title": "Climbing Stairs",
    "idea": "到第 `i` 阶的方法数等于到 `i-1` 和 `i-2` 阶方法数之和。",
    "code": "class Solution:\n    def climbStairs(self, n: int) -> int:\n        a, b = 1, 1\n        for _ in range(n):\n            a, b = b, a + b\n        return a"
  },
  {
    "leetcodeNumber": 198,
    "title": "House Robber",
    "idea": "每间房只有偷或不偷；滚动维护偷到当前位置的最大收益。",
    "code": "from typing import List\n\n\nclass Solution:\n    def rob(self, nums: List[int]) -> int:\n        prev2 = prev1 = 0\n        for x in nums:\n            prev2, prev1 = prev1, max(prev1, prev2 + x)\n        return prev1"
  },
  {
    "leetcodeNumber": 139,
    "title": "Word Break",
    "idea": "`dp[i]` 表示前 `i` 个字符可拆分；枚举最后一个单词长度转移。",
    "code": "from typing import List\n\n\nclass Solution:\n    def wordBreak(self, s: str, wordDict: List[str]) -> bool:\n        words = set(wordDict)\n        max_len = max(map(len, words))\n        dp = [False] * (len(s) + 1)\n        dp[0] = True\n        for i in range(1, len(s) + 1):\n            for l in range(1, min(max_len, i) + 1):\n                if dp[i - l] and s[i - l:i] in words:\n                    dp[i] = True\n                    break\n        return dp[-1]"
  },
  {
    "leetcodeNumber": 322,
    "title": "Coin Change",
    "idea": "完全背包；`dp[x]` 表示凑出金额 `x` 的最少硬币数。",
    "code": "from typing import List\n\n\nclass Solution:\n    def coinChange(self, coins: List[int], amount: int) -> int:\n        inf = amount + 1\n        dp = [0] + [inf] * amount\n        for x in range(1, amount + 1):\n            for coin in coins:\n                if coin <= x:\n                    dp[x] = min(dp[x], dp[x - coin] + 1)\n        return -1 if dp[amount] == inf else dp[amount]"
  },
  {
    "leetcodeNumber": 300,
    "title": "Longest Increasing Subsequence",
    "idea": "维护每个长度递增子序列的最小结尾值，用二分替换。",
    "code": "from bisect import bisect_left\nfrom typing import List\n\n\nclass Solution:\n    def lengthOfLIS(self, nums: List[int]) -> int:\n        tails = []\n        for x in nums:\n            i = bisect_left(tails, x)\n            if i == len(tails):\n                tails.append(x)\n            else:\n                tails[i] = x\n        return len(tails)"
  },
  {
    "leetcodeNumber": 120,
    "title": "Triangle",
    "idea": "自底向上 DP，`dp[j]` 表示从当前行第 `j` 个位置走到底部的最小路径和。",
    "code": "from typing import List\n\n\nclass Solution:\n    def minimumTotal(self, triangle: List[List[int]]) -> int:\n        dp = triangle[-1][:]\n        for r in range(len(triangle) - 2, -1, -1):\n            for c in range(len(triangle[r])):\n                dp[c] = triangle[r][c] + min(dp[c], dp[c + 1])\n        return dp[0]"
  },
  {
    "leetcodeNumber": 64,
    "title": "Minimum Path Sum",
    "idea": "一维 DP；每格只能从上方或左方到达。",
    "code": "from typing import List\n\n\nclass Solution:\n    def minPathSum(self, grid: List[List[int]]) -> int:\n        m, n = len(grid), len(grid[0])\n        dp = [float(\"inf\")] * n\n        dp[0] = 0\n        for r in range(m):\n            for c in range(n):\n                if c == 0:\n                    dp[c] += grid[r][c]\n                else:\n                    dp[c] = min(dp[c], dp[c - 1]) + grid[r][c]\n        return dp[-1]"
  },
  {
    "leetcodeNumber": 63,
    "title": "Unique Paths II",
    "idea": "障碍格路径数为 0；其它格等于上方路径数加左方路径数。",
    "code": "from typing import List\n\n\nclass Solution:\n    def uniquePathsWithObstacles(self, obstacleGrid: List[List[int]]) -> int:\n        m, n = len(obstacleGrid), len(obstacleGrid[0])\n        dp = [0] * n\n        dp[0] = 1\n        for r in range(m):\n            for c in range(n):\n                if obstacleGrid[r][c] == 1:\n                    dp[c] = 0\n                elif c > 0:\n                    dp[c] += dp[c - 1]\n        return dp[-1]"
  },
  {
    "leetcodeNumber": 5,
    "title": "Longest Palindromic Substring",
    "idea": "枚举每个中心向两边扩展，分别处理奇数和偶数长度回文。",
    "code": "class Solution:\n    def longestPalindrome(self, s: str) -> str:\n        start = end = 0\n\n        def expand(left: int, right: int) -> None:\n            nonlocal start, end\n            while left >= 0 and right < len(s) and s[left] == s[right]:\n                left -= 1\n                right += 1\n            if right - left - 2 > end - start:\n                start, end = left + 1, right - 1\n\n        for i in range(len(s)):\n            expand(i, i)\n            expand(i, i + 1)\n        return s[start:end + 1]"
  },
  {
    "leetcodeNumber": 97,
    "title": "Interleaving String",
    "idea": "`dp[j]` 表示 `s1` 前 `i` 个和 `s2` 前 `j` 个能否组成 `s3` 前 `i+j` 个。",
    "code": "class Solution:\n    def isInterleave(self, s1: str, s2: str, s3: str) -> bool:\n        m, n = len(s1), len(s2)\n        if m + n != len(s3):\n            return False\n        dp = [False] * (n + 1)\n        dp[0] = True\n        for i in range(m + 1):\n            for j in range(n + 1):\n                if i == 0 and j == 0:\n                    continue\n                k = i + j - 1\n                take1 = i > 0 and dp[j] and s1[i - 1] == s3[k]\n                take2 = j > 0 and dp[j - 1] and s2[j - 1] == s3[k]\n                dp[j] = take1 or take2\n        return dp[n]"
  },
  {
    "leetcodeNumber": 72,
    "title": "Edit Distance",
    "idea": "`dp[j]` 表示当前处理到 `word1` 某前缀时，变成 `word2[:j]` 的最小编辑距离。",
    "code": "class Solution:\n    def minDistance(self, word1: str, word2: str) -> int:\n        m, n = len(word1), len(word2)\n        dp = list(range(n + 1))\n        for i in range(1, m + 1):\n            prev_diag = dp[0]\n            dp[0] = i\n            for j in range(1, n + 1):\n                old = dp[j]\n                if word1[i - 1] == word2[j - 1]:\n                    dp[j] = prev_diag\n                else:\n                    dp[j] = 1 + min(prev_diag, dp[j], dp[j - 1])\n                prev_diag = old\n        return dp[n]"
  },
  {
    "leetcodeNumber": 123,
    "title": "Best Time to Buy and Sell Stock III",
    "idea": "维护最多两次交易的四个状态：第一次买入、第一次卖出、第二次买入、第二次卖出。",
    "code": "from typing import List\n\n\nclass Solution:\n    def maxProfit(self, prices: List[int]) -> int:\n        buy1 = buy2 = float(\"-inf\")\n        sell1 = sell2 = 0\n        for p in prices:\n            buy1 = max(buy1, -p)\n            sell1 = max(sell1, buy1 + p)\n            buy2 = max(buy2, sell1 - p)\n            sell2 = max(sell2, buy2 + p)\n        return sell2"
  },
  {
    "leetcodeNumber": 188,
    "title": "Best Time to Buy and Sell Stock IV",
    "idea": "交易次数很大时等价于无限次交易；否则维护每次交易的买入和卖出最优状态。",
    "code": "from typing import List\n\n\nclass Solution:\n    def maxProfit(self, k: int, prices: List[int]) -> int:\n        if not prices or k == 0:\n            return 0\n        n = len(prices)\n        if k >= n // 2:\n            return sum(max(prices[i] - prices[i - 1], 0) for i in range(1, n))\n\n        buy = [float(\"-inf\")] * (k + 1)\n        sell = [0] * (k + 1)\n        for p in prices:\n            for t in range(1, k + 1):\n                buy[t] = max(buy[t], sell[t - 1] - p)\n                sell[t] = max(sell[t], buy[t] + p)\n        return sell[k]"
  },
  {
    "leetcodeNumber": 221,
    "title": "Maximal Square",
    "idea": "若当前位置为 `1`，最大正方形边长由上、左、左上三个位置的最小值加一决定。",
    "code": "from typing import List\n\n\nclass Solution:\n    def maximalSquare(self, matrix: List[List[str]]) -> int:\n        m, n = len(matrix), len(matrix[0])\n        dp = [0] * (n + 1)\n        best = 0\n        for r in range(1, m + 1):\n            prev_diag = 0\n            for c in range(1, n + 1):\n                old = dp[c]\n                if matrix[r - 1][c - 1] == \"1\":\n                    dp[c] = min(dp[c], dp[c - 1], prev_diag) + 1\n                    best = max(best, dp[c])\n                else:\n                    dp[c] = 0\n                prev_diag = old\n        return best * best"
  }
];

export function hot150ReferenceMarkdown() {
  return hot150ReferenceSolutions.map(({ leetcodeNumber, title, idea, code }) => [
    `### ${leetcodeNumber}. ${title}`,
    `思路：${idea}`,
    "```python",
    code,
    "```",
  ].join("\n")).join("\n\n");
}
