import { z } from "zod";
import { apiReferenceEntrySchema } from "./chat-tool-contracts";

export const apiReferenceKbSchema = z.array(apiReferenceEntrySchema);

export type ApiReferenceEntry = z.infer<typeof apiReferenceEntrySchema>;

export const apiReferenceKb = apiReferenceKbSchema.parse([
  {
    language: "Python",
    topic: "deque",
    summary:
      "collections.deque is the usual Python queue for BFS and other O(1) front-pop workflows.",
    commonUses: [
      "Use append to push new states at the back of a BFS queue.",
      "Use popleft to consume the next state from the front in O(1).",
      "Use appendleft/pop only when you truly need both ends, such as 0-1 BFS or a deque-specific pattern.",
    ],
    examples: [
      "from collections import deque",
      "q = deque([start]); q.append(nxt); cur = q.popleft()",
      "while q:\n    cur = q.popleft()",
    ],
    pitfalls: [
      "list.pop(0) is O(n); use deque.popleft() for queue behavior.",
      "deque is not ordered by priority; use heapq when the smallest priority must come out first.",
    ],
  },
  {
    language: "Python",
    topic: "collections",
    summary:
      "Use collections for interview helpers such as Counter, defaultdict, and deque.",
    commonUses: [
      "Counter counts frequencies for anagram, window, and top-k style problems.",
      "defaultdict(list/int) reduces key-existence branching.",
      "deque supports O(1) queue operations from both ends.",
    ],
    examples: [
      "from collections import Counter; freq = Counter(s)",
      "from collections import defaultdict; groups = defaultdict(list)",
      "from collections import deque; q = deque([start]); q.popleft()",
    ],
    pitfalls: [
      "Counter missing keys read as 0, but normal dict missing keys raise KeyError.",
      "defaultdict creates a key when you read it; use dict.get when that side effect matters.",
    ],
  },
  {
    language: "Python",
    topic: "heapq",
    summary:
      "heapq is Python's min-heap module; push/pop are O(log n), peek is heap[0].",
    commonUses: [
      "Track top-k items with a bounded min-heap.",
      "Simulate a max-heap by pushing negative priorities.",
      "Merge sorted streams by keeping the next candidate from each stream.",
    ],
    examples: [
      "import heapq; heapq.heappush(heap, value)",
      "smallest = heapq.heappop(heap)",
      "heapq.heappush(heap, (-count, value))",
    ],
    pitfalls: [
      "heapq does not sort the whole list; only heap[0] is guaranteed smallest.",
      "When priorities tie, include a stable tiebreaker if values are not comparable.",
    ],
  },
  {
    language: "C++",
    topic: "vector",
    summary:
      "std::vector is the default dynamic array for indexed LeetCode inputs and outputs.",
    commonUses: [
      "Use push_back for append-heavy construction.",
      "Use size() for bounds and operator[] when you already know the index is valid.",
      "Sort with std::sort(v.begin(), v.end()).",
    ],
    examples: [
      "vector<int> ans; ans.push_back(i);",
      "sort(nums.begin(), nums.end());",
      "for (int x : nums) { /* ... */ }",
    ],
    pitfalls: [
      "size() returns size_t; be careful when mixing with signed int in reverse loops.",
      "operator[] has no bounds check; at() checks but is less common in interviews.",
    ],
  },
  {
    language: "C++",
    topic: "unordered_map",
    summary:
      "std::unordered_map is the usual hash table for value->index and frequency maps.",
    commonUses: [
      "Two Sum complement lookup.",
      "Frequency counting for strings or arrays.",
      "Last-seen index tracking for sliding window problems.",
    ],
    examples: [
      "unordered_map<int, int> seen;",
      "if (seen.count(need)) return {seen[need], i};",
      "seen[nums[i]] = i;",
    ],
    pitfalls: [
      "operator[] inserts a default value when the key is missing.",
      "Use count() or find() when you only want to test existence.",
    ],
  },
  {
    language: "C++",
    topic: "priority_queue",
    summary:
      "std::priority_queue is a max-heap by default; use greater<> for a min-heap.",
    commonUses: [
      "Keep largest or smallest candidates.",
      "Greedy scheduling and top-k variants.",
      "Dijkstra-style frontier ordering.",
    ],
    examples: [
      "priority_queue<int> maxHeap;",
      "priority_queue<int, vector<int>, greater<int>> minHeap;",
      "pq.push(x); int best = pq.top(); pq.pop();",
    ],
    pitfalls: [
      "The default is max-heap, opposite of Python heapq.",
      "For pairs, ordering is lexicographic unless you provide a comparator.",
    ],
  },
  {
    language: "C++",
    topic: "set",
    summary:
      "std::set stores unique ordered keys with O(log n) insert, erase, and lookup.",
    commonUses: [
      "Maintain a sorted active window.",
      "Need predecessor/successor queries with lower_bound.",
      "Deduplicate while preserving sorted order.",
    ],
    examples: [
      "set<int> s; s.insert(x);",
      "auto it = s.lower_bound(target);",
      "if (it != s.end()) { /* first >= target */ }",
    ],
    pitfalls: [
      "set is ordered and O(log n); unordered_set is usually faster for pure existence.",
      "Iterator invalidation rules differ from vector; erasing invalidates the erased iterator.",
    ],
  },
  {
    language: "C++",
    topic: "map",
    summary:
      "std::map is an ordered key-value tree; use it when key order matters.",
    commonUses: [
      "Ordered counts or intervals.",
      "Find first key >= target with lower_bound.",
      "Maintain sorted mapping when hash order is not enough.",
    ],
    examples: [
      "map<int, int> count;",
      "auto it = count.lower_bound(x);",
      "count[key] += 1;",
    ],
    pitfalls: [
      "operator[] inserts missing keys, just like unordered_map.",
      "If order is irrelevant, unordered_map is usually the simpler interview choice.",
    ],
  },
]);
