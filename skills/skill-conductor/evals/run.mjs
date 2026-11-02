#!/usr/bin/env node
/**
 * evals/run.mjs — skill-conductor 单一包回归执行器（零依赖）
 *
 * 覆盖 10 类用例：硬轨基线、样本仓库、缺陷注入、文风 fixture、导师行为、
 * 四意图路由、不短路、两段式 LLM（direct + deferred）、文档结构与 Agent 契约、
 * 平台适配与安全检查。
 *
 * 退出码：0 全部通过 / 1 存在失败 / 2 环境错误
 */

import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { analyzeSkill } from '../scripts/stylist/analyze.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SCRIPT = (p) => path.join(ROOT, 'scripts', p);
const CASES = path.join(HERE, 'cases.yaml');
const RELEASE = path.join(HERE, 'fixtures', 'release-notes');

function parseCases(text) {
  const out = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    const t = raw.trim();
    if (indent === 2 && t.startsWith('- name:')) {
      current = { name: t.slice(7).trim() };
      out.push(current);
    } else if (indent === 4 && current) {
      const m = /^([a-zA-Z]+):\s*(.*)$/.exec(t);
      if (m) current[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status ?? 2, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function runJson(script, args, workDir, name, env = {}) {
  const out = path.join(workDir, `${name}.json`);
  const r = run(script, [...args, '--json', out], env);
  let data = null;
  if (existsSync(out)) {
    try { data = JSON.parse(await readFile(out, 'utf8')); } catch { data = null; }
  }
  return { code: r.code, data, stderr: r.stderr, stdout: r.stdout };
}

async function hardBaseline(tmp) {
  const checks = [
    ['validate', ['validate.mjs', RELEASE, '--level', '5'], 0],
    ['score', ['score.mjs', RELEASE, '--target', 'L5'], 0],
    ['audit', ['audit.mjs', RELEASE], 0],
    ['sensitivity', ['sensitivity.mjs'], 0],
  ];
  const results = [];
  for (const [name, args, expect] of checks) {
    const r = await runJson(SCRIPT(`assessor/${args[0]}`), args.slice(1), tmp, `hard-${name}`);
    results.push({ name, ok: r.code === expect, detail: `${name} 期望 ${expect} 实际 ${r.code}` });
  }
  return results;
}

async function sampleRepo(tmp) {
  const repo = process.env.SAMPLE_REPO || path.resolve(ROOT, '..', 'skills-main');
  if (!existsSync(repo)) return [{ name: 'sample-repo', ok: true, detail: `SKIP：样本仓库不存在 ${repo}` }];
  const checks = [
    ['validate', ['validate.mjs', repo, '--scan', 'skills', '--level', '3'], 1],
    ['score', ['score.mjs', repo, '--scan', 'skills', '--target', 'L2'], 1],
    ['audit', ['audit.mjs', repo], 0],
  ];
  const results = [];
  for (const [name, args, expect] of checks) {
    const r = await runJson(SCRIPT(`assessor/${args[0]}`), args.slice(1), tmp, `sample-${name}`);
    results.push({ name, ok: r.code === expect, detail: `${name} 期望 ${expect} 实际 ${r.code}` });
  }
  return results;
}

async function credentialInjection(tmp) {
  const dir = path.join(tmp, 'cred-skill');
  await cp(RELEASE, dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  const text = await readFile(file, 'utf8');
  const token = ['ghp', 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5z'].join('_');
  await writeFile(file, text.replace('## Inputs', `> 调试用 token: ${token}\n\n## Inputs`), 'utf8');
  const r = await runJson(SCRIPT('assessor/validate.mjs'), [dir, '--level', '5'], tmp, 'cred');
  return [{ name: 'credential', ok: r.code === 1, detail: `注入凭证后 validate 期望 1 实际 ${r.code}` }];
}

async function renameMismatch(tmp) {
  const dir = path.join(tmp, 'renamed-skill');
  await cp(RELEASE, dir, { recursive: true });
  const r = await runJson(SCRIPT('assessor/validate.mjs'), [dir, '--level', '5'], tmp, 'rename');
  return [{ name: 'rename', ok: r.code === 1, detail: `目录名不一致时 validate 期望 1 实际 ${r.code}` }];
}

const STYLIST_EXPECT = {
  'positive-writing': { 'WQ-INS-01': 'pass', 'WQ-STR-02': 'pass', 'WQ-ANTI-03': 'pass' },
  'negative-flood': { 'WQ-INS-01': 'fail', 'WQ-ANTI-01': 'fail' },
  'term-mixing': { 'WQ-TRM-01': 'fail', 'WQ-TRM-02': 'fail' },
  'long-paragraph': { 'WQ-COG-01': 'fail' },
  'no-when-not': { 'WQ-STR-02': 'fail' },
  'marketing-words': { 'WQ-ANTI-03': 'fail' },
};

async function stylistFixtures() {
  const results = [];
  for (const [fixture, expected] of Object.entries(STYLIST_EXPECT)) {
    const dir = path.join(HERE, 'fixtures', fixture);
    if (!existsSync(path.join(dir, 'SKILL.md'))) {
      results.push({ name: fixture, ok: false, detail: 'fixture 不存在' });
      continue;
    }
    const analysis = await analyzeSkill(dir);
    for (const [id, want] of Object.entries(expected)) {
      const got = analysis.deterministic[id]?.result ?? 'missing';
      results.push({ name: `${fixture}/${id}`, ok: got === want, detail: `期望 ${want} 实际 ${got}` });
    }
  }
  return results;
}

async function writeSkill(root, name, with03 = true) {
  const skillDir = path.join(root, 'skills', name);
  const designDir = path.join(root, 'design', name);
  await mkdir(skillDir, { recursive: true });
  await mkdir(designDir, { recursive: true });
  await writeFile(path.join(skillDir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    'description: demo skill for mentor evals',
    'metadata:',
    '  portability: portable',
    '---',
    '',
    '# Demo',
    '',
    '## 工作流程',
    '',
    '1. do it',
    '',
    '## Inputs',
    '',
    'none',
    '',
    '## Outputs',
    '',
    'none',
    '',
  ].join('\n'), 'utf8');
  await writeFile(path.join(designDir, '01-需求界定.md'), '# 需求\n\n## 失败模式\n\n重复手工发布\n\n## 触发场景\n\n用户要求发版时\n\n## 不做的事\n\n不写代码\n', 'utf8');
  await writeFile(path.join(designDir, '02-生态决策.md'), '# 生态\n\n## 可移植性\n\nportable\n', 'utf8');
  if (with03) {
    await writeFile(path.join(designDir, '03-接口契约.yaml'), 'input:\n  - version\noutput:\n  - CHANGELOG.md\nfailure:\n  - missing-tag\nside_effects:\n  - write CHANGELOG.md\ndependencies:\n  - git\n', 'utf8');
  }
}

async function mentorScenarios(tmp) {
  const results = [];

  const skipRoot = path.join(tmp, 'mentor-skip');
  await writeSkill(skipRoot, 'demo-skill');
  run(SCRIPT('mentor/state.mjs'), ['init', skipRoot, 'demo-skill']);
  const skip = run(SCRIPT('mentor/state.mjs'), ['advance', skipRoot, 'demo-skill', 'STEP-02']);
  results.push({ name: '跳过 STEP-01', ok: skip.code === 1 && /顺序违规/.test(skip.stderr) && /回退建议/.test(skip.stderr), detail: `退出码 ${skip.code}` });

  const cpRoot = path.join(tmp, 'mentor-cp');
  await writeSkill(cpRoot, 'demo-skill', true);
  run(SCRIPT('mentor/state.mjs'), ['init', cpRoot, 'demo-skill']);
  for (const s of ['STEP-01', 'STEP-02', 'STEP-03']) run(SCRIPT('mentor/state.mjs'), ['advance', cpRoot, 'demo-skill', s]);
  const cp = run(SCRIPT('mentor/blueprint.mjs'), [cpRoot, '--skill', 'demo-skill', '--checkpoint', 'CP-1']);
  results.push({ name: 'CP-1 完整', ok: /CP-1 demo-skill: PASS/.test(cp.stdout), detail: cp.stdout.split(/\r?\n/).filter((l) => l.includes('CP-1')).join(' | ') });

  const badRoot = path.join(tmp, 'mentor-cp-bad');
  await writeSkill(badRoot, 'demo-skill', false);
  run(SCRIPT('mentor/state.mjs'), ['init', badRoot, 'demo-skill']);
  run(SCRIPT('mentor/state.mjs'), ['advance', badRoot, 'demo-skill', 'STEP-01']);
  run(SCRIPT('mentor/state.mjs'), ['advance', badRoot, 'demo-skill', 'STEP-02']);
  const bad = run(SCRIPT('mentor/blueprint.mjs'), [badRoot, '--skill', 'demo-skill', '--checkpoint', 'CP-1']);
  results.push({ name: 'CP-1 缺失', ok: /CP-1 demo-skill: FAIL/.test(bad.stdout) && /STEP-03/.test(bad.stdout), detail: bad.stdout.split(/\r?\n/).filter((l) => l.includes('CP-1')).join(' | ') });

  const skillText = await readFile(path.join(ROOT, 'SKILL.md'), 'utf8');
  results.push({ name: '终检声明', ok: skillText.includes('自动走入口 1 终检') || skillText.includes('--final-check'), detail: 'SKILL.md 声明开发完成后自动终检' });

  return results;
}

async function conductorIntents(tmp) {
  const results = [];
  const good = path.join(HERE, 'fixtures', 'positive-writing');
  const env = { LLM_MODE: 'deferred' };

  const style = await runJson(SCRIPT('conductor.mjs'), [good, '--intent', 'style'], tmp, 'cond-style', env);
  results.push({ name: 'intent=style', ok: style.code === 0 && style.data?.modules?.stylist && !style.data?.modules?.hard, detail: `退出码 ${style.code}` });

  const assess = await runJson(SCRIPT('conductor.mjs'), [good, '--intent', 'assess'], tmp, 'cond-assess', env);
  results.push({ name: 'intent=assess', ok: assess.code === 0 && assess.data?.modules?.hard && assess.data?.modules?.soft && !assess.data?.modules?.stylist, detail: `退出码 ${assess.code}` });

  const evaluate = await runJson(SCRIPT('conductor.mjs'), [good, '--intent', 'evaluate'], tmp, 'cond-evaluate', env);
  results.push({ name: 'intent=evaluate', ok: evaluate.code === 0 && evaluate.data?.modules?.hard && evaluate.data?.modules?.soft && evaluate.data?.modules?.stylist, detail: `退出码 ${evaluate.code}` });

  const develop = await runJson(SCRIPT('conductor.mjs'), [good, '--intent', 'develop'], tmp, 'cond-develop', env);
  results.push({ name: 'intent=develop', ok: develop.code === 0 && develop.data?.modules?.blueprint, detail: `退出码 ${develop.code}` });

  // 不短路（硬轨内部） + 硬轨失败后跳过下游 + 退出码只取硬轨
  const badDir = path.join(tmp, 'bad-conductor-skill');
  await cp(good, badDir, { recursive: true });
  const p = path.join(badDir, 'SKILL.md');
  const token = ['ghp', 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5z'].join('_');
  await writeFile(p, (await readFile(p, 'utf8')).replace('## Inputs', `> 调试用 token: ${token}\n\n## Inputs`), 'utf8');
  const bad = await runJson(SCRIPT('conductor.mjs'), [badDir, '--intent', 'evaluate'], tmp, 'cond-bad', env);
  const hard = bad.data?.modules?.hard;
  const hardExit = hard?.exitCode;
  const allFour = ['validate', 'score', 'audit', 'sensitivity'].every((k) => hard?.[k] && typeof hard[k].exitCode === 'number');
  const skipped = bad.data?.modules?.skipped;
  results.push({
    name: '硬轨内部四脚本不短路',
    ok: allFour && hard?.validate?.exitCode === 1,
    detail: allFour
      ? `validate=${hard.validate.exitCode} score=${hard.score.exitCode} audit=${hard.audit.exitCode} sensitivity=${hard.sensitivity.exitCode}`
      : '存在未执行的硬轨脚本',
  });
  results.push({
    name: '硬轨失败 → 跳过软轨与文风 + 显式原因',
    ok: bad.code === 1 && hardExit === 1
      && !bad.data?.modules?.soft && !bad.data?.modules?.stylist
      && skipped?.soft === true && skipped?.stylist === true
      && /硬轨/.test(skipped?.reason ?? ''),
    detail: `退出码 ${bad.code}，hard=${hardExit}，soft=${Boolean(bad.data?.modules?.soft)}，stylist=${Boolean(bad.data?.modules?.stylist)}，原因=${skipped?.reason ?? '无'}`,
  });

  const scoreEntry = bad.data?.modules?.hard?.score?.data?.scorecards?.[0]?.entries?.find((e) => e.id === 'QM-SC-L2');
  results.push({
    name: 'score 失败条目说明写「未通过」',
    ok: scoreEntry?.pass === false && /未通过/.test(scoreEntry?.note ?? ''),
    detail: `pass=${scoreEntry?.pass}，note=${scoreEntry?.note ?? '无'}`,
  });

  const badAssess = await runJson(SCRIPT('conductor.mjs'), [badDir, '--intent', 'assess'], tmp, 'cond-bad-assess', env);
  results.push({
    name: 'intent=assess 硬轨失败 → 跳过软轨',
    ok: badAssess.code === 1 && !badAssess.data?.modules?.soft && badAssess.data?.modules?.skipped?.soft === true,
    detail: `退出码 ${badAssess.code}，soft=${Boolean(badAssess.data?.modules?.soft)}`,
  });

  return results;
}

async function platformSafety(tmp) {
  const results = [];

  // 1. 未声明 Codex/OpenAI：不强制 agents/openai.yaml
  const noCodex = path.join(tmp, 'platform-no-codex', 'release-notes');
  await cp(RELEASE, noCodex, { recursive: true });
  await rm(path.join(noCodex, 'agents'), { recursive: true, force: true });
  const a1 = await runJson(SCRIPT('assessor/audit.mjs'), [noCodex], tmp, 'platform-no-codex');
  const p1 = a1.data?.platform?.[0];
  const c13a = a1.data?.findings?.find((f) => f.id === 'C-13');
  results.push({
    name: '未声明 Codex → 不强制接口文件',
    ok: a1.code === 0 && p1?.codexDeclared === false && p1?.adapter === false && c13a?.failed === false,
    detail: `exit=${a1.code} codex=${p1?.codexDeclared} adapter=${p1?.adapter} C-13=${c13a?.failed}`,
  });

  // 2. 声明 Codex 但缺接口文件：阻断
  const declared = path.join(tmp, 'platform-codex', 'release-notes');
  await cp(RELEASE, declared, { recursive: true });
  await rm(path.join(declared, 'agents'), { recursive: true, force: true });
  const declaredFile = path.join(declared, 'SKILL.md');
  await writeFile(declaredFile, (await readFile(declaredFile, 'utf8')).replace('compatibility: "', 'compatibility: "支持 Codex。'), 'utf8');
  const a2 = await runJson(SCRIPT('assessor/audit.mjs'), [declared], tmp, 'platform-codex');
  const c13b = a2.data?.findings?.find((f) => f.id === 'C-13');
  results.push({
    name: '声明 Codex 但缺接口文件 → 阻断',
    ok: a2.code === 1 && c13b?.failed === true,
    detail: `exit=${a2.code} C-13=${c13b?.failed}`,
  });

  // 3. 大体积随包数据无许可：SHOULD 提示
  const large = path.join(tmp, 'safety-large', 'release-notes');
  await cp(RELEASE, large, { recursive: true });
  await writeFile(path.join(large, 'corpus.txt'), 'x'.repeat(2 * 1024 * 1024 + 1), 'utf8');
  const vLarge = await runJson(SCRIPT('assessor/validate.mjs'), [large, '--level', '3'], tmp, 'safety-large');
  const v075 = vLarge.data?.results?.find((r) => r.id === 'V-075');
  results.push({ name: '大体积数据无许可 → 提示', ok: v075?.failed === true, detail: `V-075=${v075?.failed}` });

  // 4. 本机绝对路径：SHOULD 提示
  const abs = path.join(tmp, 'safety-abs', 'release-notes');
  await cp(RELEASE, abs, { recursive: true });
  const absFile = path.join(abs, 'SKILL.md');
  await writeFile(absFile, `${await readFile(absFile, 'utf8')}\n参见 C:\\Users\\alice\\secret\\notes.md\n`, 'utf8');
  const vAbs = await runJson(SCRIPT('assessor/validate.mjs'), [abs, '--level', '3'], tmp, 'safety-abs');
  const v076 = vAbs.data?.results?.find((r) => r.id === 'V-076');
  results.push({ name: '本机绝对路径 → 提示', ok: v076?.failed === true, detail: `V-076=${v076?.failed}` });

  // 5. 缺 Side effects：读取范围 SHOULD 提示
  const noSide = path.join(tmp, 'safety-side', 'release-notes');
  await cp(RELEASE, noSide, { recursive: true });
  const sideFile = path.join(noSide, 'SKILL.md');
  const sideText = await readFile(sideFile, 'utf8');
  await writeFile(sideFile, sideText.replace(/## Side effects[\s\S]*?(?=\n## )/, ''), 'utf8');
  const vSide = await runJson(SCRIPT('assessor/validate.mjs'), [noSide, '--level', '3'], tmp, 'safety-side');
  const v077 = vSide.data?.results?.find((r) => r.id === 'V-077');
  results.push({ name: '缺 Side effects → 读取范围提示', ok: v077?.failed === true, detail: `V-077=${v077?.failed}` });

  return results;
}

async function listMarkdown(dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      await listMarkdown(full, base, acc);
    } else if (e.name.endsWith('.md')) {
      acc.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return acc;
}

/** 文档结构与 Agent 契约：单文档化后，保证没有死链、没有过期路径、description 有触发词 */
async function docStructure(tmp) {
  const results = [];
  const skill = await readFile(path.join(ROOT, 'SKILL.md'), 'utf8');
  const runbook = await readFile(path.join(ROOT, 'references', 'agent-runbook.md'), 'utf8');
  const deferred = await readFile(path.join(ROOT, 'references', 'deferred.md'), 'utf8');
  const combined = `${skill}\n${runbook}\n${deferred}`;
  const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
  const contributing = await readFile(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8');
  const advice = await readFile(path.join(ROOT, 'references', 'assessor', 'advice-rules.md'), 'utf8');

  const required = [
    '<SKILL_ROOT>', '--intent evaluate', '--prepare', '--prepare-critique', '--collect',
    '退出码 3', 'modules.hard.exitCode', 'modules.skipped', 'Node.js', '--workdir',
  ];
  for (const token of required) {
    results.push({ name: `SKILL+references 必含 ${token}`, ok: combined.includes(token), detail: combined.includes(token) ? '存在' : '缺失' });
  }
  results.push({
    name: 'SKILL 指向 agent-runbook',
    ok: skill.includes('references/agent-runbook.md'),
    detail: skill.includes('references/agent-runbook.md') ? '存在' : '缺失',
  });
  results.push({
    name: 'SKILL 指向 deferred 附录',
    ok: skill.includes('references/deferred.md'),
    detail: skill.includes('references/deferred.md') ? '存在' : '缺失',
  });
  results.push({
    name: 'runbook 核心保持精简（≤200 行）',
    ok: runbook.split(/\r?\n/).length <= 200,
    detail: `${runbook.split(/\r?\n/).length} 行（上限 200）`,
  });

  // 用户报告契约：模板面向读者、章节齐全、不含内部术语；跳过规则与问题表述规则到位
  const reportSection = /^## 6\. 用户报告模板\s*\r?\n([\s\S]*?)(?=\r?\n## 7\.)/m.exec(runbook)?.[1] ?? '';
  const reportTemplate = /````markdown\s*\r?\n([\s\S]*?)````/m.exec(reportSection)?.[1] ?? '';
  const reportHeadings = ['## 结论', '## 评分', '## 阻断问题', '## 重要问题', '## 建议改进', '## 内容质量', '## 做得好的地方', '## 文风', '## 下一步'];
  const missingHeadings = reportHeadings.filter((h) => !reportTemplate.includes(h));
  results.push({
    name: '用户报告模板章节齐全',
    ok: reportTemplate.length > 0 && missingHeadings.length === 0,
    detail: missingHeadings.length ? `缺少 ${missingHeadings.join(', ')}` : `${reportHeadings.length} 个章节齐备`,
  });
  const reportBanned = ['硬轨', '软轨', '退出码', 'validate', 'score', 'audit', 'sensitivity', 'exitCode', 'modules.', 'V-0', 'QM-', 'C-1', 'CQ-', 'SELF-', 'report.json', '--json', '--intent', 'L1', 'L2', 'L3', 'L4', 'L5'];
  const reportHits = reportBanned.filter((w) => reportTemplate.includes(w));
  results.push({
    name: '用户报告模板不含内部术语',
    ok: reportTemplate.length > 0 && reportHits.length === 0,
    detail: reportHits.length ? `命中 ${reportHits.join(', ')}` : '未命中',
  });
  const cropOk = reportSection.includes('intent=assess')
    && /删除.*文风.*整节/.test(reportSection)
    && /删除.*内容质量.*整节/.test(reportSection)
    && /全文不得出现/.test(reportSection)
    && reportSection.includes('intent=style')
    && reportSection.includes('多技能')
    && reportSection.includes('绝对路径');
  results.push({
    name: '用户报告裁剪规则完整',
    ok: cropOk,
    detail: cropOk ? '含 assess / 文风 / 内容质量 / style / 多技能 / 路径规则' : '裁剪规则不完整',
  });
  const adviceOk = advice.includes('问题表述规则')
    && advice.includes('合并')
    && advice.includes('不写入')
    && advice.includes('不编造')
    && advice.includes('证据')
    && advice.includes('置信度')
    && advice.includes('绝对路径')
    && advice.includes('文风未评审');
  results.push({
    name: '问题表述规则完整',
    ok: adviceOk,
    detail: adviceOk ? '含分级、合并、证据、置信度与边界' : '缺少关键规则',
  });
  const judgeSelf = run(SCRIPT('assessor/llm-judge.mjs'), ['--self-check']);
  results.push({
    name: '软轨含 19 条锚点（14 工程 + 5 内容）',
    ok: judgeSelf.code === 0 && /19 条/.test(judgeSelf.stderr),
    detail: judgeSelf.code === 0 ? judgeSelf.stderr.trim().split(/\r?\n/).pop() : judgeSelf.stderr.slice(-300),
  });
  const skillReportOk = skill.includes('用户报告')
    && skill.includes('不出现内部模块名')
    && skill.includes('内容质量')
    && skill.includes('平台适配')
    && !skill.includes('三段式评审报告');
  results.push({
    name: 'SKILL 用户报告约束',
    ok: skillReportOk,
    detail: skillReportOk ? '已声明用户报告、内容质量与平台适配' : '缺少用户报告约束或仍含旧三段式',
  });
  const agentExample = /### 3\.1 Agent 版[\s\S]*?(?=\n### 3\.2|\n## 4\.)/.exec(readme)?.[0] ?? '';
  const agentHits = ['硬轨', '软轨', '退出码', 'validate', 'score', 'audit', 'sensitivity'].filter((w) => agentExample.includes(w));
  results.push({
    name: 'README Agent 示例不含内部术语',
    ok: agentExample.length > 0 && agentHits.length === 0,
    detail: agentHits.length ? `命中 ${agentHits.join(', ')}` : '未命中',
  });
  const oaText = await readFile(path.join(ROOT, 'agents', 'openai.yaml'), 'utf8');
  const oaHits = ['硬轨', '软轨', '退出码'].filter((w) => oaText.includes(w));
  results.push({
    name: 'openai.yaml 默认提示不含内部术语',
    ok: oaHits.length === 0,
    detail: oaHits.length ? `命中 ${oaHits.join(', ')}` : '未命中',
  });
  results.push({
    name: 'SKILL 含 Bash 不可用降级',
    ok: /Bash/.test(skill) && /只读文档/.test(skill),
    detail: /Bash/.test(skill) && /只读文档/.test(skill) ? '存在' : '缺失',
  });
  results.push({
    name: 'SKILL 无错误示例 ../..',
    ok: !/conductor\.mjs\s+\.\.\/\.\./.test(skill),
    detail: /conductor\.mjs\s+\.\.\/\.\./.test(skill) ? '仍含 ../.. 示例' : '未发现',
  });

  // description 必须含显式触发词（SPEC-033 / V-033 的文档侧兜底）
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill);
  const descLine = fm ? (fm[1].split(/\r?\n/).find((l) => /^description:\s*/i.test(l)) ?? '') : '';
  const trigger = /(use\s+(?:this|when|for)|when\s+(?:the\s+)?user|when\s+asked|trigger|当用户|当需要|在用户|用户(?:说|提到|要求)|何时使用|使用场景|什么时候用)/i;
  results.push({
    name: 'SKILL description 含显式触发词',
    ok: trigger.test(descLine),
    detail: descLine ? (trigger.test(descLine) ? '含触发分支' : '缺触发分支') : '未解析到 description',
  });

  const pass = await runJson(SCRIPT('conductor.mjs'), [ROOT, '--intent', 'evaluate'], tmp, 'runbook-pass', { LLM_MODE: 'deferred' });
  results.push({
    name: 'runbook 自评',
    ok: pass.code === 0
      && pass.data?.exitCode === 0
      && Boolean(pass.data?.modules?.soft)
      && Boolean(pass.data?.modules?.stylist)
      && pass.data?.modules?.skipped === null,
    detail: `退出码 ${pass.code}，soft=${Boolean(pass.data?.modules?.soft)}，stylist=${Boolean(pass.data?.modules?.stylist)}，skipped=${pass.data?.modules?.skipped === null ? 'null' : '非空'}`,
  });

  const badDir = path.join(tmp, 'runbook-bad-skill');
  await cp(path.join(HERE, 'fixtures', 'positive-writing'), badDir, { recursive: true });
  const badFile = path.join(badDir, 'SKILL.md');
  const token = ['ghp', 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5z'].join('_');
  await writeFile(badFile, (await readFile(badFile, 'utf8')).replace('## Inputs', `> 调试用 token: ${token}\n\n## Inputs`), 'utf8');
  const bad = await runJson(SCRIPT('conductor.mjs'), [badDir, '--intent', 'evaluate'], tmp, 'runbook-bad', { LLM_MODE: 'deferred' });
  results.push({
    name: 'runbook 硬轨失败跳过',
    ok: bad.code === 1
      && bad.data?.modules?.soft === null
      && bad.data?.modules?.stylist === null
      && /硬轨/.test(bad.data?.modules?.skipped?.reason ?? ''),
    detail: `退出码 ${bad.code}，soft=${Boolean(bad.data?.modules?.soft)}，stylist=${Boolean(bad.data?.modules?.stylist)}，原因=${bad.data?.modules?.skipped?.reason ?? '无'}`,
  });

  // 单文档化：docs/ 不再存在，且任何文档都不得再引用被删除的三份文档
  const docsDir = path.join(ROOT, 'docs');
  results.push({
    name: 'docs/ 已合并删除',
    ok: !existsSync(docsDir),
    detail: existsSync(docsDir) ? 'docs/ 仍存在' : '已不存在',
  });
  const mdFiles = ['SKILL.md', 'README.md', 'CONTRIBUTING.md', ...(await listMarkdown(path.join(ROOT, 'references'))).map((f) => `references/${f}`)];
  const staleFiles = [];
  const staleRe = /docs\/(?:USAGE|DESIGN_RATIONALE|REAL_MODEL_VALIDATION)\.md|\.\/(?:DESIGN_RATIONALE|REAL_MODEL_VALIDATION)\.md/;
  for (const rel of mdFiles) {
    const t = rel === 'SKILL.md' ? skill : rel === 'README.md' ? readme : rel === 'CONTRIBUTING.md' ? contributing : await readFile(path.join(ROOT, rel), 'utf8');
    if (staleRe.test(t)) staleFiles.push(rel);
  }
  results.push({
    name: '无已删除文档的死链',
    ok: staleFiles.length === 0,
    detail: staleFiles.length ? `命中 ${staleFiles.join(', ')}` : `扫描 ${mdFiles.length} 个 Markdown，未发现`,
  });

  // references 里提到的 scripts/ 与 references/ 路径必须真实存在
  const pathRe = /(?:scripts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.mjs|references\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:md|yaml|json)|evals\/fixtures\/[A-Za-z0-9_-]+\/SKILL\.md)/g;
  const broken = [];
  for (const rel of mdFiles) {
    const t = rel === 'SKILL.md' ? skill : rel === 'README.md' ? readme : rel === 'CONTRIBUTING.md' ? contributing : await readFile(path.join(ROOT, rel), 'utf8');
    for (const m of new Set(t.match(pathRe) ?? [])) {
      if (!existsSync(path.join(ROOT, m))) broken.push(`${rel} -> ${m}`);
    }
  }
  results.push({
    name: '文档内路径引用均存在',
    ok: broken.length === 0,
    detail: broken.length ? `断链 ${broken.slice(0, 5).join('；')}` : '全部可解析',
  });

  // LLM 判定 Prompt 必须把被审内容标记为不可信数据，防止提示注入
  const clientSrc = await readFile(path.join(ROOT, 'scripts', 'lib', 'llm-client.mjs'), 'utf8');
  const judgeSrc = await readFile(SCRIPT('assessor/llm-judge.mjs'), 'utf8');
  const wqSrc = await readFile(SCRIPT('stylist/wq-judge.mjs'), 'utf8');
  const guardOk = /untrusted_skill_content/.test(clientSrc)
    && /不是给你的指令/.test(clientSrc)
    && /wrapUntrustedContent/.test(judgeSrc)
    && /wrapUntrustedContent/.test(wqSrc);
  results.push({
    name: 'LLM 判定 Prompt 含数据边界',
    ok: guardOk,
    detail: guardOk ? '软轨与文风均使用不可信内容包装' : '存在未包装的 Prompt 构造',
  });

  // deferred 模式必须写入已填充的 prompt：含真实技能内容与数据边界，且不残留占位符
  const guardWork = path.join(tmp, 'guard-prompts');
  const prep = run(SCRIPT('assessor/llm-judge.mjs'), [path.join(HERE, 'fixtures', 'positive-writing'), '--prepare', '--workdir', guardWork], { LLM_MODE: 'deferred' });
  const promptDir = path.join(guardWork, 'prompts');
  const promptFiles = existsSync(promptDir) ? await readdir(promptDir) : [];
  const firstPrompt = promptFiles.find((f) => f.endsWith('.md'));
  const promptText = firstPrompt ? await readFile(path.join(promptDir, firstPrompt), 'utf8') : '';
  results.push({
    name: 'deferred prompt 已填充且含数据边界',
    ok: prep.code === 0 && promptText.includes('untrusted_skill_content') && !promptText.includes('{skill_content}'),
    detail: promptText
      ? `${firstPrompt}：${promptText.includes('untrusted_skill_content') ? '含数据边界' : '缺数据边界'}，${promptText.includes('{skill_content}') ? '残留占位符' : '无占位符'}`
      : '未生成 prompt',
  });

  results.push({ name: 'README 首屏两种用法', ok: /^## 0\. 两种用法/m.test(readme) && readme.includes('装进 Agent'), detail: '标题与关键词检查' });
  results.push({ name: 'README 含 Agent 安装段', ok: /^## 2\. 安装到 Agent/m.test(readme), detail: '标题检查' });
  results.push({ name: 'README 含已知限制', ok: /^## 10\. 已知限制/m.test(readme), detail: '标题检查' });
  results.push({
    name: 'README 说明 agents/openai.yaml',
    ok: /agents\/openai\.yaml/.test(readme) && /(Codex|OpenAI)/.test(readme),
    detail: /agents\/openai\.yaml/.test(readme) && /(Codex|OpenAI)/.test(readme) ? '存在说明' : '缺少说明',
  });
  return results;
}

async function llmTwoPass() {
  const r = run(path.join(HERE, 'llm-two-pass.mjs'), []);
  return [{ name: 'llm-two-pass', ok: r.code === 0, detail: r.stdout.split(/\r?\n/).filter(Boolean).slice(-4).join(' | ') || r.stderr.slice(-500) }];
}

async function main() {
  if (!existsSync(CASES)) { console.error(`用例文件不存在: ${CASES}`); process.exit(2); }
  const cases = parseCases(await readFile(CASES, 'utf8'));
  const tmp = path.join(os.tmpdir(), `skill-evals-${Date.now()}`);
  await mkdir(tmp, { recursive: true });

  const results = [];
  for (const c of cases) {
    let rows = [];
    try {
      if (c.type === 'hard-baseline') rows = await hardBaseline(tmp);
      else if (c.type === 'sample-repo') rows = await sampleRepo(tmp);
      else if (c.type === 'credential-injection') rows = await credentialInjection(tmp);
      else if (c.type === 'rename-mismatch') rows = await renameMismatch(tmp);
      else if (c.type === 'stylist-fixtures') rows = await stylistFixtures();
      else if (c.type === 'mentor-scenarios') rows = await mentorScenarios(tmp);
      else if (c.type === 'conductor-intents') rows = await conductorIntents(tmp);
      else if (c.type === 'llm-two-pass') rows = await llmTwoPass();
      else if (c.type === 'agent-runbook') rows = await docStructure(tmp);
      else if (c.type === 'platform-safety') rows = await platformSafety(tmp);
      else rows = [{ name: c.type, ok: false, detail: `未知用例类型: ${c.type}` }];
    } catch (e) {
      rows = [{ name: c.type, ok: false, detail: `异常: ${e.message}` }];
    }
    results.push({ case: c.name, rows });
  }

  await rm(tmp, { recursive: true, force: true });

  console.log('\n=== skill-conductor · 回归 ===\n');
  let failed = 0;
  for (const r of results) {
    const caseFailed = r.rows.filter((x) => !x.ok).length;
    failed += caseFailed;
    console.log(`[${caseFailed ? 'FAIL' : 'PASS'}] ${r.case}`);
    for (const row of r.rows) console.log(`        ${row.ok ? 'ok  ' : 'FAIL'} ${row.name} — ${row.detail}`);
  }
  console.log(`\n合计 ${results.length} 组用例：失败 ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
