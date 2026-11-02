#!/usr/bin/env node
/**
 * score.mjs — 质量模型评分器
 *
 * 职责：
 *   1. 调用 validate.mjs（规范符合性）与 audit.mjs（仓库一致性）取得机器判定结果；
 *   2. 自行判定 QM 中 runner='repo' 的条目（需要文件系统探索，无法由单文件检查表达）；
 *   3. 对每个技能、每个维度计算**已达到的等级**；
 *   4. 无法机器判定的条目交给软轨 `llm-judge.mjs` 按锚点裁决（本脚本不再输出待专家确认清单）。
 *
 * 关键设计：机器等级与软轨评分分开报告。
 *   机器等级 = 满足全部机器条目的最高级别。
 *   软轨评分 = 专家/混合条目按 LLM 多采样投票结果加权，不进入退出码。
 *   这样既不假装机器能判定一切，也不让不可判定的条目阻塞自动化。
 *
 * 用法：
 *   node score.mjs <repo-root> [--scan skills] [--target L3] [--json out.json]
 * 退出码：
 *   0 = 达到目标等级（或未指定目标）
 *   1 = 未达到 --target 指定的等级
 *   2 = 参数/路径错误
 */

import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { CHECKS, DIMENSIONS, LEVELS, MODEL_VERSION } from './quality-model.mjs';
import { CHECKS as SPEC_CHECKS } from './validate.mjs';
import { listSkills } from '../lib/skill-parser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * SELF-002：SPEC 与 QM 的级别一致性自检。
 *
 * 为什么需要它：规范（SPEC）与质量模型（QM）是两份独立维护的数据，
 * 同一个要求在两边各有一个级别。二者失配会让使用者拿到互相矛盾的结论——
 * 本评分器第一版就出现过：SPEC 把「依赖声明」定为 L3，QM 却把它定为 L2，
 * 导致同一个技能在 SPEC 下是 L2、在 QM 下却是 L1。
 *
 * 规则：
 *   1. QM 条目的级别不得低于它所依赖的任一 V 检查的 minLevel。
 *   2. 引用的 V 检查必须真实存在（防止拼错 ID 导致的空通过）。
 *   3. C-* 前缀的是 audit.mjs 的**仓库级**检查，不参与级别对齐（仓库级要求不属于单个技能的分级）。
 */
function selfCheckSpecConsistency() {
  const specLevel = new Map(SPEC_CHECKS.map((c) => [c.id, c.minLevel]));
  const problems = [];
  for (const qm of CHECKS) {
    if (!qm.check || qm.check.length === 0) continue;
    const vIds = qm.check.filter((id) => /^V-/.test(id));
    const unknown = vIds.filter((id) => !specLevel.has(id));
    for (const u of unknown) problems.push(`${qm.id} 依赖了不存在的 SPEC 检查 ${u}（会导致空通过）`);
    const required = Math.max(0, ...vIds.filter((id) => specLevel.has(id)).map((id) => specLevel.get(id)));
    if (required > qm.level) {
      problems.push(`${qm.id} 级别 L${qm.level} 低于其依赖的 ${vIds.map((id) => `${id}(L${specLevel.get(id)})`).join(', ')}，应为 L${required}`);
    }
  }
  return problems;
}

/**
 * SELF-003：不可机器判定的条目必须有专家锚点。
 *
 * 这是本项目的核心硬要求之一：「不能机器验证的，必须给专家评审锚点和评分示例」。
 * 若只标注 expert 却不给锚点，评审者会各自解读，一致性（kappa）必然崩塌。
 * 因此把它做成工具链自检，而不是靠人记得写。
 */
function selfCheckAnchors() {
  const problems = [];
  for (const qm of CHECKS) {
    if (qm.verify === 'machine') continue;
    if (!qm.anchor) problems.push(`${qm.id}（${qm.verify}）缺少专家锚点，评审者将无据可依`);
  }
  return problems;
}

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

/** 运行子进程并把 JSON 产物读回来；容忍非零退出码（validate/audit 用退出码表达失败） */
function runJsonTool(script, args) {
  const outFile = path.join(os.tmpdir(), `skill-conductor-${path.basename(script)}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [path.join(HERE, script), ...args, '--json', outFile], { encoding: 'utf8' });
  let data = null;
  try { data = JSON.parse(readFileSyncSafe(outFile)); } catch { /* 保持 null */ }
  return { exitCode: r.status, stderr: r.stderr ?? '', data };
}
function readFileSyncSafe(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

// ---------------------------------------------------------------------------
// runner='repo' 的条目实现（需要文件系统探索）
// ---------------------------------------------------------------------------
const REPO_CHECKS = {
  /** QM-FN-L2b：技能内（含渐进披露的引用文件）含 ≥1 个可辨识的真实示例 */
  'QM-FN-L2b': async (dir, body) => {
    // 渐进披露下示例常放在 references/ 里，因此扫描技能内全部 Markdown，而非只看 SKILL.md 正文
    const files = (await listFiles(dir)).filter((f) => f.rel.endsWith('.md'));
    let best = null;
    for (const f of files) {
      const t = f.rel === 'SKILL.md' ? body : await readText(f.full);
      if (!t) continue;
      const fenced = [...t.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]);
      const longEnough = fenced.some((x) => x.split(/\r?\n/).length >= 6);
      const hasExampleSection = /^#{1,6}\s*(?:示例|例子|example|examples)\b/im.test(t);
      if ((longEnough || hasExampleSection) && !best) best = `${f.rel}（${longEnough ? '≥5 行代码块' : '示例小节'}）`;
    }
    return { pass: Boolean(best), note: best ?? `扫描 ${files.length} 个 Markdown，均无示例代码块或示例小节` };
  },
  /** QM-FN-L4：存在可复现的回归基线 */
  'QM-FN-L4': async (dir) => {
    for (const d of ['evals', 'tests', 'test']) {
      const p = path.join(dir, d);
      if (!existsSync(p)) continue;
      const files = await listFiles(p);
      if (files.length === 0) continue;
      let pairs = 0;
      for (const f of files) {
        const t = await readText(f.full);
        if (!t) continue;
        if (/(?:input|输入|case|given)/i.test(t) && /(?:expect|expected|期望|should|断言)/i.test(t)) pairs++;
      }
      if (pairs > 0) return { pass: true, note: `${d}/ 下有 ${pairs} 个「输入+期望」对` };
    }
    return { pass: false, note: '未找到含「输入+期望」对的 evals/ 或 tests/ 目录' };
  },
  /** QM-DC-L4：文档含真实示例（文档包括渐进披露的引用文件） */
  'QM-DC-L4': async (dir, body) => {
    const files = (await listFiles(dir)).filter((f) => f.rel.endsWith('.md'));
    let total = 0, where = null;
    for (const f of files) {
      const t = f.rel === 'SKILL.md' ? body : await readText(f.full);
      if (!t) continue;
      const n = [...t.matchAll(/```[\s\S]*?```/g)].length;
      total += n;
      if (n > 0 && !where) where = f.rel;
    }
    return { pass: total >= 1, note: total >= 1 ? `共 ${total} 个代码块，首个出现在 ${where}` : `扫描 ${files.length} 个 Markdown，无示例代码块` };
  },
  /** QM-DC-L5：有变更记录 */
  'QM-DC-L5': async (dir, body, ctx) => {
    const hasChangelog = existsSync(path.join(ctx.root, 'CHANGELOG.md'));
    const hasChangeset = await listDirs(path.join(ctx.root, '.changeset')).then((d) => d.length > 0);
    if (hasChangelog || hasChangeset) return { pass: true, note: hasChangelog ? '存在 CHANGELOG.md' : '存在 .changeset/' };

    // 独立技能没有仓库级变更记录，改为检查技能自身的变更记录：
    //   技能目录下的 CHANGELOG.md，或 evals/ 用例文件里的 history 块（QM-TS-L5 要求维护的同一份记录）。
    // 不直接豁免，是因为「行为变更可追溯」对独立技能同样成立且同样重要。
    if (!ctx.isRepoMember) {
      if (existsSync(path.join(dir, 'CHANGELOG.md'))) return { pass: true, note: '技能目录下存在 CHANGELOG.md' };
      for (const d of ['evals', 'tests', 'test']) {
        for (const f of await listFiles(path.join(dir, d))) {
          // 排除测试 fixture：fixtures/ 下是样例技能的用例，不是本技能自己的变更记录。
          // 曾出现 skill-conductor 因 fixtures/release-notes 的 history 块被误判为「有变更记录」。
          if (f.rel.startsWith('fixtures/')) continue;
          const t = await readText(f.full);
          if (t && /^history:\s*$/m.test(t) && /^\s*- date:/m.test(t)) {
            return { pass: true, note: `变更记录位于 ${f.rel} 的 history 块` };
          }
        }
      }
      return { pass: false, note: '独立技能：无 CHANGELOG.md，evals 内也无 history 记录' };
    }
    return { pass: false, note: '仓库无 CHANGELOG.md 也无 .changeset/' };
  },
  /** QM-TS-L1 / QM-RB-L1 / QM-SC-L1 / QM-MT-L1：低级别显式无要求 */
  'QM-TS-L1': async () => ({ pass: true, note: 'L1 显式无要求' }),
  'QM-RB-L1': async () => ({ pass: true, note: 'L1 显式无要求' }),
  'QM-SC-L1': async () => ({ pass: true, note: 'L1 显式无要求' }),
  'QM-MT-L1': async () => ({ pass: true, note: 'L1 显式无要求' }),
  /**
   * QM-TS-L2b：声明了可核验的验证说明。
   * 查找范围刻意放宽到配套文档页 docs/<bucket>/<name>.md ——
   * 样本仓库把验证说明写在文档页的 "It's working if" 段里（模式库 P-04），
   * 只扫技能目录会漏掉这种合法做法，产生误报。
   */
  'QM-TS-L2b': async (dir, body, ctx) => {
    // 收录常见同义写法，并允许可选的编号前缀（如 `### 5. Verify`）。
    // 这两个补充都是被示例评审逼出来的：git-guardrails-claude-code 用 `### 5. Verify`
    // 承载验证说明，初版正则既未收录 `Verify`，也未考虑编号前缀，导致误报。
    const VERIFY_HEADING = /^#{1,6}\s*(?:\d+[.、)]\s*)?(?:Verification|Verify|How to verify|It'?s working if|验证|如何确认|完成判据|成功判据|验收)/im;
    const candidates = [{ rel: 'SKILL.md', text: body }];
    for (const f of await listFiles(dir)) {
      if (f.rel === 'SKILL.md' || !f.rel.endsWith('.md')) continue;
      // 排除 design/：那是**过程记录**（需求界定、生态决策），按约定不随技能发布。
      // 敏感性测试 MUT-08 曾暴露此缺陷：删掉 SKILL.md 的 Verification 小节后检查仍通过，
      // 因为 design/01-需求界定.md 里的「完成判据」小节被误当作技能的验证说明。
      // 教训：检查范围必须与该条要求的语义一致，范围过宽会让检查形同虚设。
      if (f.rel.startsWith('design/')) continue;
      candidates.push({ rel: f.rel, text: await readText(f.full) });
    }
    const skillName = path.basename(dir);
    const bucket = path.basename(path.dirname(dir));
    const docRel = `docs/${bucket}/${skillName}.md`;
    const docText = await readText(path.join(ctx.root, docRel));
    if (docText) candidates.push({ rel: docRel, text: docText });

    for (const c of candidates) {
      if (typeof c.text === 'string' && VERIFY_HEADING.test(c.text)) {
        return { pass: true, note: `验证说明位于 ${c.rel}` };
      }
    }
    return { pass: false, note: `扫描 ${candidates.length} 个 Markdown（含 ${docRel}），均无验证类小节标题` };
  },
  /** QM-TS-L3：提供 ≥1 个评测用例（case + expect） */
  'QM-TS-L3': async (dir) => {
    for (const d of ['evals', 'tests', 'test']) {
      const p = path.join(dir, d);
      if (!existsSync(p)) continue;
      for (const f of await listFiles(p)) {
        const t = await readText(f.full);
        if (t && /case/i.test(t) && /expect/i.test(t)) return { pass: true, note: `${f.rel} 含 case/expect` };
      }
    }
    return { pass: false, note: '无含 case/expect 的评测文件' };
  },
  /** QM-TS-L4：可自动执行 + 覆盖失败路径 + 已接入 CI 门禁 */
  'QM-TS-L4': async (dir, body, ctx) => {
    const files = await listFiles(dir);
    const runner = files.find((f) => /^(?:scripts|evals|tests)\//.test(f.rel) && /\.(mjs|js|cjs|py|sh)$/.test(f.rel));
    const declared = /(?:评测|eval)[^\n]{0,20}(?:运行|runner|命令|command)/i.test(body);
    const runnable = Boolean(runner) || declared;

    let failureCases = 0;
    for (const d of ['evals', 'tests', 'test']) {
      const p = path.join(dir, d);
      if (!existsSync(p)) continue;
      for (const f of await listFiles(p)) {
        const t = await readText(f.full);
        if (t && /(?:fail|failure|invalid|error|失败|非法)/i.test(t)) failureCases++;
      }
    }

    // 独立技能（不属于任何可分发仓库）没有 CI 基建，这一项按豁免处理——
    // 与 audit 类检查同样的道理：不适用不等于通过，必须显式豁免并说明。
    // 但单技能包可能自带 .github/workflows；此时 CI 是真实存在的，不应再豁免。
    const wf = path.join(ctx.root, '.github', 'workflows');
    const wfFiles = existsSync(wf) ? await listFiles(wf) : [];
    const hasCi = wfFiles.length > 0;
    if (!ctx.isRepoMember && !hasCi) {
      const pass = runnable && failureCases > 0;
      return { pass, note: `可执行 ${runnable ? '是' : '否'}；失败路径用例 ${failureCases} 个；CI 门禁豁免（非仓库成员且无 workflows）` };
    }

    let ciHasEval = false;
    for (const f of wfFiles) {
      const t = await readText(f.full);
      if (t && /(?:eval|score\.mjs|validate\.mjs|skill-conductor)/i.test(t)) ciHasEval = true;
    }
    const pass = runnable && failureCases > 0 && ciHasEval;
    return { pass, note: `可执行 ${runnable ? '是' : '否'}；失败路径用例 ${failureCases} 个；CI 含评测步骤 ${ciHasEval ? '是' : '否'}` };
  },
  /** QM-MT-L4：体量受控 */
  'QM-MT-L4': async (dir, body) => {
    const lines = body.split(/\r?\n/).length;
    const nested = [...body.matchAll(/\]\((?:\.\/)?(?:references|scripts|assets)\/[^)\s]*\]\(/g)].length;
    const ok = lines <= 500 && nested === 0;
    return { pass: ok, note: `正文 ${lines} 行（上限 500）；嵌套引用 ${nested} 处` };
  },
  /** QM-MT-L5：owner 声明与废弃策略（仓库级治理，独立技能豁免） */
  'QM-MT-L5': async (dir, body, ctx, fm) => {
    const hasCodeowners = existsSync(path.join(ctx.root, 'CODEOWNERS')) || existsSync(path.join(ctx.root, '.github', 'CODEOWNERS'));
    const hasDeprecated = await listDirs(path.join(ctx.root, 'skills')).then((d) => d.includes('deprecated'));
    if (!ctx.isRepoMember) {
      const declaredInBody = /owner|维护者|maintainer/i.test(body);
      const declaredInMeta = typeof fm?.metadata?.owner === 'string' && fm.metadata.owner.length > 0;
      return {
        pass: declaredInBody || declaredInMeta,
        note: `非仓库成员：检查 owner 声明 —— metadata.owner ${declaredInMeta ? `="${fm.metadata.owner}"` : '无'}，正文提及 ${declaredInBody ? '有' : '无'}`,
      };
    }
    return { pass: hasCodeowners && hasDeprecated, note: `CODEOWNERS ${hasCodeowners ? '有' : '无'}；deprecated 约定 ${hasDeprecated ? '有' : '无'}` };
  },
};

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const rawRoot = args.find((a) => !a.startsWith('--') && !['--scan', '--target', '--json'].includes(args[args.indexOf(a) - 1]));
  const root = rawRoot ? path.resolve(rawRoot) : null;
  const scanIdx = args.indexOf('--scan');
  const scanDir = scanIdx >= 0 ? args[scanIdx + 1] : null;
  const targetIdx = args.indexOf('--target');
  const target = targetIdx >= 0 ? args[targetIdx + 1] : null;
  const jsonIdx = args.indexOf('--json');
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

  // 仅跑工具链自检，不评分。CI 的第一道门禁用它。
  if (args.includes('--self-check-only')) {
    const problems = [...selfCheckSpecConsistency(), ...selfCheckAnchors()];
    if (problems.length) {
      console.error('[SELF-002/003 FAIL] 质量模型自检未通过：');
      for (const p of problems) console.error('  - ' + p);
      process.exit(3);
    }
    console.error('[SELF-002 PASS] SPEC 与质量模型的级别一致');
    console.error('[SELF-003 PASS] 所有不可机器判定的条目均有专家锚点');
    process.exit(0);
  }

  if (!root || !existsSync(root)) { console.error('用法: node score.mjs <repo-root> [--scan skills] [--target L1..L5] [--json out.json] [--self-check-only]'); process.exit(2); }

  // SELF-002：SPEC 与 QM 的级别一致性
  const selfProblems = selfCheckSpecConsistency();
  if (selfProblems.length) {
    console.error('[SELF-002 FAIL] SPEC 与质量模型的级别失配：');
    for (const p of selfProblems) console.error('  - ' + p);
    process.exit(3);
  }
  console.error('[SELF-002 PASS] SPEC 与质量模型的级别一致');

  const targetLevel = target ? Number(String(target).replace(/^L/i, '')) : null;
  if (target && (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 5)) { console.error('--target 必须是 L1..L5'); process.exit(2); }

  // 1. 取得机器判定结果
  const scanArgs = scanDir ? ['--scan', scanDir] : [];
  const v = runJsonTool('validate.mjs', [root, ...scanArgs, '--level', '5']);
  if (!v.data) { console.error('[ERROR] validate.mjs 未产出结果，请先单独运行排查'); process.exit(2); }
  const a = runJsonTool('audit.mjs', [root]);
  const auditFailed = new Map();
  if (a.data) for (const f of a.data.findings) auditFailed.set(f.id, f.failed);
  else console.error('[WARN] audit.mjs 未产出结果，runner=audit 的条目将标记为「未验证」');

  // 2. 仓库能力探测
  //    runner='audit' 的条目是**仓库级**的（版本一致性、清单对齐）。若仓库根本没有分发清单，
  //    这些条目在语义上"不适用"，必须走豁免而不是**空通过**——否则单技能目录会因为
  //    「两个不存在的清单版本都是 undefined，所以相等」而假阳性通过。这是本评分器
  //    第三版修正的一个真实缺陷（空通过）。
  const hasRepoManifests = existsSync(path.join(root, '.claude-plugin', 'plugin.json')) || existsSync(path.join(root, 'package.json'));
  // 是否为「仓库成员」：有分发清单或 skills/ 目录结构。独立技能目录为 false，
  // 仓库级治理要求（CI 门禁、CODEOWNERS、deprecated 约定）对它按豁免处理。
  const isRepoMember = hasRepoManifests || existsSync(path.join(root, 'skills'));

  // 3. 枚举技能（支持单技能、扁平与分桶三种布局）
  const skillDirs = (await listSkills(root, scanDir)).map((s) => s.dir);
  if (skillDirs.length === 0) { console.error(`未发现技能目录于 ${scanDir ? path.join(root, scanDir) : root}`); process.exit(2); }

  // 3. 逐技能评分
  const scorecards = [];
  for (const dir of skillDirs) {
    const skillName = path.basename(dir);
    const relKey = path.relative(root, dir).split(path.sep).join('/');
    const detail = v.data.skillDetail?.[relKey] ?? {};
    const body = (await readText(path.join(dir, 'SKILL.md'))) ?? '';
    // frontmatter 供需要读取元数据的 repo 检查使用（如 QM-MT-L5 的 metadata.owner）
    const fmText = (await readText(path.join(dir, 'SKILL.md'))) ?? '';
    const fmParsed = (() => {
      const lines = fmText.split(/\r?\n/);
      if (lines[0]?.trim() !== '---') return {};
      const obj = {}; let cur = obj; let stack = [{ indent: -1, obj }];
      for (let i = 1; i < lines.length; i++) {
        const raw = lines[i];
        if (raw.trim() === '---') break;
        if (!raw.trim() || raw.trim().startsWith('#')) continue;
        const indent = raw.match(/^ */)[0].length;
        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
        cur = stack[stack.length - 1].obj;
        const m = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw.trim());
        if (!m) continue;
        if (m[2] === '') { const child = {}; cur[m[1]] = child; stack.push({ indent, obj: child }); }
        else cur[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      return obj;
    })();
    const ctx = { root, isRepoMember };

    const entryResults = new Map();
    for (const c of CHECKS) {
      let pass = null, note = '';
      if (c.runner === 'validate') {
        const vals = c.check.map((id) => detail[id]);
        const unknown = c.check.filter((id) => detail[id] === undefined);
        // 三态：validate 的 'na' 表示该条对技能不适用（命中豁免）。
        // 不适用**不阻塞**等级推进，但也不能当成「通过」——它会作为 'na' 传递到评审工具，
        // 与专家的「不适用」判定对齐（阶段 5 一致性验证暴露的缺陷修正）。
        const allNa = vals.length > 0 && vals.every((v) => v === 'na');
        pass = allNa ? 'na' : vals.every((x) => x === true || x === 'na');
        note = unknown.length
          ? `检查 ${unknown.join(', ')} 未在 validate 结果中（级别未覆盖）`
          : (allNa ? `依赖 ${c.check.join(', ')} 全部不适用（豁免）` : `依赖 ${c.check.join(', ')} ${pass ? '通过' : '未通过'}${vals.includes('na') ? '（含豁免项）' : ''}`);
      } else if (c.runner === 'audit') {
        if (!hasRepoManifests) {
          // 单技能包没有 docs/<bucket>/<name>.md，但根 README.md 就是它的人类文档页。
          // 有 README 时按真实证据通过；没有 README 时仍按「无人类文档」豁免，
          // 避免把未发布的测试 fixture 判成不合规。
          if (c.id === 'QM-DC-L3b' && existsSync(path.join(root, 'SKILL.md'))) {
            const hasReadme = existsSync(path.join(root, 'README.md'));
            pass = true;
            note = hasReadme ? '单技能包：根 README.md 作为人类文档' : '单技能包无 README.md，按无人类文档豁免';
          } else {
            pass = true; note = `豁免：仓库无分发清单（${c.exemption}），本条不适用`;
          }
        } else if (!a.data) { pass = null; note = 'audit.mjs 无结果，未验证'; }
        else {
          const vals = c.check.map((id) => auditFailed.get(id));
          pass = vals.every((x) => x === false);
          note = `依赖 ${c.check.join(', ')}：${c.check.map((id) => `${id}=${auditFailed.get(id) === undefined ? '未找到' : (auditFailed.get(id) ? '失败' : '通过')}`).join(' ')}`;
        }
      } else if (c.runner === 'repo') {
        const fn = REPO_CHECKS[c.id];
        if (!fn) { pass = null; note = '未实现该 repo 检查'; }
        else { const r = await fn(dir, body, ctx, fmParsed); pass = r.pass; note = r.note; }
      } else {
        pass = null; note = '仅专家判定';
      }
      entryResults.set(c.id, { pass, note, verify: c.verify });
    }

    // 4. 逐维度计算已达到等级（累积：达到 L 需要 L1..L 全部通过）
    const dimLevels = {};
    for (const d of DIMENSIONS) {
      let level = 0;
      for (const l of LEVELS) {
        const inLevel = CHECKS.filter((c) => c.dim === d.id && c.level === l.id);
        const machineOnly = inLevel.filter((c) => c.verify !== 'expert');
        // 'na'（豁免）不阻塞等级推进；只有明确 false 才阻塞。
        const allMachinePass = machineOnly.every((c) => {
          const p = entryResults.get(c.id)?.pass;
          return p === true || p === 'na';
        });
        if (allMachinePass) level = l.id; else break;
      }
      dimLevels[d.id] = level;
    }

    const overall = Math.min(...Object.values(dimLevels));
    // 瓶颈维度：等级等于整体等级的维度。其中 gate=true 的是关键瓶颈，优先提示。
    const bottlenecks = DIMENSIONS
      .filter((d) => dimLevels[d.id] === overall)
      .map((d) => ({ id: d.id, name: d.name, gate: d.gate, level: dimLevels[d.id] }));
    // 加权总分：仅用于排序，不参与等级判定（见 quality-model.mjs 中 DIMENSIONS 的注释）
    const wSum = DIMENSIONS.reduce((s, d) => s + d.weight, 0);
    const weighted = DIMENSIONS.reduce((s, d) => s + d.weight * dimLevels[d.id], 0) / wSum;
    scorecards.push({
      skill: skillName, relPath: relKey || skillName,
      dimensionLevels: dimLevels,
      overallMachineLevel: overall,
      weightedScore: Number(weighted.toFixed(2)),
      bottlenecks,
      entries: [...entryResults.entries()].map(([id, r]) => ({ id, ...r })),
    });
  }

  // 5. 输出
  console.log(`\n=== 质量模型评分 · v${MODEL_VERSION} · ${scorecards.length} 个技能 ===\n`);
  console.log('维度：' + DIMENSIONS.map((d) => `${d.id}=${d.name}(w${d.weight}${d.gate ? ',关键' : ''})`).join('  '));
  console.log('');
  const header = ['技能'.padEnd(38), ...DIMENSIONS.map((d) => d.id.padStart(3)), '  整体', '  加权'];
  console.log(header.join(' '));
  console.log('-'.repeat(header.join(' ').length));
  for (const s of scorecards) {
    const cells = DIMENSIONS.map((d) => {
      // 瓶颈维度加 * 标记，关键瓶颈加 **
      const isBottle = s.bottlenecks.some((b) => b.id === d.id);
      const isGate = s.bottlenecks.some((b) => b.id === d.id && b.gate);
      const mark = isGate ? '*' : (isBottle ? '·' : '');
      return (String(s.dimensionLevels[d.id]) + mark).padStart(3);
    });
    console.log([s.relPath.padEnd(38), ...cells, `  L${s.overallMachineLevel}`, s.weightedScore.toFixed(2).padStart(6)].join(' '));
  }
  console.log('  图例：* = 关键瓶颈维度（gate）  · = 瓶颈维度（等级等于整体等级）');

  const levels = scorecards.map((s) => s.overallMachineLevel);
  const dist = {};
  for (const l of levels) dist[l] = (dist[l] ?? 0) + 1;
  console.log('');
  console.log('整体等级分布（机器可判定部分）：');
  for (const l of [0, 1, 2, 3, 4, 5]) if (dist[l]) console.log(`  L${l}: ${dist[l]} 个技能`);
  console.log(`  最低 ${Math.min(...levels)} / 最高 ${Math.max(...levels)}`);

  // 瓶颈统计：让使用者知道该补哪个维度
  const bottleCount = {};
  for (const s of scorecards) for (const b of s.bottlenecks) bottleCount[b.id] = (bottleCount[b.id] ?? 0) + 1;
  if (Object.keys(bottleCount).length) {
    console.log('');
    console.log('瓶颈维度分布（卡住整体等级的维度）：');
    for (const d of DIMENSIONS) {
      if (!bottleCount[d.id]) continue;
      console.log(`  ${d.id} ${d.name}${d.gate ? '（关键）' : ''}：${bottleCount[d.id]} 个技能`);
    }
    const gateHits = DIMENSIONS.filter((d) => d.gate && bottleCount[d.id]).map((d) => `${d.id}(${bottleCount[d.id]})`);
    if (gateHits.length) console.log(`  ⚠️ 关键维度成为瓶颈：${gateHits.join('、')} —— 改进应优先补这些维度，而非提升其他维度`);
  }

  // 加权总分排序（辅助指标，不代表等级）
  const ranked = [...scorecards].sort((a, b) => b.weightedScore - a.weightedScore || b.overallMachineLevel - a.overallMachineLevel);
  console.log('');
  console.log('加权总分排序（辅助指标，仅用于横向比较，不参与等级判定）：');
  console.log('  前 3：' + ranked.slice(0, 3).map((s) => `${s.skill} ${s.weightedScore.toFixed(2)}`).join('  |  '));
  if (ranked.length > 3) {
    console.log('  后 3：' + ranked.slice(-3).map((s) => `${s.skill} ${s.weightedScore.toFixed(2)}`).join('  |  '));
  }

  // 改造后：不再输出「待专家确认」清单。
  // 无法机器判定的条目改由软轨（scripts/llm-judge.mjs）按锚点做 LLM 裁决，
  // 软轨结果不进入退出码（D-08）。

  if (jsonOut) {
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify({
      generatedAt: new Date().toISOString(), modelVersion: MODEL_VERSION, root, scanDir,
      dimensions: DIMENSIONS, levels: LEVELS,
      summary: { skillCount: scorecards.length, distribution: dist, min: Math.min(...levels), max: Math.max(...levels) },
      scorecards,
    }, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }

  if (targetLevel !== null) {
    const worst = Math.min(...levels);
    if (worst < targetLevel) {
      console.log(`\n[FAIL] 目标 L${targetLevel}，实际最低 L${worst}`);
      process.exit(1);
    }
    console.log(`\n[PASS] 达到目标 L${targetLevel}（最低 L${worst}）`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(2); });
