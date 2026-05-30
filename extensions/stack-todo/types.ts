/**
 * Stack Todo - Types
 *
 * Stack: LIFO execution order. Top of stack = current active task.
 * Tree:  Dependency structure overlaid on tasks. Built automatically via push parentId. Read-only except via fix.
 */

export type TaskStatus = "active" | "completed" | "abandoned";

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface TaskNode {
  id: string;
  content: string;
  status: TaskStatus;
  /** null = root task */
  parentId: string | null;
  /** Derived from parentId. Cached for rendering. */
  childrenIds: string[];
  /** Append-only notes */
  notes?: string[];
  /** Per-task lightweight plan. NOT pushed to stack — just a local reminder. */
  checklist?: ChecklistItem[];
  /** ISO timestamp */
  createdAt: string;
}

export interface StackState {
  nodes: Record<string, TaskNode>;
  /** Node IDs in LIFO order. index 0 = bottom, last = top = current task. */
  stack: string[];
  /** Monotonic counter for node IDs */
  nextId: number;
}

export interface StackOpEntry {
  op: "push" | "done" | "drop" | "fix" | "note" | "check" | "list";
  task?: string;
  parent?: string;
  text?: string;
  target?: string;
  content?: string;
  newParent?: string;
  /** Checklist items to create when pushing a task */
  plan?: string[];
  /** Checklist item text to toggle (for check op) */
  item?: string;
}

export interface StackTodoDetails {
  ops: StackOpEntry[];
  state: StackState;
  summary: string;
  errors: string[];
}

/** Custom entry type for session persistence */
export const STACK_TODO_ENTRY_TYPE = "stack-todo-state";

/** Hard limit: prevent the LLM from using the stack as a flat pipeline */
export const STACK_DEPTH_LIMIT = 6;
