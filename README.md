# Agent Skills

个人开发的 AI Agent Skills 集合。每个技能在 `skills/` 下独立打包，可以单独复制到支持 skills 的 Agent 宿主中使用；仓库根目录只负责索引、通用规范与持续集成。

## 技能列表

| 技能 | 用途 | 成熟度 | 平台适配 | 目录 |
|---|---|---|---|---|
| [skill-conductor](skills/skill-conductor/README.md) | 评审已有 skill 的合格性与文风，或指导从零开发新 skill | 成熟（5/5） | 已适配 Codex/OpenAI | `skills/skill-conductor/` |

新增技能后请同步更新此表。

## 目录结构

```text
.
├── README.md                      仓库说明与技能索引
├── CONTRIBUTING.md                新增技能与提交规范
├── LICENSE                        仓库级 MIT 许可
├── .github/
│   ├── scripts/
│   │   └── check-skill-layout.mjs 所有技能的通用结构检查
│   └── workflows/
│       ├── skill-layout.yml       通用结构检查
│       └── skill-conductor.yml    skill-conductor 专项检查
└── skills/
    └── skill-conductor/           自包含技能包，可单独安装
        ├── SKILL.md
        ├── README.md
        ├── CHANGELOG.md
        ├── CONTRIBUTING.md
        ├── LICENSE
        ├── agents/
        ├── references/
        ├── scripts/
        └── evals/
```

每个技能目录都是一个可独立安装的完整包。仓库根目录不放入任何技能实现，避免多个技能共享脚本或互相引用。

## 使用

### 安装到 Agent

把目标技能目录复制到宿主 Agent 的 skills 目录，然后重新加载或重启 Agent：

```bash
cp -r skills/skill-conductor <宿主 skills 目录>/
```

`skill-conductor/README.md` 里写有安装后的用法与命令示例。

### 命令行

在技能目录内直接运行该技能自带的命令：

```bash
cd skills/skill-conductor
node scripts/conductor.mjs . --intent evaluate
```

## 新增技能

1. 在 `skills/` 下新建目录，目录名使用小写连字符，并与 `SKILL.md` 的 `name` 保持一致。
2. 从最小结构开始：`SKILL.md` 必需，`README.md`、`CHANGELOG.md`、`agents/openai.yaml`、`references/`、`scripts/`、`evals/` 按需添加。
3. `SKILL.md` 首行写 `---`，frontmatter 至少包含 `name` 与 `description`；`description` 同时说明做什么与何时使用。
4. 正文补齐输入、输出、失败模式、副作用、依赖与验证六节；细节放到 `references/`，保持主文件精简。
5. 技能必须自包含：不通过 `../` 引用其他技能，不依赖仓库根的共享脚本。
6. 在根 `README.md` 的技能列表里登记用途、成熟度与平台适配。

完整规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 持续集成

- `skill-layout`：检查 `skills/*/SKILL.md` 是否存在、目录名与 `name` 是否一致、`description` 是否合法。
- `skill-conductor`：运行该技能的自检、规范检查、质量评分与全量回归。

新增技能时，按同样方式在 `.github/workflows/` 下增加一份专项工作流；若技能没有专项检查，通用结构检查仍然生效。

## 许可

仓库与各技能均采用 [MIT License](LICENSE)。各技能目录内的 `LICENSE` 为该技能单独分发时使用。
