/// <reference lib="dom" />

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { MarkdownFormat } from "./components/markdown";
import { renderMarkdown } from "./lib/markdown";

const highlight = HighlightStyle.define([
  { tag: tags.heading, class: "md-tok-heading" },
  { tag: tags.strong, class: "md-tok-strong" },
  { tag: tags.emphasis, class: "md-tok-em" },
  { tag: [tags.link, tags.url], class: "md-tok-link" },
  { tag: tags.monospace, class: "md-tok-code" },
  { tag: tags.quote, class: "md-tok-quote" },
  { tag: tags.processingInstruction, class: "md-tok-mark" },
]);

function wrap(view: EditorView, before: string, after = before) {
  view.dispatch(
    view.state.changeByRange((range) => ({
      changes: {
        from: range.from,
        to: range.to,
        insert: before + view.state.sliceDoc(range.from, range.to) + after,
      },
      range: EditorSelection.range(
        range.from + before.length,
        range.to + before.length,
      ),
    })),
  );
}

function toggleLinePrefix(view: EditorView, prefix: string) {
  const { doc, selection } = view.state;
  const lines = new Set<number>();
  selection.ranges.forEach((r) => {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++)
      lines.add(n);
  });
  const specs: ChangeSpec[] = [...lines].map((n) => {
    const line = doc.line(n);
    return line.text.startsWith(prefix)
      ? { from: line.from, to: line.from + prefix.length }
      : { from: line.from, insert: prefix };
  });
  const changes = view.state.changes(specs);
  // 選択範囲を前寄せのまま写さないのは、行頭のカーソルが差し込んだ記号の手前に残り、続けて打つ文字が記号の前に入るため
  view.dispatch({ changes, selection: selection.map(changes, 1) });
}

const FORMATS: Record<MarkdownFormat, (view: EditorView) => void> = {
  heading: (view) => toggleLinePrefix(view, "## "),
  bold: (view) => wrap(view, "**"),
  italic: (view) => wrap(view, "*"),
  listBullet: (view) => toggleLinePrefix(view, "- "),
  listNumbered: (view) => toggleLinePrefix(view, "1. "),
  code: (view) => wrap(view, "`"),
  link: (view) => wrap(view, "[", "](https://)"),
};

const isFormat = (f: string | undefined): f is MarkdownFormat =>
  !!f && f in FORMATS;

const formatKey = (key: string, format: MarkdownFormat) => ({
  key,
  run: (view: EditorView) => {
    FORMATS[format](view);
    return true;
  },
});

export function mountMarkdownEditor(field: HTMLElement) {
  const source = field.querySelector<HTMLTextAreaElement>(".md-editor-source");
  const host = field.querySelector<HTMLElement>("[data-md-host]");
  const preview = field.querySelector<HTMLElement>("[data-md-preview]");
  const toolbar = field.querySelector<HTMLElement>(".md-toolbar");
  if (
    !source ||
    !host ||
    !preview ||
    !toolbar ||
    field.hasAttribute("data-md-ready")
  )
    return;
  field.setAttribute("data-md-ready", "");

  const view = new EditorView({
    parent: host,
    doc: source.value,
    extensions: [
      history(),
      keymap.of([
        formatKey("Mod-b", "bold"),
        formatKey("Mod-i", "italic"),
        formatKey("Mod-k", "link"),
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      commonmarkLanguage.extension,
      syntaxHighlighting(highlight),
      EditorView.lineWrapping,
      placeholder(source.placeholder),
      EditorView.contentAttributes.of({
        "aria-labelledby": `${source.id}-label`,
        "aria-multiline": "true",
        ...(source.hasAttribute("aria-describedby") && {
          "aria-describedby": source.getAttribute("aria-describedby")!,
        }),
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) source.value = u.state.doc.toString();
      }),
    ],
  });
  source.hidden = true;

  field
    .querySelector(`label[for="${source.id}"]`)
    ?.addEventListener("click", () => view.focus());
  toolbar.addEventListener("click", (e) => {
    const format = (e.target as Element).closest<HTMLElement>(
      "[data-md-format]",
    )?.dataset.mdFormat;
    if (!isFormat(format)) return;
    FORMATS[format](view);
    view.focus();
  });
  field.querySelector(".md-modes")?.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>(
      "[data-md-mode]",
    );
    if (!btn) return;
    const showPreview = btn.dataset.mdMode === "preview";
    if (showPreview) {
      preview.style.minHeight = `${host.offsetHeight}px`;
      const text = view.state.doc.toString();
      preview.innerHTML = text.trim()
        ? renderMarkdown(text)
        : '<p class="muted">まだ何も書かれていません。</p>';
    }
    host.hidden = showPreview;
    toolbar.hidden = showPreview;
    preview.hidden = !showPreview;
    field
      .querySelectorAll("[data-md-mode]")
      .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    if (!showPreview) view.focus();
  });
}
