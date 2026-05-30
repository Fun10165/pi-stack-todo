# pi-stack-todo

> Subroutine-style task orchestration for Pi — **save context, jump, restore.**

[中文文档](README.zh.md) | [English](README.md)

![License](https://img.shields.io/badge/license-MIT-blue)
![pi-package](https://img.shields.io/badge/pi-package-blueviolet)

---

## The Idea

Your CPU doesn't plan all its function calls upfront. It pushes a **stack frame** — saving registers, setting the return address, jumping to the callee — and when the callee returns, the caller resumes exactly where it left off. No parallel planning. No dependency graph. Just a disciplined call stack that never forgets.

**pi-stack-todo** brings this paradigm to your coding agent.

| OS Subroutine | pi-stack-todo |
|---|---|
| **Save context** (push registers to stack) | `push {task: "...", parent: current}` — parent state is preserved underneath |
| **Jump** (set PC to callee) | Stack top becomes your current focus. The parent waits. |
| **Stack frame** (locals, return address) | Each task carries its own **checklist** (local plan), **notes**, and a link back to its parent |
| **Return** (pop frame, restore PC) | `done` pops the current task, parent resumes. Checklist shows you exactly where you were. |
| **Abort** (unwind on error) | `drop` abandons the top frame. Stack unwinds. |
| **Context switch** (save/restore on interrupt) | Compatible with context-compression plugins — deep stacks can be compressed, then decompressed on return. |

---

## vs. Anthropic's Dynamic Workflows

| | Dynamic Workflows | pi-stack-todo |
|---|---|---|
| **Strategy** | Pre-planned DAG. Plan first, execute in parallel. | Emergent call tree. Push when complexity is discovered, pop when resolved. |
| **Best for** | Large-scale tasks that are **easy to plan** but benefit from massive parallelism. | Deep, **non-parallelizable** work where the path isn't known in advance. |
| **Planning** | Upfront. You need to know the shape of the work before starting. | Organic. You discover subtasks AS you work. Push when you hit complexity. |
| **Parallelism** | Yes — designed for it. | No — this is a subroutine model. One thing at a time, in depth. |
| **Focus** | Breadth. Divide and conquer. | Depth. Drill down, then come back up. |

> Dynamic Workflows scales **out**. pi-stack-todo scales **down**.

---

## Features

- **LIFO stack with strict depth limit (6)** — prevents the model from treating it as a flat todo list
- **Dependency tree overlay** — each task knows its parent. Read-only except via `fix`.
- **Per-task checklist** — lightweight local plans. Not pushed to the stack — just reminders.
- **Subroutine semantics enforced** — only one child per parent on the stack at a time. No sibling flooding.
- **Session-persistent** — state survives restarts and respects branch navigation.
- **Persistent widget** — current task always visible above the editor.
- **8 guideline prompts** injected into the system prompt — teaches the model to use the stack correctly.

---

## Install

```bash
pi install git:github.com/Fun10165/pi-stack-todo
```

Or project-local:

```bash
pi install -l git:github.com/Fun10165/pi-stack-todo
```

---

## Usage

### Agent Tool: `stack_todo`

The LLM calls `stack_todo` with ops:

| Op | What it does |
|---|---|
| `push {task, parent?, plan?}` | Push a new task onto the stack. Optional checklist via `plan`. |
| `done` | Complete and pop the current task. Parent resumes. |
| `drop` | Abandon and pop the current task. |
| `check {target?, item}` | Toggle a checklist item. |
| `fix {target, content?, newParent?}` | Correct a task's description or re-parent it. |
| `note {target?, text}` | Attach a freeform note. |
| `list` | Read-only view of the current state. |

### User Commands: `/stack`

```
/stack                          Interactive tree view (j/k scroll, Esc close)
/stack push <task>              Manually push a task
/stack done                     Complete the current task
/stack drop                     Abandon the current task
/stack note [target] <text>     Add a note
/stack check [target] <item>    Toggle a checklist item
/stack fix <target> content <t> Fix a task's description
/stack fix <target> parent <p>  Re-parent a task
/stack help                     Show help
```

---

## How the Model Uses It

The model is taught NOT to pre-plan. It works normally without the stack. Only when the current task becomes too complex does it push a subtask:

```
Work on "Refactor auth module"
  → Complexity discovered: need to extract token validator first
  → push "Extract token validator" as child of "Refactor auth module"
  → Work on validator...
  → done — pops back to "Refactor auth module"
  → Continue with the refactor (checklist reminds you what's left)
  → done — stack empty. All done.
```

---

## Context Compression (Future / Complementary)

For very deep stacks, each task's context can be compressed by an external plugin. pi-stack-todo's tree structure is designed to be consumable by context-management plugins:

- A compressor plugin reads the task tree, compresses non-current branches
- When the model navigates back (via `done`), the compressor decompresses
- The model resumes with full context — never forgetting, always efficient

This is intentionally NOT part of pi-stack-todo. It's a separate concern that plugs into the tree data structure.

---

## Structure

```
extensions/stack-todo/
├── index.ts          # Entry point: tool + command + widget + lifecycle
├── types.ts          # TaskNode, StackState, op schemas
├── stack-engine.ts   # Pure functions: applyOps, resolveNode, cycle detection
├── renderer.ts       # TUI rendering for tool calls/results
└── tui-view.ts       # /stack interactive full-screen component
```

---

## License

MIT
