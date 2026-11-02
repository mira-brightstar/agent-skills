# Agent 运行手册（核心）

> 每次执行先读本文件；只有进入 deferred 模式时，才追加读取 `references/deferred.md`。

## 1. 读取策略

| 情况 | 读什么 |
|---|---|
| 每次执行 | 本文件：命令、JSON 契约、判断规则、用户报告模板 |
| 没有 `LLM_API_KEY`、网络不可达、或 direct 退出码 2 | 追加 `references/deferred.md` |
| Node 或 Bash 不可用 | 按 `SKILL.md` 第 4 节降级，本文件不重复 |
| 需要解释退出码来源 | `references/assessor/exit-codes.md` |

## 2. 产物与工作目录

每次执行固定一个 `<work>` 目录：

| 产物 | 路径 | 说明 |
|---|---|---|
| 编排报告 | `<work>/report.json` | `--json` 输出，内部结论来源 |
| 软轨 / 文风 prompts 与 results | `<work>/llm/`、`<work>/stylist/` | deferred 三阶段共用同一个 `--workdir` |
| 导师状态 | `<repo-root>/.skill-mentor/<name>.json` | 仅 `develop` 写入 |

目标形态与传参规则见 `SKILL.md` 第 0 节。

## 3. 命令

```bash
# 单技能：把 evaluate 换成 assess / style / develop 即可复用
node "<SKILL_ROOT>/scripts/conductor.mjs" "<skill-dir>" --intent evaluate --json "<work>/report.json"

# 多技能仓库
node "<SKILL_ROOT>/scripts/conductor.mjs" "<repo-root>" --scan skills --skill "<name>" --intent evaluate --json "<work>/report.json"
```

direct 模式先设置 `LLM_API_URL`、`LLM_API_KEY`、`LLM_MODEL`；不要输出或记录真实 key。PowerShell 设置 `LLM_MODE` 用 `$env:LLM_MODE="deferred"`。

## 4. JSON 契约（内部）

权威结论只看 `exitCode` 与 `modules.hard.exitCode`，两者应始终相等。

| 字段 | 含义 |
|---|---|
| `modules.hard.{validate,score,audit,sensitivity}.exitCode` | 四个硬轨子结论 |
| `modules.hard.exitCode` | 硬轨汇总 |
| `modules.skipped` | 硬轨失败时的 `{soft, stylist, reason}` |
| `modules.hard.audit.data.platform` | 每个技能是否声明 Codex/OpenAI、是否提供接口文件 |
| `modules.soft.data.summary` | 工程/内容条目数量、high/medium/low/pending、两项分数 |
| `modules.soft.data.skills[].entries` | 逐条判定；`group` 为 `quality` 或 `content` |
| `modules.stylist.results[].data` | 文风 summary、needsFix、keepAsIs |
| `modules.blueprint.data.reports[]` / `modules.finalCheck.exitCode` | 导师进度与终检 |

硬轨通过的精简示例：

```json
{
  "exitCode": 0,
  "modules": {
    "hard": { "validate": {"exitCode": 0}, "score": {"exitCode": 0}, "audit": {"exitCode": 0}, "sensitivity": {"exitCode": 0}, "exitCode": 0 },
    "soft": { "data": { "summary": { "quality_entries": 14, "content_entries": 5, "high_confidence": 8, "content_high": 3, "pending": 0 } } },
    "stylist": { "results": [ { "data": { "summary": { "pass": 26, "fail": 2 }, "needsFix": [], "keepAsIs": [] } } ] },
    "skipped": null
  }
}
```

硬轨失败时 `soft` 与 `stylist` 为 `null`，`modules.skipped` 为 `{soft:true, stylist:true, reason:"..."}`。

解析规则：

1. 先看 `modules.skipped`。非空时不得声称软轨或文风“通过/失败”，也不得评价内容质量。
2. 再看 `modules.hard` 的四个子退出码，定位失败脚本。
3. 硬轨通过后，才读取 `modules.soft` 与 `modules.stylist`。
4. `low` 置信度不写入用户报告。
5. `score` 的 `entries[].pass` 只有为 `false` 才是缺陷；`null` 表示未由机器判定，不得写成失败或通过。
6. `soft.entries[].group=content` 只用于「内容质量」章节，不并入工程问题；没有内容结果时整节删除。

## 5. 判断规则（内部，不写进用户报告）

1. **发布结论只看阻断问题**：`validate` 或 `audit` 存在 MUST 失败 → 暂不可发布；否则可以发布。`score` 的等级只决定成熟度，不改变发布结论。
2. **工具异常与技能不合格分开**：`validate` / `score` / `audit` 任一为 3 → 「无法判定（评审工具异常）」；`sensitivity` 为 1/3 且前三者全为 0 → 「无法判定（评审标准自检未通过）」，不要写成技能不合格；任一为 2 → 停止，不出报告。已有技能阻断且 `sensitivity` 为 1/3 时，仍写「暂不可发布」，并在总评补一句「评审标准自检异常，建议修复后复核」。工具异常时仍可列出已经产生的 `failed` 项，但不得写「通过」或给出发布结论。
3. **评分**：六个分项取 `scorecards[].dimensionLevels` 的 FN/RB/DC/TS/MT/SC；总成熟度取最低项；1=初稿，2=可用，3=可发布，4=可维护，5=成熟。不要写 L1~L5 代号。
4. **平台适配**：看 `audit.data.platform`。`codexDeclared=false` 且无接口文件 → 未声明 Codex/OpenAI，不要求接口文件；`codexDeclared=true` 且无接口文件 → 声明支持但缺少接口文件，属于阻断；有接口文件 → 已适配。不要把所有技能都默认成 Codex。
5. **问题分级**：阻断 = `validate` / `audit` 的 MUST 失败；重要 = `score` 瓶颈中的具体缺陷、软轨工程 `fail` + `high`；建议 = `audit` SHOULD、软轨工程 `fail` + `medium`、文风 `needsFix`、其余已确认的机器缺陷（如无变更记录/无 owner）；不写入 = `low`、`pending`、无证据的猜测。
6. **合并同一根因**：同一文件、同一类缺失只写一条。例：五个契约小节缺失合并为「缺少输入、输出和边界说明」，不要拆成 5 条。
7. **证据与置信度**：机器判定写「确定」；工程软轨 `high` 写「较确定」；`medium` 写「需复核」；人工观察写「需复核」。每条问题都要有证据；没有证据就不写。
8. 成熟度、重要问题、建议都不改变「可以发布」的结论，但要在总评里说明风险。

## 6. 用户报告模板

````markdown
# 技能评审报告：<技能名>

## 结论
- 评审对象：<技能名 / 相对路径；不写绝对路径>
- 是否可以发布：<可以 / 暂不可发布 / 无法判定>
- 一句话总评：<...>

## 评分
- 总成熟度：<初稿 / 可用 / 可发布 / 可维护 / 成熟>（<x>/5，取最低分项）
- 分项：功能 <x>/5 · 健壮 <x>/5 · 文档 <x>/5 · 可验证 <x>/5 · 可维护 <x>/5 · 安全合规 <x>/5
- 平台适配：<已适配 Codex/OpenAI / 未声明 Codex/OpenAI，不要求接口文件 / 声明支持但缺少接口文件>
- 口径：分项取各维度已达到的级别；总成熟度取最低项；1=初稿，2=可用，3=可发布，4=可维护，5=成熟；不设加权。

## 阻断问题（<N> 项）
### 1. <标题>
- 位置：<文件 / 小节>
- 现状：<...>
- 影响：<...>
- 建议：<...>
- 证据：<...>；置信度：<确定 / 较确定 / 需复核>

## 重要问题（<N> 项）
### 1. <标题>
- 位置：
- 现状：
- 影响：
- 建议：
- 证据：<...>；置信度：<...>

## 建议改进（<N> 项）
### 1. <标题>
- 优先级：<中 / 低>
- 位置：
- 现状：
- 影响：
- 建议：
- 证据：<...>；置信度：<...>

## 内容质量
- 总体：内容质量 <x>/5
- 需要改进：
  - <条目>：<证据>；置信度：<...>
- 不需要改：
  - <最多 3 条有具体证据的>

## 做得好的地方
- <结构事实>

## 文风
- 总体印象：<...>
- 需要修改：
  - 原文：<...>
    改文：<...>
    原因：<...>
- 不需要修改：
  - <...>

## 下一步
1. <...>
````

裁剪规则：

- `intent=assess`：删除「文风」整节；保留「内容质量」（如果软轨产出了内容条目）。
- 文风未产出：删除「文风」整节；全文不得出现「文风」「跳过」「pending」「未执行」等字样。
- 内容质量未产出（软轨被跳过、没有内容条目，或内容条目全部 pending）：删除「内容质量」整节；全文不得评价内容深度、原创性、自洽性或「内容上乘」。
- `intent=style`：标题改为「文风评审报告：<技能名>」；结论只写总体印象、文风评分、需要修改数；正文保留「文风」的「需要修改 / 不需要修改」；最后写「下一步」。删除「评分」「阻断」「重要」「建议」「内容质量」。
- `intent=style` 且文风未产出：不生成报告；直接说明当前无法完成文风评审，以及恢复条件。
- 软轨未产出：不得出现由软轨产生的结论，也不标注来源。
- 问题数为 0 时，该章节只写一行「未发现阻断问题」或直接删除；不要保留空模板。
- 「下一步」只写 1~3 个最高优先级动作，不重复问题清单。
- 没有可核对事实时删除「做得好的地方」。
- `develop`：按 `references/mentor/blueprint.md` 输出进度，不用本模板。
- 多技能仓库未指定 `--skill`：先在结论后加一张总览表（技能 / 发布结论 / 总成熟度 / 平台适配 / 阻断数 / 重要数），再只展开有阻断或重要问题的技能；全部通过的技能合并一行。
- 「文风」的「改文」无法针对原文给出时，改写为「改写方向」；`keepAsIs` 最多列 3 条有具体证据的。

## 7. 用户表达规则

- 报告是用户文档。禁止出现：`硬轨`、`软轨`、`退出码`、`validate`、`score`、`audit`、`sensitivity`、检查项 ID（`V-*` / `QM-*` / `C-*` / `SELF-*` / `CQ-*`）、JSON 字段、模块名、`L1`~`L5`、脚本路径、`report.json`、`--json`、`--intent`。
- **不写绝对路径**：评审对象用技能名或相对路径；位置用 `SKILL.md` / `references/...`；证据里出现本机路径时脱敏为 `<本机路径>`。
- 每条问题写清「位置 / 现状 / 影响 / 建议 / 证据 / 置信度」；位置写到文件与小节，没有可靠行号时不写行号。
- 建议措辞按 `references/assessor/advice-rules.md` 生成，不凭印象发挥；纯风格项标「低（风格项）」。
- 优点只写可核对的结构事实（触发描述、契约、示例、评测、失败模式、文件体积等）；内容质量未评估时不得评价内容深度、原创性、自洽性；文风未评估时不得评价文笔、措辞、节奏或风格。
- 不输出命令、报告 JSON 路径，也不主动提示「可再跑 --intent style」之类的内部选项；用户主动问时再解释。
- 发送前扫一遍草稿；命中上述禁用词就改写。若内容质量未产出，再搜索「内容上乘」「深度」「原创」「自洽」，命中即删除或改写；若文风未产出，再搜索「文风」「跳过」「pending」「未执行」「改写」「措辞」，命中即删除或改写。

## 8. 退出码与处置

| 码 | 含义 | Agent 动作 |
|---|---|---|
| `0` | 硬轨通过 | 生成用户报告 |
| `1` | 硬轨存在 MUST 失败 / 未达目标 | 报告阻断问题与建议；不自动重试、不改目标 |
| `2` | 参数或路径错误 | 停止；检查路径/参数；无法判断时向用户确认 |
| `3` | 工具链自检失败 | 停止；在报告中写「无法判定（评审工具异常）」；不修改目标技能 |

退出码只由硬轨决定。逐脚本来源见 `references/assessor/exit-codes.md`。

## 9. 条件分支

- **deferred**：读 `references/deferred.md`，按其中的三阶段命令、文件命名与合并步骤执行。
- **Node / Bash 不可用**：按 `SKILL.md` 第 4 节降级；不得把只读文档模式伪装成“已检查”或“通过”。
