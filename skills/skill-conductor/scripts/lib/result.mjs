/**
 * result.mjs — 三态结果构造与聚合（零依赖）
 *
 * 第一原则：所有判定必须是 pass / fail / na，禁止从人类可读文本反推成败。
 */

export function pass(id, message, evidence = []) {
  return { id, result: 'pass', message, evidence: Array.isArray(evidence) ? evidence : [evidence] };
}

export function fail(id, message, evidence = []) {
  return { id, result: 'fail', message, evidence: Array.isArray(evidence) ? evidence : [evidence] };
}

export function na(id, reason) {
  return { id, result: 'na', message: reason, evidence: [] };
}

/**
 * 聚合结果。退出码只看 fail，na 不阻塞。
 * @param {Array<{result:string}>} results
 * @param {{id?:string}} [options]
 */
export function aggregate(results, options = {}) {
  const counts = { pass: 0, fail: 0, na: 0 };
  for (const r of results) {
    if (counts[r.result] === undefined) throw new Error(`未知判定结果: ${r.result}（只允许 pass/fail/na）`);
    counts[r.result] += 1;
  }
  const failed = results.filter((r) => r.result === 'fail');
  return {
    exitCode: failed.length > 0 ? 1 : 0,
    id: options.id ?? null,
    summary: { total: results.length, ...counts, failedIds: failed.map((r) => r.id) },
  };
}
