import { z } from "zod";

const hot150DifficultySchema = z.enum(["Easy", "Medium", "Hard"]);

export const hot150ProblemSchema = z.object({
  order: z.number().int().positive(),
  leetcodeNumber: z.number().int().positive(),
  slug: z.string().min(1),
  title: z.string().min(1),
  difficulty: hot150DifficultySchema,
  section: z.string().min(1),
  tags: z.array(z.string().min(1)),
});

export type Hot150Problem = z.infer<typeof hot150ProblemSchema>;

const hot150Raw = `
1	88	merge-sorted-array	Easy	Array / String	Merge Sorted Array
2	27	remove-element	Easy	Array / String	Remove Element
3	26	remove-duplicates-from-sorted-array	Easy	Array / String	Remove Duplicates from Sorted Array
4	80	remove-duplicates-from-sorted-array-ii	Medium	Array / String	Remove Duplicates from Sorted Array II
5	169	majority-element	Easy	Array / String	Majority Element
6	189	rotate-array	Medium	Array / String	Rotate Array
7	121	best-time-to-buy-and-sell-stock	Easy	Array / String	Best Time to Buy and Sell Stock
8	122	best-time-to-buy-and-sell-stock-ii	Medium	Array / String	Best Time to Buy and Sell Stock II
9	55	jump-game	Medium	Array / String	Jump Game
10	45	jump-game-ii	Medium	Array / String	Jump Game II
11	274	h-index	Medium	Array / String	H-Index
12	380	insert-delete-getrandom-o1	Medium	Array / String	Insert Delete GetRandom O(1)
13	238	product-of-array-except-self	Medium	Array / String	Product of Array Except Self
14	134	gas-station	Medium	Array / String	Gas Station
15	135	candy	Hard	Array / String	Candy
16	42	trapping-rain-water	Hard	Array / String	Trapping Rain Water
17	13	roman-to-integer	Easy	Array / String	Roman to Integer
18	12	integer-to-roman	Medium	Array / String	Integer to Roman
19	58	length-of-last-word	Easy	Array / String	Length of Last Word
20	14	longest-common-prefix	Easy	Array / String	Longest Common Prefix
21	151	reverse-words-in-a-string	Medium	Array / String	Reverse Words in a String
22	6	zigzag-conversion	Medium	Array / String	Zigzag Conversion
23	28	find-the-index-of-the-first-occurrence-in-a-string	Easy	Array / String	Find the Index of the First Occurrence in a String
24	68	text-justification	Hard	Array / String	Text Justification
25	125	valid-palindrome	Easy	Two Pointers	Valid Palindrome
26	392	is-subsequence	Easy	Two Pointers	Is Subsequence
27	167	two-sum-ii-input-array-is-sorted	Medium	Two Pointers	Two Sum II - Input Array Is Sorted
28	11	container-with-most-water	Medium	Two Pointers	Container With Most Water
29	15	3sum	Medium	Two Pointers	3Sum
30	209	minimum-size-subarray-sum	Medium	Sliding Window	Minimum Size Subarray Sum
31	3	longest-substring-without-repeating-characters	Medium	Sliding Window	Longest Substring Without Repeating Characters
32	30	substring-with-concatenation-of-all-words	Hard	Sliding Window	Substring with Concatenation of All Words
33	76	minimum-window-substring	Hard	Sliding Window	Minimum Window Substring
34	36	valid-sudoku	Medium	Matrix	Valid Sudoku
35	54	spiral-matrix	Medium	Matrix	Spiral Matrix
36	48	rotate-image	Medium	Matrix	Rotate Image
37	73	set-matrix-zeroes	Medium	Matrix	Set Matrix Zeroes
38	289	game-of-life	Medium	Matrix	Game of Life
39	383	ransom-note	Easy	Hashmap	Ransom Note
40	205	isomorphic-strings	Easy	Hashmap	Isomorphic Strings
41	290	word-pattern	Easy	Hashmap	Word Pattern
42	242	valid-anagram	Easy	Hashmap	Valid Anagram
43	49	group-anagrams	Medium	Hashmap	Group Anagrams
44	1	two-sum	Easy	Hashmap	Two Sum
45	202	happy-number	Easy	Hashmap	Happy Number
46	219	contains-duplicate-ii	Easy	Hashmap	Contains Duplicate II
47	128	longest-consecutive-sequence	Medium	Hashmap	Longest Consecutive Sequence
48	228	summary-ranges	Easy	Intervals	Summary Ranges
49	56	merge-intervals	Medium	Intervals	Merge Intervals
50	57	insert-interval	Medium	Intervals	Insert Interval
51	452	minimum-number-of-arrows-to-burst-balloons	Medium	Intervals	Minimum Number of Arrows to Burst Balloons
52	20	valid-parentheses	Easy	Stack	Valid Parentheses
53	71	simplify-path	Medium	Stack	Simplify Path
54	155	min-stack	Medium	Stack	Min Stack
55	150	evaluate-reverse-polish-notation	Medium	Stack	Evaluate Reverse Polish Notation
56	224	basic-calculator	Hard	Stack	Basic Calculator
57	141	linked-list-cycle	Easy	Linked List	Linked List Cycle
58	2	add-two-numbers	Medium	Linked List	Add Two Numbers
59	21	merge-two-sorted-lists	Easy	Linked List	Merge Two Sorted Lists
60	138	copy-list-with-random-pointer	Medium	Linked List	Copy List with Random Pointer
61	92	reverse-linked-list-ii	Medium	Linked List	Reverse Linked List II
62	25	reverse-nodes-in-k-group	Hard	Linked List	Reverse Nodes in k-Group
63	19	remove-nth-node-from-end-of-list	Medium	Linked List	Remove Nth Node From End of List
64	82	remove-duplicates-from-sorted-list-ii	Medium	Linked List	Remove Duplicates from Sorted List II
65	61	rotate-list	Medium	Linked List	Rotate List
66	86	partition-list	Medium	Linked List	Partition List
67	146	lru-cache	Medium	Linked List	LRU Cache
68	104	maximum-depth-of-binary-tree	Easy	Binary Tree General	Maximum Depth of Binary Tree
69	100	same-tree	Easy	Binary Tree General	Same Tree
70	226	invert-binary-tree	Easy	Binary Tree General	Invert Binary Tree
71	101	symmetric-tree	Easy	Binary Tree General	Symmetric Tree
72	105	construct-binary-tree-from-preorder-and-inorder-traversal	Medium	Binary Tree General	Construct Binary Tree from Preorder and Inorder Traversal
73	106	construct-binary-tree-from-inorder-and-postorder-traversal	Medium	Binary Tree General	Construct Binary Tree from Inorder and Postorder Traversal
74	117	populating-next-right-pointers-in-each-node-ii	Medium	Binary Tree General	Populating Next Right Pointers in Each Node II
75	114	flatten-binary-tree-to-linked-list	Medium	Binary Tree General	Flatten Binary Tree to Linked List
76	112	path-sum	Easy	Binary Tree General	Path Sum
77	129	sum-root-to-leaf-numbers	Medium	Binary Tree General	Sum Root to Leaf Numbers
78	124	binary-tree-maximum-path-sum	Hard	Binary Tree General	Binary Tree Maximum Path Sum
79	173	binary-search-tree-iterator	Medium	Binary Tree General	Binary Search Tree Iterator
80	222	count-complete-tree-nodes	Easy	Binary Tree General	Count Complete Tree Nodes
81	236	lowest-common-ancestor-of-a-binary-tree	Medium	Binary Tree General	Lowest Common Ancestor of a Binary Tree
82	199	binary-tree-right-side-view	Medium	Binary Tree BFS	Binary Tree Right Side View
83	637	average-of-levels-in-binary-tree	Easy	Binary Tree BFS	Average of Levels in Binary Tree
84	102	binary-tree-level-order-traversal	Medium	Binary Tree BFS	Binary Tree Level Order Traversal
85	103	binary-tree-zigzag-level-order-traversal	Medium	Binary Tree BFS	Binary Tree Zigzag Level Order Traversal
86	530	minimum-absolute-difference-in-bst	Easy	Binary Search Tree	Minimum Absolute Difference in BST
87	230	kth-smallest-element-in-a-bst	Medium	Binary Search Tree	Kth Smallest Element in a BST
88	98	validate-binary-search-tree	Medium	Binary Search Tree	Validate Binary Search Tree
89	200	number-of-islands	Medium	Graph General	Number of Islands
90	130	surrounded-regions	Medium	Graph General	Surrounded Regions
91	133	clone-graph	Medium	Graph General	Clone Graph
92	399	evaluate-division	Medium	Graph General	Evaluate Division
93	207	course-schedule	Medium	Graph General	Course Schedule
94	210	course-schedule-ii	Medium	Graph General	Course Schedule II
95	909	snakes-and-ladders	Medium	Graph BFS	Snakes and Ladders
96	433	minimum-genetic-mutation	Medium	Graph BFS	Minimum Genetic Mutation
97	127	word-ladder	Hard	Graph BFS	Word Ladder
98	208	implement-trie-prefix-tree	Medium	Trie	Implement Trie (Prefix Tree)
99	211	design-add-and-search-words-data-structure	Medium	Trie	Design Add and Search Words Data Structure
100	212	word-search-ii	Hard	Trie	Word Search II
101	17	letter-combinations-of-a-phone-number	Medium	Backtracking	Letter Combinations of a Phone Number
102	77	combinations	Medium	Backtracking	Combinations
103	46	permutations	Medium	Backtracking	Permutations
104	39	combination-sum	Medium	Backtracking	Combination Sum
105	52	n-queens-ii	Hard	Backtracking	N-Queens II
106	22	generate-parentheses	Medium	Backtracking	Generate Parentheses
107	79	word-search	Medium	Backtracking	Word Search
108	108	convert-sorted-array-to-binary-search-tree	Easy	Divide & Conquer	Convert Sorted Array to Binary Search Tree
109	148	sort-list	Medium	Divide & Conquer	Sort List
110	427	construct-quad-tree	Medium	Divide & Conquer	Construct Quad Tree
111	23	merge-k-sorted-lists	Hard	Divide & Conquer	Merge k Sorted Lists
112	53	maximum-subarray	Medium	Kadane's Algorithm	Maximum Subarray
113	918	maximum-sum-circular-subarray	Medium	Kadane's Algorithm	Maximum Sum Circular Subarray
114	35	search-insert-position	Easy	Binary Search	Search Insert Position
115	74	search-a-2d-matrix	Medium	Binary Search	Search a 2D Matrix
116	162	find-peak-element	Medium	Binary Search	Find Peak Element
117	33	search-in-rotated-sorted-array	Medium	Binary Search	Search in Rotated Sorted Array
118	34	find-first-and-last-position-of-element-in-sorted-array	Medium	Binary Search	Find First and Last Position of Element in Sorted Array
119	153	find-minimum-in-rotated-sorted-array	Medium	Binary Search	Find Minimum in Rotated Sorted Array
120	4	median-of-two-sorted-arrays	Hard	Binary Search	Median of Two Sorted Arrays
121	215	kth-largest-element-in-an-array	Medium	Heap	Kth Largest Element in an Array
122	502	ipo	Hard	Heap	IPO
123	373	find-k-pairs-with-smallest-sums	Medium	Heap	Find K Pairs with Smallest Sums
124	295	find-median-from-data-stream	Hard	Heap	Find Median from Data Stream
125	67	add-binary	Easy	Bit Manipulation	Add Binary
126	190	reverse-bits	Easy	Bit Manipulation	Reverse Bits
127	191	number-of-1-bits	Easy	Bit Manipulation	Number of 1 Bits
128	136	single-number	Easy	Bit Manipulation	Single Number
129	137	single-number-ii	Medium	Bit Manipulation	Single Number II
130	201	bitwise-and-of-numbers-range	Medium	Bit Manipulation	Bitwise AND of Numbers Range
131	9	palindrome-number	Easy	Math	Palindrome Number
132	66	plus-one	Easy	Math	Plus One
133	172	factorial-trailing-zeroes	Medium	Math	Factorial Trailing Zeroes
134	69	sqrtx	Easy	Math	Sqrt(x)
135	50	powx-n	Medium	Math	Pow(x, n)
136	149	max-points-on-a-line	Hard	Math	Max Points on a Line
137	70	climbing-stairs	Easy	1D DP	Climbing Stairs
138	198	house-robber	Medium	1D DP	House Robber
139	139	word-break	Medium	1D DP	Word Break
140	322	coin-change	Medium	1D DP	Coin Change
141	300	longest-increasing-subsequence	Medium	1D DP	Longest Increasing Subsequence
142	120	triangle	Medium	Multidimensional DP	Triangle
143	64	minimum-path-sum	Medium	Multidimensional DP	Minimum Path Sum
144	63	unique-paths-ii	Medium	Multidimensional DP	Unique Paths II
145	5	longest-palindromic-substring	Medium	Multidimensional DP	Longest Palindromic Substring
146	97	interleaving-string	Medium	Multidimensional DP	Interleaving String
147	72	edit-distance	Medium	Multidimensional DP	Edit Distance
148	123	best-time-to-buy-and-sell-stock-iii	Hard	Multidimensional DP	Best Time to Buy and Sell Stock III
149	188	best-time-to-buy-and-sell-stock-iv	Hard	Multidimensional DP	Best Time to Buy and Sell Stock IV
150	221	maximal-square	Medium	Multidimensional DP	Maximal Square
`.trim();

export const hot150Problems = z.array(hot150ProblemSchema).length(150).parse(
  hot150Raw.split("\n").map((line) => {
    const [order, leetcodeNumber, slug, difficulty, section, title] =
      line.split("\t");

    return {
      order: Number(order),
      leetcodeNumber: Number(leetcodeNumber),
      slug,
      title,
      difficulty,
      section,
      tags: sectionTags(section),
    };
  }),
);

export const hot150BySlug = new Map(
  hot150Problems.map((problem) => [problem.slug, problem]),
);

export function getHot150Problem(slug: string) {
  return hot150BySlug.get(slug);
}

function sectionTags(section: string) {
  const tagsBySection: Record<string, string[]> = {
    "Array / String": ["array", "string"],
    "Two Pointers": ["two-pointers"],
    "Sliding Window": ["sliding-window"],
    Matrix: ["matrix"],
    Hashmap: ["hashmap", "hash-table"],
    Intervals: ["intervals"],
    Stack: ["stack"],
    "Linked List": ["linked-list"],
    "Binary Tree General": ["binary-tree", "tree", "dfs"],
    "Binary Tree BFS": ["binary-tree", "tree", "bfs"],
    "Binary Search Tree": ["binary-search-tree", "bst", "tree"],
    "Graph General": ["graph", "dfs", "bfs"],
    "Graph BFS": ["graph", "bfs"],
    Trie: ["trie"],
    Backtracking: ["backtracking"],
    "Divide & Conquer": ["divide-and-conquer"],
    "Kadane's Algorithm": ["kadane", "array", "dynamic-programming"],
    "Binary Search": ["binary-search"],
    Heap: ["heap", "priority-queue"],
    "Bit Manipulation": ["bit-manipulation"],
    Math: ["math"],
    "1D DP": ["dynamic-programming", "1d-dp"],
    "Multidimensional DP": ["dynamic-programming", "multidimensional-dp"],
  };

  return unique([
    ...(tagsBySection[section] ?? [slugify(section)]),
    "top-interview-150",
    "interview-150",
    "hot150",
  ]);
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
