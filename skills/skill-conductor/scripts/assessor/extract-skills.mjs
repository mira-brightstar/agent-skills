#!/usr/bin/env node
/**
 * extract-skills.mjs — Phase 1 生态解剖的机械抽取器
 *
 * 用途：对任意 skill 集合仓库做无偏抽取，产出 inventory.json。
 * 不依赖第三方库，仅用 node 内置模块，便于在 CI 中零安装运行。
 *
 * 用法：
 *   node extract-skills.mjs <repo-root> [--out <file>]
 *
 * 退出码：
 *   0 = 抽取成功
 *   2 = 参数/路径错误
 */

import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SKILL_FILE = 'SKILL.md';
const BUCKET_DIR = 'skills';

function parseArgs(argv) {
  const args = argv.slice(2);
  const root = args.find((a) => !a.startsWith('--'));
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : null;
  return { root, out };
}

/** 极简 frontmatter 解析：只处理顶层标量 key: value，够用且不引依赖 */
function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { raw: null, keys: [], scalars: {}, endLine: 0 };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { end = i; break; }
  }
  if (end === -1) return { raw: null, keys: [], scalars: {}, endLine: 0 };
  const block = lines.slice(1, end);
  const scalars = {};
  const keys = [];
  for (const line of block) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (m) {
      keys.push(m[1]);
      scalars[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    } else {
      const nested = /^\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
      if (nested) keys.push(`(nested).${nested[1]}`);
    }
  }
  return { raw: block.join('\n'), keys, scalars, endLine: end + 1 };
}

async function walk(dir, base = dir, acc = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      await walk(full, base, acc);
    } else {
      const st = await stat(full);
      acc.push({ rel: path.relative(base, full).split(path.sep).join('/'), bytes: st.size });
    }
  }
  return acc;
}

/** 抽取技能内部对其它技能的调用（跨技能依赖的证据） */
function extractRefs(body) {
  const skillToolCalls = [...body.matchAll(/[Cc]all the Skill tool(?:[^."]*?)?with\s+[`"']([a-z0-9-]+)[`"']/g)].map((m) => m[1]);
  const skillToolCallsMulti = [...body.matchAll(/Skill tool twice,?\s+for\s+[`"']([a-z0-9-]+)[`"']\s+and\s+[`"']([a-z0-9-]+)[`"']/g)].map((m) => [m[1], m[2]]);
  const slashMentions = [...new Set([...body.matchAll(/`\/([a-z0-9-]{2,})`/g)].map((m) => m[1]))];
  const fileLinks = [...new Set([...body.matchAll(/\]\((\.{0,2}\/[^)\s#]+)/g)].map((m) => m[1]))];
  const plainFileRefs = [...new Set([...body.matchAll(/`([A-Za-z0-9._/-]+\.(?:md|sh|yaml|yml|json|cjs|mjs|ts))`/g)].map((m) => m[1]))];
  return { skillToolCalls, skillToolCallsMulti, slashMentions, fileLinks, plainFileRefs };
}

async function collectSkill(root, bucket, name) {
  const dir = path.join(root, BUCKET_DIR, bucket, name);
  const files = await walk(dir);
  const skillMdPath = path.join(dir, SKILL_FILE);
  let skill = null;
  if (existsSync(skillMdPath)) {
    const text = await readFile(skillMdPath, 'utf8');
    const fm = parseFrontmatter(text);
    const body = text.split(/\r?\n/).slice(fm.endLine).join('\n');
    skill = {
      lines: text.split(/\r?\n/).length,
      bytes: Buffer.byteLength(text, 'utf8'),
      bodyLines: body.split(/\r?\n/).length,
      frontmatterRaw: fm.raw,
      frontmatterKeys: fm.keys,
      frontmatter: fm.scalars,
      refs: extractRefs(body),
      headings: [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((m) => `${m[1]} ${m[2]}`),
    };
  }
  let openaiYaml = null;
  const oaPath = path.join(dir, 'agents', 'openai.yaml');
  if (existsSync(oaPath)) openaiYaml = await readFile(oaPath, 'utf8');
  const sideFiles = files.filter((f) => f.rel !== SKILL_FILE).map((f) => f.rel);
  return {
    bucket,
    name,
    relPath: `${BUCKET_DIR}/${bucket}/${name}`,
    dirName: name,
    fileCount: files.length,
    files,
    sideFiles,
    hasSkillMd: Boolean(skill),
    skill,
    hasOpenaiYaml: Boolean(openaiYaml),
    openaiYaml,
    hasReadme: files.some((f) => f.rel === 'README.md'),
    hasScripts: files.some((f) => f.rel.startsWith('scripts/')),
    hasLicense: files.some((f) => /^LICENSE/i.test(f.rel)),
    hasTests: files.some((f) => /(^|\/)(test|tests|__tests__|spec)\b/i.test(f.rel) || /\.(test|spec)\./i.test(f.rel)),
    hasExamples: files.some((f) => /(^|\/)(examples?|samples?)\//i.test(f.rel)),
  };
}

async function main() {
  const { root, out } = parseArgs(process.argv);
  if (!root) { console.error('用法: node extract-skills.mjs <repo-root> [--out <file>]'); process.exit(2); }
  if (!existsSync(root)) { console.error(`路径不存在: ${root}`); process.exit(2); }

  const bucketsRoot = path.join(root, BUCKET_DIR);
  if (!existsSync(bucketsRoot)) { console.error(`未找到 ${BUCKET_DIR}/ 目录于 ${root}`); process.exit(2); }

  const buckets = (await readdir(bucketsRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const skills = [];
  for (const bucket of buckets) {
    const names = (await readdir(path.join(bucketsRoot, bucket), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const name of names) skills.push(await collectSkill(root, bucket, name));
  }

  // 仓库级清单
  const readJson = async (p) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : null);
  const plugin = await readJson(path.join(root, '.claude-plugin', 'plugin.json'));
  const marketplace = await readJson(path.join(root, '.claude-plugin', 'marketplace.json'));
  const pkg = await readJson(path.join(root, 'package.json'));
  const readmePath = path.join(root, 'README.md');
  const readme = existsSync(readmePath) ? await readFile(readmePath, 'utf8') : null;
  const rootFiles = (await readdir(root, { withFileTypes: true })).map((e) => e.name).sort();

  const report = {
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    rootFiles,
    buckets,
    skillCount: skills.length,
    manifests: {
      plugin,
      marketplace,
      packageJson: pkg ? { name: pkg.name, version: pkg.version, license: pkg.license, scripts: pkg.scripts, devDependencies: pkg.devDependencies } : null,
    },
    readmeLength: readme ? readme.length : 0,
    readmeMentions: readme ? [...new Set([...readme.matchAll(/\]\(\.?\/?(skills\/[^)\s]+)/g)].map((m) => m[1]))] : [],
    skills,
  };

  const json = JSON.stringify(report, null, 2);
  if (out) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, json, 'utf8');
    console.error(`已写出: ${out}`);
  } else {
    process.stdout.write(json);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(2); });
