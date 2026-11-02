#!/usr/bin/env node
/**
 * llm-judge.mjs — 评定官软轨（verdict + critique 两段式）
 *
 * 对 11 条专家条目与 3 条混合条目执行：
 *   1. verdict：按锚点判定
 *   2. critique：在已知 verdict 的前提下审查并指出薄弱点或修正
 *
 * 置信度：同意且无薄弱点 high；同意但有薄弱点 medium；不同意 low。
 * 软轨不影响退出码（D-08）。
 *
 * 用法：
 *   node scripts/assessor/llm-judge.mjs <repo-root> --scan skills --json out.json
 *   node scripts/assessor/llm-judge.mjs <repo-root> --scan skills --prepare --json out.json
 *   node scripts/assessor/llm-judge.mjs <repo-root> --scan skills --prepare-critique --json out.json
 *   node scripts/assessor/llm-judge.mjs <repo-root> --scan skills --collect --json out.json
 *   node scripts/assessor/llm-judge.mjs --self-check
 *
 * 退出码：0 正常；2 参数/路径/LLM 错误；3 自检失败
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listSkills } from '../lib/skill-parser.mjs';
import { CHECKS as QM_CHECKS } from './quality-model.mjs';
import {
  judgeTwoPass, prepareVerdict, prepareCritique, readVerdict, collectTwoPass,
  llmConfig, resolveWorkDir, CONFIDENCE_WEIGHT, wrapUntrustedContent,
} from '../lib/llm-client.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRIES_FILE = path.join(HERE, '..', '..', 'references', 'assessor', 'llm-entries.md');

function parseEntries(text) {
  const blocks = text.split(/^## /m).slice(1);
  const entries = [];
  for (const block of blocks) {
    const id = block.split(/\r?\n/)[0].trim();
    const isContent = id.startsWith('CQ-');
    if (!/^QM-[A-Z]{2}-L\d/.test(id) && !/^CQ-\d{2}$/.test(id)) continue;
    const dim = /\*\*维度\*\*[：:]\s*([^\n]+)/.exec(block)?.[1]?.trim();
    const level = isContent ? null : Number(/\*\*级别\*\*[：:]\s*L(\d)/.exec(block)?.[1]);
    const req = /\*\*条目\*\*[：:]\s*([^\n]+)/.exec(block)?.[1]?.trim();
    const threshold = /\*\*阈值\*\*[：:]\s*([^\n]+)/.exec(block)?.[1]?.trim();
    const prompts = [...block.matchAll(/```text\s*\r?\n([\s\S]*?)```/g)].map((m) => m[1].trim());
    entries.push({
      id,
      dim,
      level,
      group: isContent ? 'content' : 'quality',
      req,
      threshold,
      prompt: prompts[0] ?? null,
      critiquePrompt: prompts[1] ?? null,
      hasAnchors: /\*\*正例\*\*/.test(block) && /\*\*反例\*\*/.test(block) && /\*\*3 档评分\*\*/.test(block),
    });
  }
  return entries;
}

async function listMarkdownFiles(dir) {
  const { readdir } = await import('node:fs/promises');
  const out = [];
  async function walk(current, base) {
    if (!existsSync(current)) return;
    for (const e of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, e.name);
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (['node_modules', '.git', 'design', 'evals'].includes(e.name)) continue;
        await walk(full, base);
      } else if (/\.md$/i.test(e.name)) {
        out.push({ rel, full });
      }
    }
  }
  await walk(dir, dir);
  return out.sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : a.rel.localeCompare(b.rel)));
}

async function readSkillContent(dir) {
  const parts = [];
  let total = 0;
  for (const f of await listMarkdownFiles(dir)) {
    const t = await readFile(f.full, 'utf8');
    if (total + t.length > 24000) {
      parts.push(`\n===== ${f.rel}（已截断）=====\n${t.slice(0, Math.max(0, 24000 - total))}`);
      break;
    }
    parts.push(`\n===== ${f.rel} =====\n${t}`);
    total += t.length;
  }
  return parts.join('\n');
}

function fillPrompt(template, entry, skillName, content) {
  return template
    .replaceAll('{entry_id}', entry.id)
    .replaceAll('{skill_name}', skillName)
    .replaceAll('{skill_content}', wrapUntrustedContent(content));
}

function scoreOf(entries, group) {
  let num = 0;
  let den = 0;
  for (const e of entries) {
    if (e.group !== group) continue;
    const w = CONFIDENCE_WEIGHT[e.confidence] ?? 0;
    if (!w) continue;
    num += (e.score ?? 0) * w;
    den += 2 * w;
  }
  const value = den > 0 ? num / den : null;
  return { value, five: value === null ? null : Number((value * 5).toFixed(2)) };
}

function softScore(entries) {
  return scoreOf(entries, 'quality');
}

function contentScore(entries) {
  return scoreOf(entries, 'content');
}

async function selfCheck() {
  const text = existsSync(ENTRIES_FILE) ? await readFile(ENTRIES_FILE, 'utf8') : '';
  const entries = parseEntries(text);
  const problems = [];
  const ids = entries.map((e) => e.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`条目 ID 重复：${[...new Set(dup)].join(', ')}`);
  for (const e of entries) {
    if (!e.dim) problems.push(`${e.id}: 缺少维度`);
    if (e.group === 'quality' && !Number.isInteger(e.level)) problems.push(`${e.id}: 缺少级别`);
    if (!e.req) problems.push(`${e.id}: 缺少条目要求`);
    if (!e.prompt) problems.push(`${e.id}: 缺少 verdict Prompt`);
    if (!e.critiquePrompt) problems.push(`${e.id}: 缺少复核 Prompt`);
    if (e.critiquePrompt && !e.critiquePrompt.includes('{verdict_json}')) problems.push(`${e.id}: 复核 Prompt 缺少 {verdict_json}`);
    if (e.prompt && e.critiquePrompt && e.prompt === e.critiquePrompt) problems.push(`${e.id}: 复核 Prompt 与 verdict Prompt 完全相同（伪投票）`);
    if (!e.hasAnchors) problems.push(`${e.id}: 缺少正例/反例/3 档评分`);
  }
  const contentEntries = entries.filter((e) => e.group === 'content');
  if (contentEntries.length === 0) problems.push('缺少内容质量条目（CQ）');
  const expertIds = QM_CHECKS.filter((c) => c.verify === 'expert').map((c) => c.id);
  const hybridIds = QM_CHECKS.filter((c) => c.verify === 'hybrid').map((c) => c.id);
  for (const id of [...expertIds, ...hybridIds]) {
    if (!ids.includes(id)) problems.push(`SELF-005: 质量模型条目 ${id} 没有软轨锚点`);
  }
  const known = new Set(QM_CHECKS.map((c) => c.id));
  for (const id of ids) {
    if (id.startsWith('CQ-')) continue;
    if (!known.has(id)) problems.push(`${id}: 质量模型中不存在该条目`);
  }
  return { problems, entries, expertIds, hybridIds };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  if (args.includes('--self-check')) {
    const { problems, entries } = await selfCheck();
    if (problems.length) {
      console.error('[SELF-005 FAIL] 软轨锚点不完备：');
      for (const p of problems) console.error('  - ' + p);
      process.exit(3);
    }
    console.error(`[SELF-005 PASS] 软轨 ${entries.length} 条锚点完备（verdict + 复核 Prompt + 正反例 + 3 档评分）`);
    process.exit(0);
  }

  const jsonOut = value('--json');
  const scanDir = value('--scan') || 'skills';
  const workdir = value('--workdir');
  const skillOnly = value('--skill');
  const hardScorePath = value('--hard-score');
  const collect = args.includes('--collect');
  const prepare = args.includes('--prepare');
  const prepareCritiquePhase = args.includes('--prepare-critique');

  const rawRoot = args.find((a) => !a.startsWith('--') && ![
    '--scan', '--json', '--workdir', '--skill', '--hard-score',
  ].includes(args[args.indexOf(a) - 1]));
  const root = rawRoot ? path.resolve(rawRoot) : null;
  if (!root || !existsSync(root)) {
    console.error('用法: node llm-judge.mjs <repo-root> [--scan skills] [--json out] [--prepare|--prepare-critique|--collect] [--workdir dir] [--self-check]');
    process.exit(2);
  }

  const { entries, problems } = await selfCheck();
  if (problems.length) {
    console.error('[SELF-005 FAIL] 软轨锚点不完备，拒绝运行：');
    for (const p of problems) console.error('  - ' + p);
    process.exit(3);
  }

  let skills = await listSkills(root, scanDir);
  if (existsSync(path.join(root, 'SKILL.md'))) {
    skills = [{
      name: path.basename(root),
      dir: root,
      relPath: '.',
      skillMdPath: path.join(root, 'SKILL.md'),
    }];
  }
  if (skillOnly) skills = skills.filter((s) => s.name === skillOnly);
  if (skills.length === 0) { console.error(`未发现技能目录：${path.join(root, scanDir)}`); process.exit(2); }

  const workDirName = 'assessor';
  const envMode = process.env.LLM_MODE || 'direct';
  const prepareEffective = prepare || (envMode === 'deferred' && !collect && !prepareCritiquePhase);
  const mode = collect ? 'collect' : (prepareCritiquePhase ? 'prepare-critique' : (prepareEffective ? 'deferred-verdict' : envMode));

  const outSkills = [];
  const pending = [];
  for (const skill of skills) {
    const content = await readSkillContent(skill.dir);
    const results = [];
    for (const entry of entries) {
      const id = `${skill.name}__${entry.id}`;
      const opts = { id, workDir: workdir, workDirName };
      try {
        let judged;
        if (collect) {
          judged = await collectTwoPass(id, opts);
        } else if (prepareCritiquePhase) {
          const verdict = await readVerdict(id, opts);
          judged = await prepareCritique(id, fillPrompt(entry.critiquePrompt, entry, skill.name, content), verdict, opts);
        } else if (prepareEffective) {
          judged = await prepareVerdict(id, fillPrompt(entry.prompt, entry, skill.name, content), opts);
        } else {
          const verdictPrompt = fillPrompt(entry.prompt, entry, skill.name, content);
          const critiquePrompt = fillPrompt(entry.critiquePrompt, entry, skill.name, content);
          judged = await judgeTwoPass(verdictPrompt, critiquePrompt, opts);
        }

        if (judged.deferred) {
          pending.push({ skill: skill.name, id: entry.id, phase: judged.phase });
          results.push({
            id: entry.id,
            group: entry.group,
            verify: entry.group === 'content' ? 'content' : (QM_CHECKS.find((c) => c.id === entry.id)?.verify ?? 'expert'),
            result: null,
            confidence: 'pending',
            score: null,
            reason: `已生成 ${judged.phase} prompt，等待 Agent 返回`,
            evidence: '',
          });
        } else {
          results.push({
            id: entry.id,
            group: entry.group,
            verify: entry.group === 'content' ? 'content' : (QM_CHECKS.find((c) => c.id === entry.id)?.verify ?? 'expert'),
            result: judged.result,
            confidence: judged.confidence,
            score: judged.score,
            reason: judged.critique?.reason || judged.verdict?.reason || '',
            evidence: judged.critique?.evidence || judged.verdict?.evidence || '',
            weaknesses: judged.weaknesses ?? [],
            verdict: judged.verdict ?? null,
            critique: judged.critique ?? null,
          });
        }
      } catch (err) {
        console.error(`[ERROR] ${skill.name} / ${entry.id}: ${err.message}`);
        process.exit(2);
      }
    }
    const counts = { high: 0, medium: 0, low: 0, pending: 0 };
    const contentCounts = { high: 0, medium: 0, low: 0, pending: 0 };
    for (const r of results) {
      const bucket = r.group === 'content' ? contentCounts : counts;
      bucket[r.confidence] = (bucket[r.confidence] ?? 0) + 1;
    }
    const ss = softScore(results);
    const cs = contentScore(results);
    outSkills.push({
      name: skill.name,
      relPath: skill.relPath,
      entries: results,
      counts,
      contentCounts,
      softScore0to1: ss.value,
      softScore5: ss.five,
      contentScore0to1: cs.value,
      contentScore5: cs.five,
    });
  }

  const summary = {
    entries: entries.length,
    quality_entries: entries.filter((e) => e.group === 'quality').length,
    content_entries: entries.filter((e) => e.group === 'content').length,
    high_confidence: outSkills.reduce((n, s) => n + s.counts.high, 0),
    medium_confidence: outSkills.reduce((n, s) => n + s.counts.medium, 0),
    low_confidence: outSkills.reduce((n, s) => n + s.counts.low, 0),
    content_high: outSkills.reduce((n, s) => n + s.contentCounts.high, 0),
    content_medium: outSkills.reduce((n, s) => n + s.contentCounts.medium, 0),
    content_low: outSkills.reduce((n, s) => n + s.contentCounts.low, 0),
    pending: pending.length,
    skills: outSkills.length,
  };
  const overall = softScore(outSkills.flatMap((s) => s.entries));
  const contentOverall = contentScore(outSkills.flatMap((s) => s.entries));
  summary.softScore0to1 = overall.value;
  summary.softScore5 = overall.five;
  summary.contentScore0to1 = contentOverall.value;
  summary.contentScore5 = contentOverall.five;

  let composite = null;
  if (hardScorePath && existsSync(hardScorePath)) {
    const hard = JSON.parse(await readFile(hardScorePath, 'utf8'));
    composite = [];
    for (const s of outSkills) {
      const card = (hard.scorecards ?? []).find((c) => c.skill === s.name || c.relPath === s.relPath);
      if (!card || s.softScore0to1 === null) continue;
      const hardScore = card.overallMachineLevel / 5;
      const score = hardScore * 0.7 + s.softScore0to1 * 0.3;
      composite.push({
        skill: s.name,
        hardLevel: card.overallMachineLevel,
        hardScore: Number(hardScore.toFixed(3)),
        softScore0to1: s.softScore0to1,
        compositeScore: Number(score.toFixed(3)),
        compositeLevel: Math.floor(score * 5),
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    workDir: resolveWorkDir(workDirName, workdir),
    summary,
    skills: outSkills,
    composite,
    pending,
  };

  if (jsonOut) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify(report, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }

  console.log(`\n=== 软轨判定 · ${mode} · ${outSkills.length} 个技能 × ${summary.quality_entries} 条工程 + ${summary.content_entries} 条内容 ===\n`);
  for (const s of outSkills) {
    console.log(`${s.name}: 工程 high ${s.counts.high} / medium ${s.counts.medium} / low ${s.counts.low} / pending ${s.counts.pending}，分 ${s.softScore5 ?? 'N/A'}/5；内容 high ${s.contentCounts.high} / medium ${s.contentCounts.medium} / low ${s.contentCounts.low} / pending ${s.contentCounts.pending}，分 ${s.contentScore5 ?? 'N/A'}/5`);
  }
  if (pending.length) console.log(`\n等待 Agent 执行 ${pending.length} 条 ${pending[0]?.phase} prompt。工作目录：${resolveWorkDir(workDirName, workdir)}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
