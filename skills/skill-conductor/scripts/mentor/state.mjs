#!/usr/bin/env node
/**
 * state.mjs — 技能导师 · 14 步状态机（零依赖）
 *
 * 状态文件：<repo-root>/.skill-mentor/<skill-name>.json
 * D-18：状态持久化到仓库根，而不是临时目录，便于跨会话恢复。
 *
 * 用法：
 *   node scripts/state.mjs init <repo-root> <skill-name>
 *   node scripts/state.mjs get <repo-root> <skill-name>
 *   node scripts/state.mjs advance <repo-root> <skill-name> <STEP-XX>
 *   node scripts/state.mjs checkpoint <repo-root> <skill-name> <CP-X> --result pass|fail --evidence "..."
 *
 * 退出码：0 成功；1 流程顺序违规（提示回退）；2 参数错误
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const STEPS = Array.from({ length: 14 }, (_, i) => `STEP-${String(i + 1).padStart(2, '0')}`);
const CHECKPOINTS = {
  'CP-1': { steps: ['STEP-01', 'STEP-02', 'STEP-03'], name: '设计阶段检查点' },
  'CP-2': { steps: ['STEP-06', 'STEP-07'], name: '实现阶段检查点' },
  'CP-3': { steps: ['STEP-11', 'STEP-12'], name: '打包前检查点' },
  'CP-4': { steps: ['STEP-14'], name: '维护检查点' },
};

function statePath(repoRoot, skillName) {
  return path.join(repoRoot, '.skill-mentor', `${skillName}.json`);
}

async function readState(repoRoot, skillName) {
  const p = statePath(repoRoot, skillName);
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf8'));
}

async function writeState(repoRoot, skillName, state) {
  const p = statePath(repoRoot, skillName);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(state, null, 2), 'utf8');
  return p;
}

function usage() {
  console.error('用法: node state.mjs init|get|advance|checkpoint <repo-root> <skill-name> [step|cp] [--result pass|fail] [--evidence "..."]');
}

async function main() {
  const args = process.argv.slice(2);
  const [cmd, repoRoot, skillName, extra] = args;
  if (!cmd || !repoRoot || !skillName) { usage(); process.exit(2); }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) {
    console.error(`skill 名不合法（需 kebab-case）: ${skillName}`);
    process.exit(2);
  }

  const now = new Date().toISOString();

  if (cmd === 'init') {
    const existing = await readState(repoRoot, skillName);
    if (existing) {
      console.log(JSON.stringify(existing, null, 2));
      process.exit(0);
    }
    const state = {
      skill_name: skillName,
      skill_dir: path.join(repoRoot, 'skills', skillName).split(path.sep).join('/'),
      current_step: 'STEP-01',
      completed_steps: [],
      checkpoint_results: {},
      started_at: now,
      last_updated: now,
    };
    await writeState(repoRoot, skillName, state);
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  }

  const state = await readState(repoRoot, skillName);
  if (!state) {
    console.error(`状态不存在，请先 init：${statePath(repoRoot, skillName)}`);
    process.exit(2);
  }

  if (cmd === 'get') {
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  }

  if (cmd === 'advance') {
    if (!STEPS.includes(extra)) { console.error(`步骤非法: ${extra}（只允许 STEP-01 ~ STEP-14）`); process.exit(2); }
    const targetIndex = STEPS.indexOf(extra);
    const currentIndex = STEPS.indexOf(state.current_step);
    if (targetIndex !== currentIndex) {
      const missing = STEPS.slice(0, targetIndex).filter((s) => !state.completed_steps.includes(s));
      console.error(`[顺序违规] 当前步骤 ${state.current_step}，不能直接推进到 ${extra}。`);
      if (missing.length) console.error(`请先完成并 advance：${missing.join(', ')}`);
      console.error(`回退建议：回到 ${state.current_step}，完成该步产物后再推进。`);
      process.exit(1);
    }
    state.completed_steps = [...new Set([...state.completed_steps, extra])];
    state.current_step = STEPS[targetIndex + 1] ?? 'DONE';
    state.last_updated = now;
    await writeState(repoRoot, skillName, state);
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  }

  if (cmd === 'checkpoint') {
    const cp = extra;
    if (!CHECKPOINTS[cp]) { console.error(`检查点非法: ${cp}（只允许 CP-1 ~ CP-4）`); process.exit(2); }
    const ri = args.indexOf('--result');
    const ei = args.indexOf('--evidence');
    const result = ri >= 0 ? args[ri + 1] : null;
    const evidence = ei >= 0 ? args[ei + 1] : '';
    if (!['pass', 'fail'].includes(result)) { console.error('--result 必须是 pass 或 fail'); process.exit(2); }
    state.checkpoint_results[cp] = { result, timestamp: now, evidence };
    state.last_updated = now;
    await writeState(repoRoot, skillName, state);
    console.log(JSON.stringify(state, null, 2));
    process.exit(0);
  }

  usage();
  process.exit(2);
}

export { STEPS, CHECKPOINTS, statePath, readState };
const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('state.mjs');
if (isMain) main().catch((e) => { console.error(e); process.exit(2); });
