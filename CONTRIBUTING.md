# 贡献指南

本仓库用于收纳个人开发的 AI Agent Skills。新增或修改技能时，请遵守以下约定。

## 1. 目录约定

```text
skills/<skill-name>/
├── SKILL.md            必需，入口与执行契约
├── README.md           面向使用者的说明
├── CHANGELOG.md        行为变更记录
├── LICENSE             该技能单独分发时使用
├── agents/
│   └── openai.yaml     声明支持 Codex/OpenAI 时必需
├── references/         判定规则、模板、锚点等按需加载内容
├── scripts/            可执行脚本，可选
└── evals/              评测用例与回归，可选
```

- 目录名使用小写连字符（`^[a-z0-9]+(-[a-z0-9]+)*$`），并与 `SKILL.md` 的 `name` 一致。
- 每个技能目录必须自包含，可单独复制到宿主 skills 目录运行。
- 禁止通过 `../` 引用其他技能，也不依赖仓库根目录的共享脚本。
- 根目录只放索引、通用规范与 CI，不放技能实现。

## 2. SKILL.md 要求

- 首行必须是 `---`，frontmatter 由 `---` 闭合。
- `name` 与目录名一致；`description` 同时说明「做什么」与「何时使用」，并包含可匹配的触发词。
- 正文至少包含：
  - `## Inputs`：输入项、必填性、缺省值、非法值。
  - `## Outputs`：产出物与结构。
  - `## Failure modes`：失败条件与对应行为。
  - `## Side effects`：读取范围、写入范围、可逆性。
  - `## Dependencies`：运行时、权限、网络、数据边界。
  - `## Verification`：可运行的验证命令或可观察判据。
- 细节放入 `references/`，主文件保持精简；不要复制重复内容。

## 3. 新增技能流程

1. 在 `skills/` 下创建目录，放入最小可运行结构。
2. 补齐 `SKILL.md` 契约与 `README.md` 使用说明。
3. 有可执行逻辑时补 `scripts/`，并保证零第三方依赖或写明安装方式。
4. 有判定规则时补 `evals/`，至少覆盖正常路径与一个失败路径。
5. 在根 `README.md` 的技能列表中登记。
6. 在 `.github/workflows/` 下增加该技能的专项工作流；没有专项检查时至少通过通用结构检查。

## 4. 本地检查

```bash
# 通用结构检查
node .github/scripts/check-skill-layout.mjs

# skill-conductor 专项检查
cd skills/skill-conductor
node scripts/assessor/validate.mjs --self-check-only
node scripts/assessor/score.mjs --self-check-only
node scripts/assessor/validate.mjs . --level 3
node scripts/assessor/score.mjs . --target L3
node evals/run.mjs
```

提交前确保上述命令退出码为 0。

## 5. 提交约定

- 分支名建议 `feat/<skill-name>`、`fix/<skill-name>`、`docs/<topic>`。
- 提交信息建议 `skill(<name>): <一句话说明>`，例如 `skill(skill-conductor): 增加覆盖率门槛`。
- 一次提交只处理一个技能或一类通用改动，不顺手重排无关文件。
- 影响用户可见行为时，同步更新该技能的 `README.md` 与 `CHANGELOG.md`。
- 不要在仓库中提交真实凭证、个人路径或大体积无关文件。

## 6. 许可

提交即表示你同意以本仓库的 [MIT License](LICENSE) 授权你的贡献。
