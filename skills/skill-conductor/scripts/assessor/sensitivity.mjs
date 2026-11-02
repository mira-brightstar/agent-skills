#!/usr/bin/env node
/**
 * sensitivity.mjs — 敏感性测试：标准能否区分好坏
 *
 * 为什么需要它：
 *   阶段 5 的一致性验证只证明了「两次评审结论相同」。但 kappa=1.0 也可能是
 *   两次评审都同样地「什么都发现不了」——即标准无区分力。
 *   本测试通过**缺陷注入**回答另一个问题：**标准能否抓住真实缺陷？**
 *
 * 做法：复制一个已知合规的技能，逐个注入缺陷，断言对应检查必须失败。
 *   若某个注入的缺陷未被任何检查抓住 → 标准存在盲区，测试失败。
 *
 * 用法：
 *   node sensitivity.mjs [--skill-dir <path>] [--json <out.json>]
 * 退出码：0 全部缺陷被抓住 / 1 存在盲区 / 2 参数错误
 */

import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 单一包结构：基线技能位于根 evals/fixtures
const DEFAULT_SKILL = path.join(HERE, '..', '..', 'evals', 'fixtures', 'release-notes');

/** 缺陷注入清单：每个缺陷断言至少一个指定检查必须失败 */
const MUTATIONS = [
  {
    id: 'MUT-01', name: '移除 portability 声明',
    expect: ['V-061'], why: '使用 L1 字段（argument-hint）却未声明 claude-code-only',
    apply: (t) => t.replace(/^\s*portability:.*$/m, ''),
  },
  {
    id: 'MUT-02', name: 'Bash 工具去掉作用域',
    expect: ['V-021'], why: '裸 Bash 等于无限制命令执行',
    apply: (t) => t.replace('Bash(git log *)', 'Bash'),
  },
  {
    id: 'MUT-03', name: '注入硬编码凭证',
    expect: ['V-070'], why: '凭证随技能公开泄露',
    // 运行时拼接：避免把可直接命中的凭证字面量写进本 skill 自己的源码，导致 V-070 自伤
    apply: (t) => t.replace('## Inputs', `## Inputs\n\n> 调试用 token: ${['ghp', 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5z'].join('_')}\n`),
  },
  {
    id: 'MUT-04', name: '字段名大小写错误',
    expect: ['V-014'], why: '字段名拼错会被静默忽略，技能能跑但行为不符预期',
    apply: (t) => t.replace(/^description:/m, 'Description:'),
  },
  {
    id: 'MUT-05', name: '首行插入空行（破坏 frontmatter 识别）',
    expect: ['V-003'], why: '整个 frontmatter 会被当作正文，元数据全空',
    apply: (t) => '\n' + t,
  },
  {
    id: 'MUT-06', name: 'metadata 改成嵌套结构',
    expect: ['V-016'], why: 'spec 要求 metadata 是 string→string 映射',
    apply: (t) => t.replace(/^metadata:\n(?:  .*\n)+/m, 'metadata:\n  contract:\n    version: "1"\n'),
  },
  {
    id: 'MUT-07', name: '删除 Failure modes 小节',
    expect: ['V-043'], why: '失败模式缺失意味着静默降级的风险',
    apply: (t) => t.replace(/^## Failure modes[\s\S]*?(?=^## )/m, ''),
  },
  {
    id: 'MUT-08', name: '删除 Verification 小节',
    expect: ['QM-TS-L2b'], why: '无可核验的验证说明，改动后无法知道是否破坏行为',
    apply: (t) => t.replace(/^## Verification[\s\S]*?(?=^## )/m, ''),
  },
  {
    id: 'MUT-09', name: '目录名与 name 字段不一致',
    expect: ['V-010'], why: '跨生态打包硬报错；Skill 工具调用名错位',
    renameDirTo: 'renamed-skill',
  },
];

function runValidate(dir) {
  const out = path.join(os.tmpdir(), `sens-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  spawnSync(process.execPath, [path.join(HERE, 'validate.mjs'), dir, '--level', '5', '--json', out], { encoding: 'utf8' });
  try { return JSON.parse(readFileSync(out, 'utf8')); } catch { return null; }
}

/** QM 条目需另跑 score */
function runScore(dir) {
  const out = path.join(os.tmpdir(), `sens-sc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  spawnSync(process.execPath, [path.join(HERE, 'score.mjs'), dir, '--json', out], { encoding: 'utf8' });
  try { return JSON.parse(readFileSync(out, 'utf8')); } catch { return null; }
}

async function main() {
  const args = process.argv.slice(2);
  const si = args.indexOf('--skill-dir');
  const skillDir = si >= 0 ? args[si + 1] : DEFAULT_SKILL;
  const ji = args.indexOf('--json');
  const jsonOut = ji >= 0 ? args[ji + 1] : null;

  if (!existsSync(skillDir)) { console.error(`技能目录不存在: ${skillDir}`); process.exit(2); }

  const tmpRoot = path.join(os.tmpdir(), `sens-run-${Date.now()}`);
  const results = [];

  // 基线：原始技能必须完全通过（否则敏感性测试无意义）
  const baseOut = runValidate(skillDir);
  const baseFailed = (baseOut?.results ?? []).filter((r) => r.failed).map((r) => r.id);
  const baseScore = runScore(skillDir);
  const baseQmFailed = (baseScore?.scorecards?.[0]?.entries ?? []).filter((e) => e.pass === false).map((e) => e.id);
  const baselineClean = baseFailed.length === 0 && baseQmFailed.length === 0;

  console.log(`\n=== 敏感性测试 · 基线 ===`);
  console.log(`技能：${path.relative(process.cwd(), skillDir)}`);
  console.log(`基线状态：${baselineClean ? '合规（无失败项）' : `存在失败项 — SPEC ${baseFailed.join(', ') || '无'}；QM ${baseQmFailed.join(', ') || '无'}`}`);
  if (!baselineClean) console.log('⚠️ 基线不干净，注入测试的结果将无法归因。请先修复基线。');
  console.log('');

  for (const mut of MUTATIONS) {
    const dir = path.join(tmpRoot, mut.id);
    await mkdir(path.dirname(dir), { recursive: true });
    await cp(skillDir, dir, { recursive: true });

    if (mut.renameDirTo) {
      const target = path.join(tmpRoot, mut.renameDirTo);
      await cp(dir, target, { recursive: true });
      await rm(dir, { recursive: true, force: true });
      results.push(await evaluate(mut, target));
      continue;
    }
    const p = path.join(dir, 'SKILL.md');
    await writeFile(p, mut.apply(await readFile(p, 'utf8')), 'utf8');
    results.push(await evaluate(mut, dir));
  }

  await rm(tmpRoot, { recursive: true, force: true });

  const caught = results.filter((r) => r.caught).length;
  console.log(`=== 结果：${caught}/${results.length} 个注入缺陷被抓住 ===\n`);
  for (const r of results) {
    console.log(`[${r.caught ? ' CAUGHT ' : ' MISSED '}] ${r.id} ${r.name}`);
    console.log(`           期望 ${r.expect.join(', ')} 失败 → 实际失败：${r.actualFailed.length ? r.actualFailed.join(', ') : '（无）'}`);
    if (!r.caught) console.log(`           ⚠️ 盲区：${r.why}`);
  }
  const coverage = results.length ? caught / results.length : 0;
  console.log(`\n缺陷检出率：${(coverage * 100).toFixed(0)}%`);

  if (jsonOut) {
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify({
      generatedAt: new Date().toISOString(), skillDir, baselineClean,
      baselineSpecFailed: baseFailed, baselineQmFailed: baseQmFailed,
      total: results.length, caught, detectionRate: coverage, results,
    }, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }
  process.exit(caught === results.length && baselineClean ? 0 : 1);
}

async function evaluate(mut, dir) {
  const v = runValidate(dir);
  const s = runScore(dir);
  const actual = new Set();
  for (const r of (v?.results ?? [])) if (r.failed) actual.add(r.id);
  for (const e of (s?.scorecards?.[0]?.entries ?? [])) if (e.pass === false) actual.add(e.id);
  const actualFailed = [...actual];
  const caught = mut.expect.some((id) => actual.has(id));
  return { id: mut.id, name: mut.name, why: mut.why, expect: mut.expect, actualFailed, caught };
}

main().catch((e) => { console.error(e); process.exit(2); });
