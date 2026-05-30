# pi-stack-todo

> 将 OS 子程序调用模型搬进你的 AI 编程助手 — **保护现场、跳转、恢复、永不遗忘。**

[English](README.md) | [中文文档](README.zh.md)

![License](https://img.shields.io/badge/license-MIT-blue)
![pi-package](https://img.shields.io/badge/pi-package-blueviolet)

---

## 设计理念

你的 CPU 从来不提前规划所有函数调用。它只是老老实实地**压栈**——保存寄存器、设置返回地址、跳转到被调用者——等被调用者 `return` 之后, 调用者从断点继续执行, 就像从未离开过。不画 DAG, 不排并行, 只有一个严格守纪律的调用栈, 永远不会忘。

**pi-stack-todo 把这个模型搬到了你的 coding agent 里。**

| OS 子程序机制 | pi-stack-todo |
|---|---|
| **保护现场** (寄存器压栈) | `push {task: "...", parent: current}` — 父任务状态全部保留在栈帧下方 |
| **跳转** (PC 指向被调用者) | 栈顶自动成为当前焦点。父任务挂起等待。 |
| **栈帧** (局部变量、返回地址) | 每个任务自带 **checklist** (本地计划)、**notes** (备注)、以及指向父节点的链接 |
| **返回** (弹栈帧, 恢复 PC) | `done` 弹出当前任务, 父任务恢复执行。checklist 告诉你当初计划了什么。 |
| **异常展开** (unwind) | `drop` 放弃当前栈帧, 沿调用链回退 |
| **上下文切换** (保存/恢复) | 兼容上下文压缩插件——深栈可 compress, 返回时自动 decompress |

---

## 与 Anthropic Dynamic Workflows 的对比

| | Dynamic Workflows | pi-stack-todo |
|---|---|---|
| **策略** | 脚本先行。模型先生成编排代码(图灵完备 JS: while 循环、动态扇出), 然后确定性运行时并行执行。 | 涌现式调用栈。边做边发现复杂度, 发现才 push, 解决后 pop。没有提前写好的脚本。 |
| **适合场景** | 大规模、**可以提前分解**的任务——哪怕分解本身很复杂(Bun: 75 万行、三阶段、数百 agent 并行加双 reviewer)。 | 深度、**不可并行**、分解路径预先未知的任务。路径是在做的过程中逐步揭示的。 |
| **规划方式** | 通过生成 JS 代码前置规划。阶段、并行分支、交叉验证都在执行前定义好。 | 有机生长。子任务在做的时候才涌现。碰到复杂点才推栈。 |
| **并行能力** | 是, 为此而生。最多 16 并发, 单次 1000 agent。 | 否, 子程序模型。严格顺序, 一次一个焦点。 |
| **模型执行期角色** | 在睡觉。JS 运行时负责编排, 模型只在 agent() 调用点醒来干活。 | 始终在线。模型主动决定何时 push、pop、abandon——模型自己就是运行时。 |
| **可复用性** | 脚本存为 `/command`, 不同输入反复跑同一编排。 | 即兴。栈是实时会话产物, 不是可复用模板。 |
| **核心哲学** | 广度优先, 分而治之。 | 深度优先, 钻下去再上来。 |

> Dynamic Workflows 做**横向**扩展(并行扇出, 脚本编排)。pi-stack-todo 做**纵向**深挖(顺序深入, 涌现发现)。
>
> 两者互补, 不是竞争。知道怎么拆就用 DW, 不知道怎么拆就用 ST。

---

## 功能

- **LIFO 栈 + 硬深度限制 (6)** — 防止模型把栈当平铺 todo list 用
- **依赖树叠层** — 每个任务知道自己的父节点。树结构只读, 仅可通过 `fix` 纠错。
- **每任务内置 checklist** — 轻量本地计划, 不推入栈, 仅作备忘。子任务做完 pop 回来一看就知道当初计划了什么。
- **子程序语义强制** — 每个父节点在栈上最多只能有一个子节点。禁止兄弟泛滥。
- **会话持久化** — 状态跨重启保留, 且天然支持分支导航。
- **常驻状态面板** — 当前任务始终显示在编辑器上方。
- **8 条系统 prompt 指南** — 注入到 context 中, 教模型正确使用栈。

---

## 安装

```bash
pi install git:github.com/Fun10165/pi-stack-todo
```

项目本地安装：

```bash
pi install -l git:github.com/Fun10165/pi-stack-todo
```

---

## 使用

### Agent 工具: `stack_todo`

LLM 通过 `stack_todo` 操作栈:

| Op | 作用 |
|---|---|
| `push {task, parent?, plan?}` | 压入新任务。可选附带 checklist (`plan`)。 |
| `done` | 完成栈顶任务并弹出。父任务恢复。 |
| `drop` | 放弃栈顶任务并弹出。 |
| `check {target?, item}` | 勾选 / 取消 checklist 条目。 |
| `fix {target, content?, newParent?}` | 修正任务描述或重新挂载父节点。 |
| `note {target?, text}` | 追加备注。 |
| `list` | 只读查看当前状态。 |

### 用户命令: `/stack`

```
/stack                          # 交互式树视图 (j/k 滚动, Esc 关闭)
/stack push <task>              # 手动压入任务
/stack done                     # 完成当前任务
/stack drop                     # 放弃当前任务
/stack note [target] <text>     # 添加备注
/stack check [target] <item>    # 勾选 checklist
/stack fix <target> content <t> # 修正描述
/stack fix <target> parent <p>  # 重新挂载父节点
/stack help                     # 帮助
```

---

## 模型如何用它

模型被训练为**不提前规划**。平常没有栈的时候正常干活。只有当当前任务变得太复杂时才 push 子任务：

```
做 "重构认证模块"
  → 发现需要先抽离 token 校验器
  → push "抽离 token 校验器" 作为 "重构认证模块" 的子任务
  → 专注做校验器...
  → done — 弹回 "重构认证模块"
  → 继续重构 (checklist 提醒你还有哪些没做完)
  → done — 栈空, 全部完成
```

**核心规则**: 不在 push 1.1 的同时 push 1.2。1.1 必须先做完 (done), 弹回 1, 然后才能 push 1.2。这就是子程序调用——不是 todo list。

---

## 上下文压缩 (未来 / 增强)

对于极深的栈, 可以通过外部压缩插件来管理上下文。pi-stack-todo 的树结构专门为此设计：

- 压缩插件读取 task tree, 将非当前分支压缩
- 模型通过 `done` 回到某个节点时, 压缩插件自动解压
- 模型以完整上下文恢复——永不遗忘, 始终高效

这部分**刻意不做在** pi-stack-todo 里。它是独立关注点, 通过消费树数据结构来接入。

---

## 文件结构

```
extensions/stack-todo/
├── index.ts          # 入口: 注册工具 + 命令 + 常驻面板 + 生命周期
├── types.ts          # TaskNode、StackState、Schema 类型定义
├── stack-engine.ts   # 纯函数核心: applyOps、模糊匹配、环形依赖检测
├── renderer.ts       # TUI 自定义渲染 (工具调用/结果)
└── tui-view.ts       # /stack 交互式全屏组件
```

---

## License

MIT
