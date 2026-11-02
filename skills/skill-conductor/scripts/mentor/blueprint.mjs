#!/usr/bin/env node
/**
 * blueprint.mjs — 技能导师 · 14 步流程的状态机检查器（零依赖）
 *
 * 定位：导师只查「流程走没走、产物有没有生成」，不查「合规不合规」——
 * 后者归 skill-assessor。因此本脚本不调用 validate/score/audit，也不引用 V-/QM- 检查 ID。
 *
 * 用法：
 *   node scripts/blueprint.mjs <repo-root> [--scan skills] [--skill <name>] [--json out]
 *   node scripts/blueprint.mjs <repo-root> --skill <name> --step STEP-03
 *   node scripts/blueprint.mjs <repo-root> --skill <name> --checkpoint CP-1
 *   node scripts/blueprint.mjs --self-check
 *
 * 退出码：0 正常；2 参数错误；3 自检失败
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listSkills, parseSkillMd } from '../lib/skill-parser.mjs';
import { STEPS as STATE_STEPS, CHECKPOINTS, readState } from './state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function readTextIfExists(p) {
  return existsSync(p) ? readFile(p, 'utf8') : null;
}

function designPath(root, dir, file) {
  const a = path.join(root, 'design', path.basename(dir), file);
  const b = path.join(dir, 'design', file);
  if (existsSync(a)) return { label: path.relative(root, a).split(path.sep).join('/'), full: a };
  if (existsSync(b)) return { label: `design/${file}`, full: b };
  return null;
}

async function checkArtifact(root, dir, file, sections = []) {
  const hit = designPath(root, dir, file);
  if (!hit) return { pass: false, note: `缺少 design/${file}` };
  if (sections.length === 0) return { pass: true, note: `${hit.label} 已存在` };
  const t = (await readTextIfExists(hit.full)) ?? '';
  const missing = sections.filter((s) => !t.includes(s));
  return { pass: missing.length === 0, note: missing.length ? `${hit.label} 缺少：${missing.join('、')}` : `${hit.label} 结构完整` };
}

const STEP_DEFS = [
  { id: 'STEP-01', name: '需求界定', run: (root, dir) => checkArtifact(root, dir, '01-需求界定.md', ['失败模式', '触发场景', '不做的事']), fallback: '回退到 STEP-01，先写清「失败模式 / 触发场景 / 不做的事」三节。' },
  { id: 'STEP-02', name: '生态选择', run: (root, dir) => checkArtifact(root, dir, '02-生态决策.md', ['可移植性']), fallback: '回退到 STEP-02，明确 metadata.portability 取值与目标生态。' },
  { id: 'STEP-03', name: '接口设计', run: (root, dir) => checkArtifact(root, dir, '03-接口契约.yaml', ['input', 'output', 'failure', 'side_effects', 'dependencies']), fallback: '回退到 STEP-03，补齐输入/输出/失败/副作用/依赖五类契约。' },
  {
    id: 'STEP-04', name: '目录初始化',
    run: async (root, dir) => {
      const has = existsSync(path.join(dir, 'SKILL.md'));
      return { pass: has, note: has ? '技能目录与 SKILL.md 已存在' : `缺少 ${path.join(dir, 'SKILL.md')}` };
    },
    fallback: '回退到 STEP-04，先建目录与 SKILL.md 骨架。',
  },
  {
    id: 'STEP-05', name: '元数据',
    run: async (root, dir) => {
      if (!existsSync(path.join(dir, 'SKILL.md'))) return { pass: false, note: '无 SKILL.md' };
      const s = await parseSkillMd(path.join(dir, 'SKILL.md'));
      const missing = ['name', 'description'].filter((k) => !s.frontmatter[k]);
      if (!s.frontmatter.metadata?.portability) missing.push('metadata.portability');
      return { pass: missing.length === 0, note: missing.length ? `缺少元数据：${missing.join(', ')}` : '元数据齐备' };
    },
    fallback: '回退到 STEP-05，补齐 name / description / metadata.portability。',
  },
  {
    id: 'STEP-06', name: '实现',
    run: async (root, dir) => {
      const body = (await readTextIfExists(path.join(dir, 'SKILL.md'))) ?? '';
      const hasScripts = existsSync(path.join(dir, 'scripts'));
      const hasRefs = existsSync(path.join(dir, 'references'));
      const substantial = body.split(/\r?\n/).length >= 40 || hasScripts || hasRefs;
      return { pass: substantial, note: substantial ? `正文 ${body.split(/\r?\n/).length} 行，scripts ${hasScripts ? '有' : '无'}，references ${hasRefs ? '有' : '无'}` : '正文过短，且无 scripts/references' };
    },
    fallback: '回退到 STEP-06，先把技能主体写出来。',
  },
  {
    id: 'STEP-07', name: '测试',
    run: async (root, dir) => {
      const has = existsSync(path.join(dir, 'evals', 'cases.yaml'));
      return { pass: has, note: has ? 'evals/cases.yaml 已存在' : '缺少 evals/cases.yaml' };
    },
    fallback: '回退到 STEP-07，先写 evals/cases.yaml 再写实现细节。',
  },
  {
    id: 'STEP-08', name: '文档',
    run: async (root, dir) => {
      const body = (await readTextIfExists(path.join(dir, 'SKILL.md'))) ?? '';
      const has = /^#{1,6}\s*(?:Usage|How to use|工作流程|用法)\b/im.test(body);
      return { pass: has, note: has ? '含用法/工作流程小节' : '缺少用法/工作流程小节' };
    },
    fallback: '回退到 STEP-08，补「何时使用 / 工作流程」小节。',
  },
  {
    id: 'STEP-09', name: '示例',
    run: async (root, dir) => {
      const t = (await readTextIfExists(path.join(dir, 'SKILL.md'))) ?? '';
      const hasSection = /^#{1,6}\s*(?:示例|例子|examples?)\b/im.test(t);
      const hasBlock = [...t.matchAll(/```[\s\S]*?```/g)].some((m) => m[0].split(/\r?\n/).length >= 6);
      const pass = hasSection || hasBlock;
      return { pass, note: pass ? '含真实示例' : '未见示例小节或 ≥5 行代码块' };
    },
    fallback: '回退到 STEP-09，补一个真实输入→输出示例。',
  },
  {
    id: 'STEP-10', name: '评测',
    run: async (root, dir) => {
      const has = existsSync(path.join(dir, 'evals', 'run.mjs'));
      return { pass: has, note: has ? 'evals/run.mjs 已存在' : '缺少 evals/run.mjs' };
    },
    fallback: '回退到 STEP-10，补可执行的评测运行器。',
  },
  { id: 'STEP-11', name: '安全合规', run: (root, dir) => checkArtifact(root, dir, '11-安全合规检查表.md', []), fallback: '回退到 STEP-11，完成安全合规检查表。' },
  {
    id: 'STEP-12', name: '打包',
    run: async (root, dir) => {
      const has = existsSync(path.join(dir, 'README.md'));
      return { pass: has, note: has ? '技能 README.md 已存在' : '缺少技能 README.md' };
    },
    fallback: '回退到 STEP-12，补技能 README 与打包清单。',
  },
  {
    id: 'STEP-13', name: '发布',
    run: async (root, dir) => {
      const has = existsSync(path.join(root, 'CHANGELOG.md')) || existsSync(path.join(dir, 'CHANGELOG.md'));
      return { pass: has, note: has ? '存在 CHANGELOG' : '缺少 CHANGELOG（发布记录）' };
    },
    fallback: '回退到 STEP-13，补发布记录；发布后必须调用 skill-assessor 做硬轨终检。',
  },
  {
    id: 'STEP-14', name: '维护',
    run: async (root, dir) => {
      const body = (await readTextIfExists(path.join(dir, 'SKILL.md'))) ?? '';
      const has = /^#{1,6}\s*(?:Maintenance|维护|版本策略)\b/im.test(body) || existsSync(path.join(dir, 'references', 'maintenance.md'));
      return { pass: has, note: has ? '含维护说明' : '缺少维护说明' };
    },
    fallback: '回退到 STEP-14，补 owner、更新节奏与废弃策略。',
  },
];

async function selfCheck() {
  const problems = [];
  const ids = STEP_DEFS.map((s) => s.id);
  if (ids.join(',') !== STATE_STEPS.join(',')) problems.push('步骤定义与 state.mjs 不一致');
  for (const [cp, def] of Object.entries(CHECKPOINTS)) {
    for (const s of def.steps) if (!ids.includes(s)) problems.push(`${cp} 引用了不存在的步骤 ${s}`);
  }
  for (const s of STEP_DEFS) {
    if (typeof s.run !== 'function') problems.push(`${s.id} 缺少检查实现`);
    if (!s.fallback) problems.push(`${s.id} 缺少回退建议`);
  }
  return problems;
}

async function evaluate(root, dir, state) {
  const steps = [];
  for (const def of STEP_DEFS) {
    const r = await def.run(root, dir);
    steps.push({ id: def.id, name: def.name, pass: Boolean(r.pass), note: r.note, fallback: def.fallback });
  }
  const firstBlocked = steps.find((s) => !s.pass) ?? null;
  const completed = new Set(state?.completed_steps ?? []);
  const stateSkip = state ? steps.find((s) => !completed.has(s.id) && STATE_STEPS.indexOf(s.id) < STATE_STEPS.indexOf(state.current_step)) : null;
  return {
    skill: path.basename(dir),
    relPath: path.relative(root, dir).split(path.sep).join('/'),
    currentStep: state?.current_step ?? (firstBlocked ? firstBlocked.id : 'DONE'),
    completedSteps: [...completed],
    checkpointResults: state?.checkpoint_results ?? {},
    steps,
    stepsPassed: steps.filter((s) => s.pass).length,
    stepsTotal: steps.length,
    firstBlocked,
    stateSkip,
  };
}

function checkpointResult(report, cp) {
  const def = CHECKPOINTS[cp];
  const covered = report.steps.filter((s) => def.steps.includes(s.id));
  const failed = covered.filter((s) => !s.pass);
  return {
    id: cp,
    name: def.name,
    coveredSteps: def.steps,
    result: failed.length === 0 ? 'pass' : 'fail',
    failed: failed.map((s) => ({ id: s.id, name: s.name, note: s.note })),
    nextAction: failed.length ? `补全 ${failed.map((s) => s.id).join(', ')} 后重新检查` : '允许进入下一阶段',
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--self-check')) {
    const problems = await selfCheck();
    if (problems.length) {
      console.error('[SELF-004 FAIL] 流程蓝图自检失败：');
      for (const p of problems) console.error('  - ' + p);
      process.exit(3);
    }
    console.error(`[SELF-004 PASS] ${STEP_DEFS.length} 个步骤与 ${Object.keys(CHECKPOINTS).length} 个检查点定义一致`);
    process.exit(0);
  }

  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const scanDir = value('--scan') || 'skills';
  const jsonOut = value('--json');
  const skillOnly = value('--skill');
  const stepOnly = value('--step');
  const cpOnly = value('--checkpoint');
  const rawRoot = args.find((a) => !a.startsWith('--') && !['--scan', '--json', '--skill', '--step', '--checkpoint'].includes(args[args.indexOf(a) - 1]));
  const root = rawRoot ? path.resolve(rawRoot) : null;

  if (!root || !existsSync(root)) {
    console.error('用法: node blueprint.mjs <repo-root> [--scan skills] [--skill name] [--step STEP-XX] [--checkpoint CP-X] [--json out]');
    process.exit(2);
  }
  if (stepOnly && !STATE_STEPS.includes(stepOnly)) { console.error(`--step 非法: ${stepOnly}`); process.exit(2); }
  if (cpOnly && !CHECKPOINTS[cpOnly]) { console.error(`--checkpoint 非法: ${cpOnly}`); process.exit(2); }

  let skills = await listSkills(root, scanDir);
  if (existsSync(path.join(root, 'SKILL.md'))) {
    skills = [{ name: path.basename(root), dir: root, relPath: '.', skillMdPath: path.join(root, 'SKILL.md') }];
  }
  if (skillOnly) skills = skills.filter((s) => s.name === skillOnly);
  if (skills.length === 0) { console.error(`未发现技能目录：${path.join(root, scanDir)}`); process.exit(2); }

  const reports = [];
  for (const s of skills) {
    const state = await readState(root, s.name);
    reports.push(await evaluate(root, s.dir, state));
  }

  console.log(`\n=== 流程蓝图评估 · ${reports.length} 个技能 ===\n`);
  for (const r of reports) {
    const bar = r.steps.map((s) => (s.pass ? '●' : '○')).join('');
    console.log(`${r.relPath.padEnd(42)} ${bar}  ${r.stepsPassed}/${r.stepsTotal}  当前 ${r.currentStep}`);
    if (r.stateSkip) console.log(`  ⚠️ 状态跳过：${r.stateSkip.id} ${r.stateSkip.name} 未完成，但状态已推进到 ${r.currentStep}`);
    if (r.firstBlocked) {
      console.log(`  阻塞于：${r.firstBlocked.id} ${r.firstBlocked.name}`);
      console.log(`  原因：${r.firstBlocked.note}`);
      console.log(`  回退建议：${r.firstBlocked.fallback}`);
    }
  }

  if (stepOnly) {
    console.log('\n=== 指定步骤详情 ===');
    for (const r of reports) {
      const s = r.steps.find((x) => x.id === stepOnly);
      console.log(`${r.skill}: ${s.pass ? 'PASS' : 'FAIL'} — ${s.note}`);
    }
  }

  const checkpoints = cpOnly
    ? reports.map((r) => ({ skill: r.skill, ...checkpointResult(r, cpOnly) }))
    : reports.map((r) => ({ skill: r.skill, checkpoints: Object.keys(CHECKPOINTS).map((cp) => checkpointResult(r, cp)) }));

  if (cpOnly) {
    console.log(`\n=== ${cpOnly} ${CHECKPOINTS[cpOnly].name} ===`);
    for (const c of checkpoints) console.log(`${cpOnly} ${c.skill}: ${c.result.toUpperCase()} — ${c.nextAction}`);
  }

  if (jsonOut) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify({
      generatedAt: new Date().toISOString(), root, scanDir,
      stepCount: STEP_DEFS.length,
      reports,
      checkpoints,
    }, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
