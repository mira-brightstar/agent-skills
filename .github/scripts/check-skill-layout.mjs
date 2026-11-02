#!/usr/bin/env node
/**
 * 通用技能结构检查。
 * 遍历 skills/ 下的每个技能目录，校验目录名、SKILL.md 首行、frontmatter 的 name 与 description。
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SKILLS_DIR = path.join(ROOT, 'skills');
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return null;

  const data = {};
  const block = lines.slice(1, end);
  for (let i = 0; i < block.length; i += 1) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(block[i]);
    if (!match) continue;
    const [, key, value] = match;
    if (['>', '>-', '|', '|-'].includes(value.trim())) {
      const collected = [];
      while (i + 1 < block.length && (/^\s+/.test(block[i + 1]) || block[i + 1].trim() === '')) {
        collected.push(block[i + 1].replace(/^\s+/, ''));
        i += 1;
      }
      data[key] = collected.join(' ').trim();
    } else {
      data[key] = value.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return data;
}

async function checkSkill(name) {
  const problems = [];
  const dir = path.join(SKILLS_DIR, name);
  const skillPath = path.join(dir, 'SKILL.md');

  if (!NAME_RE.test(name)) problems.push('目录名不符合小写连字符规则');

  let text = null;
  try {
    text = await readFile(skillPath, 'utf8');
  } catch {
    problems.push('缺少 SKILL.md');
  }

  if (text) {
    if (!text.startsWith('---')) problems.push('SKILL.md 首行不是 ---');
    const frontmatter = parseFrontmatter(text);
    if (!frontmatter) {
      problems.push('frontmatter 无法解析');
    } else {
      if (!frontmatter.name) {
        problems.push('frontmatter 缺少 name');
      } else if (frontmatter.name !== name) {
        problems.push(`name "${frontmatter.name}" 与目录名不一致`);
      }
      if (!frontmatter.description) {
        problems.push('frontmatter 缺少 description');
      } else if (frontmatter.description.length > 1024) {
        problems.push('description 超过 1024 字符');
      }
    }
  }

  return problems;
}

let entries;
try {
  entries = await readdir(SKILLS_DIR, { withFileTypes: true });
} catch {
  console.error('FAIL: 找不到 skills/ 目录');
  process.exit(1);
}

const names = entries
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .sort();

if (names.length === 0) {
  console.error('FAIL: skills/ 下没有技能目录');
  process.exit(1);
}

let failed = 0;
for (const name of names) {
  const problems = await checkSkill(name);
  if (problems.length === 0) {
    console.log(`PASS skills/${name}`);
  } else {
    failed += 1;
    console.error(`FAIL skills/${name}`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }
}

if (failed > 0) {
  console.error(`合计 ${names.length} 个技能，失败 ${failed} 个`);
  process.exit(1);
}

console.log(`合计 ${names.length} 个技能，全部通过`);
