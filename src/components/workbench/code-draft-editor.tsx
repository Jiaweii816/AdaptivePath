"use client";

import type { BeforeMount, OnMount } from "@monaco-editor/react";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { CodeRunErrorLocation } from "@/types/code-runner";
import {
  codeEditorIndentation,
  codeEditorInteractionOptions,
  codeEditorThemeName,
  monacoLanguageFor,
} from "./code-editor-config";

const MonacoEditor = dynamic(
  async () => {
    // @monaco-editor/react defaults to a CDN loader. PatternCoach is a
    // local-first workbench, so configure the installed Monaco instance in
    // this client-only loader before rendering the editor.
    const [monaco, reactMonaco] = await Promise.all([
      import("monaco-editor"),
      import("@monaco-editor/react"),
    ]);
    reactMonaco.loader.config({ monaco });
    return reactMonaco.Editor;
  },
  {
    loading: () => (
      <div className="grid h-full min-h-[280px] place-items-center bg-[#15171c] font-mono text-sm text-[#8b949e]">
        Loading editor...
      </div>
    ),
    ssr: false,
  },
);

type CodeDraftEditorProps = {
  code: string;
  className?: string;
  errorHighlight?: CodeRunErrorLocation | null;
  language: string;
  onChange: (code: string) => void;
  onErrorHighlightSeen?: () => void;
};

type MonacoEditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

declare global {
  interface Window {
    __patternCoachCodeEditor?: {
      focus: () => void;
      getValue: () => string;
      setValue: (value: string) => void;
    };
  }
}

const editorFontFamily =
  '"JetBrains Mono", "Fira Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

const beforeMount: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(codeEditorThemeName, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "8B949E", fontStyle: "italic" },
      { token: "keyword", foreground: "FF7B72" },
      { token: "number", foreground: "79C0FF" },
      { token: "string", foreground: "A5D6FF" },
      { token: "type", foreground: "FFA657" },
      { token: "class", foreground: "D2A8FF" },
      { token: "function", foreground: "D2A8FF" },
      { token: "identifier", foreground: "E6EDF3" },
    ],
    colors: {
      "editor.background": "#15171c",
      "editor.foreground": "#e6edf3",
      "editor.lineHighlightBackground": "#20242d",
      "editorLineNumber.foreground": "#626b78",
      "editorLineNumber.activeForeground": "#d6dde7",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#26384f",
      "editorIndentGuide.background1": "#2f3540",
      "editorIndentGuide.activeBackground1": "#6e7681",
      "editorCursor.foreground": "#f4c95d",
      "editorWhitespace.foreground": "#3b424d",
      "editorGutter.background": "#15171c",
      "scrollbarSlider.background": "#6e768166",
      "scrollbarSlider.hoverBackground": "#8b949e66",
      "scrollbarSlider.activeBackground": "#8b949e99",
    },
  });
};

function configureMountedEditor(
  editor: MonacoEditorInstance,
  onChange?: (value: string) => void,
) {
  editor.getModel()?.updateOptions(codeEditorIndentation);

  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    window.__patternCoachCodeEditor = {
      focus: () => editor.focus(),
      getValue: () => editor.getValue(),
      setValue: (value: string) => {
        editor.setValue(value);
        onChange?.(value);

        const model = editor.getModel();

        if (model) {
          const lastLine = model.getLineCount();
          editor.setPosition({
            column: model.getLineMaxColumn(lastLine),
            lineNumber: lastLine,
          });
        }
      },
    };
  }

  requestAnimationFrame(() => {
    editor.layout();
  });
}

function applyEditorErrorHighlight({
  decorationIds,
  editor,
  errorHighlight,
  monaco,
}: {
  decorationIds: string[];
  editor: MonacoEditorInstance | null;
  errorHighlight: CodeRunErrorLocation | null;
  monaco: MonacoInstance | null;
}) {
  const model = editor?.getModel();

  if (!editor || !monaco || !model || !errorHighlight) {
    return editor && decorationIds.length > 0
      ? editor.deltaDecorations(decorationIds, [])
      : decorationIds;
  }

  const lineNumber = errorHighlight.line;

  if (lineNumber < 1 || lineNumber > model.getLineCount()) {
    return editor.deltaDecorations(decorationIds, []);
  }

  const nextDecorations = editor.deltaDecorations(decorationIds, [
    {
      range: new monaco.Range(
        lineNumber,
        1,
        lineNumber,
        model.getLineMaxColumn(lineNumber),
      ),
      options: {
        className: "patterncoach-error-line-highlight",
        glyphMarginClassName: "patterncoach-error-line-glyph",
        hoverMessage: errorHighlight.message
          ? [{ value: errorHighlight.message }]
          : undefined,
        isWholeLine: true,
        lineNumberClassName: "patterncoach-error-line-number",
        linesDecorationsClassName: "patterncoach-error-line-decoration",
        marginClassName: "patterncoach-error-line-margin",
        overviewRuler: {
          color: "#f59e0b",
          position: monaco.editor.OverviewRulerLane.Right,
        },
        zIndex: 10,
      },
    },
  ]);
  editor.revealLineInCenterIfOutsideViewport(lineNumber);

  return nextDecorations;
}

export function CodeDraftEditor({
  code,
  className,
  errorHighlight,
  language,
  onChange,
  onErrorHighlightSeen,
}: CodeDraftEditorProps) {
  const editorRef = useRef<MonacoEditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const highlightRef = useRef<CodeRunErrorLocation | null>(null);
  const onHighlightSeenRef = useRef(onErrorHighlightSeen);

  useEffect(() => {
    highlightRef.current = errorHighlight ?? null;
  }, [errorHighlight]);

  useEffect(() => {
    onHighlightSeenRef.current = onErrorHighlightSeen;
  }, [onErrorHighlightSeen]);

  useEffect(() => {
    decorationIdsRef.current = applyEditorErrorHighlight({
      decorationIds: decorationIdsRef.current,
      editor: editorRef.current,
      errorHighlight: errorHighlight ?? null,
      monaco: monacoRef.current,
    });
  }, [errorHighlight]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    configureMountedEditor(editor, onChange);
    decorationIdsRef.current = applyEditorErrorHighlight({
      decorationIds: decorationIdsRef.current,
      editor,
      errorHighlight: errorHighlight ?? null,
      monaco,
    });

    editor.onMouseDown((event) => {
      const highlightedLine = highlightRef.current?.line;
      const clickedLine = event.target.position?.lineNumber;

      if (highlightedLine && clickedLine === highlightedLine) {
        onHighlightSeenRef.current?.();
      }
    });
  };

  return (
    <div
      aria-label={`${language} code draft`}
      className={cn(
        "min-h-[360px] flex-1 overflow-hidden rounded-md border border-[#303642] bg-[#15171c] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
      data-testid="code-draft-editor"
      role="group"
    >
      <MonacoEditor
        beforeMount={beforeMount}
        height="100%"
        language={monacoLanguageFor(language)}
        onChange={(nextCode) => onChange(nextCode ?? "")}
        onMount={handleMount}
        options={{
          ...codeEditorIndentation,
          ...codeEditorInteractionOptions,
          ariaLabel: `${language} code draft`,
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          contextmenu: true,
          cursorBlinking: "smooth",
          cursorSmoothCaretAnimation: "on",
          fixedOverflowWidgets: true,
          folding: true,
          fontFamily: editorFontFamily,
          fontLigatures: false,
          fontSize: 14,
          glyphMargin: true,
          guides: {
            bracketPairs: true,
            indentation: true,
          },
          lineHeight: 22,
          lineNumbersMinChars: 3,
          matchBrackets: "always",
          minimap: { enabled: false },
          mouseWheelZoom: true,
          padding: { bottom: 16, top: 16 },
          renderFinalNewline: "on",
          renderLineHighlight: "line",
          renderWhitespace: "selection",
          roundedSelection: false,
          scrollBeyondLastLine: false,
          scrollbar: {
            horizontalScrollbarSize: 10,
            verticalScrollbarSize: 10,
          },
          smoothScrolling: true,
          stickyScroll: { enabled: false },
          wordWrap: "off",
        }}
        theme={codeEditorThemeName}
        value={code}
      />
    </div>
  );
}
