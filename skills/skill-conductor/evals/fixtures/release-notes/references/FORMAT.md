# 分类映射与输出模板

本文件由 `SKILL.md` 的 Process 第 4 步按需加载。

## 1. label → 分类映射

| PR label | Keep a Changelog 分类 |
|---|---|
| `feature`、`enhancement` | Added |
| `breaking`、`change` | Changed |
| `bug`、`fix` | Fixed |
| `deprecation` | Deprecated |
| `removal` | Removed |
| `security` | Security |
| `docs`、`chore`、`refactor`、`test`、`ci` | **不输出**（内部改动，不进发布说明） |

## 2. 无 label 时的兜底策略

按顺序尝试，**只取第一个命中的规则**：

1. 标题以 `feat:` / `feature:` 开头 → Added
2. 标题以 `fix:` / `bugfix:` 开头 → Fixed
3. 标题含 `security` / `CVE-` → Security
4. 标题以 `chore:` / `docs:` / `refactor:` / `test:` / `ci:` 开头 → 不输出
5. 全部未命中 → **不猜测**。计入"未归类"计数，在对话摘要中报告，且不写入文件。

第 5 条是刻意的：宁可让用户看到"有 3 条未归类"，也不要把不确定的改动塞进错误的分类。这符合 `SKILL.md` 中"禁止静默降级"的约定。

## 3. 输出模板

```markdown
# <to-ref>

<ISO 8601 日期>

## Added

- <PR 标题> ([#<number>](<url>)) @<author>

## Changed

- ...

## Fixed

- ...
```

**规则**：

- 只输出**有条目**的分类，空分类整节省略。
- 分类顺序固定为 Added → Changed → Deprecated → Removed → Fixed → Security。
- 每个条目一行，格式为 `<标题> ([#<number>](<url>)) @<author>`。
- 标题保留原文，不做改写（改写会引入未经证实的语义）。

## 4. 真实示例

输入：`release-notes v1.2.0 v1.3.0`

输出文件 `docs/releases/v1.3.0.md`：

```markdown
# v1.3.0

2026-09-23

## Added

- Add retry with backoff to the uploader ([#412](https://github.com/acme/app/pull/412)) @lin

## Fixed

- Fix off-by-one in pagination cursor ([#418](https://github.com/acme/app/pull/418)) @zhao
- Fix crash when config file is empty ([#421](https://github.com/acme/app/pull/421)) @lin
```

对话摘要：

```
区间 v1.2.0..v1.3.0：共 7 个已合并 PR
  Added   1
  Fixed   2
  内部改动（不输出）  3
  未归类（未写入）    1
未归类条目需人工确认后手动补充：#420
```
