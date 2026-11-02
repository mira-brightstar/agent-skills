#!/usr/bin/env node
/**
 * wq-judge.mjs — 文风师 30 条检查（verdict + critique 两段式）
 *
 * 不设退出码（D-09）：结果只作建议，不阻塞发布。
 *
 * 用法：
 *   node scripts/stylist/wq-judge.mjs <skill-dir|repo-root> --scan skills --skill <name> --json out.json
 *   node scripts/stylist/wq-judge.mjs <skill-dir> --prepare --json out.json
 *   node scripts/stylist/wq-judge.mjs <skill-dir> --prepare-critique --json out.json
 *   node scripts/stylist/wq-judge.mjs <skill-dir> --collect --json out.json
 *   node scripts/stylist/wq-judge.mjs --self-check
 *
 * 退出码：0 正常；2 参数/LLM 错误；3 自检失败
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listSkills } from '../lib/skill-parser.mjs';
import { analyzeSkill } from './analyze.mjs';
import {
  judgeTwoPass, prepareVerdict, prepareCritique, readVerdict, collectTwoPass,
  llmConfig, resolveWorkDir, CONFIDENCE_WEIGHT, wrapUntrustedContent,
} from '../lib/llm-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(HERE, '..', '..', 'references', 'stylist');

const CATEGORY_COUNTS = { 指令表述: 5, 认知负荷: 4, 结构清晰度: 5, 术语一致性: 3, 失败模式: 3, 触发条件: 3, 反模式: 7 };

function blocksOf(text, idPattern) {
  return text.split(/^## /m).slice(1).filter((b) => idPattern.test(b.split(/\r?\n/)[0]));
}

function parseChecks(text) {
  return blocksOf(text, /^WQ-/).map((b) => ({
    id: b.split(/\r?\n/)[0].trim(),
    category: /\*\*类别\*\*[：:]\s*([^\n]+)/.exec(b)?.[1]?.trim(),
    name: /\*\*检查项\*\*[：:]\s*([^\n]+)/.exec(b)?.[1]?.trim(),
    method: /\*\*判定方式\*\*[：:]\s*([^\n]+)/.exec(b)?.[1]?.trim(),
    rule: /\*\*粗筛规则\*\*[：:]\s*([^\n]+)/.exec(b)?.[1]?.trim(),
  }));
}

function parsePrompts(text) {
  const map = new Map();
  for (const b of blocksOf(text, /^WQ-/)) {
    const id = b.split(/\r?\n/)[0].trim();
    const blocks = [...b.matchAll(/```text\s*\r?\n([\s\S]*?)```/g)].map((m) => m[1].trim());
    if (blocks.length) map.set(id, { verdict: blocks[0], critique: blocks[1] ?? null });
  }
  return map;
}

function parseAnchors(text) {
  const map = new Map();
  for (const b of blocksOf(text, /^WQ-/)) {
    const id = b.split(/\r?\n/)[0].trim().split(/\s+/)[0];
    const posBlock = /\*\*正例\*\*[：:]?\s*\r?\n([\s\S]*?)(?=\r?\n\*\*|$)/.exec(b)?.[1] ?? '';
    const positives = posBlock.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('- ')).map((l) => l.slice(2).trim());
    map.set(id, { positives, hasAnchors: /\*\*正例\*\*/.test(b) && /\*\*反例\*\*/.test(b) && /\*\*3 档评分\*\*/.test(b) });
  }
  return map;
}

async function loadDefinitions() {
  const [checksText, promptsText, anchorsText] = await Promise.all([
    readFile(path.join(REF, 'writing-checks.md'), 'utf8'),
    readFile(path.join(REF, 'prompts.md'), 'utf8'),
    readFile(path.join(REF, 'anchors.md'), 'utf8'),
  ]);
  return { checks: parseChecks(checksText), prompts: parsePrompts(promptsText), anchors: parseAnchors(anchorsText) };
}

async function selfCheck() {
  const { checks, prompts, anchors } = await loadDefinitions();
  const problems = [];
  const ids = checks.map((c) => c.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`检查项 ID 重复：${[...new Set(dup)].join(', ')}`);
  if (checks.length !== 30) problems.push(`检查项数量应为 30，实际 ${checks.length}`);
  for (const c of checks) {
    if (!c.category) problems.push(`${c.id}: 缺少类别`);
    if (!c.name) problems.push(`${c.id}: 缺少检查项名称`);
    const p = prompts.get(c.id);
    if (!p?.verdict) problems.push(`${c.id}: prompts.md 缺少 verdict Prompt`);
    else {
      if (!p.verdict.includes('{skill_content}')) problems.push(`${c.id}: verdict Prompt 缺少 {skill_content}`);
      if (!p.verdict.includes('{deterministic}')) problems.push(`${c.id}: verdict Prompt 缺少 {deterministic}`);
    }
    if (!p?.critique) problems.push(`${c.id}: prompts.md 缺少复核 Prompt`);
    else {
      if (!p.critique.includes('{verdict_json}')) problems.push(`${c.id}: 复核 Prompt 缺少 {verdict_json}`);
      if (p.verdict === p.critique) problems.push(`${c.id}: 复核 Prompt 与 verdict Prompt 完全相同（伪投票）`);
    }
    if (!anchors.has(c.id)) problems.push(`${c.id}: anchors.md 缺少锚点`);
    else if (!anchors.get(c.id).hasAnchors) problems.push(`${c.id}: 锚点缺少正例/反例/3 档评分`);
  }
  const counts = {};
  for (const c of checks) counts[c.category] = (counts[c.category] ?? 0) + 1;
  for (const [cat, n] of Object.entries(CATEGORY_COUNTS)) {
    if (counts[cat] !== n) problems.push(`类别「${cat}」应有 ${n} 条，实际 ${counts[cat] ?? 0}`);
  }
  return { problems, checks };
}

function scoreToResult(vote) {
  if (vote.score === null || vote.score === undefined) return vote.result;
  if (vote.result === 'na') return 'na';
  return vote.score >= 1 ? 'pass' : 'fail';
}

function buildPrompt(template, check, det, skillName, content) {
  const detText = det ? `[${det.result}] ${det.evidence}` : '无（本条为纯 LLM 判定）';
  return template
    .replaceAll('{check_id}', check.id)
    .replaceAll('{check_name}', check.name)
    .replaceAll('{skill_name}', skillName)
    .replaceAll('{skill_content}', wrapUntrustedContent(content))
    .replaceAll('{deterministic}', detText);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--self-check')) {
    const { problems, checks } = await selfCheck();
    if (problems.length) {
      console.error('[SELF-005 FAIL] 文风锚点不完备：');
      for (const p of problems) console.error('  - ' + p);
      process.exit(3);
    }
    console.error(`[SELF-005 PASS] ${checks.length} 条文风检查均有定义、verdict + 复核 Prompt 与锚点`);
    process.exit(0);
  }

  const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const jsonOut = value('--json');
  const scanDir = value('--scan') || 'skills';
  const skillName = value('--skill');
  const workdir = value('--workdir');
  const collect = args.includes('--collect');
  const prepare = args.includes('--prepare');
  const prepareCritiquePhase = args.includes('--prepare-critique');
  const rawRoot = args.find((a) => !a.startsWith('--') && !['--json', '--scan', '--skill', '--workdir'].includes(args[args.indexOf(a) - 1]));
  const root = rawRoot ? path.resolve(rawRoot) : null;

  if (!root || !existsSync(root)) {
    console.error('用法: node wq-judge.mjs <skill-dir|repo-root> [--scan skills] [--skill name] [--json out] [--prepare|--prepare-critique|--collect] [--self-check]');
    process.exit(2);
  }

  const { problems, checks } = await selfCheck();
  if (problems.length) {
    console.error('[SELF-005 FAIL] 文风锚点不完备，拒绝运行：');
    for (const p of problems) console.error('  - ' + p);
    process.exit(3);
  }

  let dir = root;
  if (!existsSync(path.join(root, 'SKILL.md'))) {
    const skills = await listSkills(root, scanDir);
    if (skillName) dir = skills.find((s) => s.name === skillName)?.dir;
    else if (skills.length === 1) dir = skills[0].dir;
    if (!dir) { console.error(`未找到唯一技能，请用 --skill 指定：${root}`); process.exit(2); }
  }

  const analysis = await analyzeSkill(dir);
  const content = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
  const envMode = process.env.LLM_MODE || 'direct';
  const prepareEffective = prepare || (envMode === 'deferred' && !collect && !prepareCritiquePhase);
  const mode = collect ? 'collect' : (prepareCritiquePhase ? 'prepare-critique' : (prepareEffective ? 'deferred-verdict' : envMode));
  const { prompts, anchors } = await loadDefinitions();

  const results = [];
  for (const check of checks) {
    const det = analysis.deterministic[check.id] ?? null;
    const id = `${analysis.skill}__${check.id}`;
    const opts = { id, workDir: workdir, workDirName: 'stylist' };
    try {
      let judged;
      if (collect) {
        judged = await collectTwoPass(id, opts);
      } else if (prepareCritiquePhase) {
        const verdict = await readVerdict(id, opts);
        judged = await prepareCritique(id, buildPrompt(prompts.get(check.id).critique, check, det, analysis.skill, content), verdict, opts);
      } else if (prepareEffective) {
        judged = await prepareVerdict(id, buildPrompt(prompts.get(check.id).verdict, check, det, analysis.skill, content), opts);
      } else {
        judged = await judgeTwoPass(
          buildPrompt(prompts.get(check.id).verdict, check, det, analysis.skill, content),
          buildPrompt(prompts.get(check.id).critique, check, det, analysis.skill, content),
          opts,
        );
      }

      if (judged.deferred) {
        results.push({ id: check.id, category: check.category, name: check.name, deterministic: det, result: null, confidence: 'pending', score: null, reason: `已生成 ${judged.phase} prompt，等待 Agent 返回`, evidence: '' });
        continue;
      }
      const positives = anchors.get(check.id)?.positives ?? [];
      results.push({
        id: check.id, category: check.category, name: check.name,
        deterministic: det,
        result: judged.result,
        confidence: judged.confidence,
        score: judged.score,
        reason: judged.critique?.reason || judged.verdict?.reason || '',
        evidence: judged.critique?.evidence || judged.verdict?.evidence || '',
        weaknesses: judged.weaknesses ?? [],
        suggestion: judged.result === 'fail' ? (positives[0] ? `改为：${positives[0]}` : '参见 references/stylist/anchors.md 的正例') : null,
        verdict: judged.verdict ?? null,
        critique: judged.critique ?? null,
      });
    } catch (err) {
      console.error(`[ERROR] ${check.id}: ${err.message}`);
      process.exit(2);
    }
  }

  const categories = {};
  for (const r of results) {
    if (!categories[r.category]) categories[r.category] = { pass: 0, fail: 0, na: 0, low: 0, pending: 0 };
    const key = r.confidence === 'pending' ? 'pending' : (r.result ?? 'na');
    categories[r.category][key] += 1;
    if (r.confidence === 'low') categories[r.category].low += 1;
  }
  const count = (k) => {
    if (k === 'pending') return results.filter((r) => r.confidence === 'pending').length;
    if (k === 'low') return results.filter((r) => r.confidence === 'low').length;
    return results.filter((r) => r.result === k).length;
  };

  const soft = (() => {
    let n = 0, d = 0;
    for (const r of results) {
      const w = CONFIDENCE_WEIGHT[r.confidence] ?? 0;
      if (!w) continue;
      n += (r.score ?? 0) * w; d += 2 * w;
    }
    return d ? Number(((n / d) * 5).toFixed(2)) : null;
  })();

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    workDir: resolveWorkDir('stylist', workdir),
    skill: analysis.skill,
    dir: analysis.dir,
    analysis: {
      stats: analysis.stats,
      negative_terms: analysis.negative_terms,
      modal_terms: analysis.modal_terms,
      marketing_terms: analysis.marketing_terms,
      term_variants: analysis.term_variants,
      missing_sections: analysis.missing_sections,
      repeated_phrases: analysis.repeated_phrases,
    },
    summary: {
      total: results.length,
      pass: count('pass'), fail: count('fail'), na: count('na'),
      low_confidence: count('low'),
      pending: count('pending'),
      categories,
      softScore5: soft,
    },
    needsFix: results.filter((r) => r.result === 'fail'),
    lowConfidence: results.filter((r) => r.confidence === 'low'),
    keepAsIs: results.filter((r) => r.result === 'pass' && r.confidence === 'high').map((r) => ({ id: r.id, name: r.name })),
    checks: results,
  };

  if (jsonOut) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify(report, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }

  console.log(`\n=== 文风评审 · ${analysis.skill} · ${mode} ===`);
  console.log(`通过 ${report.summary.pass} · 失败 ${report.summary.fail} · 不适用 ${report.summary.na} · 低置信度 ${report.summary.low_confidence} · 待执行 ${report.summary.pending}`);
  console.log(`文风分 ${report.summary.softScore5 ?? 'N/A'}/5`);
  for (const r of report.needsFix.slice(0, 10)) console.log(`  [${r.confidence}] ${r.id} ${r.name} — ${r.evidence || r.reason}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
