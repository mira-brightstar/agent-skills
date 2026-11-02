---
name: no-when-not
description: 演示缺少「何时不使用」小节的技能。
---

# 缺少边界

## 何时使用

- 用户要求生成发布说明
- 用户要求整理变更记录

## 工作流程

1. 读取 git log。
2. 按类型分组。
3. 写入 CHANGELOG.md。

## Inputs

无参数。

## Outputs

写入 CHANGELOG.md。
