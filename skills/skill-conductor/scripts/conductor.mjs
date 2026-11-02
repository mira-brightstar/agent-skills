#!/usr/bin/env node
/**
 * conductor.mjs — 单一 skill-conductor 包的编排层（零依赖）
 *
 * 两个主入口：
 *   evaluate（评价已有 skill）  → assessor 硬轨 + assessor 软轨 + stylist
 *   develop （指导开发新 skill）→ mentor；全部步骤完成后自动走 evaluate 终检
 *
 * 两个单选项：
 *   assess（只做合格评定）→ assessor
 *   style （只做文风评审）→ stylist
 *
 * 编排纪律：
 *   - 不短路：无论前序模块成功或失败，后续检查模块都必须执行完毕。
 *   - 退出码只在全部检查完成后汇总，且只反映 assessor 硬轨（0/1/2/3）。
 *   - stylist 与 mentor 不影响退出码。
 *
 * 用法：
 *   node scripts/conductor.mjs <repo-root> --scan skills [--skill name] [--intent evaluate|develop|assess|style] [--json out]
 *
 * 退出码：0/1/3 = assessor 硬轨汇总；2 = 参数错误
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { listSkills } from './lib/skill-parser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = {
  validate: path.join(HERE, 'assessor', 'validate.mjs'),
  score: path.join(HERE, 'assessor', 'score.mjs'),
  audit: path.join(HERE, 'assessor', 'audit.mjs'),
  sensitivity: path.join(HERE, 'assessor', 'sensitivity.mjs'),
  llmJudge: path.join(HERE, 'assessor', 'llm-judge.mjs'),
  stylist: path.join(HERE, 'stylist', 'wq-judge.mjs'),
  blueprint: path.join(HERE, 'mentor', 'blueprint.mjs'),
  state: path.join(HERE, 'mentor', 'state.mjs'),
};

function runNode(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { exitCode: r.status ?? 2, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function runJson(script, args, workDir, name) {
  const out = path.join(workDir, `${name}.json`);
  const r = runNode(script, [...args, '--json', out]);
  let data = null;
  if (existsSync(out)) {
    try { data = JSON.parse(await readFile(out, 'utf8')); } catch { data = null; }
  }
  return { exitCode: r.exitCode, jsonPath: out, data, stderr: r.stderr.slice(-2000) };
}

/** 汇总硬轨退出码：3 优先，其次 1，否则 0 */
function aggregateHard(entries) {
  const codes = entries.map((e) => e.exitCode);
  if (codes.includes(3)) return 3;
  if (codes.includes(1)) return 1;
  if (codes.includes(2)) return 2;
  return 0;
}

async function runAssessorHard(root, scanDir, workDir) {
  const single = existsSync(path.join(root, 'SKILL.md'));
  const scanArgs = single ? [] : ['--scan', scanDir];
  const v = await runJson(SCRIPTS.validate, [root, ...scanArgs, '--level', '3'], workDir, 'validate');
  const s = await runJson(SCRIPTS.score, [root, ...scanArgs], workDir, 'score');
  const a = await runJson(SCRIPTS.audit, [root], workDir, 'audit');
  const sens = await runJson(SCRIPTS.sensitivity, ['--skill-dir', path.join(HERE, '..', 'evals', 'fixtures', 'release-notes')], workDir, 'sensitivity');
  return {
    validate: v, score: s, audit: a, sensitivity: sens,
    exitCode: aggregateHard([v, s, a, sens]),
  };
}

async function runAssessorSoft(root, scanDir, skill, workDir, hardScorePath) {
  const single = existsSync(path.join(root, 'SKILL.md'));
  const args = [root];
  if (!single) args.push('--scan', scanDir);
  if (skill && !single) args.push('--skill', skill);
  if (hardScorePath) args.push('--hard-score', hardScorePath);
  return runJson(SCRIPTS.llmJudge, args, workDir, 'soft');
}

async function runStylist(root, scanDir, skill, workDir) {
  const single = existsSync(path.join(root, 'SKILL.md'));
  // stylist 一次评一个技能；未指定 skill 时逐个评
  let targets = skill ? [skill] : [];
  if (!targets.length) {
    const skills = single ? [{ name: path.basename(root) }] : await listSkills(root, scanDir);
    targets = skills.map((s) => s.name);
  }
  if (!targets.length) return { exitCode: 0, results: [], note: '未发现技能，stylist 跳过' };
  const results = [];
  for (const name of targets) {
    const args = single ? [root] : [root, '--scan', scanDir, '--skill', name];
    const r = await runJson(SCRIPTS.stylist, args, workDir, `stylist-${name}`);
    results.push({ skill: name, ...r });
  }
  return { exitCode: 0, results };
}

async function runMentor(root, scanDir, skill, workDir, finalCheck) {
  const single = existsSync(path.join(root, 'SKILL.md'));
  const args = single ? [root] : [root, '--scan', scanDir];
  if (skill && !single) args.push('--skill', skill);
  const bp = await runJson(SCRIPTS.blueprint, args, workDir, 'blueprint');
  const report = bp.data?.reports?.find((r) => !skill || r.skill === skill) ?? bp.data?.reports?.[0] ?? null;
  const complete = report ? !report.firstBlocked : false;
  const shouldFinal = finalCheck || complete;
  if (!shouldFinal) return { blueprint: bp, complete, finalCheck: null };
  return { blueprint: bp, complete, finalCheck: await runEvaluate(root, scanDir, skill, workDir) };
}

function skipReason(hardExit) {
  return `硬轨汇总退出码 ${hardExit}（非 0），按编排规则跳过软轨与文风评审`;
}

async function runEvaluate(root, scanDir, skill, workDir) {
  const hard = await runAssessorHard(root, scanDir, workDir);
  if (hard.exitCode !== 0) {
    return {
      hard,
      soft: null,
      stylist: null,
      skipped: { soft: true, stylist: true, reason: skipReason(hard.exitCode) },
      exitCode: hard.exitCode,
    };
  }
  const soft = await runAssessorSoft(root, scanDir, skill, workDir, hard.score.jsonPath);
  const stylist = await runStylist(root, scanDir, skill, workDir);
  return { hard, soft, stylist, skipped: null, exitCode: hard.exitCode };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const rawRoot = args.find((a) => !a.startsWith('--') && !['--scan', '--skill', '--intent', '--json'].includes(args[args.indexOf(a) - 1]));
  const root = rawRoot ? path.resolve(rawRoot) : null;
  const scanDir = value('--scan') || 'skills';
  const skill = value('--skill');
  const intent = value('--intent') || 'evaluate';
  const jsonOut = value('--json');
  const finalCheck = args.includes('--final-check');

  if (!root || !existsSync(root)) {
    console.error('用法: node conductor.mjs <repo-root> [--scan skills] [--skill name] [--intent evaluate|develop|assess|style] [--json out] [--final-check]');
    process.exit(2);
  }
  if (!['evaluate', 'develop', 'assess', 'style'].includes(intent)) {
    console.error(`--intent 必须是 evaluate|develop|assess|style，收到: ${intent}`);
    process.exit(2);
  }

  const workDir = path.join(os.tmpdir(), `conductor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(workDir, { recursive: true });

  let modules = {};
  let exitCode = 0;

  if (intent === 'evaluate') {
    modules = await runEvaluate(root, scanDir, skill, workDir);
    exitCode = modules.exitCode;
  } else if (intent === 'assess') {
    const hard = await runAssessorHard(root, scanDir, workDir);
    if (hard.exitCode !== 0) {
      modules = {
        hard,
        soft: null,
        skipped: { soft: true, reason: skipReason(hard.exitCode) },
        exitCode: hard.exitCode,
      };
    } else {
      const soft = await runAssessorSoft(root, scanDir, skill, workDir, hard.score.jsonPath);
      modules = { hard, soft, skipped: null, exitCode: hard.exitCode };
    }
    exitCode = hard.exitCode;
  } else if (intent === 'style') {
    const stylist = await runStylist(root, scanDir, skill, workDir);
    modules = { stylist, exitCode: 0 };
    exitCode = 0;
  } else {
    const mentor = await runMentor(root, scanDir, skill, workDir, finalCheck);
    modules = mentor;
    exitCode = mentor.finalCheck ? mentor.finalCheck.exitCode : 0;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    intent,
    root,
    scanDir,
    skill: skill ?? null,
    exitCode,
    modules,
  };

  if (jsonOut) {
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify(report, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }

  console.log(`\n=== skill-conductor · ${intent} ===`);
  console.log(`目标：${root}${skill ? ` / ${skill}` : ''}`);
  if (intent === 'evaluate' || intent === 'assess') {
    const h = modules.hard;
    console.log(`硬轨：validate=${h.validate.exitCode} score=${h.score.exitCode} audit=${h.audit.exitCode} sensitivity=${h.sensitivity.exitCode} → 汇总 ${h.exitCode}`);
    if (modules.skipped?.soft) {
      console.log(`软轨与文风：已跳过 — ${modules.skipped.reason}`);
    } else {
      const ss = modules.soft?.data?.summary;
      console.log(ss
        ? `软轨（参考信号）：工程 high ${ss.high_confidence} / medium ${ss.medium_confidence} / low ${ss.low_confidence}；内容 high ${ss.content_high ?? 0} / medium ${ss.content_medium ?? 0} / low ${ss.content_low ?? 0}；pending ${ss.pending}`
        : '软轨（参考信号）：未产出');
      if (modules.stylist) {
        const st = modules.stylist.results?.[0]?.data?.summary;
        console.log(`文风（参考信号）：${st ? `通过 ${st.pass} / 失败 ${st.fail} / 低置信度 ${st.low_confidence} / pending ${st.pending}，分 ${st.softScore5 ?? 'N/A'}/5` : '未产出'}`);
      }
    }
  } else if (intent === 'style') {
    const st = modules.stylist?.results?.[0]?.data?.summary;
    console.log(`文风（参考信号）：${st ? `通过 ${st.pass} / 失败 ${st.fail} / 低置信度 ${st.low_confidence} / pending ${st.pending}` : '未产出'}`);
  } else {
    const r = modules.blueprint?.data?.reports?.[0];
    console.log(`导师：${r ? `当前 ${r.currentStep}，通过 ${r.stepsPassed}/${r.stepsTotal}` : '未产出'}`);
    if (r?.firstBlocked) console.log(`阻塞：${r.firstBlocked.id} ${r.firstBlocked.name} — ${r.firstBlocked.note}`);
    if (modules.finalCheck) console.log(`终检：已执行，硬轨汇总 ${modules.finalCheck.exitCode}`);
  }
  console.log(`退出码：${exitCode}`);
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(2); });
