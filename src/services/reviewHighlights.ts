import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import { sectionDefinitions } from "../../shared/note";
import type { ReviewIssue } from "../../shared/review";

export function reviewDecorations(
  doc: Node,
  issues: ReviewIssue[],
): DecorationSet {
  const decorations: Decoration[] = [];
  issues.forEach((issue, index) => {
    const attrs = {
      class: "review-mark",
      "data-review-issue": String(index),
      title: issue.message,
    };
    let found = false;
    if (issue.quote)
      doc.descendants((node, pos) => {
        if (!node.isText || !node.text) return;
        let at = node.text.indexOf(issue.quote!);
        while (at >= 0) {
          decorations.push(
            Decoration.inline(pos + at, pos + at + issue.quote!.length, attrs),
          );
          found = true;
          at = node.text.indexOf(issue.quote!, at + issue.quote!.length);
        }
      });
    if (found) return;
    const section = sectionDefinitions.find((s) => s.key === issue.field);
    if (!section) return;
    const names = [section.label, ...section.aliases];
    let active = false,
      level = 0;
    doc.forEach((node, pos) => {
      if (node.type.name === "heading") {
        if (active && node.attrs.level <= level) active = false;
        if (
          names.some((name) =>
            node.textContent
              .toLocaleLowerCase()
              .includes(name.toLocaleLowerCase()),
          )
        ) {
          active = true;
          level = node.attrs.level;
        }
      }
      if (active)
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            ...attrs,
            class: "review-section-mark",
          }),
        );
    });
  });
  return DecorationSet.create(doc, decorations);
}
export function reviewHighlightExtension(issues: () => ReviewIssue[]) {
  return Extension.create({
    name: "reviewFeedback",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              return reviewDecorations(state.doc, issues());
            },
          },
        }),
      ];
    },
  });
}
