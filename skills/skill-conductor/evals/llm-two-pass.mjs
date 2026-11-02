#!/usr/bin/env node
/**
 * evals/llm-two-pass.mjs — 两段式 LLM 的自测（verdict + critique）
 *
 * 验证：
 *   1. direct 模式能产出 high / medium / low 三档；
 *   2. deferred 模式 prepare → 回填 → prepare-critique → 回填 → collect 同样产出三档；
 *   3. low 置信度权重为 0（不参与综合评分）。
 *
 * 退出码：0 通过 / 1 失败
 */

import http from 'node:http';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  judgeTwoPass, prepareVerdict, prepareCritique, collectTwoPass,
  CONFIDENCE_WEIGHT,
} from '../scripts/lib/llm-client.mjs';

const CASES = {
  high: {
    verdict: { result: 'pass', score: 2, reason: '证据充分', evidence: 'SKILL.md 有验证小节' },
    critique: { agreement: true, weaknesses: [], reason: '复核同意，无薄弱点', evidence: '同上' },
    expected: 'high',
  },
  medium: {
    verdict: { result: 'pass', score: 2, reason: '证据基本充分', evidence: 'SKILL.md 第 20 行' },
    critique: { agreement: true, weaknesses: ['只覆盖了正常路径，缺少失败用例'], reason: '同意但存在薄弱点', evidence: 'evals 下无用例' },
    expected: 'medium',
  },
  low: {
    verdict: { result: 'pass', score: 2, reason: '初判通过', evidence: '未找到验证说明' },
    critique: { agreement: false, result: 'fail', score: 0, weaknesses: ['把缺少验证说明误判为通过'], reason: '不同意初判', evidence: 'SKILL.md 无 Verification 小节' },
    expected: 'low',
  },
};

function payloadFor(content) {
  const marker = /CASE=(high|medium|low)/.exec(content)?.[1] ?? 'high';
  const isCritique = /复核|批判性/.test(content);
  const data = isCritique ? CASES[marker].critique : CASES[marker].verdict;
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] });
}

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let content = '';
        try { content = JSON.parse(body)?.messages?.[0]?.content ?? ''; } catch { content = ''; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(payloadFor(content));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function verdictPrompt(marker) {
  return `这是 verdict 判决。CASE=${marker}\n请返回 JSON。`;
}

function critiquePrompt(marker) {
  return `这是批判性复核 prompt。CASE=${marker}\n【第一轮判定】\n{verdict_json}\n请审查并返回 JSON。`;
}

async function main() {
  const results = [];
  const { server, port } = await startMock();
  process.env.LLM_API_URL = `http://127.0.0.1:${port}/v1/chat/completions`;
  process.env.LLM_MODE = 'direct';

  try {
    for (const marker of Object.keys(CASES)) {
      const r = await judgeTwoPass(verdictPrompt(marker), critiquePrompt(marker), { id: `direct-${marker}` });
      results.push({
        name: `direct/${marker}`,
        ok: r.confidence === CASES[marker].expected,
        detail: `期望 ${CASES[marker].expected} 实际 ${r.confidence}，result=${r.result} score=${r.score}`,
      });
    }

    const workDir = path.join(os.tmpdir(), `two-pass-${Date.now()}`);
    await mkdir(path.join(workDir, 'results'), { recursive: true });
    for (const marker of Object.keys(CASES)) {
      const id = `deferred-${marker}`;
      await prepareVerdict(id, verdictPrompt(marker), { workDir, workDirName: 'assessor' });
      await writeFile(path.join(workDir, 'results', `${id}-verdict.json`), JSON.stringify(CASES[marker].verdict), 'utf8');
      await prepareCritique(id, critiquePrompt(marker), CASES[marker].verdict, { workDir, workDirName: 'assessor' });
      const critiqueFile = path.join(workDir, 'prompts', `${id}-critique.md`);
      const critiqueText = await readFile(critiqueFile, 'utf8');
      results.push({
        name: `deferred/${marker}/prompt`,
        ok: critiqueText.includes('"result"') && !critiqueText.includes('{verdict_json}'),
        detail: '复核 prompt 已填入第一轮 verdict',
      });
      await writeFile(path.join(workDir, 'results', `${id}-critique.json`), JSON.stringify(CASES[marker].critique), 'utf8');
      const r = await collectTwoPass(id, { workDir, workDirName: 'assessor' });
      results.push({
        name: `deferred/${marker}`,
        ok: r.confidence === CASES[marker].expected,
        detail: `期望 ${CASES[marker].expected} 实际 ${r.confidence}，result=${r.result} score=${r.score}`,
      });
    }
    await rm(workDir, { recursive: true, force: true });

    results.push({
      name: 'low 权重',
      ok: CONFIDENCE_WEIGHT.low === 0 && CONFIDENCE_WEIGHT.medium === 0.7 && CONFIDENCE_WEIGHT.high === 1,
      detail: `high=${CONFIDENCE_WEIGHT.high} medium=${CONFIDENCE_WEIGHT.medium} low=${CONFIDENCE_WEIGHT.low}`,
    });
  } finally {
    server.close();
  }

  console.log('\n=== LLM 两段式自测 ===\n');
  for (const r of results) console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name} — ${r.detail}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n合计 ${results.length} 项：失败 ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
