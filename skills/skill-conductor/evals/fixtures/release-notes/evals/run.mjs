#!/usr/bin/env node
/**
 * run.mjs — 示例技能的评测运行器
 *
 * 诚实声明本运行器**能**做什么、**不能**做什么：
 *   能：校验用例结构完整性（每条必须含 id / kind / title / given / when / expect），
 *       统计失败路径用例数量与声明的覆盖率，
 *       并按用例生成人工/模型执行清单。
 *   不能：自动判定「期望行为是否真的发生」——技能是提示词程序，其输出质量需要
 *       模型执行后由人或另一个模型核对。这是本技能评测的现实边界，不假装能自动化。
 *
 * 退出码：0 = 结构合法且至少 1 个失败路径用例；1 = 不满足
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(HERE, 'cases.yaml');

/**
 * 逐行解析用例块。
 *
 * 这里刻意不用正则做多行匹配：`$` 在 `m` 标志下会匹配**每一行**的行尾，
 * 使非贪婪的 `[\s\S]*?` 吞掉零个字符就宣告成功，导致所有多行字段被误判为空。
 * （本运行器第一版就踩了这个坑。教训与反模式 A-08 同源：判定逻辑要显式、可读，
 *  不要用精巧的正则去猜结构。）
 */
function parseCases(text) {
  const lines = text.split(/\r?\n/);
  const cases = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    const indent = raw.match(/^ */)[0].length;

    if (/^- id:/.test(t)) {
      if (cur) cases.push(cur);
      cur = { id: t.replace(/^- id:/, '').trim().replace(/^["']|["']$/g, ''), scalars: {}, blocks: {} };
      continue;
    }
    if (!cur || indent !== 4) continue;

    const m = /^([a-z_]+):\s*(.*)$/.exec(t);
    if (!m) continue;
    const key = m[1], val = m[2];

    if (val === '|' || val === '') {
      const buf = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l2 = lines[j];
        if (l2.trim() === '') { buf.push(''); continue; }
        const ind2 = l2.match(/^ */)[0].length;
        if (ind2 <= indent) break;
        buf.push(l2.trim());
      }
      cur.blocks[key] = buf.join('\n').trim();
      i = j - 1;
    } else {
      cur.scalars[key] = val.replace(/^["']|["']$/g, '').trim();
    }
  }
  if (cur) cases.push(cur);

  const coverage = /failure_modes_covered:\s*(\d+)/.exec(text)?.[1];
  const total = /failure_modes_total:\s*(\d+)/.exec(text)?.[1];
  const baseline = /^\s*result:\s*(.+)$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, '');

  return {
    cases: cases.map((c) => ({
      id: c.id, kind: c.scalars.kind, title: c.scalars.title,
      missing: [
        !c.id && 'id',
        !c.scalars.kind && 'kind',
        !c.scalars.title && 'title',
        !(c.blocks.given ?? '').length && 'given(非空)',
        !(c.blocks.when ?? '').length && 'when(非空)',
        !(c.blocks.expect ?? '').length && 'expect(非空)',
      ].filter(Boolean),
    })),
    coverage: { covered: Number(coverage ?? 0), total: Number(total ?? 0) },
    baseline,
  };
}

async function main() {
  if (!existsSync(CASES)) { console.error(`未找到 ${CASES}`); process.exit(1); }
  const { cases, coverage, baseline } = parseCases(await readFile(CASES, 'utf8'));

  console.log(`\n=== release-notes 评测 · ${cases.length} 个用例 ===\n`);

  let bad = 0;
  for (const c of cases) {
    if (c.missing.length) {
      bad++;
      console.log(`[FAIL] ${c.id || '(无 id)'} [${c.kind || '?'}] ${c.title || ''}`);
      console.log(`       结构缺失：${c.missing.join(', ')}`);
    } else {
      console.log(`[ OK ] ${c.id} [${c.kind}] ${c.title}`);
    }
  }

  const failureCases = cases.filter((c) => c.kind === 'failure').length;
  const normalCases = cases.filter((c) => c.kind === 'normal').length;
  console.log('');
  console.log(`正常用例 ${normalCases} 个 / 失败用例 ${failureCases} 个`);

  if (failureCases === 0) {
    console.log('[FAIL] 无失败路径用例（QM-TS-L4 要求至少 1 个）');
    bad++;
  }
  if (coverage.total > 0) {
    const rate = coverage.covered / coverage.total;
    console.log(`失败模式覆盖率：${coverage.covered}/${coverage.total} = ${(rate * 100).toFixed(0)}%`);
    if (rate < 1) console.log('[WARN] 覆盖率未达 100%，按 QM-TS-L5 的覆盖率要求仍需补充用例');
  }

  console.log('');
  console.log('以下用例的期望行为需要**人工或模型执行后核对**（本运行器无法自动判定）：');
  for (const c of cases) console.log(`  - ${c.id}：${c.title}`);
  console.log(`\n基线记录：${baseline ?? '(未记录)'}`);
  console.log(`\n结论：结构校验 ${bad === 0 ? '通过' : `失败 ${bad} 项`}`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
