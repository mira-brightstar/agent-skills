# 变更记录

本文件记录 skill-conductor 对外行为的版本变更。详细改造过程见源仓库的 `REFACTOR_REPORT_0X_*.md`。

## 2.6 · 2026-11-02

- 平台适配改为按目标声明判定：未声明 Codex/OpenAI 时不强制 `agents/openai.yaml`；声明但缺失才算阻断。`audit` JSON 增加 `platform` 字段。
- 软轨新增 5 条内容质量条目（CQ-01~05），与 14 条工程条目共用两段式协议；内容质量单独计分，不并入六维评分。
- 新增 `V-075` 大体积随包数据许可检查、`V-076` 本机绝对路径检查、`V-077` 读取范围声明检查。
- 用户报告增加「评分」章节（六维文字 + x/5 + 平台适配），每条问题增加「证据 / 置信度」，并禁止输出绝对路径。
- 内容质量只在软轨产出内容条目时出现；未产出时不得评价内容深度、原创性、自洽性。
- 回归增加平台适配、内容质量条目、安全检查和报告契约检查。

## 2.5 · 2026-11-01

- 用户报告改为面向读者的结构：结论 → 阻断问题 → 重要问题 → 建议改进 → 做得好的地方 → 文风（仅当实际评审）→ 下一步。
- 报告禁用内部术语（硬轨、软轨、退出码、脚本名、检查项 ID、JSON 字段、等级代号）；未执行的环节整节删除，不再写「已跳过」。
- 发布结论与「工具异常」分开：工具自检失败时写「无法判定」，不把标准自身问题算到目标技能上。
- 同一根因合并为一条问题，避免五个契约缺失被拆成五条。
- `references/assessor/advice-rules.md` 改为问题表述规则，附常见问题对照表。
- `README.md` 的 Agent 示例与 `agents/openai.yaml` 的默认提示改为用户语言。
- 回归增加用户报告模板契约与禁用词检查。

## 2.4 · 2026-10-29

- `references/agent-runbook.md` 瘦身为每次必读核心（约 110 行）；deferred 三阶段移入 `references/deferred.md`，仅在无 LLM 凭证或 direct 失败时读取。
- JSON 契约保留一个精简示例，删除重复的完整失败示例。
- 删除 runbook 中与 `SKILL.md` 第 4 节重复的降级小节。
- 回归增加「runbook 核心 ≤140 行」与「SKILL 指向 deferred 附录」检查。

## 2.3 · 2026-10-29

- 文档单文档化：`docs/USAGE.md` 合并进 `README.md`，删除 `docs/DESIGN_RATIONALE.md` 与 `docs/REAL_MODEL_VALIDATION.md`。
- `description` 增加显式触发词；`validate` 新增 `V-033` 检查 description 是否含「何时用」信号。
- 删除 `references/routing.md`，意图优先级并入 `SKILL.md` 第 2 节。
- 修正 `references/` 中失效的脚本路径与模板路径；修正退出码汇总规则为 `3 > 1 > 2 > 0`。
- 软轨与文风结果在命令行输出中标记为「参考信号」。
- 软轨与文风的 LLM Prompt 增加数据边界，被审 skill 内容按不可信数据处理。
- `score.mjs` 修正 `QM-DC-L5` 的扫描范围，不再把 `evals/fixtures/` 当作本技能的变更记录。
- `score.mjs` 在单技能包里用根 `README.md` 作为人类文档页，并用 `.github/workflows` 判定 CI 门禁。
- 回归第 9 组扩展为文档结构、路径引用、触发词与数据边界检查。

## 2.2

- `SKILL.md` 重写为 Agent 运行手册：运行约定、参数规则、JSON 契约、报告模板、退出码处置、deferred 三阶段与 Node/Bash 降级。
- `docs/USAGE.md` 改为 Agent-first。

## 2.1

- 开源发布补齐：MIT 许可证、`CONTRIBUTING.md`、CI 工作流与真实模型验证手册。
- 设计文档与使用文档拆分。

## 2.0

- 评定官、文风师、导师三个模块合并为单一 `skill-conductor` 包，对外只暴露根 `SKILL.md`。
