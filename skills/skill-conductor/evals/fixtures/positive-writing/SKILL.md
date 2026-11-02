---
name: positive-writing
description: 把一个目录下的 Markdown 文件汇总成一份索引。当用户要求生成目录索引或文档清单时使用。
license: MIT
---

# 目录索引

## 何时使用

- 用户要求生成文档索引
- 仓库新增了 Markdown 文件需要登记

## 何时不使用

- 用户只需要单个文件的内容
- 目录中没有任何 Markdown 文件

## 工作流程

1. 使用 Read 工具读取目录清单。
2. 使用 Write 工具写入 `INDEX.md`。
3. 运行 `node evals/run.mjs` 确认索引数量与文件数量一致。

## Inputs

| 参数 | 含义 | 缺省 |
|---|---|---|
| 目录 | 要扫描的目录 | 当前目录 |

## Outputs

写入 `INDEX.md`，每行一个文件路径。

## Failure modes

- 目录不存在：返回退出码 2，不写文件。
- 目录为空：写入空索引并提示用户。

## Side effects

- 写入 `INDEX.md`，可通过 git 回滚，属于可逆操作。

## Dependencies

- Node.js >= 18。
- 无网络依赖。
