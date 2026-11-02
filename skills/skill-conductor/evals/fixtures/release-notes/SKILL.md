---
name: release-notes
description: "Turn merged pull requests between two git refs into release notes grouped by change type, in Keep a Changelog format. Use when the user asks for release notes, a changelog entry, or a summary of what shipped between two versions."
compatibility: "需要 git 与 gh CLI（已认证）。副作用：读文件、写文件（均可逆）。需要网络访问 GitHub API。"
metadata:
  contract-version: "1"
  portability: "claude-code-only"
  owner: "@zhao"
  side-effects: "read-files,write-files,network-read"
  failure-modes: "no-merge-base,gh-unauthenticated,empty-range"
allowed-tools: Bash(git log *) Bash(git describe *) Bash(gh pr list *) Bash(gh pr view *) Read Write
argument-hint: "[from-ref] [to-ref]"
---

# Release Notes

把两个 git 引用之间合并的 PR 整理成发布说明。目的是让"这一版到底改了什么"从一堆提交标题里被还原成人类可读、可分类、可直接粘贴进 CHANGELOG 的文本。

本技能只**读取**历史并**写入一个新文件**，不修改仓库状态、不创建 tag、不推送。

## Inputs

- `[from-ref]`：起始引用（tag、commit SHA 或分支名）。缺省行为：取 `git describe --tags --abbrev=0` 的最近一个 tag。
- `[to-ref]`：结束引用。缺省行为：`HEAD`。

两个占位符都可以省略。若 `[from-ref]` 无法解析为有效引用，按「Failure modes」处理，**不要**猜测一个近似的引用继续执行。

## Outputs

- 形态：写入文件，同时在对话中展示摘要。
- 路径：`docs/releases/<to-ref>.md`；若 `<to-ref>` 是分支名则用 `docs/releases/<from-ref>..<to-ref>.md`。目录不存在时创建。
- 格式：Keep a Changelog 分类结构，详见 [references/FORMAT.md](references/FORMAT.md)。

## Failure modes

| 场景 | 行为 |
|---|---|
| `[from-ref]` 或 `[to-ref]` 无法解析 | 停止，报告 `git rev-parse` 的原始错误，列出最近的 5 个 tag 供选择 |
| 两个引用之间没有合并的 PR | 停止，明确报告"该区间内没有合并的 PR"。**不得**退化为罗列原始 commit |
| `gh` 未安装或未认证 | 停止，提示运行 `gh auth status` 检查。**不得**用 `git log` 猜测 PR 内容 |
| 区间内 PR 数量超过 200 | 先报告数量并询问是否继续，避免一次性拉取过多 |
| 目标文件已存在 | 询问是覆盖、改名还是放弃。**不得**静默覆盖 |

以上任何一条都**不允许静默降级**：无法完成时必须显式报告，而不是给出一份不完整的说明。

## Side effects

- 读文件：读取 git 历史与 PR 元数据。可逆（无副作用）。
- 写文件：在 `docs/releases/` 下创建或覆盖一个 Markdown 文件。可逆（用户可删除），但**覆盖已有文件前必须询问**（见 SPEC-046 的确认要求）。
- 网络：只读访问 GitHub API。不向任何其他端点发送数据。
- 不可逆操作：**无**。本技能不创建 tag、不推送、不改写历史。

## Dependencies

- 运行时：`git`（任意近版本）、`gh` CLI 且已认证（`gh auth status` 通过）。
- 外部服务：GitHub API（经 `gh` 转发）。需要的权限：读取 PR 与仓库元数据。**不写入任何凭证**，认证完全由 `gh` 自行管理。
- 模型：无特殊能力要求。

## Process

1. **解析引用**。对两个引用分别执行 `git rev-parse --verify <ref>`。任一失败即进入失败模式第 1 行。
2. **确认区间非空**。执行 `git log <from>..<to> --oneline`，为空则进入失败模式第 2 行。
3. **取合并的 PR**。执行 `gh pr list --state merged --base <branch> --json number,title,labels,author,mergedAt`，按 `mergedAt` 过滤到区间内。数量超 200 时先询问。
4. **分类**。按 PR 的 label 映射到 Keep a Changelog 的分类（Added / Changed / Fixed / Removed / Security）。映射规则与无 label 时的兜底策略见 [references/FORMAT.md](references/FORMAT.md)。
5. **写入**。按 `Outputs` 的路径规则写文件。若文件已存在，先询问。
6. **展示摘要**。在对话中给出：各分类的条目数、区间内 PR 总数、以及被跳过（无 label 且无法归类）的条目数。

## Verification

本技能做完之后，用以下检查确认它真的做对了（不需要打开 SKILL.md 就能核验）：

1. 输出文件存在，路径符合 `Outputs` 的规则。
2. 文件中只出现**有条目**的分类，空分类整节不出现。
3. 分类顺序为 Added → Changed → Deprecated → Removed → Fixed → Security。
4. 文件中每条都带 `([#<number>](<url>))` 形式的 PR 链接。
5. 对话摘要中的「PR 总数」等于各分类条目数 + 内部改动数 + 未归类数。
6. 若目标文件原本已存在，对话中应当能看到询问覆盖的交互记录。

以上任一不成立，即为实现有误。

## 详细参考

分类映射规则、无 label 兜底策略、输出模板与真实示例见 [references/FORMAT.md](references/FORMAT.md)。
