# skill-conductor：Skill 治理包

> 一个对外 skill 包，内部由评定官、文风师、导师三个模块组成。日常使用时，Agent 读取根 `SKILL.md` 后自动执行；也保留命令行与 CI 入口。退出码只反映评定官硬轨。

本文件是**唯一面向用户阅读的文档**：安装、Agent 用法、命令行参考、输出解读、CI 与已知限制都写在这里。判定规则本身在 `references/` 下，供脚本与需要复核的人使用。

---

## 0. 两种用法

| 用法 | 适合谁 | 入口 |
|---|---|---|
| **A. 装进 Agent（推荐）** | 日常评审、让 Agent 自动跑 | 把 `skill-conductor/` 放进 Agent 的 skills 目录，对 Agent 说一句话 |
| **B. 命令行 / CI** | 开发者调试、流水线门禁 | 在包根目录直接运行 `node scripts/conductor.mjs` |

**用法 A 示例**：把目录放进 skills 目录并重载 Agent 后，直接说：

```text
用 skill-conductor 评审 ./my-skill
用 skill-conductor 只做文风评审 ./my-skill
用 skill-conductor 帮我从零做一个发布说明 skill
```

Agent 会读取根 `SKILL.md` 并自动执行，不需要你记命令。详见第 2 节。

**用法 B 示例**：

```bash
cd skill-conductor
node scripts/conductor.mjs . --intent evaluate
```

## 1. 这是什么

`skill-conductor` 把「一个 AI Agent Skill 好不好、能不能发布、怎么写得更清楚、从零怎么开发」收进一个入口：

| 主入口 | 用途 | 内部模块 |
|---|---|---|
| 入口 1 | 评价已有 skill | 评定官硬轨 + 评定官软轨 + 文风师 |
| 入口 2 | 指导开发新 skill | 导师；完成后自动走入口 1 终检 |

两个单选项：

| 用户显式说 | 只执行 |
|---|---|
| 只做合格评定 | 评定官（硬轨 + 软轨） |
| 只做文风评审 | 文风师 |

三个模块不独立发布，没有各自的 `SKILL.md`、`references/`、`evals/`。

## 2. 安装到 Agent（推荐）

### 2.1 步骤

1. 确认 Node.js >= 18（Agent 执行脚本需要）。
2. 把整个 `skill-conductor/` 目录放进宿主 Agent 的 skills 目录（项目级或用户级均可，路径取决于宿主）。
3. 确认目录根有 `SKILL.md`，且 `scripts/`、`references/`、`evals/` 未被拆散。
4. 重新加载或重启 Agent，使其发现 `skill-conductor`。

### 2.2 对 Agent 说什么

| 你想做什么 | 直接说 |
|---|---|
| 评价一个 skill | 「用 skill-conductor 评审 `./my-skill`」 |
| 只看能不能发布 | 「用 skill-conductor 只做合格评定 `./my-skill`」 |
| 只看写得好不好 | 「用 skill-conductor 只做文风评审 `./my-skill`」 |
| 从零开发 | 「用 skill-conductor 帮我从零做一个发布说明 skill」 |
| 多技能仓库里挑一个 | 「用 skill-conductor 评审这个仓库里的 `<name>`」 |

### 2.3 Agent 会做什么

1. 读 `SKILL.md`，判断意图（evaluate / assess / style / develop）。
2. 确认目标是单技能目录还是多技能仓库。
3. 运行 `scripts/conductor.mjs`，先做自动核对；通过后再做语义判断与文风评审。
4. 读取 `--json` 报告，先判定发布结论与成熟度，再按用户报告结构输出。
5. 报告结构：结论、评分、阻断问题、重要问题、建议改进、内容质量（仅当实际评审）、做得好的地方、文风（仅当实际评审）、下一步。
6. 报告只写用户能理解的问题、影响与改法；不出现内部模块名、检查项编号、退出码或 JSON 字段；未执行的环节不写进报告，也不写「已跳过」。
7. 平台适配按目标声明的平台判定；未声明 Codex/OpenAI 时不把接口文件缺失算阻断。

### 2.4 前提与降级

- 没有 `LLM_API_KEY`：Agent 会使用 deferred 三阶段，先生成 prompt；如果宿主 Agent 无法执行 prompt，本次只输出已经确认的硬性结论，不把未完成的部分写进报告。
- Node 不可用：Agent 会停止并提示安装 Node.js >= 18，不会伪造核对结论。
- 宿主没有 Bash 权限：退化为「只读文档」模式，只给人工建议，并明确「未检查、未通过、未评分」。

## 3. 5 分钟跑通

### 3.1 Agent 版

```text
你：用 skill-conductor 评审 ./my-skill
Agent：评审完成：暂不可发布（成熟度 1/5，初稿）。
       平台适配：未声明 Codex/OpenAI，不要求接口文件。
       阻断问题 1 项：缺少输入、输出和边界说明（SKILL.md 正文）。
       重要问题 2 项：无法验证和回归；没有可照着做的示例。
       做得好的地方：触发描述清楚，任务路由完整。
       下一步：先补五段契约，再补 1 个示例与 3 个评测用例。
```

如果 Agent 回答“找不到 `scripts/conductor.mjs`”，说明它没有按 `<SKILL_ROOT>` 的绝对路径执行；`SKILL.md` 第 0 节给出了 `node "<SKILL_ROOT>/scripts/conductor.mjs"` 的写法。

### 3.2 CLI 版

在 `skill-conductor/` 根目录执行：

```bash
node scripts/assessor/validate.mjs . --level 3
```

期望输出（节选）：

```text
[SELF-001 PASS] 实现与 JSON Schema 的字段白名单一致
...
合计 26 项检查 · MUST 20（失败 0）· 不适用 3
```

再跑质量评分：

```bash
node scripts/assessor/score.mjs . --target L3
```

期望输出（节选）：

```text
skill-conductor  5·  5·  5·  5*  5·  5*   L5   5.00
[PASS] 达到目标 L3（最低 L5）
```

这是本包的自评结果，用来说明命令可运行；被评技能的等级可能不同。

### 3.3 评价任意 skill

```bash
# 单技能目录
LLM_MODE=deferred node scripts/conductor.mjs "<skill-dir>" --intent evaluate --json out/report.json

# 多技能仓库
node scripts/conductor.mjs "<repo-root>" --scan skills --skill "<name>" --intent evaluate --json out/report.json

# 只做合格评定 / 只做文风评审
node scripts/conductor.mjs "<skill-dir>" --intent assess
node scripts/conductor.mjs "<skill-dir>" --intent style

# 指导开发
node scripts/conductor.mjs "<skill-dir>" --intent develop
node scripts/conductor.mjs "<skill-dir>" --intent develop --final-check
```

PowerShell 设置环境变量用 `$env:LLM_MODE="deferred"`。

## 4. 命令行参考（开发者 / CI）

以下命令均在包根目录 `skill-conductor/` 执行。

### 4.1 统一入口 `scripts/conductor.mjs`

```bash
node scripts/conductor.mjs <repo-root> [--scan skills] [--skill <name>] \
  [--intent evaluate|develop|assess|style] [--json <out>] [--final-check]
```

| 意图 | 执行模块 | 退出码 |
|---|---|---|
| `evaluate`（默认） | 硬轨 + 软轨 + 文风 | 硬轨汇总 |
| `assess` | 硬轨 + 软轨 | 硬轨汇总 |
| `style` | 文风 | 0 |
| `develop` | 导师；完成时自动终检 | 0 或终检硬轨 |

说明：`conductor` 的硬轨固定用 `validate --level 3` 与 `score`（不设目标级别）。需要 L4/L5 的合规门禁时，直接调用 `validate --level 5` 或 `score --target L5`。

编排纪律：

1. 硬轨四个脚本全部执行，内部不短路。
2. 硬轨汇总为 0 → 执行软轨与文风；两者之间不短路。
3. 硬轨汇总非 0 → 跳过软轨与文风，并在 `modules.skipped.reason` 写明原因。
4. 退出码只取硬轨汇总。

### 4.2 硬轨脚本（评定官）

```bash
node scripts/assessor/validate.mjs <repo-root|skill-dir> [--scan skills] [--level 1-5] [--json out]
node scripts/assessor/score.mjs     <repo-root|skill-dir> [--scan skills] [--target L1-L5] [--json out]
node scripts/assessor/audit.mjs     <repo-root> [--json out]
node scripts/assessor/sensitivity.mjs [--skill-dir <path>] [--json out]
```

- `validate`：SPEC 规范符合性，按 `--level` 渐进检查。
- `score`：QM 质量模型评分，输出维度等级、瓶颈与加权分。
- `audit`：仓库一致性。分桶仓库走 C-05~C-12；扁平或单技能仓库会把这些检查显式标记为 `SKIP`。
- `sensitivity`：9 个缺陷注入，验证检查器有区分力。

### 4.3 软轨 `scripts/assessor/llm-judge.mjs`

```bash
# direct：需要 LLM_API_URL / LLM_API_KEY / LLM_MODEL
node scripts/assessor/llm-judge.mjs <repo-root> [--scan skills] [--skill name] --json out

# deferred 三阶段（三个阶段必须用同一个 --workdir）
node scripts/assessor/llm-judge.mjs <repo-root> --prepare --workdir <dir> --json out
# Agent 执行 prompts/ 并把结果写入 results/
node scripts/assessor/llm-judge.mjs <repo-root> --prepare-critique --workdir <dir> --json out
node scripts/assessor/llm-judge.mjs <repo-root> --collect --workdir <dir> --json out
```

deferred 的完整步骤与结果合并见 `references/deferred.md`。

置信度：复核同意且无薄弱点 = `high`（1.0）；同意但有薄弱点 = `medium`（0.7）；不同意 = `low`（0，不参与综合分）。

软轨同时运行 14 条工程条目与 5 条内容质量条目（CQ-01~05）。内容条目只进入报告的「内容质量」，不参与六维评分；工程条目只进入工程问题。

### 4.4 文风师

```bash
node scripts/stylist/analyze.mjs <skill-dir|repo-root> [--scan skills] [--skill name] --json out
node scripts/stylist/wq-judge.mjs <skill-dir|repo-root> [--scan skills] [--skill name] --json out

# deferred 三阶段同上：--prepare -> --prepare-critique -> --collect
```

`analyze` 只做确定性粗筛；`wq-judge` 对 30 条检查做 verdict + critique。文风师不设退出码。

### 4.5 导师

```bash
node scripts/mentor/state.mjs init <repo-root> <skill-name>
node scripts/mentor/state.mjs get <repo-root> <skill-name>
node scripts/mentor/state.mjs advance <repo-root> <skill-name> <STEP-01..STEP-14>
node scripts/mentor/state.mjs checkpoint <repo-root> <skill-name> <CP-1..CP-4> --result pass|fail --evidence "..."
node scripts/mentor/blueprint.mjs <repo-root> [--scan skills] [--skill name] [--step STEP-XX] [--checkpoint CP-X] --json out
```

状态文件：`<repo-root>/.skill-mentor/<skill-name>.json`。

### 4.6 自检与回归

```bash
node scripts/assessor/validate.mjs --self-check-only
node scripts/assessor/score.mjs --self-check-only
node scripts/assessor/llm-judge.mjs --self-check
node scripts/stylist/wq-judge.mjs --self-check
node scripts/mentor/blueprint.mjs --self-check
node evals/run.mjs
node evals/llm-two-pass.mjs
```

## 5. 输出解读

### 5.1 退出码

| 码 | 含义 | Agent 动作 |
|---|---|---|
| `0` | 硬轨通过 | 生成完整报告 |
| `1` | 硬轨存在 MUST 失败 / 未达目标 | 报告失败项与建议；不自动重试、不改目标 |
| `2` | 参数或路径错误 | 停止；检查路径与参数；必要时向用户确认 |
| `3` | 工具链自检失败（标准自身有问题） | 停止；说明标准自检失败；不修改目标技能 |

软轨、文风师、导师不影响退出码。完整的逐脚本退出码语义见 `references/assessor/exit-codes.md`。

### 5.2 硬轨结果

`validate` 输出 `[PASS] / [FAIL] / [N/A]`；`score` 输出六维等级矩阵与瓶颈；`audit` 输出 `[PASS] / [FAIL] / [SKIP]`，`SKIP` 表示结构不适用且已显式说明。

### 5.3 软轨结果（参考信号）

`llm-judge` 输出每个条目的 `result`、`confidence`、`score`、`reason`、`evidence`、`weaknesses` 与 `group`（`quality` / `content`）。`low` 置信度保留在 JSON 中供人工复核，不写入用户报告，也不参与综合评分。工程条目与内容质量条目分开统计；内容质量只在有结果时进入报告。软轨结果只作参考信号，不进入退出码。

### 5.4 文风结果（参考信号）

`wq-judge` 输出 30 条检查的通过、失败、低置信度、`needsFix`、`keepAsIs` 与文风分。修改建议以「原文 → 改文」给出。文风结果同样只作参考信号。

### 5.5 编排报告

`conductor --json` 的关键字段：

```json
{
  "intent": "evaluate",
  "exitCode": 0,
  "modules": {
    "hard": { "validate": {"exitCode": 0}, "score": {"exitCode": 0}, "audit": {"exitCode": 0, "data": { "platform": [ { "rel": ".", "codexDeclared": true, "adapter": true } ] } }, "sensitivity": {"exitCode": 0}, "exitCode": 0 },
    "soft": { "data": { "summary": { "quality_entries": 14, "content_entries": 5, "high_confidence": 8, "content_high": 3, "pending": 0 } } },
    "stylist": { "results": [ { "skill": "foo", "data": { "summary": { "pass": 26, "fail": 2 }, "needsFix": [], "keepAsIs": [] } } ] },
    "skipped": null
  }
}
```

硬轨失败时 `soft` 与 `stylist` 为 `null`，并出现：

```json
"skipped": { "soft": true, "stylist": true, "reason": "硬轨汇总退出码 1（非 0），按编排规则跳过软轨与文风评审" }
```

权威结论看顶层 `exitCode` 与 `modules.hard.exitCode`；`modules.skipped` 非空时不得声称软轨或文风通过。逐字段契约与用户报告模板见 `references/agent-runbook.md`。

## 6. 目录结构与文档分工

```text
skill-conductor/
├── SKILL.md                     ← 唯一对外 skill，Agent 的入口与执行契约
├── README.md                    ← 本文件，唯一面向用户的文档
├── LICENSE                      ← MIT
├── CONTRIBUTING.md              ← 贡献与本地测试约定
├── CHANGELOG.md                 ← 版本变更记录
├── agents/openai.yaml           ← Codex 适配层
├── references/
│   ├── agent-runbook.md         Agent 每次执行必读的核心：JSON 契约、判断规则、用户报告模板
│   ├── deferred.md              仅在无 LLM 凭证或 direct 失败时读：三阶段命令与结果合并
│   ├── assessor/                SPEC、QM、软轨锚点、建议规则、退出码、Schema、audit-config
│   ├── stylist/                 30 条检查、锚点、Prompt、反模式
│   └── mentor/                  14 步蓝图、4 个检查点、5 个模板
├── scripts/
│   ├── conductor.mjs            编排层（四意图、不短路）
│   ├── lib/                     共享解析、三态结果、两段式 LLM 客户端
│   ├── assessor/                validate / score / audit / sensitivity / quality-model / llm-judge
│   ├── stylist/                 analyze / wq-judge
│   └── mentor/                  state / blueprint
├── evals/
│   ├── cases.yaml
│   ├── run.mjs                  10 组回归
│   ├── llm-two-pass.mjs         两段式 LLM 自测
│   └── fixtures/                release-notes 与 6 个文风 fixture
└── .github/workflows/skill-governance.yml   # 单独分发时使用
```

本仓库把该工作流放在仓库根 `.github/workflows/skill-conductor.yml`，并把工作目录指向本技能；单独分发本技能时，可把工作流放回技能目录并去掉工作目录设置。

文档分工：用户从本文件开始；Agent 从 `SKILL.md` 开始，每次执行读 `references/agent-runbook.md`，只有进入 deferred 时才追加 `references/deferred.md`；`references/assessor`、`references/stylist`、`references/mentor` 是判定规则与锚点，供脚本与人工复核使用，日常评审不必通读。意图优先级已并入 `SKILL.md` 第 2 节，不再单独维护路由文件。

> `agents/openai.yaml` 是 Codex / OpenAI 生态的适配层：声明技能的展示名、默认提示与隐式调用策略。不声明支持 Codex 时可以省略；本包保留它以满足 `audit` 的 C-13/C-14 与 `V-031` 的一致性要求。

## 7. 判定分层

### 7.1 硬轨

确定性脚本，权重 1.0，决定机器等级、退出码与 CI 门禁：

- `validate.mjs`：SPEC 规范符合性
- `score.mjs`：QM 质量模型评分
- `audit.mjs`：仓库一致性
- `sensitivity.mjs`：9 个缺陷注入

### 7.2 软轨（verdict + critique，参考信号）

软轨只作参考信号，不进入退出码，也不改变硬轨结论。不使用「同一 prompt 采样多次」的伪投票，改为两段式：

```text
第 1 步 verdict  ：按锚点给出 pass/fail/na + score
第 2 步 critique ：输入包含第 1 步判定，任务是审查并指出薄弱点或修正判定
```

| 复核结果 | 置信度 | 权重 |
|---|---|---|
| 同意且无薄弱点 | `high` | 1.0 |
| 同意但有薄弱点 | `medium` | 0.7 |
| 不同意 | `low` | 0（不参与综合评分） |

两个 Prompt 必须不同，复核 Prompt 必须包含 `{verdict_json}`。评定官 19 条（14 条工程 + 5 条内容质量）与文风师 30 条都有各自的复核 Prompt；`SELF-005` 会检查：

- 每条都有 verdict 与复核 Prompt；
- 复核 Prompt 含 `{verdict_json}`；
- 两个 Prompt 不完全相同。

被审 skill 的原文会被包进 `<untrusted_skill_content>` 数据块，Prompt 明确要求模型把它当作评审数据而不是指令，降低被目标技能文本诱导的风险。

### 7.3 综合分

```text
硬轨分 = 机器等级 / 5.0
软轨分 = Σ(工程条目得分 × 置信度权重) / Σ(最大可能得分)
综合分 = 硬轨分 × 0.7 + 软轨分 × 0.3
综合等级 = floor(综合分 × 5)      # 仅报告，不参与退出码
```

内容质量分单独计算，不并入综合分；综合分只取工程软轨。

## 8. CI

本仓库的 CI 在仓库根 `.github/workflows/skill-conductor.yml`，包含 5 个 job：

| job | 作用 | 阻塞 |
|---|---|---|
| `self-check` | SELF-001~005 | 是 |
| `regression` | `evals/run.mjs` | 是 |
| `spec-compliance` | 根 SKILL.md 规范符合性 | 是 |
| `quality-score` | 质量评分门禁 | 是 |
| `llm-judge` | 软轨报告 | 否 |

未配置 `LLM_API_KEY` 时软轨跳过，不阻塞合并。`self-check` 同时校验 `references/assessor/checks.yaml` 与质量模型源码同步。根工作流已把 `working-directory` 设为 `skills/skill-conductor`；若把本技能移到其他路径，同步修改该设置即可。

## 9. 仓库一致性配置

`scripts/assessor/audit.mjs` 默认按样本仓库的分桶模型工作；约定写在 `references/assessor/audit-config.yaml`：

```yaml
promoted: [engineering, productivity]
non_promoted: [misc, in-progress, deprecated]
doc_sections: [What it does, When to reach for it, Common questions, "It's working if"]
skills_dir: skills
docs_dir: docs
plugin_file: .claude-plugin/plugin.json
package_file: package.json
```

如果你的仓库不是 `skills/<bucket>/<skill>` 结构，`audit.mjs` 会自动识别为 `flat` 或 `single`，并把 C-05~C-12、C-15 标记为 `SKIP` 并说明原因，不会静默当作通过。

`audit.mjs` 的 C-13/C-14 按技能是否声明 Codex/OpenAI 判定：未声明时不强制 `agents/openai.yaml`；声明但缺失才算阻断。`audit` JSON 的 `platform` 字段给出每个技能的 `codexDeclared` 与 `adapter` 状态。

## 10. 已知限制

1. **软轨质量尚未在真实模型上系统验证**：direct / deferred 链路、high / medium / low 三档与 5 条内容质量条目已用本地 mock 验证；真实模型的准确率与 kappa 尚未测量。建议把软轨当作参考信号，需要量化时用同一模型、同一输入间隔运行两次 `llm-judge.mjs`，逐条比较 `result` 并计算 Cohen's kappa。
2. **`audit.mjs` 只对分桶仓库完整生效**：默认配置来自样本仓库；扁平或单技能仓库会显式跳过 C-05~C-12、C-15；未提供 `agents/openai.yaml` 时 C-14 也跳过。
3. **文风术语粗筛对中英混排会误报**：同一概念的中英文写法会被标记为「同概念多写法」，需由 critique 复核。
4. **`develop` 的交互式引导由 `SKILL.md` 承担**：脚本只做状态与产物检查，不自动完成 14 步。
5. **硬轨失败时不看文风**：刻意设计，避免在不可发布的 skill 上产生无关建议；需要时用 `--intent style`。
6. **软轨不阻塞**：低置信度不写入用户报告，也不影响退出码，也不影响硬轨结论。
7. **平台适配按文本声明判定**：正文或 `compatibility` 提到 Codex/OpenAI 才要求 `agents/openai.yaml`；未声明不等于已适配，只表示当前不强制。
8. **内容质量与工程软轨同一次运行**：硬轨失败时同样跳过；未运行时报告不评价内容质量，只写可核对的结构事实。
9. **版权与隐私检查只做声明层**：`V-075` 只检测大文件与许可声明是否存在，不做版权归属判断；`V-076` 只扫描文本中的本机路径模式，占位符路径豁免。授权范围仍需人工确认。

## 11. 开发与贡献

- 版本变更：见 [CHANGELOG.md](CHANGELOG.md)。
- 贡献流程与本地测试：见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 判定规则：见 `references/assessor/spec.md`、`references/assessor/quality-model.md` 与 `references/stylist/`。
- 详细改造报告：不随技能分发；若从源仓库获取，见上一级目录的 `REFACTOR_REPORT_0X_*.md`。

## 12. License

本项目采用 [MIT License](LICENSE)。选择理由：实现以 Node 内置模块为主、体量小，MIT 的约束最少、与其他开源工具组合成本最低；同时与 `SKILL.md` 的 `license: MIT` 保持一致。
