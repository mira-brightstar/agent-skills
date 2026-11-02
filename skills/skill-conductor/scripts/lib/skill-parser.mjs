/**
 * skill-parser.mjs — SKILL.md 解析与技能枚举（零依赖）
 *
 * 供 assessor / stylist / mentor 共用。每个 skill 内保留一份副本，保证独立可部署。
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

function yamlScalar(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith("'") && v.endsWith("'") && v.length > 1)) {
    return v.slice(1, -1);
  }
  if (/^(true|false|yes|no|on|off)$/i.test(v)) return /^(true|yes|on)$/i.test(v);
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** 最小 YAML 子集：映射、嵌套映射、标量数组。够用于 frontmatter 与 openai.yaml。 */
export function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root, key: null, parent: null }];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
    const line = raw.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const frame = stack[stack.length - 1];

    if (line.startsWith('- ')) {
      if (!Array.isArray(frame.obj)) {
        if (frame.parent && frame.key !== null) {
          const arr = [];
          frame.parent[frame.key] = arr;
          frame.obj = arr;
        } else {
          continue;
        }
      }
      frame.obj.push(yamlScalar(line.slice(2)));
      continue;
    }

    const m = /^([^:]+):[ \t]*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const rest = m[2];
    if (rest === '') {
      const child = {};
      frame.obj[key] = child;
      stack.push({ indent, obj: child, key, parent: frame.obj });
    } else {
      frame.obj[key] = yamlScalar(rest);
    }
  }
  return root;
}

/** 切出 frontmatter 原文与正文，并记录行号映射 */
export function splitFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  const firstLineIsDelimiter = lines[0]?.trim() === '---';
  if (!firstLineIsDelimiter) {
    return { ok: false, reason: 'first-line-not-delimiter', fmRaw: null, body: text, bodyStartLine: 1, endLine: 0 };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) {
    return { ok: false, reason: 'unclosed-frontmatter', fmRaw: null, body: text, bodyStartLine: 1, endLine: 0 };
  }
  return {
    ok: true,
    fmRaw: lines.slice(1, end).join('\n'),
    body: lines.slice(end + 1).join('\n'),
    bodyStartLine: end + 2,
    endLine: end + 1,
  };
}

/** 列出正文标题，附带行号（1-based，指向 SKILL.md 原始行） */
export function extractSections(body, bodyStartLine = 1) {
  const out = [];
  body.split(/\r?\n/).forEach((line, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: bodyStartLine + i });
  });
  return out;
}

/** 读取并解析单个 SKILL.md */
export async function parseSkillMd(filePath) {
  const text = await readFile(filePath, 'utf8');
  const fm = splitFrontmatter(text);
  const frontmatter = fm.ok ? parseYaml(fm.fmRaw) : {};
  return {
    path: filePath,
    text,
    frontmatter,
    body: fm.body,
    sections: extractSections(fm.body, fm.bodyStartLine),
    lineMap: { frontmatterStart: 1, frontmatterEnd: fm.endLine, bodyStart: fm.bodyStartLine },
    frontmatterOk: fm.ok,
    frontmatterReason: fm.reason ?? null,
  };
}

async function listDirs(p) {
  if (!existsSync(p)) return [];
  return (await readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/**
 * 枚举技能目录。支持三种形态：
 *   1. 单技能：<root>/SKILL.md
 *   2. 扁平：  <root>/<scanDir>/<skill>/SKILL.md          （本治理套件采用）
 *   3. 分桶：  <root>/<scanDir>/<bucket>/<skill>/SKILL.md （样本仓库采用）
 */
export async function listSkills(repoRoot, scanDir = 'skills') {
  const base = scanDir ? path.join(repoRoot, scanDir) : repoRoot;
  const found = new Set();

  if (existsSync(path.join(base, 'SKILL.md'))) found.add(base);

  for (const name of await listDirs(base)) {
    const p1 = path.join(base, name);
    if (existsSync(path.join(p1, 'SKILL.md'))) found.add(p1);
    for (const child of await listDirs(p1)) {
      const p2 = path.join(p1, child);
      if (existsSync(path.join(p2, 'SKILL.md'))) found.add(p2);
    }
  }

  return [...found].sort().map((dir) => ({
    name: path.basename(dir),
    dir,
    relPath: path.relative(repoRoot, dir).split(path.sep).join('/'),
    skillMdPath: path.join(dir, 'SKILL.md'),
  }));
}
