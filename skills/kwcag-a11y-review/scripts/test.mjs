#!/usr/bin/env node
// kwcag-scan.mjs 회귀 테스트: fixtures/violations.html을 정적 모드로 스캔하고, 심어 둔 위반이 기대한 KWCAG 항목으로 묶이는지 확인한다.
// 실행: jsdom, axe-core가 설치된 곳(이 저장소 루트에서 npm install 후)에서 `npm test`

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kwcag-')), 'result.json');

execFileSync(process.execPath, [path.join(here, 'kwcag-scan.mjs'), '--file', path.join(here, 'fixtures/violations.html'), '--json', out, '--out', os.devNull], { stdio: 'inherit' });
const [{ byItem }] = JSON.parse(fs.readFileSync(out, 'utf8'));

const violation = (item, rule) => byItem[item]?.violations.find((r) => r.rule === rule);

const expected = [
  ['1.1.1', 'image-alt', false],
  ['2.4.2', 'document-title', false],
  ['3.1.1', 'html-has-lang', false],
  ['3.3.2', 'label', false],
  ['4.2.1', 'button-name', false],
  ['미분류', 'meta-viewport', true],
];

for (const [item, rule, ref] of expected) {
  const r = violation(item, rule);
  assert.ok(r, `${rule}이(가) ${item}로 묶여야 함`);
  assert.equal(r.ref, ref, `${rule}의 참고 규칙 여부`);
}

const dup = violation('4.1.1', 'kwcag-duplicate-id');
assert.ok(dup, 'id 중복이 4.1.1로 보고돼야 함');
assert.equal(dup.nodes.length, 2, 'id 중복은 요소 2개로 한 번만 집계돼야 함');
assert.match(dup.nodes[0].summary, /2번 사용됨/, 'id 중복 상세 문구가 있어야 함');

console.log(`ok — 기대 결과 ${expected.length + 1}건 모두 확인`);
