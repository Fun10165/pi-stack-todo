/**
 * Stack Todo - /stack command TUI component
 *
 * Full-screen interactive view of the stack + tree.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { formatTreeView } from "./stack-engine";
import type { StackState } from "./types";

export class StackTuiComponent {
  private state: StackState;
  private theme: Theme;
  private onClose: () => void;
  private scrollOffset = 0;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(state: StackState, theme: Theme, onClose: () => void) {
    this.state = state;
    this.theme = theme;
    this.onClose = onClose;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "q")) {
      this.onClose();
      return;
    }
    if (matchesKey(data, "j") || matchesKey(data, "down")) {
      this.scrollOffset = Math.min(
        this.scrollOffset + 1,
        Math.max(0, (this.cachedLines?.length ?? 0) - 10),
      );
      this.cachedLines = undefined;
      return;
    }
    if (matchesKey(data, "k") || matchesKey(data, "up")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.cachedLines = undefined;
      return;
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const th = this.theme;
    const state = this.state;
    const totalNodes = Object.keys(state.nodes).length;

    // Title bar
    lines.push("");
    const title = th.fg("accent", " Stack Todo ");
    const headerLine =
      th.fg("borderMuted", "\u2500".repeat(3)) +
      title +
      th.fg("borderMuted", "\u2500".repeat(Math.max(0, width - 15)));
    lines.push(truncateToWidth(headerLine, width));
    lines.push("");

    // Stats
    const stackDepth = state.stack.length;
    const currentId =
      stackDepth > 0 ? state.stack[stackDepth - 1] : undefined;
    const current = currentId ? state.nodes[currentId] : undefined;

    lines.push(
      truncateToWidth(
        th.fg("muted", `${totalNodes} task(s) | `) +
          th.fg(stackDepth >= 5 ? "error" : "accent", `stack depth ${stackDepth}/6`),
        width,
      ),
    );

    if (current) {
      lines.push("");
      lines.push(
        truncateToWidth(
          th.fg("accent", "\u2192 ") + th.fg("text", current.content),
          width,
        ),
      );
      // Current task notes
      if (current.notes && current.notes.length > 0) {
        for (let j = 0; j < current.notes.length; j++) {
          if (j > 0) lines.push(truncateToWidth(th.fg("dim", "  \u2500\u2500\u2500"), width));
          for (const noteLine of current.notes[j].split("\n")) {
            lines.push(
              truncateToWidth(th.fg("dim", "  \u2502 " + noteLine), width),
            );
          }
        }
      }
    } else if (totalNodes === 0) {
      lines.push(
        truncateToWidth(
          th.fg("dim", "  No tasks yet. The agent can push tasks via stack_todo."),
          width,
        ),
      );
    }

    // Tree
    if (totalNodes > 0) {
      lines.push("");
      lines.push(truncateToWidth(th.fg("muted", "Tree:"), width));
      const treeLines = formatTreeView(state).split("\n");
      for (const line of treeLines) {
        lines.push(truncateToWidth("  " + line, width));
      }

      // Stack order
      if (stackDepth > 0) {
        lines.push("");
        lines.push(truncateToWidth(th.fg("muted", "Stack order (next up):"), width));
        for (let i = stackDepth - 2; i >= 0; i--) {
          const node = state.nodes[state.stack[i]];
          if (!node) continue;
          const pos = stackDepth - i;
          lines.push(
            truncateToWidth(
              th.fg("dim", `  ${pos}.`) + " " + th.fg("text", node.content),
              width,
            ),
          );
        }
      }
    }

    // Footer
    lines.push("");
    lines.push(
      truncateToWidth(
        th.fg("dim", "  j/k scroll  |  Esc/q close"),
        width,
      ),
    );
    lines.push("");

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}
