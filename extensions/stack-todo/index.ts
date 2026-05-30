/**
 * Stack Todo - Extension entry point
 *
 * A stack-based todo system for pi coding agent.
 * - Stack: LIFO execution order, stack top = current task
 * - Tree: dependency structure, built via push parentId, read-only except via fix
 * - Depth limit: 6 (hard limit)
 */

import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createEmptyState, serializeState, formatSummary, applyOps } from "./stack-engine";
import { renderStackTodoCall, renderStackTodoResult } from "./renderer";
import { StackTuiComponent } from "./tui-view";
import type { StackOpEntry, StackState, StackTodoDetails, TaskNode } from "./types";
import { STACK_TODO_ENTRY_TYPE } from "./types";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const StackOpSchema = Type.Object({
  op: StringEnum(["push", "done", "drop", "fix", "note", "check", "list"] as const),
  task: Type.Optional(
    Type.String({ description: "Task description for push" }),
  ),
  parent: Type.Optional(
    Type.String({
      description:
        "Parent task id or content (fuzzy match) for push. Default: current stack top.",
    }),
  ),
  text: Type.Optional(
    Type.String({ description: "Note text for note" }),
  ),
  target: Type.Optional(
    Type.String({
      description:
        "Target task for fix/note/check (fuzzy match by id or content). Default: current stack top.",
    }),
  ),
  content: Type.Optional(
    Type.String({ description: "New content for fix" }),
  ),
  newParent: Type.Optional(
    Type.String({
      description:
        "New parent task for fix (fuzzy match). Re-parents the target under this node.",
    }),
  ),
  plan: Type.Optional(
    Type.Array(Type.String(), {
      description: "Checklist items to create for the new task. A lightweight local plan — NOT pushed to stack.",
    }),
  ),
  item: Type.Optional(
    Type.String({
      description: "Checklist item text to toggle (fuzzy match). Use with op:check.",
    }),
  ),
});

const StackTodoParams = Type.Object({
  ops: Type.Array(StackOpSchema, { minItems: 1 }),
});

// ---------------------------------------------------------------------------
// Tokenizer for command arguments
// ---------------------------------------------------------------------------

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "\\" && i + 1 < input.length) {
      current += input[++i];
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseSubcommand(raw: string): { verb: string; rest: string } {
  const trimmed = raw.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) return { verb: trimmed, rest: "" };
  return { verb: trimmed.slice(0, space), rest: trimmed.slice(space + 1) };
}

// ---------------------------------------------------------------------------
// Helper: resolve node for command (same logic as engine)
// ---------------------------------------------------------------------------

function resolveNodeForCommand(
  state: StackState,
  query: string,
): TaskNode | undefined {
  const trimmed = query.trim();
  const byId = state.nodes[trimmed];
  if (byId) return byId;
  for (const node of Object.values(state.nodes)) {
    if (node.content === trimmed) return node;
  }
  const lower = trimmed.toLowerCase();
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const node = state.nodes[state.stack[i]];
    if (node && node.content.toLowerCase().includes(lower)) return node;
  }
  for (const node of Object.values(state.nodes)) {
    if (state.stack.includes(node.id)) continue;
    if (node.content.toLowerCase().includes(lower)) return node;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // In-memory state, reconstructed from session on load
  let currentState = createEmptyState();

  // ── State reconstruction ──────────────────────────────────────────

  function reconstructFromBranch(ctx: ExtensionContext): void {
    let state = createEmptyState();
    let found = false;

    for (const entry of ctx.sessionManager.getBranch()) {
      // Tool results (LLM-initiated mutations)
      if (entry.type === "message") {
        const msg = entry.message;
        if (
          msg.role === "toolResult" &&
          msg.toolName === "stack_todo"
        ) {
          const details = msg.details as StackTodoDetails | undefined;
          if (details?.state) {
            state = details.state;
            found = true;
          }
        }
      }
      // Custom entries (user command mutations)
      if (
        entry.type === "custom" &&
        entry.customType === STACK_TODO_ENTRY_TYPE
      ) {
        const data = entry.data as StackState | undefined;
        if (data) {
          state = data;
          found = true;
        }
      }
    }

    currentState = found ? state : createEmptyState();
  }

  // ── Widget ───────────────────────────────────────────────────────

  function buildWidgetLines(): string[] {
    const lines: string[] = [];
    const stack = currentState.stack;

    if (stack.length === 0) {
      lines.push("Stack \u2014 empty. Push a task to start.");
      return lines;
    }

    const depthColor =
      stack.length >= 5 ? "⚠" : stack.length >= 3 ? "●" : "○";
    const currentId = stack[stack.length - 1];
    const current = currentState.nodes[currentId];
    lines.push(
      `Stack [${stack.length}/6] ${depthColor} → ${current?.content ?? "?"}`,
    );

    // Show up to 2 upcoming tasks
    for (let i = stack.length - 2; i >= Math.max(0, stack.length - 3); i--) {
      const node = currentState.nodes[stack[i]];
      if (node) lines.push(`  ○ ${node.content}`);
    }

    const hidden = stack.length - 3;
    if (hidden > 0) lines.push(`  … ${hidden} more`);

    return lines;
  }

  function refreshWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget("stack-todo", buildWidgetLines());
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    reconstructFromBranch(ctx);
    refreshWidget(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructFromBranch(ctx);
    refreshWidget(ctx);
  });

  // Update widget after LLM tool calls
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "stack_todo") {
      refreshWidget(ctx);
    }
  });

  // ── Tool: stack_todo ──────────────────────────────────────────────

  pi.registerTool({
    name: "stack_todo",
    label: "Stack Todo",
    description:
      "Manage a stack-based todo list. Push tasks onto the stack, " +
      "complete/drop the top task to expose the next. " +
      "Optionally set parent to build a dependency tree. " +
      "Include a plan (checklist) when pushing complex tasks. " +
      "Stack depth is limited to 6. " +
      "Use fix to correct task content or parent. " +
      "Use note to attach remarks. Use check to tick off checklist items.",
    promptSnippet:
      "Push tasks to track progress. Only the top (current) task can be worked on. Push subtasks, done/drop to pop.",
    promptGuidelines: [
      "stack_todo is NOT a task queue. Do NOT pre-plan or batch-push. Work without the stack until complexity FORCES you to push ONE subtask.",
      "Push EXACTLY ONE task per stack_todo call. Never push multiple tasks in one call — each subshell is a single push.",
      "DEFAULT parent is the CURRENT (top) task. If you want a new task under a DIFFERENT parent, you MUST explicitly set the parent param. Failing to set parent will attach the new task under the current task, which is usually wrong for siblings.",
      "To push a SIBLING of the current task: first COMPLETE (done) the current task to pop back to the parent, THEN push the sibling. The sibling will default-attach to the parent correctly.",
      "Rule: each parent can have at most ONE child on the stack. You will get an error if you try to push a second child under the same parent while the first is still on the stack.",
      "When the current task is done, call op:done. The stack pops and the parent resumes. Then you can push the next sibling (if needed) under that parent.",
      "Use op:drop to abandon the current task if it was a wrong turn. Use op:note to attach remarks. Use op:fix to correct content or re-parent after mistakes.",
      "When pushing a complex task, optionally include a plan array with checklist items. These are local to the task (NOT pushed to stack). Use op:check to tick them off as you progress.",
      "After EVERY stack_todo call, read the result summary. It tells you the new current task, stack depth, and checklist progress. Stack is capped at 6.",
    ],
    parameters: StackTodoParams,

    async execute(
      _toolCallId: string,
      params: { ops: StackOpEntry[] },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionContext,
    ) {
      const ops = params.ops;
      const result = applyOps(currentState, ops);
      currentState = result.state;

      // Persist state via custom entry
      pi.appendEntry(STACK_TODO_ENTRY_TYPE, serializeState(currentState));

      const summary = formatSummary(result.state, result.errors);

      return {
        content: [{ type: "text", text: summary }],
        details: {
          ops,
          state: serializeState(result.state),
          errors: result.errors,
        } satisfies StackTodoDetails,
      };
    },

    // Custom rendering
    renderCall(args, theme, _context) {
      return renderStackTodoCall(
        args as { ops?: StackOpEntry[] },
        theme,
      );
    },

    renderResult(result, options, theme, _context) {
      return renderStackTodoResult(
        result as {
          content: Array<{ type: string; text?: string }>;
          details?: StackTodoDetails;
        },
        options as { expanded: boolean },
        theme,
      );
    },
  });

  // ── Command: /stack ───────────────────────────────────────────────

  pi.registerCommand("stack", {
    description: "View and manage the stack todo list",

    handler: async (args: string, ctx) => {
      const trimmed = args.trim();

      // ── /stack (no args) → show TUI ──
      if (!trimmed) {
        if (!ctx.hasUI) {
          // Text mode fallback
          const summary = formatSummary(currentState, []);
          ctx.ui.notify(summary, "info");
          return;
        }

        await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
          return new StackTuiComponent(currentState, theme, () => done());
        });
        return;
      }

      // ── Subcommand dispatch ──
      const { verb, rest } = parseSubcommand(trimmed);

      switch (verb) {
        case "push": {
          if (!rest) {
            ctx.ui.notify("Usage: /stack push <task description>", "error");
            return;
          }
          const result = applyOps(currentState, [
            { op: "push", task: rest },
          ]);
          currentState = result.state;
          pi.appendEntry(STACK_TODO_ENTRY_TYPE, serializeState(currentState));
          refreshWidget(ctx);
          if (currentState.stack.length > 0) {
            const top = currentState.nodes[
              currentState.stack[currentState.stack.length - 1]
            ];
            ctx.ui.notify(`Pushed: ${top.content}`, "success");
          }
          if (result.errors.length > 0) {
            ctx.ui.notify(result.errors.join("; "), "error");
          }
          break;
        }

        case "done": {
          const result = applyOps(currentState, [{ op: "done" }]);
          currentState = result.state;
          pi.appendEntry(STACK_TODO_ENTRY_TYPE, serializeState(currentState));
          refreshWidget(ctx);
          if (result.errors.length > 0) {
            ctx.ui.notify(result.errors[0], "error");
          } else {
            const next =
              currentState.stack.length > 0
                ? currentState.nodes[
                    currentState.stack[currentState.stack.length - 1]
                  ]
                : undefined;
            const msg = next
              ? `Done. Next: ${next.content}`
              : "Done. Stack is now empty.";
            ctx.ui.notify(msg, "success");
          }
          break;
        }

        case "drop": {
          const result = applyOps(currentState, [{ op: "drop" }]);
          currentState = result.state;
          pi.appendEntry(STACK_TODO_ENTRY_TYPE, serializeState(currentState));
          refreshWidget(ctx);
          if (result.errors.length > 0) {
            ctx.ui.notify(result.errors[0], "error");
          } else {
            ctx.ui.notify("Dropped top task.", "success");
          }
          break;
        }

        case "note": {
          const tokens = tokenize(rest);
          if (tokens.length === 0) {
            ctx.ui.notify(
              "Usage: /stack note [target task] <text>",
              "error",
            );
            return;
          }
          // Heuristic: if first token matches a node, it's a target; otherwise it's text
          let target: string | undefined;
          let text: string;
          // Try matching first token as task
          const maybeTarget = resolveNodeForCommand(currentState, tokens[0]);
          if (maybeTarget && tokens.length > 1) {
            target = tokens[0];
            text = tokens.slice(1).join(" ");
          } else {
            text = tokens.join(" ");
          }

          const noteEntry: StackOpEntry = { op: "note", text };
          if (target) noteEntry.target = target;

          const result = applyOps(currentState, [noteEntry]);
          currentState = result.state;
          pi.appendEntry(STACK_TODO_ENTRY_TYPE, serializeState(currentState));
          refreshWidget(ctx);
          if (result.errors.length > 0) {
            ctx.ui.notify(result.errors[0], "error");
          } else {
            ctx.ui.notify("Note added.", "success");
          }
          break;
        }

        case "fix": {
          const tokens = tokenize(rest);
          if (tokens.length < 2) {
            ctx.ui.notify(
              "Usage: /stack fix <target> content <new text>   OR   /stack fix <target> parent <new parent>",
              "error",
            );
            return;
          }

          const fixTarget = tokens[0];
          const key = tokens[1];

          const fixEntry: StackOpEntry = {
            op: "fix",
            target: fixTarget,
          };

          if (key === "content") {
            fixEntry.content = tokens.slice(2).join(" ");
          } else if (key === "parent") {
            fixEntry.newParent = tokens.slice(2).join(" ");
          } else {
            ctx.ui.notify(
              `Unknown fix key "${key}". Use "content" or "parent".`,
              "error",
            );
            return;
          }

          const result = applyOps(currentState, [fixEntry]);
          currentState = result.state;
          pi.appendEntry(STACK_TODO_ENTRY_TYPE, serializeState(currentState));
          refreshWidget(ctx);
          if (result.errors.length > 0) {
            ctx.ui.notify(result.errors[0], "error");
          } else {
            ctx.ui.notify(`Fixed task "${fixTarget}".`, "success");
          }
          break;
        }

        case "check": {
          const tokens = tokenize(rest);
          if (tokens.length === 0) {
            ctx.ui.notify(
              "Usage: /stack check [target task] <item text>",
              "error",
            );
            return;
          }
          let target: string | undefined;
          let item: string;
          const maybeTarget = resolveNodeForCommand(currentState, tokens[0]);
          if (maybeTarget && tokens.length > 1) {
            target = tokens[0];
            item = tokens.slice(1).join(" ");
          } else {
            item = tokens.join(" ");
          }

          const checkEntry: StackOpEntry = { op: "check", item };
          if (target) checkEntry.target = target;

          const result = applyOps(currentState, [checkEntry]);
          currentState = result.state;
          pi.appendEntry(STACK_TODO_ENTRY_TYPE, serializeState(currentState));
          refreshWidget(ctx);
          if (result.errors.length > 0) {
            ctx.ui.notify(result.errors[0], "error");
          } else {
            ctx.ui.notify(`Toggled: ${item}`, "success");
          }
          break;
        }

        case "help":
        case "?": {
          const helpText = [
            "Usage: /stack <subcommand> [args]",
            "",
            "  /stack                             Show interactive stack view",
            "  /stack push <task>                 Push a new task onto the stack",
            "  /stack done                        Complete the current (top) task",
            "  /stack drop                        Abandon the current (top) task",
            "  /stack note [target] <text>        Add a note to a task (default: current)",
            "  /stack check [target] <item>       Toggle a checklist item (default: current task)",
            "  /stack fix <target> content <t>    Change a task's description",
            "  /stack fix <target> parent <p>     Re-parent a task under another",
            "  /stack help                        Show this help",
          ].join("\n");
          ctx.ui.notify(helpText, "info");
          break;
        }

        default: {
          ctx.ui.notify(
            `Unknown subcommand: "${verb}". Use /stack help for usage.`,
            "error",
          );
          break;
        }
      }
    },
  });
}


