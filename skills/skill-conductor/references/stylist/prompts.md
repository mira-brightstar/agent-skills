# 文风 Prompt 模板（30 条）

本文件是 `scripts/stylist/wq-judge.mjs` 的 Prompt 来源。占位符：`{skill_name}`、`{skill_content}`、`{deterministic}`。

---

## WQ-INS-01

```text
你是 skill 文风评审专家。请判断：正向表述为主。

【判定标准】
看每一处「不要/禁止/避免」是否有对应的正向替代。安全边界处的少量否定不算问题。

【3 档评分】
- 0 = 否定性描述占比 > 50%，且无正向替代
- 1 = 否定与正向混杂，关键指令有正向表述
- 2 = 以正向指令为主，否定仅用于安全边界

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-INS-01
【类别】指令表述
【检查项】正向表述为主
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-INS-02

```text
你是 skill 文风评审专家。请判断：避免嵌套否定。

【判定标准】
双重否定（不要不、禁止未…不）会显著增加解析成本，出现多处即扣分。

【3 档评分】
- 0 = 多处双重/嵌套否定，读者需反复解析
- 1 = 偶有嵌套否定，但可从上下文理解
- 2 = 全文无嵌套否定，语义直接

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-INS-02
【类别】指令表述
【检查项】避免嵌套否定
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-INS-03

```text
你是 skill 文风评审专家。请判断：避免模糊量词。

【判定标准】
检查「尽量/可能/适当」是否落在关键动作上。非关键描述中的模糊词可接受。

【3 档评分】
- 0 = 关键动作大量使用模糊量词，无法判定何时算完成
- 1 = 部分量词模糊，但关键步骤有明确阈值
- 2 = 关键动作都有可判定阈值，模糊词仅用于非关键描述

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-INS-03
【类别】指令表述
【检查项】避免模糊量词
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-INS-04

```text
你是 skill 文风评审专家。请判断：动作动词明确。

【判定标准】
泛动词（处理、搞、优化、完善）没有可执行语义，应改为具体动作。

【3 档评分】
- 0 = 大量泛动词（处理/搞/优化），无法确定具体动作
- 1 = 有具体动词但缺少对象或路径
- 2 = 动词 + 对象 + 路径/命令都明确

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-INS-04
【类别】指令表述
【检查项】动作动词明确
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-INS-05

```text
你是 skill 文风评审专家。请判断：指令与示例一致。

【判定标准】
逐条对照示例与指令：示例是否违反了自己写下的规则。

【3 档评分】
- 0 = 示例与指令直接矛盾
- 1 = 示例基本一致，但遗漏关键约束
- 2 = 示例完整体现指令中的关键约束

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-INS-05
【类别】指令表述
【检查项】指令与示例一致
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-COG-01

```text
你是 skill 文风评审专家。请判断：单段长度可控（≤ 200 字）。

【判定标准】
只看段落正文，不含代码块与列表项。

【3 档评分】
- 0 = 存在 > 400 字的段落
- 1 = 存在 200~400 字的段落
- 2 = 所有段落 ≤ 200 字

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-COG-01
【类别】认知负荷
【检查项】单段长度可控（≤ 200 字）
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-COG-02

```text
你是 skill 文风评审专家。请判断：信息密度适中。

【判定标准】
判断读者是否需要反复回读。密度高但结构清晰可给 1 分。

【3 档评分】
- 0 = 信息严重过载，需反复回读才能理解
- 1 = 局部过载，但结构可补救
- 2 = 密度适中，一段一个主题

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-COG-02
【类别】认知负荷
【检查项】信息密度适中
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-COG-03

```text
你是 skill 文风评审专家。请判断：结构化表达（列表/表格）。

【判定标准】
看关键信息（参数、步骤、对照）是否可被快速扫描。

【3 档评分】
- 0 = 全篇散文，无可扫描结构
- 1 = 有少量列表，但关键信息仍在长段中
- 2 = 参数/步骤/对照均有结构化呈现

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-COG-03
【类别】认知负荷
【检查项】结构化表达（列表/表格）
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-COG-04

```text
你是 skill 文风评审专家。请判断：渐进披露（详情放 references）。

【判定标准】
主文件应能在 5 分钟内读完；细节应可渐进加载。

【3 档评分】
- 0 = 主文件承载全部细节，体量失控
- 1 = 有外置但主文件仍偏重
- 2 = 主文件精简，细节按需加载

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-COG-04
【类别】认知负荷
【检查项】渐进披露（详情放 references）
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-STR-01

```text
你是 skill 文风评审专家。请判断：何时使用明确。

【判定标准】
触发场景应能被用户原话匹配到。

【3 档评分】
- 0 = 无「何时使用」或完全空泛
- 1 = 有触发描述但偏抽象
- 2 = 有具体、可匹配的触发场景

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-STR-01
【类别】结构清晰度
【检查项】何时使用明确
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-STR-02

```text
你是 skill 文风评审专家。请判断：何时不使用明确。

【判定标准】
「何时不使用」是防止误触发的关键，必须有具体场景。

【3 档评分】
- 0 = 无「何时不使用」
- 1 = 有但只是口号，未划出具体场景
- 2 = 具体场景 + 替代方案

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-STR-02
【类别】结构清晰度
【检查项】何时不使用明确
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-STR-03

```text
你是 skill 文风评审专家。请判断：输入输出明确。

【判定标准】
判断第三个人能否据此写出调用代码。

【3 档评分】
- 0 = 输入输出均模糊
- 1 = 有一侧明确
- 2 = 输入输出都明确到可直接实现

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-STR-03
【类别】结构清晰度
【检查项】输入输出明确
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-STR-04

```text
你是 skill 文风评审专家。请判断：边界明确。

【判定标准】
边界包括：能做什么、不能做什么、会不会产生副作用。

【3 档评分】
- 0 = 边界完全缺失
- 1 = 提到部分边界
- 2 = 权限/写操作/范围边界都明确

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-STR-04
【类别】结构清晰度
【检查项】边界明确
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-STR-05

```text
你是 skill 文风评审专家。请判断：示例充分。

【判定标准】
示例必须具体到可以照做。

【3 档评分】
- 0 = 无示例
- 1 = 有示例但过短或只覆盖正常路径
- 2 = 示例完整且覆盖关键路径

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-STR-05
【类别】结构清晰度
【检查项】示例充分
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-TRM-01

```text
你是 skill 文风评审专家。请判断：同概念同术语。

【判定标准】
核心概念（技能、代理、提示词、工作流）必须一词一义。

【3 档评分】
- 0 = 核心概念 3 种以上写法混用
- 1 = 有 2 种写法但上下文可区分
- 2 = 核心概念全文统一

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-TRM-01
【类别】术语一致性
【检查项】同概念同术语
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-TRM-02

```text
你是 skill 文风评审专家。请判断：避免同义词混用。

【判定标准】
同义词混用会让模型误以为是不同概念。

【3 档评分】
- 0 = 同义词大量交替，读者需自行映射
- 1 = 局部混用但不影响理解
- 2 = 同义词已统一

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-TRM-02
【类别】术语一致性
【检查项】避免同义词混用
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-TRM-03

```text
你是 skill 文风评审专家。请判断：关键术语首次出现有定义。

【判定标准】
术语定义可以是一句话或一个 references 链接。

【3 档评分】
- 0 = 多个关键术语无定义
- 1 = 部分术语有定义
- 2 = 关键术语首次出现均有定义或链接

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-TRM-03
【类别】术语一致性
【检查项】关键术语首次出现有定义
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-FAIL-01

```text
你是 skill 文风评审专家。请判断：失败模式具体可操作。

【判定标准】
每条失败模式都应能回答「出现时具体做什么」。

【3 档评分】
- 0 = 只有抽象风险描述
- 1 = 有具体失败但缺少行为
- 2 = 失败条件 + 明确行为

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-FAIL-01
【类别】失败模式
【检查项】失败模式具体可操作
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-FAIL-02

```text
你是 skill 文风评审专家。请判断：每种失败有处理方式。

【判定标准】
处理方式可以是报错、重试、回退或人工确认，但必须明确。

【3 档评分】
- 0 = 失败清单无任何处理方式
- 1 = 部分失败有处理
- 2 = 每种失败都有明确处理

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-FAIL-02
【类别】失败模式
【检查项】每种失败有处理方式
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-FAIL-03

```text
你是 skill 文风评审专家。请判断：失败描述非抽象口号。

【判定标准】
口号无法被验证，不能算失败模式。

【3 档评分】
- 0 = 全是口号式描述
- 1 = 口号与具体描述混杂
- 2 = 全部为可观察的具体行为

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-FAIL-03
【类别】失败模式
【检查项】失败描述非抽象口号
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-TRIG-01

```text
你是 skill 文风评审专家。请判断：description 触发场景明确。

【判定标准】
description 是模型自动触发的唯一依据。

【3 档评分】
- 0 = 无触发场景
- 1 = 有场景但关键词泛化
- 2 = 场景具体且含可匹配关键词

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-TRIG-01
【类别】触发条件
【检查项】description 触发场景明确
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-TRIG-02

```text
你是 skill 文风评审专家。请判断：不过于宽泛。

【判定标准】
过于宽泛会导致技能被大量误触发。

【3 档评分】
- 0 = 触发范围覆盖一切
- 1 = 范围偏宽但仍有限定
- 2 = 范围聚焦，误触发概率低

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-TRIG-02
【类别】触发条件
【检查项】不过于宽泛
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-TRIG-03

```text
你是 skill 文风评审专家。请判断：不过于狭窄。

【判定标准】
过于狭窄会导致该触发时触发不到。

【3 档评分】
- 0 = 只有一个精确短语能触发
- 1 = 覆盖少量同义说法
- 2 = 覆盖常见同义表达且不宽泛

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-TRIG-03
【类别】触发条件
【检查项】不过于狭窄
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-ANTI-01

```text
你是 skill 文风评审专家。请判断：否定淹没正向指令。

【判定标准】
模型对否定句的处理弱于正向指令，否定过多会稀释核心动作。

【3 档评分】
- 0 = 否定句压倒正向指令，核心动作缺失
- 1 = 否定偏多，但核心动作仍可辨认
- 2 = 正向指令为主，否定只用于边界

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-ANTI-01
【类别】反模式
【检查项】否定淹没正向指令
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-ANTI-02

```text
你是 skill 文风评审专家。请判断：隐含矛盾指令。

【判定标准】
找出两条无法同时满足的要求。

【3 档评分】
- 0 = 存在直接冲突的指令
- 1 = 存在潜在冲突，需读者自行裁决
- 2 = 指令之间无冲突

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-ANTI-02
【类别】反模式
【检查项】隐含矛盾指令
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-ANTI-03

```text
你是 skill 文风评审专家。请判断：营销式语言。

【判定标准】
营销词不提供可执行信息，且会误导模型。

【3 档评分】
- 0 = 多处营销词
- 1 = 个别营销词
- 2 = 无营销词，全部为可验证描述

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-ANTI-03
【类别】反模式
【检查项】营销式语言
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-ANTI-04

```text
你是 skill 文风评审专家。请判断：冗余重复。

【判定标准】
重复会占用上下文预算，也会让模型误以为要求被强调。

【3 档评分】
- 0 = 大段重复，明显稀释信息
- 1 = 局部重复但不影响阅读
- 2 = 无高频重复

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-ANTI-04
【类别】反模式
【检查项】冗余重复
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-ANTI-05

```text
你是 skill 文风评审专家。请判断：指令内部自相矛盾。

【判定标准】
注意「不…」类指令与后文动作的冲突。

【3 档评分】
- 0 = 存在直接自相矛盾
- 1 = 存在未标注的例外
- 2 = 全文一致

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-ANTI-05
【类别】反模式
【检查项】指令内部自相矛盾
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-ANTI-06

```text
你是 skill 文风评审专家。请判断：安全边界缺失。

【判定标准】
关注：外部内容、写操作、权限、不可逆操作。

【3 档评分】
- 0 = 有明显风险动作且无任何边界声明
- 1 = 有部分边界声明
- 2 = 风险动作都有边界与确认

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-ANTI-06
【类别】反模式
【检查项】安全边界缺失
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
## WQ-ANTI-07

```text
你是 skill 文风评审专家。请判断：过度泛化。

【判定标准】
过度泛化会让用户在不适用场景误用。

【3 档评分】
- 0 = 声称适用一切场景
- 1 = 有泛化倾向但仍有边界
- 2 = 适用范围明确且有反例

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```

---

**复核 Prompt**：
```text
你是同一 skill 的复核专家。下面是【第一轮判定】。你的任务不是重新独立判定，而是批判性审查这次判定：

1. 检查第一轮是否遗漏原文证据、误读标准，或把「不适用」判成「通过」。
2. 若判定站得住，明确同意，并列出仍存在的薄弱点；没有薄弱点时 weaknesses 返回空数组。
3. 若判定不成立，明确不同意，并给出修正后的 result 与 score。

【检查项 ID】WQ-ANTI-07
【类别】反模式
【检查项】过度泛化
【第一轮判定（JSON）】
{verdict_json}

【粗筛参考（可能为空）】
{deterministic}

【技能名】{skill_name}
【技能内容】
{skill_content}

【输出格式】只返回 JSON：
{"agreement":true|false,"weaknesses":["..."],"result":"pass|fail|na","score":0|1|2,"reason":"简短理由","evidence":"引用原文片段"}
```
