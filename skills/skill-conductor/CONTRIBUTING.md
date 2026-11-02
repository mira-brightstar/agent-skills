# 贡献指南

感谢参与 `skill-conductor`。本文件说明如何报告问题、提交 PR、本地跑测试，以及改造记录的约定。

---

## 1. 报告问题

提交 issue 时请包含：

1. **环境**：操作系统、Node 版本（`node --version`）、是否配置了 `LLM_API_URL` / `LLM_API_KEY`。
2. **复现命令**：完整命令与参数，不要只贴截图。
3. **期望行为 / 实际行为**：两者分别是什么。
4. **输出**：相关退出码、stderr，以及 `--json` 产物的关键片段。
5. **最小样本**：如涉及某个 skill，请提供最小可复现的 `SKILL.md` 或 fixture；不要上传含真实凭证的文件。

缺陷类型建议在标题前缀标注：`[bug]`、`[docs]`、`[audit]`、`[soft-track]`、`[stylist]`、`[mentor]`。

## 2. 提交 PR

1. Fork 仓库并从 `main` 拉出分支，分支名建议 `fix/...` 或 `feat/...`。
2. 只改与本 PR 目标相关的文件；不要顺手重排无关代码。
3. 保持零依赖：脚本只使用 Node 内置模块，Node >= 18。
4. 所有判定必须返回三态 `pass` / `fail` / `na`，禁止从文本反推成败。
5. 不改变软轨 verdict + critique 协议、硬轨退出码语义与编排不短路语义，除非 PR 同时给出设计说明。
6. 提交前跑完第 3 节的本地测试。
7. PR 描述请写明：改了什么、为什么改、如何验证、是否影响退出码或报告结构。
8. 用户报告模板改动必须同步更新 `references/agent-runbook.md` 与回归中的禁用词检查；不得把内部模块名、检查项编号、退出码或 JSON 字段写进用户报告。

## 3. 本地测试

在 `skill-conductor/` 根目录执行：

```bash
# 工具链自检
node scripts/assessor/validate.mjs --self-check-only
node scripts/assessor/score.mjs --self-check-only
node scripts/assessor/llm-judge.mjs --self-check
node scripts/stylist/wq-judge.mjs --self-check
node scripts/mentor/blueprint.mjs --self-check

# 根 skill 规范与质量
node scripts/assessor/validate.mjs . --level 3
node scripts/assessor/score.mjs . --target L3

# 全量回归（10 组）
node evals/run.mjs

# 两段式 LLM 自测（不需要真实 API key）
node evals/llm-two-pass.mjs
```

要求：

- 上述命令全部退出码为 0（`evals/run.mjs` 允许样本仓库用例在缺少 `SAMPLE_REPO` 时 SKIP）。
- 如果修改了 `audit.mjs` 的配置或布局探测，请额外在分桶仓库（`SAMPLE_REPO`）与单技能仓库各跑一次 `audit.mjs`。
- 如果修改了软轨 Prompt 或锚点，必须同时更新 verdict 与复核 Prompt，并保证 `--self-check` 通过；内容质量条目（CQ-01~05）同样适用。

## 4. 改造记录要求

结构性改造必须新增一份 `REFACTOR_REPORT_0X_<topic>.md`，并与既有报告保持**完全一致的章节结构**：

```text
## 1. 目标
## 2. 改造前状态
## 3. 冲突与问题
## 4. 关键决策
## 5. 迁移步骤
## 6. 验收结果
## 7. 遗留问题
```

约定：

- 编号连续：已有 01~05，下一份为 `06`。
- 文件名格式：`REFACTOR_REPORT_0X_<short_topic>.md`，全小写下划线。
- 「冲突与问题」每条必须写清**现象 / 根因 / 解决**三段。
- 「关键决策」必须写理由，不能只写结论。
- 「验收结果」必须包含可复现命令与结果。
- 「遗留问题」必须写后续处理方式或明确「不处理」的理由。

不需要新增报告的情况：

- 纯 bug 修复、文案修正、单条检查阈值调整。
- 依赖升级或 CI 配置微调。

这些内容写在 PR 描述即可；如果影响到用户可见行为，请在 `README.md` 的「已知限制」中同步说明。

## 5. 文档同步

本项目只保留 `README.md` 一份面向用户的文档，不再新建 `docs/` 下的说明文件。

| 改动 | 需要更新 |
|---|---|
| 安装步骤、命令参数、输出字段、用户可见限制 | `README.md` |
| Agent 执行契约、JSON 字段、用户报告模板 | `SKILL.md` 与 `references/agent-runbook.md` |
| deferred 三阶段、结果合并 | `references/deferred.md` |
| 判定规则、锚点、建议模板 | `references/` 对应文件 |
| 目录结构、入口 | `README.md` 的「目录结构与文档分工」 |
| 结构性改造 | 新增 `REFACTOR_REPORT_0X` |

## 6. 许可证

提交即表示你同意以本项目的 [MIT License](LICENSE) 授权你的贡献。
