---
name: skill-conductor
description: 评价、检查、评审一个已有 AI Agent Skill 的合格性与文风，或指导从零开发、创建新 skill 时使用。当用户说「评审这个 skill」「这个 skill 能不能发布」「skill 写得好不好」「帮我做一个 skill」「从零开发一个技能」时使用。
license: MIT
compatibility: Node.js >= 18
metadata:
  portability: portable
  contract-version: "2.6"
  owner: skill-governance-suite
allowed-tools: Bash(node:*) Read Write Skill
---

# 技能总控台（skill-conductor）

单一对外 skill 包。用户说一句话，Agent 按本文执行；执行细节（JSON 字段、用户报告模板、deferred 三阶段、退出码处置）见 `references/agent-runbook.md`。

## 0. 运行约定

- `<SKILL_ROOT>` = 本 `SKILL.md` 所在目录。`allowed-tools` 只允许 `node` 命令，因此命令统一用绝对路径执行：`node "<SKILL_ROOT>/scripts/conductor.mjs" ...`。若宿主允许 `cd`，也可以先进入该目录再执行。
- 目标只有两种：单技能目录（含 `SKILL.md`）或多技能仓库（含 `skills/`）。
- 单技能只传目录；仓库传根目录 + `--scan skills`，可加 `--skill <name>`。单技能下脚本会忽略 `--scan` / `--skill`。
- 用户只说“这个 skill”而未给路径时，先问路径。

## 1. 何时使用，何时不使用

使用：

- 评价、检查、评审一个已有 skill
- 判断 skill 能不能发布、多成熟
- 评审文风、隐含缺陷、改写建议
- 从零创建、开发、指导一个新 skill

不使用：

- 只问 skill 是什么、frontmatter 怎么写：直接回答
- 要求直接修改代码：直接改，不进入治理流程
- 安装或卸载 skill：走安装流程

## 2. 意图与命令

| 用户原话 | 意图 | 动作 |
|---|---|---|
| 「评审这个 skill」「检查一下」「全面看看」「能发布吗」 | `evaluate`（默认） | 硬轨 + 软轨 + 文风 |
| 「只做合格评定」「只看能不能发布」「不用看文风」 | `assess` | 硬轨 + 软轨 |
| 「只做文风评审」「只看写得好不好」「不用管合规」 | `style` | 文风 |
| 「创建 / 开发 / 从零做 / 脚手架 / 指导我做一个」 | `develop` | 导师；完成时自动终检 |

意图模糊时只问一次：

> 你是想评价已有 skill、只做合格评定、只做文风评审，还是开发新 skill？

一句话含多个信号时，按此顺序判定：

1. 「只做……」是显式单选信号，优先级最高。
2. 「创建 / 开发」次之（开发流程包含最终评价）。
3. 「评审 / 检查 / 全面看看」再次之。
4. 只有「写得好 / 文风」时为 `style`。

```bash
# 单技能
node "<SKILL_ROOT>/scripts/conductor.mjs" "<skill-dir>" --intent evaluate --json "<work>/report.json"
# 多技能仓库
node "<SKILL_ROOT>/scripts/conductor.mjs" "<repo-root>" --scan skills --skill "<name>" --intent evaluate --json "<work>/report.json"
```

需要 deferred 时，先设置 `LLM_MODE=deferred`（PowerShell 用 `$env:LLM_MODE="deferred"`）。

只做评定 / 只做文风 / 开发：把 `--intent` 换成 `assess` / `style` / `develop`；开发终检加 `--final-check`。

## 3. 执行契约

执行前读取 `references/agent-runbook.md`，按其中的 JSON 字段契约、用户报告模板与退出码处置执行；仅在没有 `LLM_API_KEY`、网络不可达或 direct 调用失败时，再读 `references/deferred.md`。

关键约束：

- 权威结论只看 `exitCode` 与 `modules.hard.exitCode`。
- `modules.skipped` 非空时，不得声称软轨或文风通过。
- 最终回复只按 `references/agent-runbook.md` 第 6、7 节输出用户报告：不出现内部模块名、检查项编号、退出码、JSON 字段或脚本路径。
- 未执行的环节整节删除，不写「已跳过」「pending」；文风未产出时不得出现任何文风评价。
- 内容质量只在软轨产出内容条目时出现；未产出时不得评价内容深度、原创性、自洽性。
- 平台适配按目标声明的平台判定：未声明 Codex/OpenAI 时，不把接口文件缺失算阻断。
- 每条问题带「证据 + 置信度」；报告不写绝对路径。
- 发布结论按 `references/agent-runbook.md` 第 5 节判定；工具自检异常时写「无法判定」，不得写成技能不合格。
- 退出码只取硬轨；文风师与导师不影响退出码。
- 问题表述按 `references/assessor/advice-rules.md` 生成，不凭印象发挥。

## 4. 降级：Node 与 Bash

| 条件 | 行为 |
|---|---|
| Node 不存在或 < 18 | 停止；提示安装 Node.js >= 18；不提供其他语言替代；不产出硬轨结论 |
| 宿主 Agent 无 Bash 权限 | 退化为「只读文档」模式：不运行脚本、不产出硬轨结论，只说明当前无法检查及恢复条件 |

Bash 不可用时，可以阅读 `README.md` 与 `references/assessor/spec.md` 给出人工建议，但必须明确「未检查、未通过、未评分」，不得伪装成已检查或通过。

## Inputs

| 输入 | 必填 | 缺省 | 非法值 |
|---|---|---|---|
| `<skill-dir>` 或 `<repo-root>` | 是 | 无 | 路径不存在 → 退出码 2 |
| `--scan <dir>` | 否 | `skills` | 目录不存在且根无 `SKILL.md` → 退出码 2 |
| `--skill <name>` | 否 | 全部 | 未匹配 → 空结果并提示 |
| `--intent <name>` | 否 | `evaluate` | 非四个意图 → 退出码 2 |
| `--json <path>` | 否 | 只打屏 | 父目录自动创建 |
| `--workdir <dir>`（仅 deferred） | 否 | 系统临时目录 | 不可写 → 退出码 2 |

## Outputs

- 用户评审报告：结论、评分、阻断问题、重要问题、建议改进、内容质量（仅当实际评审）、做得好的地方、文风（仅当实际评审）、下一步。
- `--json` 编排报告（内部字段见 `references/agent-runbook.md`）。
- deferred 模式写出 prompts 与 results。

## Failure modes

| 失败 | 行为 |
|---|---|
| 路径 / 参数错误 | 退出码 2；停止并修正，必要时向用户确认 |
| 意图非法 | 退出码 2；列出四个合法值 |
| 某个硬轨脚本崩溃 | 记录 exitCode 与 stderr，继续执行其余硬轨脚本；汇总非 0 时跳过下游 |
| 硬轨汇总非 0 | 跳过软轨与文风；最终报告只写已确认的问题，不解释内部跳过原因 |
| LLM 无凭证或不可达 | 改用 deferred 三阶段；不得伪造判定 |
| verdict / critique 非 JSON | 该次判定作废并报错；不降级为 pass |
| 工具链自检失败 | 退出码 3；停止并说明标准自身有问题；不修改目标 |
| Node 或 Bash 不可用 | 按第 4 节降级；不产出硬轨结论 |

## Side effects

- 读取：目标 skill 目录、`references/`、`evals/fixtures/`。
- 写入：`--json`、deferred 的 prompts/results、`<repo-root>/.skill-mentor/`。
- 不修改目标 skill；写出物均可删除，属可逆操作。

## Dependencies

- Node.js >= 18，零第三方依赖。
- 权限：读取目标目录；写入 `--json`、临时目录、`.skill-mentor/`。
- 网络：direct 模式需要 `LLM_API_URL`；deferred 不需要。
- 数据边界：direct 模式会把目标 skill 文本发送到 `LLM_API_URL`；Prompt 会将其包进 `<untrusted_skill_content>` 并按数据而非指令处理。
- 环境变量：`LLM_API_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_MODE`、`SKILL_LLM_WORKDIR`。

## Verification

```bash
node "<SKILL_ROOT>/scripts/assessor/validate.mjs" --self-check-only
node "<SKILL_ROOT>/scripts/assessor/score.mjs" --self-check-only
node "<SKILL_ROOT>/scripts/assessor/llm-judge.mjs" --self-check
node "<SKILL_ROOT>/scripts/stylist/wq-judge.mjs" --self-check
node "<SKILL_ROOT>/scripts/mentor/blueprint.mjs" --self-check
node "<SKILL_ROOT>/scripts/assessor/validate.mjs" "<SKILL_ROOT>" --level 3
node "<SKILL_ROOT>/evals/run.mjs"
```

`evals/run.mjs` 覆盖 10 组用例：第 9 组验证「仅凭 SKILL.md + references 完成 evaluate」并检查路径引用；第 10 组验证平台适配与安全检查。

## 示例

以下是内部产物示例，不直接展示给用户；最终报告按 `references/agent-runbook.md` 第 6 节输出。

```bash
LLM_MODE=deferred node "<SKILL_ROOT>/scripts/conductor.mjs" "<SKILL_ROOT>" --intent evaluate --json "<work>/report.json"
# 硬轨：validate=0 score=0 audit=0 sensitivity=0 → 汇总 0
# 软轨：pending 19（14 工程 + 5 内容，等待 Agent 执行 prompt）
# 文风：pending 30
# 退出码：0
```

## 参考文件

| 文件 | 何时读 | 谁读 |
|---|---|---|
| `references/agent-runbook.md` | 每次执行前必读（核心） | Agent |
| `references/deferred.md` | 无 LLM 凭证、网络不可达或 direct 调用失败时 | Agent |
| `references/assessor/exit-codes.md` | 需要向用户解释退出码时 | Agent |
| `references/assessor/advice-rules.md` | 生成改进建议时 | Agent |
| `references/assessor/spec.md`、`quality-model.md`、`llm-entries.md` | 需要复核判定口径时 | 人 / 脚本 |
| `references/stylist/`、`references/mentor/` | 需要复核文风与流程时 | 人 / 脚本 |
| `README.md` | 需要安装、CLI 细节或面向用户的说明时 | 人 |
