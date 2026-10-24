export const codeEditorThemeName = "patterncoach-code-dark";

export const codeEditorIndentation = {
  detectIndentation: false,
  insertSpaces: true,
  tabSize: 4,
} as const;

export const codeEditorInteractionOptions = {
  autoIndent: "full",
  formatOnType: true,
  useTabStops: true,
} as const;

export function monacoLanguageFor(language: string) {
  if (language === "C++") {
    return "cpp";
  }

  if (language === "Python") {
    return "python";
  }

  return "plaintext";
}
