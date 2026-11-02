#!/usr/bin/env node
/**
 * quality-model.mjs — 质量模型的**单一真相源**
 *
 * 架构决策：QM 定义写在代码里而不是 YAML 里，理由有三：
 *   1. score.mjs 可以直接 import，无需在 Node 里再写一个能解析「对象列表嵌套」的 YAML 解析器；
 *   2. references/assessor/checks.yaml 由本文件**生成**（--emit-yaml），YAML 只是给人看与给外部工具消费的派生物；
 *   3. CI 可以校验 checks.yaml 是否与代码同步（--check-yaml），防止二者漂移。
 *   这与样本仓库自己的 sync-plugin-version.mjs --check 是同一个模式（模式库 P-11）。
 *
 * 用法：
 *   node quality-model.mjs --emit-yaml  <out.yaml>   生成 checks.yaml
 *   node quality-model.mjs --check-yaml <out.yaml>   校验已生成的 yaml 是否最新（CI 用）
 *   node quality-model.mjs --list                    打印全部 QM 条目
 *
 * 退出码：0 成功 / 1 不同步（仅 --check-yaml）/ 2 参数错误
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const MODEL_VERSION = '1.0';

// ---------------------------------------------------------------------------
// 等级定义
// ---------------------------------------------------------------------------
export const LEVELS = [
  { id: 1, code: 'L1', name: 'Demo 级', criterion: '能在自己的机器上跑起来' },
  { id: 2, code: 'L2', name: '可用级', criterion: '换个人也能用，不需要问作者' },
  { id: 3, code: 'L3', name: '团队级', criterion: '团队共享，改动不会破坏别人' },
  { id: 4, code: 'L4', name: '生产级', criterion: '生产环境依赖它，出问题要能定位' },
  { id: 5, code: 'L5', name: '关键生产级', criterion: '关键路径，事故代价不可接受' },
];

// ---------------------------------------------------------------------------
// 维度定义
//
// weight：排序用的相对权重。**不参与等级判定**——整体等级始终是各维度等级的
//         最小值（木桶原理）。权重只影响加权总分，用于横向排序。
//         之所以不做数值加权的等级聚合：那会让「L3」失去可解释性
//         （加权分 2.7 到底是什么等级？）。等级必须能回答「还差什么才能晋级」。
// gate  ：关键维度。其等级通常成为整体等级的瓶颈，评分器会显式标注。
//
// 权重取值的依据：**缺失后果的严重性 × 修复难度**。
//   TS=2.0  缺失后果最隐蔽（改动静默破坏行为，无信号），且修复成本最高（要补评测）
//   SC=1.5  缺失后果不可逆（数据/凭证/权限事故无法回滚）
//   其余=1.0 缺失后果可见且可回滚
// ---------------------------------------------------------------------------
export const DIMENSIONS = [
  { id: 'FN', name: '功能', question: '它能不能稳定地做成那件事？', weight: 1.0, gate: false },
  { id: 'RB', name: '健壮', question: '出问题时它的行为可预期吗？', weight: 1.0, gate: false },
  { id: 'DC', name: '文档', question: '别人能否不读源码就正确使用它？', weight: 1.0, gate: false },
  { id: 'TS', name: '可测', question: '改动之后，怎么知道没坏？', weight: 2.0, gate: true },
  { id: 'MT', name: '可维护', question: '三个月后还能改得动吗？', weight: 1.0, gate: false },
  { id: 'SC', name: '合规与安全', question: '它会不会越权或造成不可逆损害？', weight: 1.5, gate: true },
];

/**
 * QM 条目。
 * 字段说明：
 *   verify  : 'machine' 完全机器判定 | 'hybrid' 机器先筛+专家确认 | 'expert' 仅专家判定
 *   runner  : 'validate' 跑 scripts/assessor/validate.mjs | 'audit' 跑 scripts/assessor/audit.mjs | 'repo' 由 score.mjs 自行判定
 *   check   : 依赖的检查 ID（数组，全部通过才算通过）；expert 类为 null
 *   anchor  : 专家锚点位置（规范 §4 的编号），machine 类为 null
 */
export const CHECKS = [
  // ---------------- FN 功能 ----------------
  { id: 'QM-FN-L1', dim: 'FN', level: 1, verify: 'machine', runner: 'validate', check: ['V-001', 'V-002', 'V-003', 'V-004', 'V-010', 'V-011', 'V-014', 'V-015'],
    req: '技能可被生态解析并加载：SKILL.md 存在、首行为 ---、frontmatter 合法、name 与目录名一致、description 非空',
    threshold: '全部 8 项基础检查通过', evidence: 'SPEC-001~015（agentskills.io spec 硬约束）', exemption: '无', anchor: null },
  { id: 'QM-FN-L1b', dim: 'FN', level: 1, verify: 'expert', runner: null, check: null,
    req: 'description 能让人与模型判断出「这是干什么的」',
    threshold: '锚点 §4.1 得分 ≥1', evidence: 'SPEC-012', exemption: '无', anchor: '§4.1' },
  { id: 'QM-FN-L2', dim: 'FN', level: 2, verify: 'expert', runner: null, check: null,
    req: '技能内声明了「什么算完成」的判据，而不是只描述过程',
    threshold: '能指出至少一处完成判据，且非「做完为止」这类空话', evidence: 'writing-for-agents 的 completion criterion 要求', exemption: '单步技能', anchor: '§5.1' },
  { id: 'QM-FN-L2b', dim: 'FN', level: 2, verify: 'machine', runner: 'repo', check: null,
    req: '正文含至少 1 个可辨识的真实示例（输入 → 输出 或 输入 → 结果）',
    threshold: '正文存在围栏代码块或「示例」小节，且长度 ≥5 行', evidence: 'agentskills.io spec 推荐章节「Examples of inputs and outputs」', exemption: '无', anchor: null },
  { id: 'QM-FN-L3', dim: 'FN', level: 3, verify: 'machine', runner: 'validate', check: ['V-040', 'V-041', 'V-042'],
    req: '输入契约与输出契约完整：每个参数有含义与缺省行为，产出形态/路径/格式明确',
    threshold: 'Inputs、Outputs 小节存在且占位符全部被解释', evidence: 'SPEC-040 / 041 / 042', exemption: '无', anchor: null },
  { id: 'QM-FN-L3b', dim: 'FN', level: 3, verify: 'expert', runner: null, check: null,
    req: '边界输入有定义（空输入、超长输入、非法格式）',
    threshold: '锚点 §5.2 得分 ≥1', evidence: 'SPEC-043 的延伸', exemption: '无输入参数的技能', anchor: '§5.2' },
  { id: 'QM-FN-L4', dim: 'FN', level: 4, verify: 'machine', runner: 'repo', check: null,
    req: '存在可复现的回归基线：示例输入与期望输出成对存在，可据此判断改动是否破坏行为',
    threshold: '技能目录下存在 evals/ 或 tests/ 且含 ≥1 个「输入+期望」对', evidence: 'SPEC-042 的延伸；可复现性维度', exemption: '无', anchor: null },
  { id: 'QM-FN-L5', dim: 'FN', level: 5, verify: 'expert', runner: null, check: null,
    req: '有失败注入验证：依赖失败、输入非法、权限不足时的行为已被实际验证过',
    threshold: '锚点 §5.3 得分 =2', evidence: 'SPEC-043 的延伸', exemption: '无', anchor: '§5.3' },

  // ---------------- RB 健壮 ----------------
  { id: 'QM-RB-L1', dim: 'RB', level: 1, verify: 'machine', runner: 'repo', check: null,
    req: 'L1 不设健壮性要求（Demo 级允许「跑通即可」，此处显式声明为无要求而非遗漏）',
    threshold: '恒定通过', evidence: '分级设计原则：低级别不设无效约束', exemption: '全部', anchor: null },
  { id: 'QM-RB-L2', dim: 'RB', level: 2, verify: 'expert', runner: null, check: null,
    req: '前置条件被声明：需要什么命令、什么权限、什么网络',
    threshold: '锚点 §5.6 得分 ≥1（机器侧的依赖声明在 QM-RB-L3 判定）', evidence: 'SPEC-050 的前置部分', exemption: '无外部依赖', anchor: '§5.6' },
  { id: 'QM-RB-L3', dim: 'RB', level: 3, verify: 'hybrid', runner: 'validate', check: ['V-043', 'V-050'],
    req: '失败模式声明 ≥2 类且禁止静默降级；依赖声明完整（含「无外部依赖」的显式声明）',
    threshold: 'Failure modes 与 Dependencies 小节存在；且专家确认无「静默跳过/静默兜底」表述', evidence: 'SPEC-043 / 050 + 锚点 §4.6', exemption: '无', anchor: '§4.6' },
  { id: 'QM-RB-L4', dim: 'RB', level: 4, verify: 'expert', runner: null, check: null,
    req: '写操作声明幂等性或冲突处理策略（重复执行会怎样、目标已存在怎么办）',
    threshold: '锚点 §5.4 得分 ≥1', evidence: '新增约定', exemption: '只读技能', anchor: '§5.4' },
  { id: 'QM-RB-L5', dim: 'RB', level: 5, verify: 'expert', runner: null, check: null,
    req: '规模与资源边界已声明：预期轮数/token 量级、可否中断、中断后可否恢复',
    threshold: '锚点 §4.7 得分 ≥1', evidence: 'SPEC-044', exemption: '单轮内完成的短技能', anchor: '§4.7' },

  // ---------------- DC 文档 ----------------
  { id: 'QM-DC-L1', dim: 'DC', level: 1, verify: 'machine', runner: 'validate', check: ['V-011'],
    req: 'description 非空且长度合法',
    threshold: '1 <= len <= 1024', evidence: 'SPEC-011', exemption: '无', anchor: null },
  { id: 'QM-DC-L2', dim: 'DC', level: 2, verify: 'expert', runner: null, check: null,
    req: 'description 同时说明「做什么」与「何时用」，含可匹配的关键词',
    threshold: '锚点 §4.1 得分 =2', evidence: 'SPEC-012', exemption: 'user-invoked 技能只需说明「做什么」', anchor: '§4.1' },
  { id: 'QM-DC-L3', dim: 'DC', level: 3, verify: 'machine', runner: 'validate', check: ['V-040', 'V-042', 'V-043', 'V-045', 'V-050'],
    req: '五段契约小节齐备（Inputs / Outputs / Failure modes / Side effects / Dependencies）',
    threshold: '5/5 存在（内容为空时写「无」而非删除小节）', evidence: 'SPEC-040~050 + §3.2', exemption: '无', anchor: null },
  { id: 'QM-DC-L3b', dim: 'DC', level: 3, verify: 'machine', runner: 'audit', check: ['C-11', 'C-12'],
    req: '已发布技能有人类文档页，且含固定结构（What it does / When to reach for it / Common questions / It\'s working if）',
    threshold: '文档页存在且四段标题齐备', evidence: '模式库 P-04', exemption: '无人类文档（纯模型技能）', anchor: null },
  { id: 'QM-DC-L4', dim: 'DC', level: 4, verify: 'machine', runner: 'repo', check: null,
    req: '文档含 ≥1 个真实示例，且示例中的输入输出与技能实际行为一致',
    threshold: '文档页或正文存在示例块；且与 QM-FN-L4 的回归基线一致', evidence: 'agentskills.io spec 推荐章节', exemption: '无', anchor: null },
  { id: 'QM-DC-L5', dim: 'DC', level: 5, verify: 'machine', runner: 'repo', check: null,
    req: '有变更记录：技能行为变更可追溯到版本历史',
    threshold: '仓库存在 CHANGELOG.md 或 changeset 目录，且含该技能的条目', evidence: '模式库 P-11', exemption: '未发布技能', anchor: null },

  // ---------------- TS 可测 ----------------
  // 权重调整记录（v1.1）：本维度条目整体前移一级，使可测性从 L3 起才参与判定提前到 L2。
  // 理由：可测性是本生态最薄弱的一环（阶段 1 取证：38/38 技能零测试），且缺失后果最隐蔽
  //       ——技能改动后没有任何信号能告诉你行为被破坏了。
  // 在等级制下，「提高权重」的合法手段只有门槛前移，不能用数值加权（见 DIMENSIONS 注释）。
  //
  // 阶梯设计的关键约束（第二版修正）：L2 的门槛必须**可达**。
  //   首版把「有 evals/ 目录」放在 L2，回测导致 38/38 技能全部落到 L1——门槛高到无人能过
  //   就不是高标准，而是无效测量（失去区分度 = 零信息量）。
  //   因此改为五级递进：说明 → 用例 → 自动化门禁 → 长期有效性。
  //   L2 只需「声明可核验的验证说明」（写一段话即可，且允许写在配套文档页里）。
  { id: 'QM-TS-L1', dim: 'TS', level: 1, verify: 'machine', runner: 'repo', check: null,
    req: 'L1 不设可测性要求（显式声明为无要求）',
    threshold: '恒定通过', evidence: '分级设计原则', exemption: '全部', anchor: null },
  { id: 'QM-TS-L2', dim: 'TS', level: 2, verify: 'expert', runner: null, check: null,
    req: '成功判据是行为描述而非主观形容词',
    threshold: '锚点 §5.5 得分 ≥1', evidence: 'writing-for-agents 的 completion criterion', exemption: '无', anchor: '§5.5' },
  { id: 'QM-TS-L2b', dim: 'TS', level: 2, verify: 'machine', runner: 'repo', check: null,
    req: '声明了可核验的验证说明（技能内或配套文档页存在 Verification / 如何确认 / It\'s working if 之类的固定小节）',
    threshold: '技能目录任一 Markdown 或 docs/<bucket>/<name>.md 中存在验证类小节标题',
    evidence: '模式库 P-04（样本仓库 25 个已发布技能均有 It\'s working if 段）', exemption: '无', anchor: null },
  { id: 'QM-TS-L3', dim: 'TS', level: 3, verify: 'machine', runner: 'repo', check: null,
    req: '提供 ≥1 个评测用例：输入情境 + 期望行为断言',
    threshold: '存在 evals/*.yaml|md|json，且含 case / expect 两类字段', evidence: '阶段 0 已确认的测试定义', exemption: '无', anchor: null },
  { id: 'QM-TS-L4', dim: 'TS', level: 4, verify: 'machine', runner: 'repo', check: null,
    req: '评测可自动执行、覆盖失败路径，且已接入回归门禁（改动导致评测失败时阻断合并）',
    threshold: '存在可执行运行器；≥1 个失败路径用例；CI 配置中含评测运行步骤', evidence: '反模式 A-04 的对照', exemption: '无', anchor: null },
  { id: 'QM-TS-L5', dim: 'TS', level: 5, verify: 'expert', runner: null, check: null,
    req: '评测有覆盖率要求，且用例随技能行为变更同步更新（可追溯到更新记录）',
    threshold: '锚点 §5.7 得分 =2', evidence: '新增约定：无覆盖率与同步机制，评测会在几次迭代后悄悄失效', exemption: '无', anchor: '§5.7' },

  // ---------------- MT 可维护 ----------------
  { id: 'QM-MT-L1', dim: 'MT', level: 1, verify: 'machine', runner: 'repo', check: null,
    req: 'L1 不设可维护性要求（显式声明为无要求）',
    threshold: '恒定通过', evidence: '分级设计原则', exemption: '全部', anchor: null },
  { id: 'QM-MT-L2', dim: 'MT', level: 2, verify: 'machine', runner: 'validate', check: ['V-052'],
    req: '技能自包含于单一目录，不依赖仓库内其他技能的文件',
    threshold: '无 ../ 形式的跨目录引用', evidence: 'SPEC-052', exemption: '无', anchor: null },
  { id: 'QM-MT-L3', dim: 'MT', level: 3, verify: 'machine', runner: 'audit', check: ['C-15', 'C-05', 'C-07'],
    req: '版本单一真相源且多清单一致；分发清单与实际目录双向对齐',
    threshold: '版本字段一致；清单无悬空、无漏登', evidence: 'SPEC-063 / 064', exemption: '无分发清单', anchor: null },
  { id: 'QM-MT-L4', dim: 'MT', level: 4, verify: 'machine', runner: 'repo', check: null,
    req: '体量受控：SKILL.md ≤500 行，深层材料外置到引用文件且引用不超过一层',
    threshold: 'SKILL.md 行数 <= 500；无嵌套引用链', evidence: 'agentskills.io spec（官方为建议非硬约束，故定 SHOULD/生产级）', exemption: '无', anchor: null },
  { id: 'QM-MT-L5', dim: 'MT', level: 5, verify: 'machine', runner: 'repo', check: null,
    req: '有 owner/维护者声明与废弃策略（谁负责、弃用时如何通知）',
    threshold: '仓库存在 CODEOWNERS 或 metadata 含 owner；且有 deprecated 处理约定', evidence: '模式库 P-09', exemption: '无', anchor: null },

  // ---------------- SC 合规与安全 ----------------
  { id: 'QM-SC-L1', dim: 'SC', level: 1, verify: 'machine', runner: 'repo', check: null,
    req: 'L1 不设安全要求（显式声明为无要求）',
    threshold: '恒定通过', evidence: '分级设计原则', exemption: '全部', anchor: null },
  { id: 'QM-SC-L2', dim: 'SC', level: 2, verify: 'machine', runner: 'validate', check: ['V-070'],
    req: '不含硬编码凭证、密钥、token',
    threshold: '密钥模式扫描零命中（占位符豁免）', evidence: 'SPEC-070', exemption: '占位符与示例值', anchor: null },
  { id: 'QM-SC-L3', dim: 'SC', level: 3, verify: 'hybrid', runner: 'validate', check: ['V-045'],
    req: '副作用声明完整，且区分可逆与不可逆',
    threshold: 'Side effects 小节存在；专家确认可逆性已区分', evidence: 'SPEC-045 + 锚点 §4.8', exemption: '完全无副作用的技能（需显式写「无」）', anchor: '§4.8' },
  { id: 'QM-SC-L4', dim: 'SC', level: 4, verify: 'hybrid', runner: 'validate', check: ['V-021'],
    req: 'allowed-tools 最小权限且给出必要性说明；Bash 系工具已收窄作用域',
    threshold: '无裸 Bash/PowerShell/Execute；专家确认每个工具都有用途说明', evidence: 'SPEC-020 / 021 + E-13（不受 workspace trust 约束）', exemption: '未使用 allowed-tools', anchor: '§4.2' },
  { id: 'QM-SC-L5', dim: 'SC', level: 5, verify: 'expert', runner: null, check: null,
    req: '提示注入防护 + 数据处理边界声明 + 许可声明',
    threshold: '锚点 §4.11 / §4.12 各 ≥1；且 license 或仓库级许可存在', evidence: 'SPEC-072 / 073 / 018', exemption: '完全本地执行且无外部内容输入的技能', anchor: '§4.11, §4.12' },
];

// ---------------------------------------------------------------------------
// YAML 生成
// ---------------------------------------------------------------------------
function yamlStr(s) {
  if (s === null || s === undefined) return 'null';
  const v = String(s);
  if (v === '' ) return '""';
  if (/[:#\[\]{}",'\n]|^\s|\s$|^(true|false|null|yes|no|on|off|\d+)$/i.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

export function emitYaml() {
  const L = [];
  L.push('# checks.yaml — 质量模型的机器可读形式');
  L.push('#');
  L.push('# ⚠️ 本文件由 scripts/assessor/quality-model.mjs --emit-yaml 生成，请勿手工编辑。');
  L.push('#    单一真相源是 scripts/assessor/quality-model.mjs；CI 会用 --check-yaml 校验本文件是否最新。');
  L.push(`#    生成命令：node scripts/assessor/quality-model.mjs --emit-yaml references/assessor/checks.yaml`);
  L.push('');
  L.push(`version: ${yamlStr(MODEL_VERSION)}`);
  L.push('generated_by: "scripts/assessor/quality-model.mjs"');
  L.push('');
  L.push('levels:');
  for (const l of LEVELS) {
    L.push(`  - id: ${l.id}`);
    L.push(`    code: ${yamlStr(l.code)}`);
    L.push(`    name: ${yamlStr(l.name)}`);
    L.push(`    criterion: ${yamlStr(l.criterion)}`);
  }
  L.push('');
  L.push('dimensions:');
  for (const d of DIMENSIONS) {
    L.push(`  - id: ${yamlStr(d.id)}`);
    L.push(`    name: ${yamlStr(d.name)}`);
    L.push(`    question: ${yamlStr(d.question)}`);
    L.push(`    weight: ${d.weight}`);
    L.push(`    gate: ${d.gate}`);
  }
  L.push('');
  L.push('checks:');
  for (const c of CHECKS) {
    L.push(`  - id: ${yamlStr(c.id)}`);
    L.push(`    dimension: ${yamlStr(c.dim)}`);
    L.push(`    level: ${c.level}`);
    L.push(`    verify: ${yamlStr(c.verify)}`);
    L.push(`    runner: ${c.runner === null ? 'null' : yamlStr(c.runner)}`);
    L.push(`    depends_on: ${c.check === null ? '[]' : `[${c.check.map(yamlStr).join(', ')}]`}`);
    L.push(`    requirement: ${yamlStr(c.req)}`);
    L.push(`    threshold: ${yamlStr(c.threshold)}`);
    L.push(`    evidence: ${yamlStr(c.evidence)}`);
    L.push(`    exemption: ${yamlStr(c.exemption)}`);
    L.push(`    anchor: ${c.anchor === null ? 'null' : yamlStr(c.anchor)}`);
  }
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown 矩阵生成
// ---------------------------------------------------------------------------
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const VERIFY_LABEL = { machine: '机器', hybrid: '机器+专家', expert: '专家' };

export function emitMatrix() {
  const L = [];
  const total = CHECKS.length;
  const byVerify = { machine: 0, hybrid: 0, expert: 0 };
  for (const c of CHECKS) byVerify[c.verify]++;

  L.push('# 质量模型矩阵（QM）');
  L.push('');
  L.push('> 项目：Skill 标准逆向工程 · 阶段 3 交付物');
  L.push(`> 模型版本：v${MODEL_VERSION}`);
  L.push('> ⚠️ 本文件由 `scripts/assessor/quality-model.mjs --emit-matrix` 生成，请勿手工编辑。');
  L.push('>    单一真相源是 `scripts/assessor/quality-model.mjs`；`references/assessor/checks.yaml` 是同一数据的机器可读形式。');
  L.push('');
  L.push('## 0. 与 SPEC 的关系');
  L.push('');
  L.push('| | SPEC（阶段 2） | QM（阶段 3） |');
  L.push('|---|---|---|');
  L.push('| 回答的问题 | 「这个技能合法吗」 | 「这个技能有多成熟」 |');
  L.push('| 判定形态 | 二值（通过 / 不通过） | 分级（每维度 L1–L5） |');
  L.push('| 作用 | **准入闸门**：不达标不能发布 | **成熟度评分**：给出改进路径 |');
  L.push('| 依据 | 生态硬约束（官方 spec 与文档原文） | 工程质量经验 + 本规范新增约定 |');
  L.push('');
  L.push('二者**必须级别一致**：QM 条目的级别不得低于其依赖的 SPEC 检查的起始级别。');
  L.push('这条一致性由 `scripts/assessor/score.mjs --self-check-only`（SELF-002）强制，失配时退出码为 3。');
  L.push('');
  L.push('## 1. 等级定义');
  L.push('');
  L.push('| 级别 | 名称 | 判据 |');
  L.push('|---|---|---|');
  for (const l of LEVELS) L.push(`| ${l.code} | ${l.name} | ${cell(l.criterion)} |`);
  L.push('');
  L.push('**累积语义**：达到 L(n) 意味着 L(1)…L(n) 的全部要求都满足。');
  L.push('');
  L.push('## 2. 维度定义');
  L.push('');
  L.push('| 代号 | 维度 | 它回答的问题 | 权重 | 关键维度 |');
  L.push('|---|---|---|---|---|');
  for (const d of DIMENSIONS) L.push(`| ${d.id} | ${d.name} | ${cell(d.question)} | ${d.weight.toFixed(1)} | ${d.gate ? '是' : '—'} |`);
  L.push('');
  L.push('### 2.1 权重的语义（重要，容易被误用）');
  L.push('');
  L.push('**权重不参与等级判定。** 整体等级始终是各维度等级的**最小值**（木桶原理）。');
  L.push('权重只用于计算**加权总分**，供横向排序使用。');
  L.push('');
  L.push('为什么不把权重用于等级聚合？因为那会让等级失去可解释性：');
  L.push('加权分 2.7 到底算 L2 还是 L3？等级必须能回答「**还差什么才能晋级**」，');
  L.push('而加权平均会把「安全 L1 + 文档 L5」和「安全 L3 + 文档 L3」算成同一个分数，');
  L.push('前者是危险的，后者是可接受的，二者不可等价。');
  L.push('');
  L.push('**在等级制下提高某个维度的权重，合法手段只有一种：门槛前移**——');
  L.push('把该维度的条目放到更低的级别，使它更早成为瓶颈。本模型对 TS（可测）就是这么做的：');
  L.push('v1.1 把该维度条目整体前移一级，「提供评测用例」从 L3 提前到 L2。');
  L.push('');
  L.push('| 维度 | 权重 | 依据 |');
  L.push('|---|---|---|');
  L.push('| TS 可测 | 2.0 | 缺失后果最**隐蔽**（改动静默破坏行为，无任何信号），且修复成本最高（要补评测体系） |');
  L.push('| SC 合规与安全 | 1.5 | 缺失后果**不可逆**（数据、凭证、权限事故无法回滚） |');
  L.push('| FN / RB / DC / MT | 1.0 | 缺失后果可见且可回滚 |');
  L.push('');
  L.push('「关键维度」是提示性标注：这些维度是实测中最常见的瓶颈，评分器会显式标出被谁卡住。');
  L.push('');
  L.push('## 3. 判定方式统计');
  L.push('');
  L.push(`共 ${total} 条 QM 条目。`);
  L.push('');
  L.push('| 判定方式 | 条数 | 占比 | 含义 |');
  L.push('|---|---|---|---|');
  L.push(`| 机器 | ${byVerify.machine} | ${(byVerify.machine / total * 100).toFixed(0)}% | 完全自动判定，CI 可作门禁 |`);
  L.push(`| 机器+专家 | ${byVerify.hybrid} | ${(byVerify.hybrid / total * 100).toFixed(0)}% | 机器先筛，专家确认语义 |`);
  L.push(`| 专家 | ${byVerify.expert} | ${(byVerify.expert / total * 100).toFixed(0)}% | 仅人工判定，必须给锚点与证据 |`);
  L.push('');
  L.push('## 4. 矩阵');
  L.push('');
  for (const d of DIMENSIONS) {
    const rows = CHECKS.filter((c) => c.dim === d.id).sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
    L.push(`### ${d.id} · ${d.name}`);
    L.push('');
    L.push('| ID | 级别 | 判定 | 要求 | 阈值 | 证据 | 豁免 | 锚点 |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const c of rows) {
      L.push(`| ${c.id} | L${c.level} | ${VERIFY_LABEL[c.verify]} | ${cell(c.req)} | ${cell(c.threshold)} | ${cell(c.evidence)} | ${cell(c.exemption)} | ${c.anchor ?? '—'} |`);
    }
    L.push('');
  }
  L.push('## 5. 评分方法');
  L.push('');
  L.push('```');
  L.push('node scripts/assessor/score.mjs <repo-root> [--scan skills] [--target L3] [--json out.json]');
  L.push('```');
  L.push('');
  L.push('**机器等级与软轨评分分开报告**：');
  L.push('');
  L.push('- **机器等级**：满足全部机器类条目的最高级别。这是**下限**，可完全自动计算。');
  L.push('- **软轨评分**：专家与混合条目由 `scripts/assessor/llm-judge.mjs` 按锚点执行两段式 verdict + critique，按置信度加权。');
  L.push('');
  L.push('评分器不再输出「待专家确认」清单；软轨结果只进入报告，不影响退出码。');
  L.push('这样既不假装机器能判定一切，也不让不可判定的条目阻塞自动化。');
  L.push('');
  L.push('**整体等级 = 各维度等级的最小值**（木桶原理）。一个技能在「功能」上达到 L5 但「安全」只有 L2，整体即为 L2。');
  L.push('评分器会同时标出**瓶颈维度**（等于整体等级的关键维度），让使用者一眼看到该补哪里。');
  L.push('');
  L.push('**加权总分**（0–5，一位小数）是辅助指标，仅用于横向排序，**不参与等级判定**：');
  L.push('');
  L.push('```');
  L.push('加权总分 = Σ(维度权重 × 维度等级) / Σ(维度权重)');
  L.push('```');
  L.push('');
  L.push('两个技能整体等级相同时，加权总分可以区分「短板是否落在关键维度上」。');
  L.push('');
  L.push('## 6. 机器可读形式');
  L.push('');
  L.push('`references/assessor/checks.yaml` 是同一份数据的机器可读形式，由以下命令生成与校验：');
  L.push('');
  L.push('```bash');
  L.push('node scripts/assessor/quality-model.mjs --emit-yaml references/assessor/checks.yaml   # 生成');
  L.push('node scripts/assessor/quality-model.mjs --check-yaml references/assessor/checks.yaml  # CI 校验是否最新');
  L.push('```');
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const emitIdx = args.indexOf('--emit-yaml');
  const checkIdx = args.indexOf('--check-yaml');
  const matrixIdx = args.indexOf('--emit-matrix');

  if (args.includes('--list')) {
    for (const c of CHECKS) {
      console.log(`${c.id}  [${c.dim} L${c.level}] [${c.verify}] ${c.req}`);
    }
    console.log(`\n共 ${CHECKS.length} 条 QM 条目（${DIMENSIONS.length} 维度 × ${LEVELS.length} 级别）`);
    process.exit(0);
  }

  if (matrixIdx >= 0) {
    const out = args[matrixIdx + 1];
    if (!out) { console.error('用法: --emit-matrix <out.md>'); process.exit(2); }
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, emitMatrix(), 'utf8');
    console.error(`已生成: ${out}`);
    process.exit(0);
  }

  const yaml = emitYaml();

  if (emitIdx >= 0) {
    const out = args[emitIdx + 1];
    if (!out) { console.error('用法: --emit-yaml <out.yaml>'); process.exit(2); }
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, yaml, 'utf8');
    console.error(`已生成: ${out}`);
    process.exit(0);
  }

  if (checkIdx >= 0) {
    const p = args[checkIdx + 1];
    if (!p || !existsSync(p)) { console.error(`--check-yaml: 文件不存在 ${p}`); process.exit(1); }
    const actual = (await readFile(p, 'utf8')).replace(/\r\n/g, '\n');
    if (actual !== yaml) {
      console.error(`[FAIL] ${p} 与 scripts/assessor/quality-model.mjs 不同步。请运行：node scripts/assessor/quality-model.mjs --emit-yaml ${p}`);
      process.exit(1);
    }
    console.error(`[PASS] ${p} 与单一真相源同步`);
    process.exit(0);
  }

  process.stdout.write(yaml);
  process.exit(0);
}

// 仅在被直接执行时跑 CLI，被 import 时保持安静
const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('quality-model.mjs');
if (isMain) main().catch((e) => { console.error(e); process.exit(2); });
