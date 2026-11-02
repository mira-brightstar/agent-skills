#!/usr/bin/env node
/**
 * validate.mjs — Skill 规范 v1 的参考实现（零依赖）
 *
 * 设计原则（源自阶段 1 反模式 A-08）：
 *   1. 每项检查必须返回**显式布尔**，禁止从人类可读文本反推成败。
 *   2. 每项检查声明 minLevel，低于该级别不检查（对应规范的「起始级别」）。
 *   3. 检查 ID 与规范条目 ID 双向可追溯（V-xxx <-> SPEC-xxx）。
 *   4. 自检 SELF-001：实现内的字段白名单必须与 JSON Schema 完全一致，防止二者漂移。
 *
 * 用法：
 *   node validate.mjs <skill-dir>                    # 校验单个技能
 *   node validate.mjs <repo-root> --scan skills/     # 校验仓库内全部技能
 *   node validate.mjs <repo-root> --scan skills/ --level 3
 *   node validate.mjs <repo-root> --json <out.json>
 *
 * 退出码：
 *   0 = 在指定级别下无 MUST 失败
 *   1 = 存在 MUST 失败
 *   2 = 参数/路径错误
 *   3 = 自检失败（Schema 与实现漂移）——这是工具链错误，不是技能错误
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listSkills } from '../lib/skill-parser.mjs';

// 注意：工作区路径含非 ASCII 字符，必须用 fileURLToPath 而非 url.pathname（后者会百分号编码）
const HERE = path.dirname(fileURLToPath(import.meta.url));
// 单一包结构：Schema 位于根 references/assessor/schema
const SCHEMA_DIR = path.join(HERE, '..', '..', 'references', 'assessor', 'schema');

// ---------------------------------------------------------------------------
// 0. 字段白名单（必须与 JSON Schema 保持一致，由 SELF-001 强制）
// ---------------------------------------------------------------------------
const L0_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
const L1_FIELDS = [
  'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation', 'user-invocable',
  'disallowed-tools', 'model', 'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell',
];
const ALL_FIELDS = new Set([...L0_FIELDS, ...L1_FIELDS]);

/**
 * SPEC-021 的实现边界（重要设计决策）：
 * 只对**有文档化作用域语法**的工具要求收窄。依据【已验证】E-10：
 * CC 官方文档给出的 allowed-tools 示例为 `Read Grep`（裸名）与 `Bash(git add *)`（带作用域）。
 * 即：Bash 系工具有明确的作用域语法，裸名意味着无限制命令执行，必须判失败；
 * 而 Read/Write/Edit 等工具在 allowed-tools 中的作用域语法**未获官方文档证实**【未验证】，
 * 因此不对它们提作用域要求——否则会产出无法修复的误报（本检查器首版即踩中此坑）。
 */
const SCOPABLE_TOOLS_REQUIRING_SCOPE = new Set(['Bash', 'PowerShell', 'Execute']);

/** SPEC-042~045 要求的正文固定小节 */
const REQUIRED_SECTIONS = ['Inputs', 'Outputs', 'Failure modes', 'Side effects', 'Dependencies'];

/** SPEC-071 豁免：模板文件不是可执行脚本 */
const SCRIPT_EXEMPT = /\.template\./i;
const SCRIPT_EXT = /\.(sh|bash|zsh|ps1|py|rb)$/i;

/** SPEC-075/076/077：随包大体积数据、绝对路径、读取范围 */
const LARGE_DATA_EXT = /\.(txt|csv|json|pdf|epub|zip|tar|gz|7z|docx?|xlsx?|pptx?)$/i;
const LARGE_DATA_BYTES = 2 * 1024 * 1024;
const LICENSE_RE = /(license|licence|许可|授权|permission|copyright|©|版权)/i;
const ABSOLUTE_PATH_RE = /(?:(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s"'<>|]+|(?<![A-Za-z0-9])\/(?:Users|home)\/[^\s"'<>|]+)/;
const READ_SCOPE_RE = /(读取|读文件|读取文件|read|reading|目录|directory|文件|file)/i;
const NO_SIDE_EFFECT_RE = /(无副作用|不读取|不写文件|纯文本|none|no side effects|只输出)/i;

/** SPEC-070 密钥模式 */
const SECRET_PATTERNS = [
  { name: 'OpenAI/Anthropic 风格密钥', re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: '私钥块', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: '赋值式凭证', re: /\b(?:password|passwd|api[_-]?key|secret|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9/+=_-]{12,}/i },
];
/** SPEC-070 豁免：占位符不算凭证 */
const PLACEHOLDER_RE = /(<[^>]{2,}>|\$\{[^}]{2,}\}|YOUR_|EXAMPLE_|xxxx|\.\.\.)/i;

// ---------------------------------------------------------------------------
// 1. 最小 YAML 子集解析器（够用于 frontmatter 与 openai.yaml）
// ---------------------------------------------------------------------------
function yamlScalar(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) {
    return v.slice(1, -1);
  }
  if (/^(true|false|yes|no|on|off)$/i.test(v)) return /^(true|yes|on)$/i.test(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root, key: null, parent: null }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    let frame = stack[stack.length - 1];

    if (line.startsWith('- ')) {
      // 列表项：若当前容器不是数组，就地把它替换成数组
      if (!Array.isArray(frame.obj)) {
        if (frame.parent && frame.key !== null) {
          const arr = [];
          frame.parent[frame.key] = arr;
          frame.obj = arr;
        } else {
          continue;
        }
      }
      frame.obj.push(yamlScalar(line.slice(2)));
      continue;
    }

    const m = /^([^:]+):[ \t]*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const rest = m[2];
    if (rest === '') {
      const child = {};
      frame.obj[key] = child;
      stack.push({ indent, obj: child, key, parent: frame.obj });
    } else {
      frame.obj[key] = yamlScalar(rest);
    }
  }
  return root;
}

// ---------------------------------------------------------------------------
// 2. 工具函数
// ---------------------------------------------------------------------------
async function readText(p) {
  return existsSync(p) ? readFile(p, 'utf8') : null;
}
async function listDirs(p) {
  if (!existsSync(p)) return [];
  return (await readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
async function listFiles(dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      await listFiles(full, base, acc);
    } else {
      const st = await stat(full);
      acc.push({ rel: path.relative(base, full).split(path.sep).join('/'), full, size: st.size });
    }
  }
  return acc;
}
/** 从 SKILL.md 文本切出 frontmatter 原文与正文 */
function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  const firstLineIsDelimiter = lines[0]?.trim() === '---';
  if (!firstLineIsDelimiter) return { ok: false, reason: 'first-line-not-delimiter', fmRaw: null, body: text };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { ok: false, reason: 'unclosed-frontmatter', fmRaw: null, body: text };
  return { ok: true, fmRaw: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') };
}
/** 把 allowed-tools 的字符串或数组统一成工具名数组 */
function toToolList(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(/[\s,]+/).filter(Boolean);
  return [];
}

// ---------------------------------------------------------------------------
// 3. 检查注册表
// ---------------------------------------------------------------------------
const results = [];
/**
 * 记录一条检查结果。
 *
 * 三态模型（阶段 5 一致性验证暴露的缺陷修正）：
 *   failed=true        → 不通过
 *   failed=false       → 通过
 *   na=true            → **不适用**（命中豁免条件）
 *
 * 为什么必须有 na：检查命中豁免时若返回「通过」，机器会与专家的「不适用」判定
 * 系统性冲突。阶段 5 实测中 QM-SC-L4（未声明 allowed-tools 即豁免）在 6 个技能上
 * 全部产生 pass-vs-na 分歧，是 kappa 未达标的首要原因。
 * 语义上「不适用」与「通过」完全不同：前者是这条要求对该技能无意义，
 * 后者是技能满足了要求。混淆二者会让合规率虚高。
 */
function record(check, failed, conclusion, evidence = [], samples = [], na = false) {
  results.push({
    id: check.id, spec: check.spec, severity: check.severity, minLevel: check.minLevel,
    title: check.title, failed, na, conclusion, evidence, sampleCount: samples.length, samples: samples.slice(0, 6),
  });
}

/**
 * 检查定义。run(ctx) 返回 { failed, conclusion, evidence[], samples[] }
 * ctx = { skillName, dir, skillText, fm, body, oaText, oa, files, repoSkills, skillIndex }
 */
/**
 * 检查注册表。
 *
 * ⚠️ 本数组被 scripts/assessor/score.mjs import 用于交叉校验（SELF-002）：
 *    QM 条目的级别不得低于其依赖的 V 检查的 minLevel。
 *    因此新增/修改检查的 minLevel 时，必须同步检查 quality-model.mjs 是否失配。
 */
export const CHECKS = [
  {
    id: 'V-001', spec: 'SPEC-001', severity: 'MUST', minLevel: 1, title: '技能目录必须含 SKILL.md',
    run: (c) => ({ failed: c.skillText === null, conclusion: c.skillText === null ? '缺少 SKILL.md' : '存在', evidence: [], samples: c.skillText === null ? [c.dir] : [] }),
  },
  {
    id: 'V-002', spec: 'SPEC-002', severity: 'MUST', minLevel: 1, title: '目录名必须匹配 ^[a-z0-9]+(-[a-z0-9]+)*$ 且长度 1-64',
    run: (c) => {
      const ok = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.skillName) && c.skillName.length >= 1 && c.skillName.length <= 64;
      return { failed: !ok, conclusion: ok ? `"${c.skillName}" 合法` : `"${c.skillName}" 不合法`, evidence: [], samples: ok ? [] : [c.dir] };
    },
  },
  {
    id: 'V-003', spec: 'SPEC-003', severity: 'MUST', minLevel: 1, title: 'SKILL.md 第一行必须是 ---',
    run: (c) => ({ failed: c.fm ? c.fm.ok === false && c.fm.reason === 'first-line-not-delimiter' : false, conclusion: c.fm?.ok ? '首行正确' : '首行不是 ---', evidence: [], samples: c.fm && !c.fm.ok ? [c.dir] : [] }),
  },
  {
    id: 'V-004', spec: 'SPEC-004', severity: 'MUST', minLevel: 1, title: 'frontmatter 必须由 --- 闭合且为合法 YAML',
    run: (c) => {
      if (!c.fm || !c.fm.ok) return { failed: true, conclusion: 'frontmatter 未闭合或缺失', evidence: [], samples: [c.dir] };
      const empty = Object.keys(c.frontmatter).length === 0;
      return { failed: empty, conclusion: empty ? 'frontmatter 解析为空（静默失效）' : '已闭合且可解析', evidence: [], samples: empty ? [c.dir] : [] };
    },
  },
  {
    id: 'V-010', spec: 'SPEC-010', severity: 'MUST', minLevel: 1, title: 'frontmatter.name 必须存在且等于目录名',
    run: (c) => {
      const n = c.frontmatter.name;
      const ok = typeof n === 'string' && n === c.skillName;
      return { failed: !ok, conclusion: ok ? `name == 目录名 "${c.skillName}"` : `name=${JSON.stringify(n)} 与目录名 "${c.skillName}" 不一致`, evidence: [], samples: ok ? [] : [c.dir] };
    },
  },
  {
    id: 'V-011', spec: 'SPEC-011', severity: 'MUST', minLevel: 1, title: 'frontmatter.description 必须非空且 1-1024 字符',
    run: (c) => {
      const d = c.frontmatter.description;
      const ok = typeof d === 'string' && d.length >= 1 && d.length <= 1024;
      return { failed: !ok, conclusion: ok ? `${d.length} 字符` : `description 缺失或长度非法（${typeof d === 'string' ? d.length : 'N/A'}）`, evidence: [], samples: ok ? [] : [c.dir] };
    },
  },
  {
    id: 'V-013', spec: 'SPEC-013', severity: 'SHOULD', minLevel: 3, title: 'description + when_to_use 合并 <= 1536 字符',
    run: (c) => {
      const total = String(c.frontmatter.description ?? '').length + String(c.frontmatter.when_to_use ?? '').length;
      const ok = total <= 1536;
      return { failed: !ok, conclusion: `合并 ${total} 字符`, evidence: [], samples: ok ? [] : [`${c.dir}: ${total}`] };
    },
  },
  {
    id: 'V-014', spec: 'SPEC-014', severity: 'MUST', minLevel: 1, title: '字段名必须来自白名单（未知字段即静默失效）',
    run: (c) => {
      const unknown = Object.keys(c.frontmatter).filter((k) => !ALL_FIELDS.has(k));
      return { failed: unknown.length > 0, conclusion: unknown.length ? `${unknown.length} 个未知字段` : `全部合法（${Object.keys(c.frontmatter).length} 个字段）`, evidence: [], samples: unknown.map((k) => `${c.dir}: ${k}`) };
    },
  },
  {
    id: 'V-015', spec: 'SPEC-015', severity: 'MUST', minLevel: 1, title: '字段名必须为小写连字符（例外 when_to_use）',
    run: (c) => {
      const bad = Object.keys(c.frontmatter).filter((k) => k !== 'when_to_use' && !/^[a-z][a-z0-9-]*$/.test(k));
      return { failed: bad.length > 0, conclusion: bad.length ? `${bad.length} 个字段名格式非法` : '全部合法', evidence: [], samples: bad.map((k) => `${c.dir}: ${k}`) };
    },
  },
  {
    id: 'V-016', spec: 'SPEC-016', severity: 'MUST', minLevel: 4, title: 'metadata 必须为 string -> string 映射（禁止嵌套）',
    run: (c) => {
      const m = c.frontmatter.metadata;
      if (m === undefined) return { failed: false, na: true, conclusion: '不适用：未使用 metadata（豁免）', evidence: [], samples: [] };
      if (typeof m !== 'object' || m === null || Array.isArray(m)) return { failed: true, conclusion: 'metadata 不是映射', evidence: [], samples: [c.dir] };
      const bad = Object.entries(m).filter(([, v]) => typeof v !== 'string');
      return { failed: bad.length > 0, conclusion: bad.length ? `${bad.length} 个值不是字符串（含嵌套对象/数字）` : `${Object.keys(m).length} 个键均为字符串值`, evidence: [], samples: bad.map(([k, v]) => `${c.dir}: metadata.${k} = ${Array.isArray(v) ? 'array' : typeof v}`) };
    },
  },
  {
    id: 'V-017', spec: 'SPEC-017', severity: 'MUST', minLevel: 4, title: 'metadata 的键不得复用 frontmatter 字段名',
    run: (c) => {
      const m = c.frontmatter.metadata;
      if (!m || typeof m !== 'object' || Array.isArray(m)) return { failed: false, na: true, conclusion: '不适用：无 metadata', evidence: [], samples: [] };
      const clash = Object.keys(m).filter((k) => ALL_FIELDS.has(k));
      return { failed: clash.length > 0, conclusion: clash.length ? `${clash.length} 个键与字段名冲突` : '无冲突', evidence: [], samples: clash.map((k) => `${c.dir}: ${k}`) };
    },
  },
  {
    id: 'V-019', spec: 'SPEC-019', severity: 'MAY', minLevel: 3, title: 'compatibility <= 500 字符',
    run: (c) => {
      const v = c.frontmatter.compatibility;
      if (v === undefined) return { failed: false, na: true, conclusion: '不适用：未使用 compatibility', evidence: [], samples: [] };
      const ok = typeof v === 'string' && v.length <= 500;
      return { failed: !ok, conclusion: `长度 ${String(v).length}`, evidence: [], samples: ok ? [] : [`${c.dir}: ${String(v).length} 字符`] };
    },
  },
  {
    id: 'V-021', spec: 'SPEC-021', severity: 'SHOULD', minLevel: 4, title: 'allowed-tools 中 Bash 系工具必须收窄作用域',
    run: (c) => {
      const tools = toToolList(c.frontmatter['allowed-tools']);
      // 豁免：未声明 allowed-tools。此处返回 na 而非 pass——「没有这条要求」与
      // 「满足了这条要求」语义不同，混淆会让合规率虚高（见 record() 的三态说明）。
      if (tools.length === 0) return { failed: false, na: true, conclusion: '不适用：未使用 allowed-tools（豁免）', evidence: ['SPEC-021 豁免项'], samples: [] };
      const bad = tools.filter((t) => SCOPABLE_TOOLS_REQUIRING_SCOPE.has(t.trim()));
      const scoped = tools.filter((t) => /^[A-Za-z]+\(.+\)$/.test(t.trim()));
      return {
        failed: bad.length > 0,
        conclusion: bad.length ? `${bad.length} 个 Bash 系工具使用裸名（等于无限制命令执行）` : `${tools.length} 个工具中 ${scoped.length} 个已带作用域`,
        evidence: ['仅对有文档化作用域语法的工具判定；Read/Write/Edit 的裸名不判失败（见源码注释）'],
        samples: bad.map((t) => `${c.dir}: ${t}`),
      };
    },
  },
  {
    id: 'V-030', spec: 'SPEC-030', severity: 'MUST', minLevel: 2, title: '触发方式必须可判定（user-invoked / model-invoked）',
    run: (c) => {
      const dmi = c.frontmatter['disable-model-invocation'];
      const ui = c.frontmatter['user-invocable'];
      const dmiOn = dmi === true || dmi === 'true';
      const uiOff = ui === false || ui === 'false';
      if (dmiOn && uiOff) return { failed: true, conclusion: 'disable-model-invocation 与 user-invocable:false 同时出现，语义矛盾', evidence: [], samples: [c.dir] };
      return { failed: false, conclusion: dmiOn ? 'user-invoked' : 'model-invoked', evidence: [], samples: [] };
    },
  },
  {
    id: 'V-031', spec: 'SPEC-031', severity: 'MUST', minLevel: 2, title: '触发方式跨生态必须一致（SKILL.md <-> agents/openai.yaml）',
    run: (c) => {
      const dmi = c.frontmatter['disable-model-invocation'];
      const dmiOn = dmi === true || dmi === 'true';
      if (!c.oa) return { failed: false, conclusion: '未提供 agents/openai.yaml（SPEC-062 另行判定）', evidence: [], samples: [] };
      const declared = c.oa.policy?.allow_implicit_invocation;
      const declaresFalse = declared === false || declared === 'false';
      const ok = dmiOn === declaresFalse;
      return {
        failed: !ok,
        conclusion: ok ? `一致（${dmiOn ? 'user-invoked' : 'model-invoked'}）` : `矛盾：SKILL.md disable-model-invocation=${dmiOn}，openai.yaml allow_implicit_invocation=${JSON.stringify(declared)}`,
        evidence: [], samples: ok ? [] : [c.dir],
      };
    },
  },
  {
    id: 'V-033', spec: 'SPEC-033', severity: 'SHOULD', minLevel: 2, title: 'model-invoked 的 description 必须含显式触发词；user-invoked 不得写成触发句',
    run: (c) => {
      const d = String(c.frontmatter.description ?? '');
      const dmi = c.frontmatter['disable-model-invocation'];
      const userInvoked = dmi === true || dmi === 'true';
      // 触发分支：英文 Use when / When the user，中文 当用户 / 何时使用 / 使用场景。
      // 只认显式分支，不靠“写得好不好”这类主观判断。
      const TRIGGER = /(use\s+(?:this|when|for)|when\s+(?:the\s+)?user|when\s+asked|trigger|当用户|当需要|在用户|用户(?:说|提到|要求)|何时使用|使用场景|什么时候用)/i;
      if (userInvoked) {
        const bad = TRIGGER.test(d);
        return {
          failed: bad,
          conclusion: bad ? 'user-invoked 却写了模型触发句（应改为面向人的摘要）' : 'user-invoked 且未写触发句',
          evidence: ['锚点 §4.4：user-invoked 描述面向人，model-invoked 描述含触发分支'],
          samples: bad ? [`${c.dir}: description 含触发句`] : [],
        };
      }
      const hasTrigger = TRIGGER.test(d);
      return {
        failed: !hasTrigger,
        conclusion: hasTrigger ? 'model-invoked 且含显式触发词' : 'model-invoked 但 description 未给出何时使用（缺少触发词，模型难以自动发现）',
        evidence: ['锚点 §4.4：model-invoked 的 description 必须含触发分支'],
        samples: hasTrigger ? [] : [`${c.dir}: ${d.length} 字符，无触发词`],
      };
    },
  },
  {
    id: 'V-041', spec: 'SPEC-041', severity: 'MUST', minLevel: 2, title: 'argument-hint 的每个占位符必须在正文被解释',
    run: (c) => {
      const hint = c.frontmatter['argument-hint'];
      if (typeof hint !== 'string') return { failed: false, na: true, conclusion: '不适用：未使用 argument-hint', evidence: [], samples: [] };
      const tokens = [...hint.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
      const args = c.frontmatter.arguments;
      const named = Array.isArray(args) ? args.map(String) : (typeof args === 'string' ? args.split(/[\s,]+/).filter(Boolean) : []);
      const all = [...new Set([...tokens, ...named])];
      const missing = all.filter((t) => !c.body.includes(t));
      return { failed: missing.length > 0, conclusion: missing.length ? `${missing.length} 个占位符未被正文解释` : `${all.length} 个占位符均已解释`, evidence: [], samples: missing.map((t) => `${c.dir}: ${t}`) };
    },
  },
  {
    id: 'V-042', spec: 'SPEC-042', severity: 'MUST', minLevel: 3, title: '正文必须含 Outputs 小节（输出契约）',
    run: (c) => hasSection(c, 'Outputs'),
  },
  {
    id: 'V-040', spec: 'SPEC-040', severity: 'MUST', minLevel: 3, title: '正文必须含 Inputs 小节（输入契约）',
    run: (c) => hasSection(c, 'Inputs'),
  },
  {
    id: 'V-043', spec: 'SPEC-043', severity: 'MUST', minLevel: 3, title: '正文必须含 Failure modes 小节（失败模式）',
    run: (c) => hasSection(c, 'Failure modes'),
  },
  {
    id: 'V-045', spec: 'SPEC-045', severity: 'MUST', minLevel: 3, title: '正文必须含 Side effects 小节（副作用声明）',
    run: (c) => hasSection(c, 'Side effects'),
  },
  {
    id: 'V-050', spec: 'SPEC-050', severity: 'MUST', minLevel: 3, title: '必须声明依赖（正文 Dependencies 小节或 compatibility）',
    run: (c) => {
      const hasSec = /^#{1,6}\s*Dependencies\b/im.test(c.body);
      const hasCompat = typeof c.frontmatter.compatibility === 'string' && c.frontmatter.compatibility.length > 0;
      const ok = hasSec || hasCompat;
      return { failed: !ok, conclusion: ok ? `来源：${[hasSec && 'Dependencies 小节', hasCompat && 'compatibility'].filter(Boolean).join(' + ')}` : '既无 Dependencies 小节也无 compatibility', evidence: [], samples: ok ? [] : [c.dir] };
    },
  },
  {
    id: 'V-052', spec: 'SPEC-052', severity: 'MUST', minLevel: 2, title: '不得用跨目录文件路径引用其他技能',
    run: (c) => {
      const hits = [...c.body.matchAll(/\]\(\.\.\/[^)\s]+/g)].map((m) => m[0].slice(2));
      return { failed: hits.length > 0, conclusion: hits.length ? `${hits.length} 处跨目录引用` : '无跨目录引用', evidence: ['规范要求改用 Call the Skill tool with "X"'], samples: hits.map((h) => `${c.dir}: ${h}`) };
    },
  },
  {
    id: 'V-053', spec: 'SPEC-053', severity: 'MUST', minLevel: 5, title: 'user-invoked 技能不得被任何技能调用',
    run: (c) => {
      const viol = [];
      for (const [caller, targets] of c.skillIndex.calls) {
        for (const t of targets) {
          const target = c.repoSkills.find((s) => s.name === t);
          if (!target) continue;
          if (target.userInvoked && caller !== t) viol.push(`${caller} -> ${t}（${t} 是 user-invoked）`);
        }
      }
      const uniq = [...new Set(viol)];
      return { failed: uniq.length > 0, conclusion: uniq.length ? `${uniq.length} 处非法调用` : `检查 ${c.skillIndex.calls.size} 个调用方`, evidence: [], samples: uniq };
    },
  },
  {
    id: 'V-060', spec: 'SPEC-060', severity: 'MUST', minLevel: 3, title: '声明 portable 时不得使用 L1 字段',
    run: (c) => {
      const p = c.frontmatter.metadata?.portability;
      if (p === undefined) return { failed: false, na: true, conclusion: '不适用：未声明 portability（由 V-061 判定）', evidence: [], samples: [] };
      if (p !== 'portable') return { failed: false, na: true, conclusion: `不适用：portability=${p}（非 portable）`, evidence: [], samples: [] };
      const used = Object.keys(c.frontmatter).filter((k) => L1_FIELDS.includes(k));
      return {
        failed: used.length > 0,
        conclusion: used.length ? `声明 portable 却使用了 L1 字段：${used.join(', ')}` : '声明 portable 且仅使用 L0 字段',
        evidence: ['portable 承诺跨生态可移植，而 L1 字段在 claude.ai 上传/Skills API 打包时硬报错'],
        samples: used.length ? [c.dir] : [],
      };
    },
  },
  {
    id: 'V-061', spec: 'SPEC-061', severity: 'MUST', minLevel: 3, title: '使用 L1 字段必须声明 metadata.portability: claude-code-only',
    run: (c) => {
      const used = Object.keys(c.frontmatter).filter((k) => L1_FIELDS.includes(k));
      if (used.length === 0) return { failed: false, na: true, conclusion: '不适用：未使用 L1 字段（无需声明）', evidence: [], samples: [] };
      const p = c.frontmatter.metadata?.portability;
      const ok = p === 'claude-code-only';
      return {
        failed: !ok,
        conclusion: ok
          ? `已声明 claude-code-only（使用 ${used.length} 个 L1 字段：${used.join(', ')}）`
          : `使用 ${used.join(', ')} 但 metadata.portability=${JSON.stringify(p)}（期望 "claude-code-only"）`,
        evidence: [`合法取值：${PORTABILITY_VALUES.join(' | ')}`, '声明位置：frontmatter.metadata.portability'],
        samples: ok ? [] : [`${c.dir}: ${used.join(', ')}`],
      };
    },
  },
  {
    id: 'V-062', spec: 'SPEC-062', severity: 'SHOULD', minLevel: 4, title: '声明支持 Codex 时必须提供 agents/openai.yaml',
    run: (c) => {
      const claimsCodex = /codex/i.test(c.body) || /codex/i.test(String(c.frontmatter.compatibility ?? ''));
      if (!claimsCodex) return { failed: false, na: true, conclusion: '不适用：未声明支持 Codex（不强制）', evidence: [], samples: [] };
      return { failed: !c.oa, conclusion: c.oa ? '已提供' : '声明支持 Codex 但缺少 agents/openai.yaml', evidence: [], samples: c.oa ? [] : [c.dir] };
    },
  },
  {
    id: 'V-070', spec: 'SPEC-070', severity: 'MUST', minLevel: 2, title: '不得包含硬编码凭证/密钥/token',
    run: (c) => {
      const hits = [];
      for (const f of c.files) {
        if (!/\.(md|ya?ml|sh|bash|zsh|ps1|py|js|mjs|cjs|ts|json|txt)$/i.test(f.rel)) continue;
        const t = c.fileCache.get(f.rel);
        if (typeof t !== 'string') continue;
        for (const p of SECRET_PATTERNS) {
          for (const line of t.split(/\r?\n/)) {
            if (p.re.test(line) && !PLACEHOLDER_RE.test(line)) hits.push(`${f.rel}: ${p.name}`);
          }
        }
      }
      const uniq = [...new Set(hits)];
      return { failed: uniq.length > 0, conclusion: uniq.length ? `${uniq.length} 处疑似凭证` : `扫描 ${c.files.length} 个文件，未发现`, evidence: [], samples: uniq };
    },
  },
  {
    id: 'V-071', spec: 'SPEC-071', severity: 'MUST', minLevel: 4, title: '可执行脚本必须有 shebang 且非空',
    run: (c) => {
      const bad = [];
      for (const f of c.files) {
        if (!SCRIPT_EXT.test(f.rel) || SCRIPT_EXEMPT.test(f.rel)) continue;
        const t = c.fileCache.get(f.rel);
        if (typeof t !== 'string') continue;
        if (t.trim().length === 0) bad.push(`${f.rel}: 空文件`);
        else if (!/^#!/.test(t.split(/\r?\n/)[0])) bad.push(`${f.rel}: 缺少 shebang`);
      }
      return { failed: bad.length > 0, conclusion: bad.length ? `${bad.length} 个脚本不合规` : '全部合规（模板文件已豁免）', evidence: ['SPEC-071 豁免：文件名含 .template. 视为模板'], samples: bad };
    },
  },
  {
    id: 'V-075', spec: 'SPEC-075', severity: 'SHOULD', minLevel: 3, title: '大体积随包数据必须有许可/授权说明',
    run: (c) => {
      const large = c.files.filter((f) => f.size >= LARGE_DATA_BYTES && LARGE_DATA_EXT.test(f.rel));
      if (large.length === 0) return { failed: false, na: true, conclusion: '不适用：无大体积随包数据', evidence: [], samples: [] };
      const licenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'].some((name) =>
        existsSync(path.join(c.dir, name)) || existsSync(path.join(c.root, name)));
      const declared = LICENSE_RE.test(`${c.skillText ?? ''}\n${c.body ?? ''}`);
      const samples = large.map((f) => `${f.rel} (${(f.size / 1024 / 1024).toFixed(1)} MB)`);
      return {
        failed: !(licenseFile || declared),
        conclusion: licenseFile || declared
          ? `已发现许可/授权说明：${licenseFile ? 'LICENSE 文件' : '正文声明'}`
          : `发现 ${large.length} 个 >2MB 数据文件，但未见许可/授权说明`,
        evidence: ['SPEC-075 新增约定：只检查是否声明，不做版权归属判断'],
        samples: licenseFile || declared ? [] : samples,
      };
    },
  },
  {
    id: 'V-076', spec: 'SPEC-076', severity: 'SHOULD', minLevel: 2, title: '技能文本不得包含本机绝对路径',
    run: (c) => {
      const hits = [];
      for (const f of c.files) {
        if (!/\.(md|ya?ml|json|txt)$/i.test(f.rel)) continue;
        const t = c.fileCache.get(f.rel);
        if (typeof t !== 'string') continue;
        for (const line of t.split(/\r?\n/)) {
          if (PLACEHOLDER_RE.test(line)) continue;
          const m = line.match(ABSOLUTE_PATH_RE);
          if (m) hits.push(`${f.rel}: ${m[0]}`);
        }
      }
      return {
        failed: hits.length > 0,
        conclusion: hits.length ? `${hits.length} 处本机绝对路径` : '未发现本机绝对路径',
        evidence: ['SPEC-076 新增约定：占位符路径豁免'],
        samples: hits,
      };
    },
  },
  {
    id: 'V-077', spec: 'SPEC-077', severity: 'SHOULD', minLevel: 3, title: 'Side effects 必须声明读取范围',
    run: (c) => {
      const sec = sectionText(c.body, 'Side effects');
      if (!sec) return { failed: true, conclusion: '缺少 Side effects 小节，无法判断读取范围', evidence: ['SPEC-077 依赖 SPEC-045 的 Side effects 小节'], samples: [c.dir] };
      if (NO_SIDE_EFFECT_RE.test(sec)) return { failed: false, conclusion: '已声明无副作用或不读取', evidence: [], samples: [] };
      const hasRead = READ_SCOPE_RE.test(sec);
      return {
        failed: !hasRead,
        conclusion: hasRead ? 'Side effects 已包含读取范围说明' : 'Side effects 未说明读取哪些目录/文件',
        evidence: ['SPEC-077 只检查声明，不验证实际读取行为'],
        samples: hasRead ? [] : [c.dir],
      };
    },
  },
];

function hasSection(c, name) {
  const re = new RegExp(`^#{1,6}\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im');
  const ok = re.test(c.body);
  return { failed: !ok, conclusion: ok ? `含 ${name} 小节` : `缺少 ${name} 小节`, evidence: [`要求小节：${REQUIRED_SECTIONS.join(' / ')}`], samples: ok ? [] : [c.dir] };
}

function sectionText(body, name) {
  const lines = body.split(/\r?\n/);
  const heading = new RegExp(`^#{1,6}\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return '';
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

// ---------------------------------------------------------------------------
// 4. 自检：Schema 与实现的字段白名单必须一致
// ---------------------------------------------------------------------------
async function selfCheck() {
  const problems = [];
  for (const [file, expect] of [
    ['skill-frontmatter.core.schema.json', L0_FIELDS],
    ['skill-frontmatter.claude-code.schema.json', [...L0_FIELDS, ...L1_FIELDS]],
  ]) {
    const p = path.join(SCHEMA_DIR, file);
    const t = await readText(p);
    if (t === null) { problems.push(`${file}: 文件不存在`); continue; }
    let schema;
    try { schema = JSON.parse(t); } catch (e) { problems.push(`${file}: JSON 解析失败 ${e.message}`); continue; }
    const props = Object.keys(schema.properties ?? {}).sort();
    const exp = [...expect].sort();
    const missing = exp.filter((k) => !props.includes(k));
    const extra = props.filter((k) => !exp.includes(k));
    if (missing.length) problems.push(`${file}: schema 缺少字段 ${missing.join(', ')}`);
    if (extra.length) problems.push(`${file}: schema 多出字段 ${extra.join(', ')}`);
    if (schema.additionalProperties !== false) problems.push(`${file}: additionalProperties 必须为 false（SPEC-014 静默失效防护）`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 5. 主流程
// ---------------------------------------------------------------------------
async function buildContext(root, dir, repoSkills, skillIndex) {
  const skillText = await readText(path.join(dir, 'SKILL.md'));
  const fm = skillText ? splitFrontmatter(skillText) : null;
  const frontmatter = fm?.ok ? parseYaml(fm.fmRaw) : {};
  const body = fm?.ok ? fm.body : (skillText ?? '');
  const oaText = await readText(path.join(dir, 'agents', 'openai.yaml'));
  const oa = oaText ? parseYaml(oaText) : null;
  const files = await listFiles(dir);
  const fileCache = new Map();
  for (const f of files) {
    if (f.size < 512 * 1024) fileCache.set(f.rel, await readText(f.full));
  }
  return {
    root, skillName: path.basename(dir), dir, skillText, fm, frontmatter, body,
    oaText, oa, files, fileCache, repoSkills, skillIndex,
  };
}

async function discoverSkills(root, scanDir) {
  // 支持单技能、扁平（skills/<skill>）与分桶（skills/<bucket>/<skill>）三种布局
  return (await listSkills(root, scanDir)).map((s) => s.dir);
}

/**
 * SPEC-060 / SPEC-061 的可移植性标记（本规范新增约定）。
 *
 * 设计演进（记录一次真实的粒度修正）：
 *   v1 版 V-061 靠正则匹配散文来检测"仓库级可移植性声明"，回测样本仓库时
 *   既产生 22/38 的失败、又因为正则匹配不到样本的实际措辞而漏检——两头不讨好。
 *   根因是**用自然语言匹配做判定**，违反本检查器自己的 A-08 原则。
 *   v2 版改为要求一个机器可判定的显式标记，放进 spec 允许的 metadata 扩展位：
 *
 *     metadata:
 *       portability: "claude-code-only"   # 使用了 L1 字段，仅 Claude Code 生效
 *       portability: "portable"           # 只用 L0 六字段，跨生态可移植
 *
 *   代价：每个使用 L1 字段的技能需增加一行。收益：判定零歧义、可完全自动化、
 *   不需要维护任何措辞正则。符合"宁可多一行元数据，也不要模糊判定"的取舍。
 */
const PORTABILITY_VALUES = ['portable', 'claude-code-only'];

/** 建立全仓依赖图：谁调用了谁 */
async function buildSkillIndex(dirs) {
  const skills = [];
  const calls = new Map();
  for (const d of dirs) {
    const t = await readText(path.join(d, 'SKILL.md'));
    if (t === null) continue;
    const fm = splitFrontmatter(t);
    const frontmatter = fm.ok ? parseYaml(fm.fmRaw) : {};
    const dmi = frontmatter['disable-model-invocation'];
    skills.push({ name: path.basename(d), dir: d, userInvoked: dmi === true || dmi === 'true' });
    const targets = [...t.matchAll(/[Cc]all the Skill tool(?:[^."]*?)?with\s+[`"']([a-z0-9-]+)[`"']/g)].map((m) => m[1]);
    calls.set(path.basename(d), [...new Set(targets)]);
  }
  return { skills, calls };
}

async function main() {
  const args = process.argv.slice(2);
  const rawRoot = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--scan' && args[args.indexOf(a) - 1] !== '--level' && args[args.indexOf(a) - 1] !== '--json');
  const root = rawRoot ? path.resolve(rawRoot) : null;
  const scanIdx = args.indexOf('--scan');
  const scanDir = scanIdx >= 0 ? args[scanIdx + 1] : null;
  const levelIdx = args.indexOf('--level');
  const level = levelIdx >= 0 ? Number(args[levelIdx + 1]) : 5;
  const jsonIdx = args.indexOf('--json');
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

  // 仅跑工具链自检，不校验任何技能。CI 的第一道门禁用它。
  if (args.includes('--self-check-only')) {
    const problems = await selfCheck();
    if (problems.length) {
      console.error('[SELF-001 FAIL] 实现与 JSON Schema 漂移：');
      for (const p of problems) console.error('  - ' + p);
      process.exit(3);
    }
    console.error('[SELF-001 PASS] 实现与 JSON Schema 的字段白名单一致');
    process.exit(0);
  }

  if (!root || !existsSync(root)) { console.error('用法: node validate.mjs <skill-dir|repo-root> [--scan <dir>] [--level 1-5] [--json <out>] [--self-check-only]'); process.exit(2); }
  if (!Number.isInteger(level) || level < 1 || level > 5) { console.error('--level 必须是 1-5'); process.exit(2); }

  // SELF-001
  const selfProblems = await selfCheck();
  if (selfProblems.length) {
    console.error('[SELF-001 FAIL] 实现与 JSON Schema 漂移：');
    for (const p of selfProblems) console.error('  - ' + p);
    process.exit(3);
  }
  console.error('[SELF-001 PASS] 实现与 JSON Schema 的字段白名单一致');

  const dirs = await discoverSkills(root, scanDir);
  if (dirs.length === 0) { console.error(`未在 ${root}${scanDir ? '/' + scanDir : ''} 下发现技能目录`); process.exit(2); }

  const skillIndex = await buildSkillIndex(dirs);
  const active = CHECKS.filter((c) => c.minLevel <= level);

  const perSkill = [];
  /** 逐技能 × 逐检查的通过情况，供 score.mjs 计算质量等级 */
  const skillDetail = {};
  for (const dir of dirs) {
    skillDetail[path.relative(root, dir).split(path.sep).join('/')] = {};
  }
  for (const check of active) {
    const samples = [];
    let failedCount = 0, naCount = 0;
    const conclusions = new Set();
    for (const dir of dirs) {
      const ctx = await buildContext(root, dir, skillIndex.skills, skillIndex);
      const r = check.run(ctx);
      conclusions.add(r.conclusion);
      const key = path.relative(root, dir).split(path.sep).join('/');
      // 三态：'na'（不适用）/ true（通过）/ false（不通过）
      skillDetail[key][check.id] = r.na ? 'na' : !r.failed;
      if (r.na) naCount++;
      else if (r.failed) { failedCount++; samples.push(...r.samples); }
    }
    const failed = failedCount > 0;
    const allNa = naCount === dirs.length;
    const summary = dirs.length > 1
      ? (allNa ? `全部不适用（${naCount}/${dirs.length} 豁免）` : `${dirs.length - failedCount - naCount}/${dirs.length} 通过${naCount ? `，${naCount} 不适用` : ''}`)
      : [...conclusions][0];
    record(check, failed, summary, [], samples, allNa);
    perSkill.push({ id: check.id, failedCount, naCount, total: dirs.length });
  }

  const must = results.filter((r) => r.severity === 'MUST');
  const mustFail = must.filter((r) => r.failed);

  console.log(`\n=== Skill 规范 v1 校验 · 级别 L${level} · ${dirs.length} 个技能 ===\n`);
  for (const r of results) {
    const flag = r.na ? 'N/A ' : (r.failed ? 'FAIL' : 'PASS');
    console.log(`[${flag}] ${r.id} (${r.spec}, ${r.severity}, >=L${r.minLevel}) ${r.title}`);
    console.log(`        ${r.conclusion}`);
    for (const s of r.samples) console.log(`          - ${s}`);
  }
  const naCount = results.filter((r) => r.na).length;
  console.log(`\n合计 ${results.length} 项检查 · MUST ${must.length}（失败 ${mustFail.length}）${naCount ? ` · 不适用 ${naCount}` : ''}`);

  if (jsonOut) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify({
      generatedAt: new Date().toISOString(), root, scanDir, level, skillCount: dirs.length,
      summary: { checks: results.length, must: must.length, mustFailed: mustFail.length },
      perSkill, skillDetail, results,
    }, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }
  process.exit(mustFail.length > 0 ? 1 : 0);
}

// 仅在被直接执行时跑 CLI；被 score.mjs import 时保持安静
const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('validate.mjs');
if (isMain) main().catch((e) => { console.error(e); process.exit(2); });
