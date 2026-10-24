import { describe, expect, it } from "vitest";
import {
  codeEditorIndentation,
  codeEditorInteractionOptions,
  monacoLanguageFor,
} from "@/components/workbench/code-editor-config";

describe("code editor configuration", () => {
  it("uses Monaco language ids for the MVP languages", () => {
    expect(monacoLanguageFor("Python")).toBe("python");
    expect(monacoLanguageFor("C++")).toBe("cpp");
  });

  it("keeps Python-friendly four-space indentation stable", () => {
    expect(codeEditorIndentation).toEqual({
      detectIndentation: false,
      insertSpaces: true,
      tabSize: 4,
    });
  });

  it("enables editor-native indentation behavior", () => {
    expect(codeEditorInteractionOptions).toEqual({
      autoIndent: "full",
      formatOnType: true,
      useTabStops: true,
    });
  });
});
