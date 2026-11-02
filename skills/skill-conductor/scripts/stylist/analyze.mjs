#!/usr/bin/env node
/**
 * analyze.mjs — 技能文风师 · 确定性粗筛（零依赖）
 *
 * 只产出「可机器统计的信号」，不做最终判定。最终判定由 wq-judge.mjs 逐条做 LLM 投票；
 * 粗筛结果作为 LLM 的参考数据，避免模型在否定密度、段长这类可数指标上凭感觉。
 *
 * 用法：
 *   node scripts/analyze.mjs <skill-dir> --json out.json
 *   node scripts/analyze.mjs <repo-root> --scan skills --skill <name> --json out.json
 *
 * 退出码：0 正常；2 参数错误
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listSkills, splitFrontmatter, extractSections } from '../lib/skill-parser.mjs';

const NEGATIVE = ['不要', '禁止', '避免', '严禁', '不得', '切勿', '不准', '勿', '别'];
const MODAL = ['尽量', '可能', '适当', '也许', '大概', '通常', '一般', '或许', '酌情'];
const MARKETING = ['强大', '极致', '完美', '革命性', '颠覆', '最强', '一流', '领先', '顶级', '无与伦比', '丝滑'];

const TERM_GROUPS = {
  skill: ['技能', 'skill', '能力'],
  agent: ['代理', 'agent', '智能体'],
  prompt: ['提示词', 'prompt', '指令'],
  workflow: ['工作流', 'workflow', '流程'],
};

function countTerm(lines, terms, startLine = 1) {
  const locations = [];
  let count = 0;
  lines.forEach((line, i) => {
    for (const term of terms) {
      let idx = line.indexOf(term);
      while (idx !== -1) {
        count += 1;
        locations.push({ line: startLine + i, term, context: line.trim().slice(0, 80) });
        idx = line.indexOf(term, idx + term.length);
      }
    }
  });
  return { count, locations };
}

function paragraphsOf(bodyLines) {
  const out = [];
  let cur = [];
  let inFence = false;
  let start = 0;
  bodyLines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const t = line.trim();
    const isBlock = t === '' || /^#{1,6}\s/.test(t) || /^[-*|>]\s/.test(t) || /^\d+[.)]\s/.test(t);
    if (isBlock) {
      if (cur.join('').trim()) out.push({ text: cur.join('\n'), start });
      cur = [];
      if (t !== '') { /* 标题/列表不算段落正文 */ }
      start = i + 1;
    } else {
      if (!cur.length) start = i + 1;
      cur.push(t);
    }
  });
  if (cur.join('').trim()) out.push({ text: cur.join('\n'), start });
  return out;
}

function repeatedPhrases(body) {
  const runs = body.match(/[\u4e00-\u9fa5]{4,}/g) ?? [];
  const counts = new Map();
  for (const run of runs) {
    for (let i = 0; i + 4 <= run.length; i += 1) {
      const p = run.slice(i, i + 4);
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
}

function longSentences(lines, startLine) {
  const out = [];
  lines.forEach((line, i) => {
    for (const s of line.split(/[。！？；;]/)) {
      const t = s.trim();
      if (t.length > 80) out.push({ line: startLine + i, length: t.length, sentence: t.slice(0, 120) });
    }
  });
  return out;
}

function nestedNegations(lines, startLine) {
  const out = [];
  lines.forEach((line, i) => {
    if (/(不要|禁止|避免|严禁|不得|切勿).{0,20}(不|别|无|没)/.test(line)) {
      out.push({ line: startLine + i, text: line.trim().slice(0, 100) });
    }
  });
  return out;
}

function missingSections(body) {
  const required = [
    { key: '何时使用', re: /何时使用|when to use/i },
    { key: '何时不使用', re: /何时不使用|when not to use/i },
    { key: '工作流程', re: /工作流程|workflow|usage|how to use/i },
    { key: 'Inputs', re: /^#{1,6}\s*Inputs\b/im },
    { key: 'Outputs', re: /^#{1,6}\s*Outputs\b/im },
    { key: 'Failure modes', re: /^#{1,6}\s*Failure modes\b/im },
    { key: 'Side effects', re: /^#{1,6}\s*Side effects\b/im },
    { key: 'Dependencies', re: /^#{1,6}\s*Dependencies\b/im },
    { key: 'Verification', re: /^#{1,6}\s*(?:Verification|Verify|验证|如何确认)\b/im },
  ];
  return required.filter((r) => !r.re.test(body)).map((r) => r.key);
}

export async function analyzeSkill(dir) {
  const file = path.join(dir, 'SKILL.md');
  const text = await readFile(file, 'utf8');
  const fm = splitFrontmatter(text);
  const body = fm.body;
  const bodyStart = fm.bodyStartLine;
  const bodyLines = body.split(/\r?\n/);
  const allLines = text.split(/\r?\n/);

  const paragraphs = paragraphsOf(bodyLines);
  const paraLens = paragraphs.map((p) => p.text.replace(/\s/g, '').length);
  const totalChars = body.replace(/\s/g, '').length;

  const negative = countTerm(allLines, NEGATIVE);
  const modal = countTerm(allLines, MODAL);
  const marketing = countTerm(allLines, MARKETING);

  const variants = {};
  for (const [key, terms] of Object.entries(TERM_GROUPS)) {
    const used = terms.filter((t) => body.toLowerCase().includes(t.toLowerCase()));
    if (used.length >= 2) variants[key] = used;
  }

  const headings = extractSections(body, bodyStart);
  const missing = missingSections(body);
  const listLines = bodyLines.filter((l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l)).length;
  const listRatio = bodyLines.length ? listLines / bodyLines.length : 0;
  const repeated = repeatedPhrases(body);

  const stats = {
    total_chars: totalChars,
    total_lines: allLines.length,
    paragraphs: paragraphs.length,
    avg_paragraph_chars: paraLens.length ? Math.round(paraLens.reduce((a, b) => a + b, 0) / paraLens.length) : 0,
    max_paragraph_chars: paraLens.length ? Math.max(...paraLens) : 0,
  };

  const negativeDensity = totalChars ? negative.count / totalChars : 0;
  const modalDensity = totalChars ? modal.count / totalChars : 0;
  const positiveMarkers = (body.match(/(必须|使用|先|执行|检查|写出|读取|调用|添加|运行)/g) ?? []).length;

  const deterministic = {
    'WQ-INS-01': negativeDensity > 0.02
      ? { result: 'fail', evidence: `否定词密度 ${negativeDensity.toFixed(4)} > 0.02（${negative.count} 处）` }
      : { result: 'pass', evidence: `否定词密度 ${negativeDensity.toFixed(4)}` },
    'WQ-INS-03': (modalDensity > 0.01 || modal.count >= 5)
      ? { result: 'fail', evidence: `模糊量词 ${modal.count} 处，密度 ${modalDensity.toFixed(4)}` }
      : { result: 'pass', evidence: `模糊量词 ${modal.count} 处` },
    'WQ-COG-01': stats.max_paragraph_chars > 200
      ? { result: 'fail', evidence: `最长段落 ${stats.max_paragraph_chars} 字 > 200` }
      : { result: 'pass', evidence: `最长段落 ${stats.max_paragraph_chars} 字` },
    'WQ-COG-02': stats.avg_paragraph_chars > 150
      ? { result: 'fail', evidence: `平均段落 ${stats.avg_paragraph_chars} 字 > 150` }
      : { result: 'pass', evidence: `平均段落 ${stats.avg_paragraph_chars} 字` },
    'WQ-COG-03': (listRatio < 0.03 && paragraphs.length >= 10)
      ? { result: 'fail', evidence: `列表/表格行占比 ${(listRatio * 100).toFixed(1)}%，段落 ${paragraphs.length} 个` }
      : { result: 'pass', evidence: `结构化行占比 ${(listRatio * 100).toFixed(1)}%` },
    'WQ-TRM-01': Object.keys(variants).length
      ? { result: 'fail', evidence: `同概念多写法：${Object.entries(variants).map(([k, v]) => `${k}=${v.join('/')}`).join('；')}` }
      : { result: 'pass', evidence: '未检测到同概念多种写法' },
    'WQ-TRM-02': Object.keys(variants).length
      ? { result: 'fail', evidence: `同义词混用：${Object.entries(variants).map(([k, v]) => `${k}=${v.join('/')}`).join('；')}` }
      : { result: 'pass', evidence: '未检测到同义词混用' },
    'WQ-ANTI-01': (negative.count > 6 && negative.count > positiveMarkers * 1.5)
      ? { result: 'fail', evidence: `否定 ${negative.count} 处 vs 正向动作词 ${positiveMarkers} 处` }
      : { result: 'pass', evidence: `否定 ${negative.count} 处，正向动作词 ${positiveMarkers} 处` },
    'WQ-ANTI-03': marketing.count > 0
      ? { result: 'fail', evidence: `营销词：${[...new Set(marketing.locations.map((l) => l.term))].join('、')}` }
      : { result: 'pass', evidence: '未检测到营销词' },
    'WQ-ANTI-04': (repeated[0]?.[1] ?? 0) >= 6
      ? { result: 'fail', evidence: `重复短语「${repeated[0][0]}」出现 ${repeated[0][1]} 次` }
      : { result: 'pass', evidence: '未检测到高频重复短语' },
    // WQ-STR-02 是唯一一条不由 assessor 覆盖的结构检查（assessor 不要求「何时不使用」小节）
    'WQ-STR-02': missing.includes('何时不使用')
      ? { result: 'fail', evidence: '缺少「何时不使用」小节' }
      : { result: 'pass', evidence: '含「何时不使用」小节' },
  };

  return {
    file: path.relative(dir, file).split(path.sep).join('/'),
    skill: path.basename(dir),
    dir,
    stats,
    negative_terms: { count: negative.count, density: Number(negativeDensity.toFixed(4)), locations: negative.locations.slice(0, 30) },
    modal_terms: { count: modal.count, terms: [...new Set(modal.locations.map((l) => l.term))], locations: modal.locations.slice(0, 30) },
    marketing_terms: { count: marketing.count, terms: [...new Set(marketing.locations.map((l) => l.term))], locations: marketing.locations.slice(0, 30) },
    repeated_phrases: repeated,
    term_variants: variants,
    long_sentences: longSentences(bodyLines, bodyStart).slice(0, 20),
    nested_negations: nestedNegations(bodyLines, bodyStart).slice(0, 20),
    headings,
    missing_sections: missing,
    deterministic,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const jsonOut = value('--json');
  const scanDir = value('--scan') || 'skills';
  const skillName = value('--skill');
  const rawRoot = args.find((a) => !a.startsWith('--') && !['--json', '--scan', '--skill'].includes(args[args.indexOf(a) - 1]));
  const root = rawRoot ? path.resolve(rawRoot) : null;

  if (!root || !existsSync(root)) {
    console.error('用法: node analyze.mjs <skill-dir|repo-root> [--scan skills] [--skill name] [--json out]');
    process.exit(2);
  }

  let dir = root;
  if (!existsSync(path.join(root, 'SKILL.md'))) {
    const skills = await listSkills(root, scanDir);
    if (skillName) dir = skills.find((s) => s.name === skillName)?.dir;
    else if (skills.length === 1) dir = skills[0].dir;
    if (!dir) { console.error(`未找到唯一技能，请用 --skill 指定：${root}`); process.exit(2); }
  }

  const data = await analyzeSkill(dir);
  if (jsonOut) {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(jsonOut), { recursive: true });
    await writeFile(jsonOut, JSON.stringify(data, null, 2), 'utf8');
    console.error(`已写出: ${jsonOut}`);
  }
  console.log(`\n=== 文风粗筛 · ${data.skill} ===`);
  console.log(`字符 ${data.stats.total_chars} · 行 ${data.stats.total_lines} · 段落 ${data.stats.paragraphs} · 平均 ${data.stats.avg_paragraph_chars} 字 · 最长 ${data.stats.max_paragraph_chars} 字`);
  console.log(`否定词 ${data.negative_terms.count}（密度 ${data.negative_terms.density}）· 模糊词 ${data.modal_terms.count} · 营销词 ${data.marketing_terms.count}`);
  for (const [id, r] of Object.entries(data.deterministic)) console.log(`[${r.result.toUpperCase().padEnd(4)}] ${id} — ${r.evidence}`);
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith('analyze.mjs');
if (isMain) main().catch((e) => { console.error(e); process.exit(2); });
