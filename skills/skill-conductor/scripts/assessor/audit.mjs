#!/usr/bin/env node
/**
 * audit.mjs — 生态一致性校验器（Phase 1 证据生成 / Phase 3 检查器雏形）
 *
 * 每条检查都有稳定 ID（C-xx），输出「结论 + 证据 + 失败样本」，并按严重级决定退出码。
 * 严重级语义：
 *   MUST   -> 违反即退出码 1（互操作/可复现被破坏）
 *   SHOULD -> 只报告，不影响退出码（质量建议）
 *   INFO   -> 统计性观察，供人判断
 *
 * 用法：
 *   node audit.mjs <repo-root> [--json <out>]
 * 退出码：
 *   0 = 无 MUST 违反
 *   1 = 存在 MUST 违反
 *   2 = 参数/路径错误
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, '..', '..', 'references', 'assessor', 'audit-config.yaml');

/** 默认配置 = 样本仓库的约定；可通过 references/assessor/audit-config.yaml 覆盖 */
const DEFAULT_CONFIG = {
  promoted: ['engineering', 'productivity'],
  non_promoted: ['misc', 'in-progress', 'deprecated'],
  doc_sections: ['What it does', 'When to reach for it', 'Common questions', "It's working if"],
  skills_dir: 'skills',
  docs_dir: 'docs',
  plugin_file: '.claude-plugin/plugin.json',
  package_file: 'package.json',
};

function parseConfig(text) {
  const out = {};
  let key = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const scalar = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw);
    if (scalar) {
      key = scalar[1];
      const val = scalar[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        out[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        out[key] = val === '' ? [] : val.replace(/^["']|["']$/g, '');
      }
      continue;
    }
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && key) {
      if (!Array.isArray(out[key])) out[key] = [];
      out[key].push(item[1].replace(/^["']|["']$/g, '').trim());
    }
  }
  return out;
}

async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  const parsed = parseConfig(await readFile(CONFIG_PATH, 'utf8'));
  return {
    promoted: parsed.promoted ?? DEFAULT_CONFIG.promoted,
    non_promoted: parsed.non_promoted ?? DEFAULT_CONFIG.non_promoted,
    doc_sections: parsed.doc_sections ?? DEFAULT_CONFIG.doc_sections,
    skills_dir: parsed.skills_dir ?? DEFAULT_CONFIG.skills_dir,
    docs_dir: parsed.docs_dir ?? DEFAULT_CONFIG.docs_dir,
    plugin_file: parsed.plugin_file ?? DEFAULT_CONFIG.plugin_file,
    package_file: parsed.package_file ?? DEFAULT_CONFIG.package_file,
  };
}

const findings = [];
/**
 * 记录一条检查结果。
 * failed 必须显式给出：默认「有失败样本即失败」，但样本非失败证据时（如 INFO 统计）
 * 必须显式传 false。绝不用自然语言匹配结论来推断成败。
 */
function add(id, severity, title, conclusion, evidence, samples = [], failed = samples.length > 0) {
  findings.push({ id, severity, title, failed, skipped: false, conclusion, evidence, sampleCount: samples.length, samples: samples.slice(0, 8) });
}

/** 记录一条显式跳过（不适用），不得静默当作通过 */
function addSkipped(id, severity, title, reason) {
  findings.push({ id, severity, title, failed: false, skipped: true, conclusion: reason, evidence: ['结构不适用，显式跳过'], sampleCount: 0, samples: [] });
}

async function readText(p) {
  return existsSync(p) ? readFile(p, 'utf8') : null;
}
async function readJson(p) {
  const t = await readText(p);
  return t ? JSON.parse(t) : null;
}
async function listDirs(p) {
  if (!existsSync(p)) return [];
  return (await readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
/** 递归列出相对路径，用于探测脚本/测试等载荷文件 */
async function listFiles(dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      await listFiles(full, base, acc);
    } else {
      acc.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return acc;
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') break;
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const rawRoot = args.find((a) => !a.startsWith('--'));
  const root = rawRoot ? path.resolve(rawRoot) : null;
  const jsonIdx = args.indexOf('--json');
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
  if (!root || !existsSync(root)) { console.error('用法: node audit.mjs <repo-root> [--json <out>]'); process.exit(2); }

  const cfg = await loadConfig();
  const skillsRoot = path.join(root, cfg.skills_dir);
  const plugin = await readJson(path.join(root, cfg.plugin_file));
  const pkg = await readJson(path.join(root, cfg.package_file));
  const readme = (await readText(path.join(root, 'README.md'))) ?? '';
  const pluginSkills = new Set((plugin?.skills ?? []).map((s) => s.replace(/^\.\//, '')));

  // 收集实际技能：分桶 → 扁平 → 单技能
  let layout = 'unknown';
  let actual = [];
  for (const bucket of [...cfg.promoted, ...cfg.non_promoted]) {
    for (const name of await listDirs(path.join(skillsRoot, bucket))) {
      if (existsSync(path.join(skillsRoot, bucket, name, 'SKILL.md'))) {
        actual.push({ bucket, name, rel: `${cfg.skills_dir}/${bucket}/${name}` });
      }
    }
  }
  if (actual.length) {
    layout = 'bucket';
  } else {
    for (const name of await listDirs(skillsRoot)) {
      if (existsSync(path.join(skillsRoot, name, 'SKILL.md'))) {
        actual.push({ bucket: '', name, rel: `${cfg.skills_dir}/${name}` });
      }
    }
    if (actual.length) layout = 'flat';
    else if (existsSync(path.join(root, 'SKILL.md'))) {
      actual = [{ bucket: '', name: path.basename(root), rel: '.' }];
      layout = 'single';
    }
  }

  if (actual.length === 0) {
    console.error(`未在 ${root} 下发现技能目录（已尝试分桶、扁平、单技能三种布局）`);
    process.exit(2);
  }

  // ---------- C-01 元数据：SKILL.md 必需字段 ----------
  const missingName = [], nameMismatch = [], missingDesc = [], descTooLong = [];
  const frontmatters = new Map();
  for (const s of actual) {
    const text = await readText(path.join(root, s.rel, 'SKILL.md'));
    if (!text) { missingName.push(`${s.rel} (无 SKILL.md)`); continue; }
    const fm = parseFrontmatter(text);
    frontmatters.set(s.rel, fm);
    if (!fm.name) missingName.push(s.rel);
    else if (fm.name !== s.name) nameMismatch.push(`${s.rel}: name="${fm.name}"`);
    if (!fm.description) missingDesc.push(s.rel);
    if (fm.description && fm.description.length > 1024) descTooLong.push(`${s.rel}: ${fm.description.length} 字符`);
  }
  add('C-01', 'MUST', 'SKILL.md 必须存在且含 name 字段',
    missingName.length === 0 ? `全部 ${actual.length} 个技能通过` : `${missingName.length} 个技能缺失/异常`,
    `扫描 ${skillsRoot}/**/SKILL.md`, missingName);
  add('C-02', 'MUST', 'frontmatter.name 必须等于技能目录名',
    nameMismatch.length === 0 ? '全部一致' : `${nameMismatch.length} 处不一致`,
    '目录名是 Claude Code 的发现键，也是 Skill 工具调用名', nameMismatch);
  add('C-03', 'MUST', 'frontmatter.description 必须非空',
    missingDesc.length === 0 ? '全部非空' : `${missingDesc.length} 个缺失`,
    'description 是模型自动触发的唯一依据', missingDesc);
  add('C-04', 'SHOULD', 'description 长度 <= 1024 字符',
    descTooLong.length === 0 ? `全部通过（最长见下方统计）` : `${descTooLong.length} 个超限`,
    '超长会挤占上下文预算', descTooLong);

  // ---------- C-05 ~ C-12 分桶仓库专属 ----------
  const promotedActual = actual.filter((s) => cfg.promoted.includes(s.bucket));
  const nonPromotedActual = actual.filter((s) => cfg.non_promoted.includes(s.bucket));
  if (layout === 'bucket') {
    const missingInPlugin = promotedActual.filter((s) => !pluginSkills.has(s.rel)).map((s) => s.rel);
    const leakedIntoPlugin = nonPromotedActual.filter((s) => pluginSkills.has(s.rel)).map((s) => s.rel);
    const pluginGhosts = [...pluginSkills].filter((p) => !actual.some((s) => s.rel === p));
    add('C-05', 'MUST', 'promoted 技能必须登记在 plugin.json.skills',
      missingInPlugin.length === 0 ? `${promotedActual.length} 个已登记` : `${missingInPlugin.length} 个漏登记`,
      '未登记的技能不会被插件分发', missingInPlugin);
    add('C-06', 'MUST', '非 promoted 技能不得出现在 plugin.json.skills',
      leakedIntoPlugin.length === 0 ? '无泄漏' : `${leakedIntoPlugin.length} 个泄漏`,
      'in-progress/deprecated 混入会污染分发集', leakedIntoPlugin);
    add('C-07', 'MUST', 'plugin.json.skills 不得指向不存在的目录',
      pluginGhosts.length === 0 ? '无悬空条目' : `${pluginGhosts.length} 个悬空`,
      '悬空路径会导致插件安装失败', pluginGhosts);

    const missingInReadme = promotedActual.filter((s) => !readme.includes(`${s.rel}/SKILL.md`)).map((s) => s.rel);
    const nonPromotedInReadme = nonPromotedActual.filter((s) => readme.includes(`${s.rel}/SKILL.md`)).map((s) => s.rel);
    add('C-08', 'SHOULD', 'promoted 技能必须在 README.md 中被链接到 SKILL.md',
      missingInReadme.length === 0 ? `${promotedActual.length} 个已链接` : `${missingInReadme.length} 个未链接`,
      'README 是人的第一入口，漏链等于不可发现', missingInReadme);
    add('C-09', 'SHOULD', '非 promoted 技能不得出现在 README.md',
      nonPromotedInReadme.length === 0 ? '无泄漏' : `${nonPromotedInReadme.length} 个泄漏`,
      'README 只承诺已发布能力', nonPromotedInReadme);

    const missingBucketReadme = [];
    for (const b of [...cfg.promoted, ...cfg.non_promoted]) {
      if (await listDirs(path.join(skillsRoot, b)).then((d) => d.length) === 0) continue;
      if (!existsSync(path.join(skillsRoot, b, 'README.md'))) missingBucketReadme.push(`${cfg.skills_dir}/${b}/README.md`);
    }
    add('C-10', 'SHOULD', '每个非空 bucket 必须有 README.md',
      missingBucketReadme.length === 0 ? '全部存在' : `${missingBucketReadme.length} 个缺失`,
      'bucket README 是该层的目录页', missingBucketReadme);

    const missingDocs = [];
    for (const s of promotedActual) {
      if (!existsSync(path.join(root, cfg.docs_dir, s.bucket, `${s.name}.md`))) missingDocs.push(`${cfg.docs_dir}/${s.bucket}/${s.name}.md`);
    }
    add('C-11', 'SHOULD', 'promoted 技能必须有 docs/<bucket>/<name>.md',
      missingDocs.length === 0 ? `${promotedActual.length} 个齐备` : `${missingDocs.length} 个缺失`,
      'docs 树镜像 promoted bucket', missingDocs);

    const badDocSections = [];
    for (const s of promotedActual) {
      const p = path.join(root, cfg.docs_dir, s.bucket, `${s.name}.md`);
      const t = await readText(p);
      if (!t) continue;
      const miss = cfg.doc_sections.filter((h) => !t.includes(h));
      if (miss.length) badDocSections.push(`${cfg.docs_dir}/${s.bucket}/${s.name}.md 缺: ${miss.join(', ')}`);
    }
    add('C-12', 'SHOULD', 'docs 页必须含四段固定结构',
      badDocSections.length === 0 ? '全部符合' : `${badDocSections.length} 页结构不全`,
      `要求段: ${cfg.doc_sections.join(' / ')}`, badDocSections);
  } else {
    const reason = `因仓库结构为 ${layout}（非分桶模型），本条不适用，已显式跳过`;
    addSkipped('C-05', 'MUST', 'promoted 技能必须登记在 plugin.json.skills', reason);
    addSkipped('C-06', 'MUST', '非 promoted 技能不得出现在 plugin.json.skills', reason);
    addSkipped('C-07', 'MUST', 'plugin.json.skills 不得指向不存在的目录', reason);
    addSkipped('C-08', 'SHOULD', 'promoted 技能必须在 README.md 中被链接到 SKILL.md', reason);
    addSkipped('C-09', 'SHOULD', '非 promoted 技能不得出现在 README.md', reason);
    addSkipped('C-10', 'SHOULD', '每个非空 bucket 必须有 README.md', reason);
    addSkipped('C-11', 'SHOULD', 'promoted 技能必须有 docs/<bucket>/<name>.md', reason);
    addSkipped('C-12', 'SHOULD', 'docs 页必须含四段固定结构', reason);
  }

  // ---------- C-13 双生态接口文件（按声明的平台判定） ----------
  const missingOpenai = [];
  const notApplicableOpenai = [];
  const policyMismatch = [];
  const platform = [];
  for (const s of actual) {
    const oa = await readText(path.join(root, s.rel, 'agents', 'openai.yaml'));
    const skillText = await readText(path.join(root, s.rel, 'SKILL.md'));
    const fm = frontmatters.get(s.rel) ?? {};
    const claimsCodex = /codex/i.test(skillText ?? '') || /codex/i.test(String(fm.compatibility ?? ''));
    const userInvoked = fm['disable-model-invocation'] === 'true';
    platform.push({ rel: s.rel, codexDeclared: claimsCodex, adapter: Boolean(oa) });
    if (!oa) {
      if (claimsCodex) missingOpenai.push(s.rel);
      else notApplicableOpenai.push(s.rel);
      continue;
    }
    if (!claimsCodex) continue;
    const declaresFalse = /allow_implicit_invocation\s*:\s*false/.test(oa);
    if (userInvoked !== declaresFalse) {
      policyMismatch.push(`${s.rel}: disable-model-invocation=${userInvoked} vs allow_implicit_invocation:false=${declaresFalse}`);
    }
  }
  add('C-13', 'MUST', '声明支持 Codex/OpenAI 的技能必须有 agents/openai.yaml',
    missingOpenai.length === 0
      ? (notApplicableOpenai.length === actual.length
        ? '全部技能未声明支持 Codex/OpenAI，平台适配项不适用'
        : `${actual.length - notApplicableOpenai.length} 个已适配；${notApplicableOpenai.length} 个未声明支持（不适用）`)
      : `${missingOpenai.length} 个声明支持 Codex/OpenAI 但缺少接口文件`,
    '按目标声明的平台判定；未声明时不强制 Codex 接口文件', missingOpenai);
  if (platform.every((p) => !p.adapter)) {
    addSkipped('C-14', 'MUST', 'user-invoked 语义必须跨生态一致',
      '未提供 agents/openai.yaml，无法比对跨生态触发语义');
  } else {
    add('C-14', 'MUST', 'user-invoked 语义必须跨生态一致',
      policyMismatch.length === 0 ? '全部一致' : `${policyMismatch.length} 处矛盾`,
      'disable-model-invocation:true (CC) 等价于 policy.allow_implicit_invocation:false (Codex)', policyMismatch);
  }

  // ---------- C-15 版本一致性 ----------
  if (!plugin || !pkg) {
    addSkipped('C-15', 'MUST', 'plugin.json.version 必须等于 package.json.version',
      '仓库未同时提供 plugin.json 与 package.json，版本一致性检查不适用，已显式跳过');
  } else {
    add('C-15', 'MUST', 'plugin.json.version 必须等于 package.json.version',
      plugin.version === pkg.version ? `一致 (${plugin.version})` : `不一致: plugin=${plugin.version}, pkg=${pkg.version}`,
      '版本漂移会让更新不可复现', plugin.version === pkg.version ? [] : ['见结论']);
  }

  // ---------- C-16 仓库风格：无 em-dash ----------
  const emDash = [];
  const scanTargets = [];
  for (const s of actual) {
    scanTargets.push(path.join(root, s.rel, 'SKILL.md'));
    for (const f of ['README.md']) scanTargets.push(path.join(root, s.rel, f));
  }
  scanTargets.push(path.join(root, 'README.md'), path.join(root, 'CLAUDE.md'));
  for (const p of scanTargets) {
    const t = await readText(p);
    if (t && t.includes('\u2014')) emDash.push(path.relative(root, p).split(path.sep).join('/'));
  }
  add('C-16', 'SHOULD', '正文不得出现 em-dash (U+2014)',
    emDash.length === 0 ? `扫描 ${scanTargets.length} 个文件，未发现` : `${emDash.length} 个文件含 em-dash`,
    '仓库自定风格约束，可机器判定', emDash);

  // ---------- C-17/C-18 载荷与测试覆盖（INFO：用于评估生态真实质量水位） ----------
  const EXEC_EXT = /\.(sh|bash|zsh|ps1|py|js|mjs|cjs|ts|rb|go)$/i;
  const withScripts = [], withTests = [], withSideFiles = [];
  for (const s of actual) {
    const files = await listFiles(path.join(root, s.rel));
    if (files.some((f) => EXEC_EXT.test(f))) withScripts.push(`${s.rel}: ${files.filter((f) => EXEC_EXT.test(f)).join(', ')}`);
    if (files.some((f) => /(^|\/)(tests?|specs?|__tests__)\//i.test(f) || /\.(test|spec)\./i.test(f))) withTests.push(s.rel);
    if (files.some((f) => f.endsWith('.md') && f !== 'SKILL.md')) withSideFiles.push(s.rel);
  }
  add('C-17', 'INFO', '技能级测试覆盖统计',
    withTests.length === 0 ? `0/${actual.length} 个技能含测试（整个仓库无技能级测试）` : `${withTests.length}/${actual.length} 个技能含测试`,
    '该生态的自动化质量验证水位', withTests, false);
  add('C-18', 'INFO', '技能级可执行载荷覆盖统计',
    `${withScripts.length}/${actual.length} 个技能携带可执行脚本`,
    '载荷越大，安全审查面越大；这是 C-18 的安全阈值输入', withScripts, false);
  add('C-19', 'INFO', '技能级渐进披露（引用文件）覆盖统计',
    `${withSideFiles.length}/${actual.length} 个技能含 SKILL.md 之外的 Markdown 引用文件`,
    '渐进披露是官方推荐的上下文节省手段', withSideFiles, false);

  // ---------- 规模统计 ----------
  const sizes = [];
  for (const s of actual) {
    const t = await readText(path.join(root, s.rel, 'SKILL.md'));
    if (t) sizes.push({ rel: s.rel, lines: t.split(/\r?\n/).length, chars: t.length, descChars: (frontmatters.get(s.rel)?.description ?? '').length });
  }
  sizes.sort((a, b) => b.lines - a.lines);
  add('C-20', 'INFO', 'SKILL.md 体量分布',
    `中位 ${sizes[Math.floor(sizes.length / 2)]?.lines} 行；最大 ${sizes[0]?.lines} 行 (${sizes[0]?.rel})；最小 ${sizes[sizes.length - 1]?.lines} 行`,
    '用于推导体量上限阈值', sizes.slice(0, 5).map((s) => `${s.rel}: ${s.lines} 行 / ${s.chars} 字符`), false);

  // ---------- 输出 ----------
  const must = findings.filter((f) => f.severity === 'MUST');
  const mustFail = must.filter((f) => f.failed);
  const report = {
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    layout,
    skillCount: actual.length,
    buckets: { promoted: cfg.promoted, nonPromoted: cfg.non_promoted },
    promotedCount: promotedActual.length,
    nonPromotedCount: nonPromotedActual.length,
    platform,
    summary: {
      must: must.length,
      mustViolated: mustFail.length,
      should: findings.filter((f) => f.severity === 'SHOULD').length,
      info: findings.filter((f) => f.severity === 'INFO').length,
      skipped: findings.filter((f) => f.skipped).length,
    },
    skippedChecks: findings.filter((f) => f.skipped).map((f) => f.id),
    sizes,
    findings,
  };

  for (const f of findings) {
    const flag = f.skipped ? 'SKIP' : (f.failed ? 'FAIL' : 'PASS');
    console.log(`[${flag}] ${f.id} (${f.severity}) ${f.title}`);
    console.log(`        ${f.conclusion}`);
    for (const s of f.samples) console.log(`          - ${s}`);
  }
  const skipped = findings.filter((f) => f.skipped);
  const adapted = platform.filter((p) => p.adapter).length;
  const declaredMissing = platform.filter((p) => !p.adapter && p.codexDeclared).length;
  const notDeclared = platform.filter((p) => !p.adapter && !p.codexDeclared).length;
  console.log(`平台适配：${adapted} 个已适配，${declaredMissing} 个声明支持但缺少接口文件，${notDeclared} 个未声明支持`);
  console.log(`\n合计 ${findings.length} 项检查：MUST ${must.length}（违反 ${mustFail.length}）${skipped.length ? `，显式跳过 ${skipped.length} 项` : ''}`);

  if (jsonOut) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify(report, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }
  process.exit(mustFail.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
