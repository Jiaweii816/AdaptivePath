import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoachMarkdown } from "@/components/coach/coach-markdown";

describe("CoachMarkdown", () => {
  it("renders Chinese bold Markdown while retaining inline-code presentation", () => {
    const html = renderToStaticMarkup(
      <CoachMarkdown
        markdown={
          "核心是**用状态判断能否继续，而不是盲目枚举**。用 `open < n` 判断是否还能加左括号。"
        }
      />,
    );

    expect(html).toContain(
      '<strong class="font-semibold text-foreground">用状态判断能否继续，而不是盲目枚举</strong>',
    );
    expect(html).toContain("<code");
    expect(html).not.toContain("**用状态判断能否继续，而不是盲目枚举**");
  });

  it("renders HTML line break tokens inside Markdown tables as real line breaks", () => {
    const html = renderToStaticMarkup(
      <CoachMarkdown
        markdown={[
          "| step | variables |",
          "| --- | --- |",
          "| 1 | L1 = nums1[0]<br>R1 = nums1[1] |",
        ].join("\n")}
      />,
    );

    expect(html).toContain("L1 = nums1[0]<br");
    expect(html).toContain("R1 = nums1[1]");
    expect(html).not.toContain("&lt;br&gt;");
  });
});
