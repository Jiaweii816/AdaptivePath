import { describe, expect, it } from "vitest";
import {
  fingerprintCodeForExecution,
  hashCodeForRun,
} from "@/server/code/code-hash";

describe("fingerprintCodeForExecution", () => {
  it("keeps the raw audit hash exact while ignoring Python comment-only edits", () => {
    const before = [
      "class Solution:",
      "    def threeSum(self, nums):",
      "        nums.sort()",
      "        # skip duplicate pointers",
      "        return nums  # old explanation",
    ].join("\n");
    const after = [
      "class Solution:",
      "    def threeSum(self, nums):",
      "        nums.sort()",
      "        # skip the next duplicate left and right pointers",
      "        return nums  # clearer explanation",
    ].join("\n");

    expect(hashCodeForRun({ language: "Python", code: before })).not.toBe(
      hashCodeForRun({ language: "Python", code: after }),
    );
    expect(
      fingerprintCodeForExecution({ language: "Python", code: before }),
    ).toBe(fingerprintCodeForExecution({ language: "Python", code: after }));
  });

  it("ignores added or removed Python comment-only lines and line-ending trivia", () => {
    const compact = "def solve(x):\n    return x + 1\n";
    const commented =
      "# module note\r\ndef solve(x):\r\n    # implementation note\r\n    return x + 1  # result\r\n\r\n";

    expect(
      fingerprintCodeForExecution({ language: "Python", code: compact }),
    ).toBe(
      fingerprintCodeForExecution({ language: "Python", code: commented }),
    );
  });

  it("preserves Python strings, docstrings, and indentation as executable source", () => {
    const base = 'def solve():\n    text = "# not a comment"\n    return text';
    const changedString =
      'def solve():\n    text = "# changed string"\n    return text';
    const changedIndent =
      'def solve():\n    text = "# not a comment"\nreturn text';
    const docstringA = 'def solve():\n    """# first doc"""\n    return 1';
    const docstringB = 'def solve():\n    """# second doc"""\n    return 1';

    expect(fingerprint("Python", base)).not.toBe(
      fingerprint("Python", changedString),
    );
    expect(fingerprint("Python", base)).not.toBe(
      fingerprint("Python", changedIndent),
    );
    expect(fingerprint("Python", docstringA)).not.toBe(
      fingerprint("Python", docstringB),
    );
  });

  it("ignores C++ line and block comment edits without stripping literals", () => {
    const before = [
      "class Solution {",
      "public:",
      "  int solve(int x) {",
      "    /* old block note */",
      "    std::string url = \"https://example.com/#anchor\";",
      "    auto raw = R\"tag(/* literal */ // literal)tag\";",
      "    return x + 1; // old line note",
      "  }",
      "};",
    ].join("\n");
    const after = before
      .replace("old block note", "new block note")
      .replace("old line note", "new line note");
    const changedLiteral = after.replace("#anchor", "#different");

    expect(fingerprint("C++", before)).toBe(fingerprint("C++", after));
    expect(fingerprint("C++", after)).not.toBe(
      fingerprint("C++", changedLiteral),
    );
  });

  it("changes when executable tokens or the language change", () => {
    const code = "return value + 1";

    expect(fingerprint("Python", code)).not.toBe(
      fingerprint("Python", "return value + 2"),
    );
    expect(fingerprint("Python", code)).not.toBe(fingerprint("C++", code));
  });
});

function fingerprint(language: "Python" | "C++", code: string) {
  return fingerprintCodeForExecution({ language, code });
}
