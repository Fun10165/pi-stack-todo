/**
 * Stack Todo - TUI Renderer
 *
 * Custom rendering for stack_todo tool calls and results.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { StackOpEntry, StackState, StackTodoDetails } from "./types";
import { formatSummary, formatTreeView, recomputeChildren } from "./stack-engine";

// ---------------------------------------------------------------------------
// renderCall: compact single-line
// ---------------------------------------------------------------------------

export function renderStackTodoCall(
  args: { ops?: StackOpEntry[] },
  theme: Theme,
): Text {
  const ops = args?.ops ?? [];
  const parts: string[] = ["stack_todo"];

  for (const entry of ops.slice(0, 3)) {
    switch (entry.op) {
      case "push":
        parts.push(
          `${theme.fg("accent", "push")} ${theme.fg("dim", JSON.stringify(entry.task ?? ""))}`,
        );
        break;
      case "done":
        parts.push(theme.fg("success", "done"));
        break;
      case "drop":
        parts.push(theme.fg("error", "drop"));
        break;
      case "note":
        parts.push(theme.fg("accent", "note"));
        break;
      case "fix":
        parts.push(theme.fg("accent", "fix"));
        break;
      case "list":
        parts.push(theme.fg("muted", "list"));
        break;
    }
  }

  if (ops.length > 3) {
    parts.push(theme.fg("dim", `+${ops.length - 3} more`));
  }

  return new Text(parts.join(" "), 0, 0);
}

// ---------------------------------------------------------------------------
// renderResult: tree view
// ---------------------------------------------------------------------------

export function renderStackTodoResult(
  result: { content: Array<{ type: string; text?: string }>; details?: StackTodoDetails },
  options: { expanded: boolean },
  theme: Theme,
): Text {
  const details = result.details;
  if (!details) {
    const text = result.content?.[0];
    return new Text(
      text?.type === "text" ? text.text ?? "" : "",
      0,
      0,
    );
  }

  const { state, errors } = details;

  if (errors.length > 0 && Object.keys(state.nodes).length === 0) {
    return new Text(theme.fg("error", errors.join("\n")), 0, 0);
  }

  const hasTasks = Object.keys(state.nodes).length > 0;

  if (!hasTasks) {
    return new Text(
      theme.fg("dim", "No tasks. Use push to create one."),
      0,
      0,
    );
  }

  if (!options.expanded) {
    // Collapsed: current + count only
    const stackDepth = state.stack.length;
    const currentId =
      stackDepth > 0 ? state.stack[stackDepth - 1] : undefined;
    const current = currentId ? state.nodes[currentId] : undefined;

    let text = theme.fg("accent", theme.bold("Stack Todo")) + "  ";
    text += theme.fg("muted", `${Object.keys(state.nodes).length} tasks`) + "  ";
    if (current) {
      text += theme.fg("text", `\u2192 ${current.content}`);
    } else {
      text += theme.fg("dim", "stack empty");
    }

    if (errors.length > 0) {
      text += "\n" + theme.fg("error", errors.join("\n"));
    }

    return new Text(text, 0, 0);
  }

  // Expanded: full tree + stack
  const lines: string[] = [];

  // Header
  const totalNodes = Object.keys(state.nodes).length;
  const stackDepth = state.stack.length;
  const currentId =
    stackDepth > 0 ? state.stack[stackDepth - 1] : undefined;
  const current = currentId ? state.nodes[currentId] : undefined;

  const header = theme.fg("accent", theme.bold("Stack Todo"));
  const stats = theme.fg(
    "muted",
    `${totalNodes} task(s), ${stackDepth} on stack`,
  );
  const depthColor = stackDepth >= 5 ? "error" : stackDepth >= 3 ? "accent" : "muted";
  const depth = theme.fg(depthColor, `[depth ${stackDepth}/6]`);
  lines.push(`${header}  ${stats}  ${depth}`);

  if (current) {
    lines.push(
      "",
      theme.fg("accent", "\u2192 ") + theme.fg("text", current.content),
    );
  }

  // Tree
  lines.push("", theme.fg("muted", "Tree:"));
  lines.push(formatTreeView(state));

  // Stack list (compact)
  if (state.stack.length > 0) {
    lines.push("", theme.fg("muted", "Stack (next up):"));
    const stack = state.stack;
    for (let i = stack.length - 2; i >= 0; i--) {
      const node = state.nodes[stack[i]];
      if (!node) continue;
      const pos = stack.length - i;
      lines.push(
        theme.fg("dim", `  ${pos}.`) + " " + theme.fg("text", node.content),
      );
    }
  }

  // Errors at bottom
  if (errors.length > 0) {
    lines.push("", theme.fg("error", `Errors: ${errors.join("; ")}`));
  }

  return new Text(lines.join("\n"), 0, 0);
}
