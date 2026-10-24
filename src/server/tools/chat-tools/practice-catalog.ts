import { z } from "zod";
import { hot150Problems } from "@/data/hot150";

export const practiceCatalogItemSchema = z.object({
  title: z.string(),
  slug: z.string(),
  leetcodeNumber: z.number().int().positive(),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  tags: z.array(z.string()),
  tier: z.enum(["hot150", "extended"]),
  order: z.number().int().positive().optional(),
  section: z.string().optional(),
});

export type PracticeCatalogItem = z.infer<typeof practiceCatalogItemSchema>;

const practiceCatalogSchema = z.object({
  hot150: z.array(practiceCatalogItemSchema),
  extended: z.array(practiceCatalogItemSchema),
});

const hot150Catalog = hot150Problems.map((problem) => ({
  title: problem.title,
  slug: problem.slug,
  leetcodeNumber: problem.leetcodeNumber,
  difficulty: problem.difficulty,
  tags: problem.tags,
  tier: "hot150" as const,
  order: problem.order,
  section: problem.section,
}));

export const practiceCatalog = practiceCatalogSchema.parse({
  hot150: hot150Catalog,
  extended: [
    {
      title: "Permutation in String",
      slug: "permutation-in-string",
      leetcodeNumber: 567,
      difficulty: "Medium",
      tags: ["sliding-window", "hashmap", "string"],
      tier: "extended",
    },
    {
      title: "Subarrays with K Different Integers",
      slug: "subarrays-with-k-different-integers",
      leetcodeNumber: 992,
      difficulty: "Hard",
      tags: ["sliding-window", "hashmap", "counting"],
      tier: "extended",
    },
    {
      title: "Koko Eating Bananas",
      slug: "koko-eating-bananas",
      leetcodeNumber: 875,
      difficulty: "Medium",
      tags: ["binary-search", "answer-search"],
      tier: "extended",
    },
    {
      title: "Find Minimum in Rotated Sorted Array",
      slug: "find-minimum-in-rotated-sorted-array",
      leetcodeNumber: 153,
      difficulty: "Medium",
      tags: ["binary-search", "array", "boundary"],
      tier: "extended",
    },
    {
      title: "Top K Frequent Elements",
      slug: "top-k-frequent-elements",
      leetcodeNumber: 347,
      difficulty: "Medium",
      tags: ["hashmap", "heap", "bucket-sort"],
      tier: "extended",
    },
    {
      title: "Number of Provinces",
      slug: "number-of-provinces",
      leetcodeNumber: 547,
      difficulty: "Medium",
      tags: ["union-find-advanced", "graph"],
      tier: "extended",
    },
  ],
});
