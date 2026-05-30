/**
 * Stack Todo - Core engine
 *
 * Pure functions for managing stack state. No side effects.
 */

import { STACK_DEPTH_LIMIT } from "./types";
import type { StackOpEntry, StackState, TaskNode, TaskStatus } from "./types";

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export function createEmptyState(): StackState {
  return { nodes: {}, stack: [], nextId: 1 };
}

function createTaskNode(
  id: string,
  content: string,
  parentId: string | null,
): TaskNode {
  return {
    id,
    content,
    status: "active",
    parentId,
    childrenIds: [],
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Node lookup
// ---------------------------------------------------------------------------

/** Match by exact id */
export function findNodeById(nodes: Record<string, TaskNode>, id: string): TaskNode | undefined {
  return nodes[id];
}

/** Match by exact content */
export function findNodeByContent(
  nodes: Record<string, TaskNode>,
  content: string,
): TaskNode | undefined {
  const trimmed = content.trim();
  for (const node of Object.values(nodes)) {
    if (node.content === trimmed) return node;
  }
  return undefined;
}

/** Fuzzy resolve: try id first, then exact content, then substring (stack-top-first). */
export function resolveNode(
  state: StackState,
  query: string,
): TaskNode | undefined {
  const trimmed = query.trim();
  // Try exact id
  const byId = findNodeById(state.nodes, trimmed);
  if (byId) return byId;
  // Try exact content
  const byContent = findNodeByContent(state.nodes, trimmed);
  if (byContent) return byContent;
  // Try substring match, stack-top-first
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
// Tree helpers
// ---------------------------------------------------------------------------

/** Recompute childrenIds for all nodes from parentId */
export function recomputeChildren(nodes: Record<string, TaskNode>): void {
  for (const node of Object.values(nodes)) {
    node.childrenIds = [];
  }
  for (const node of Object.values(nodes)) {
    if (node.parentId !== null) {
      const parent = nodes[node.parentId];
      if (parent) {
        const idx = parent.childrenIds.findIndex(
          (cid) => Number(cid) > Number(node.id),
        );
        if (idx === -1) {
          parent.childrenIds.push(node.id);
        } else {
          parent.childrenIds.splice(idx, 0, node.id);
        }
      }
    }
  }
}

/** Walk parent chain from nodeId. Returns true if targetId is an ancestor. */
function isAncestor(
  nodes: Record<string, TaskNode>,
  nodeId: string,
  targetId: string,
): boolean {
  let current: string | null = nodeId;
  while (current !== null) {
    if (current === targetId) return true;
    const node = nodes[current];
    if (!node) return false;
    current = node.parentId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// State serialization
// ---------------------------------------------------------------------------

export function cloneState(state: StackState): StackState {
  return JSON.parse(JSON.stringify(state)) as StackState;
}

export function serializeState(state: StackState): StackState {
  const cloned = cloneState(state);
  recomputeChildren(cloned.nodes);
  return cloned;
}

// ---------------------------------------------------------------------------
// Op application
// ---------------------------------------------------------------------------

function currentTaskId(state: StackState): string | undefined {
  return state.stack.length > 0 ? state.stack[state.stack.length - 1] : undefined;
}

export interface ApplyOpResult {
  state: StackState;
  error?: string;
}

function applyPush(state: StackState, entry: StackOpEntry): ApplyOpResult {
  if (!entry.task?.trim()) {
    return { state, error: "Missing task description for push" };
  }

  // Depth check
  if (state.stack.length >= STACK_DEPTH_LIMIT) {
    return {
      state,
      error: `Stack depth limit (${STACK_DEPTH_LIMIT}) reached. Current stack:\n${formatStackListCompact(state)}`,
    };
  }

  // Resolve parent
  let parentId: string | null = null;
  if (entry.parent?.trim()) {
    const parent = resolveNode(state, entry.parent.trim());
    if (!parent) {
      return { state, error: `Parent task "${entry.parent}" not found` };
    }
    parentId = parent.id;
  } else {
    parentId = currentTaskId(state) ?? null;
  }

  // Sibling check: each parent can have at most one child on the stack
  if (parentId !== null) {
    for (const id of state.stack) {
      const node = state.nodes[id];
      if (node && node.parentId === parentId) {
        return {
          state,
          error: `Parent "${state.nodes[parentId]?.content ?? parentId}" already has a subtask on the stack (#${id}: ${node.content}). Complete or drop it before pushing another sibling.`,
        };
      }
    }
  }

  // Content uniqueness
  const existing = findNodeByContent(state.nodes, entry.task.trim());
  if (existing) {
    return { state, error: `Task "${entry.task.trim()}" already exists as #${existing.id}` };
  }

  const id = String(state.nextId);
  const node = createTaskNode(id, entry.task.trim(), parentId);

  // Attach checklist plan if provided
  if (entry.plan && entry.plan.length > 0) {
    node.checklist = entry.plan.map((text) => ({ text: text.trim(), done: false }));
  }

  state.nodes[id] = node;
  state.stack.push(id);
  state.nextId++;

  return { state };
}

function applyDone(state: StackState, _entry: StackOpEntry): ApplyOpResult {
  if (state.stack.length === 0) {
    return { state, error: "Stack is empty, nothing to complete" };
  }
  const topId = state.stack.pop()!;
  const node = state.nodes[topId];
  if (node) node.status = "completed";
  return { state };
}

function applyDrop(state: StackState, _entry: StackOpEntry): ApplyOpResult {
  if (state.stack.length === 0) {
    return { state, error: "Stack is empty, nothing to drop" };
  }
  const topId = state.stack.pop()!;
  const node = state.nodes[topId];
  if (node) node.status = "abandoned";
  return { state };
}

function applyNote(state: StackState, entry: StackOpEntry): ApplyOpResult {
  if (!entry.text?.trim()) {
    return { state, error: "Missing text for note" };
  }

  let targetNode: TaskNode | undefined;
  if (entry.target?.trim()) {
    targetNode = resolveNode(state, entry.target.trim());
    if (!targetNode) {
      return { state, error: `Task "${entry.target}" not found for note` };
    }
  } else {
    const current = currentTaskId(state);
    if (!current) {
      return { state, error: "Stack is empty, specify a target task for note" };
    }
    targetNode = state.nodes[current];
  }

  const cleaned = entry.text.replace(/\s+$/u, "");
  if (!cleaned) {
    return { state, error: "Note text is empty after trimming" };
  }

  targetNode.notes = targetNode.notes
    ? [...targetNode.notes, cleaned]
    : [cleaned];
  return { state };
}

function applyFix(state: StackState, entry: StackOpEntry): ApplyOpResult {
  if (!entry.target?.trim()) {
    return { state, error: "Missing target task for fix" };
  }

  const target = resolveNode(state, entry.target.trim());
  if (!target) {
    return { state, error: `Task "${entry.target}" not found for fix` };
  }

  if (!entry.content?.trim() && !entry.newParent?.trim()) {
    return { state, error: "fix requires at least content or newParent" };
  }

  if (entry.content?.trim()) {
    target.content = entry.content.trim();
  }

  if (entry.newParent?.trim()) {
    const newParent = resolveNode(state, entry.newParent.trim());
    if (!newParent) {
      return { state, error: `New parent "${entry.newParent}" not found` };
    }
    if (newParent.id === target.id) {
      return { state, error: "Cannot set a task as its own parent" };
    }
    if (isAncestor(state.nodes, newParent.id, target.id)) {
      return {
        state,
        error: `Cannot re-parent: "${newParent.content}" is a descendant of "${target.content}" (would create a cycle)`,
      };
    }
    target.parentId = newParent.id;
  }

  return { state };
}

function applyCheck(state: StackState, entry: StackOpEntry): ApplyOpResult {
  if (!entry.item?.trim()) {
    return { state, error: "Missing item text for check" };
  }

  let targetNode: TaskNode | undefined;
  if (entry.target?.trim()) {
    targetNode = resolveNode(state, entry.target.trim());
    if (!targetNode) {
      return { state, error: `Task "${entry.target}" not found for check` };
    }
  } else {
    const current = currentTaskId(state);
    if (!current) {
      return { state, error: "Stack is empty, specify a target task for check" };
    }
    targetNode = state.nodes[current];
  }

  if (!targetNode.checklist || targetNode.checklist.length === 0) {
    return { state, error: `Task "${targetNode.content}" has no checklist items` };
  }

  const query = entry.item.trim().toLowerCase();
  const match = targetNode.checklist.find(
    (ci) => ci.text.toLowerCase().includes(query),
  );

  if (!match) {
    return {
      state,
      error: `Checklist item "${entry.item.trim()}" not found in "${targetNode.content}". Available: ${targetNode.checklist.map((ci) => `"${ci.text}"`).join(", ")}`,
    };
  }

  match.done = !match.done;
  return { state };
}

function applyList(state: StackState, _entry: StackOpEntry): ApplyOpResult {
  return { state };
}

// ---------------------------------------------------------------------------
// Top-level applyOps
// ---------------------------------------------------------------------------

export function applyOps(
  state: StackState,
  ops: StackOpEntry[],
): { state: StackState; errors: string[] } {
  let working = cloneState(state);
  const errors: string[] = [];

  for (const entry of ops) {
    let result: ApplyOpResult;
    switch (entry.op) {
      case "push":
        result = applyPush(working, entry);
        break;
      case "done":
        result = applyDone(working, entry);
        break;
      case "drop":
        result = applyDrop(working, entry);
        break;
      case "note":
        result = applyNote(working, entry);
        break;
      case "fix":
        result = applyFix(working, entry);
        break;
      case "check":
        result = applyCheck(working, entry);
        break;
      case "list":
        result = applyList(working, entry);
        break;
      default:
        result = { state: working, error: `Unknown op: ${(entry as { op: string }).op}` };
    }
    if (result.error) {
      errors.push(result.error);
    }
    working = result.state;
  }

  return { state: working, errors };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<TaskStatus, string> = {
  active: "\u25cb",    // ○
  completed: "\u2713", // ✓
  abandoned: "\u2717", // ✗
};

function formatStackListCompact(state: StackState): string {
  if (state.stack.length === 0) return "(empty)";
  const lines: string[] = [];
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const id = state.stack[i];
    const node = state.nodes[id];
    if (!node) continue;
    const arrow = i === state.stack.length - 1 ? "\u2192" : "  ";
    lines.push(`  ${arrow} #${node.id}: ${node.content}`);
  }
  return lines.join("\n");
}

function renderTree(
  state: StackState,
  nodeId: string,
  prefix: string,
  isLast: boolean,
  lines: string[],
): void {
  const node = state.nodes[nodeId];
  if (!node) return;

  const onStack = state.stack.includes(nodeId);
  const isCurrent =
    state.stack.length > 0 &&
    state.stack[state.stack.length - 1] === nodeId;

  const connector = isLast ? "\u2514" : "\u251c"; // └ or ├
  const branch = prefix + connector;
  const marker = isCurrent ? "\u2192" : STATUS_ICON[node.status];
  const stackPos = onStack
    ? ` [stack:${state.stack.indexOf(nodeId) + 1}]`
    : "";
  const noteCount = node.notes?.length ?? 0;
  const noteHint =
    noteCount > 0 ? ` (+${noteCount} note${noteCount === 1 ? "" : "s"})` : "";

  lines.push(
    `${branch} ${marker} #${node.id}: ${node.content}${stackPos}${noteHint}`,
  );

  // Inline checklist items for the current task
  if (isCurrent && node.checklist && node.checklist.length > 0) {
    const childPrefix = prefix + (isLast ? "  " : "\u2502 ");
    for (const ci of node.checklist) {
      const check = ci.done ? "\u2611" : "\u2610"; // ☑ or ☐
      lines.push(`${childPrefix}  ${check} ${ci.text}`);
    }
  }

  // Inline notes for the current task only
  if (isCurrent && node.notes && node.notes.length > 0) {
    const childPrefix = prefix + (isLast ? "  " : "\u2502 ");
    for (let j = 0; j < node.notes.length; j++) {
      if (j > 0) lines.push(`${childPrefix}  \u2502`);
      for (const noteLine of node.notes[j].split("\n")) {
        lines.push(`${childPrefix}  \u2502 ${noteLine}`);
      }
    }
  }

  const children = node.childrenIds
    .map((cid) => state.nodes[cid])
    .filter(Boolean) as TaskNode[];

  for (let i = 0; i < children.length; i++) {
    const childPrefix = prefix + (isLast ? "  " : "\u2502 ");
    renderTree(state, children[i].id, childPrefix, i === children.length - 1, lines);
  }
}

export function formatTreeView(state: StackState): string {
  recomputeChildren(state.nodes);
  const roots = Object.values(state.nodes)
    .filter((n) => n.parentId === null)
    .sort((a, b) => Number(a.id) - Number(b.id));

  if (roots.length === 0) {
    // Orphan nodes: all have parentId set but parents missing (shouldn't happen)
    return "(no root tasks)";
  }

  const lines: string[] = [];
  for (let i = 0; i < roots.length; i++) {
    renderTree(state, roots[i].id, "", i === roots.length - 1, lines);
  }
  return lines.join("\n");
}

export function formatSummary(state: StackState, errors: string[]): string {
  const totalNodes = Object.keys(state.nodes).length;

  const parts: string[] = [];
  if (errors.length > 0) {
    parts.push(`Errors: ${errors.join("; ")}`);
  }

  if (totalNodes === 0) {
    parts.push("No tasks. Use push to create one.");
  } else {
    const stackDepth = state.stack.length;
    const current =
      state.stack.length > 0
        ? state.nodes[state.stack[state.stack.length - 1]]
        : undefined;

    parts.push(`${totalNodes} task(s), ${stackDepth} on stack (limit ${STACK_DEPTH_LIMIT}).`);
    if (current) {
      parts.push(`\nCurrent: ${current.content}`);
    } else {
      parts.push("\nCurrent: none (stack empty)");
    }
    parts.push(`\n\nStack (top to bottom):\n${formatStackListCompact(state)}`);
    parts.push(`\n\nTree:\n${formatTreeView(state)}`);
  }

  return parts.join("");
}
