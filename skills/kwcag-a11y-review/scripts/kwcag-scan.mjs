#!/usr/bin/env node
// KWCAG 2.2 기준 자동 스캔: axe-core 결과를 KWCAG 검사항목별로 묶어 Markdown 보고서로 출력한다.
//
// 사용법 (검수 대상 프로젝트 루트에서 실행)
//   렌더링된 페이지:  node <skill>/scripts/kwcag-scan.mjs --url http://localhost:3000 --url http://localhost:3000/login
//   정적 HTML 파일:   node <skill>/scripts/kwcag-scan.mjs --file dist/index.html
//   옵션: --out report.md  --json report.json  --experimental  --wait <ms>
//
// 필요 패키지 (프로젝트에 설치된 것을 사용)
//   --url  : playwright, @axe-core/playwright  (+ npx playwright install chromium)
//   --file : jsdom, axe-core
//
// 주의: 자동 스캔은 33개 항목 중 일부만 판정할 수 있다. 위반이 0건이어도 "준수"가 아니다.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(fs.readFileSync(path.join(here, 'kwcag-map.json'), 'utf8'));
const projectRequire = createRequire(path.join(process.cwd(), 'noop.js'));

function parseArgs(argv) {
  const args = { urls: [], files: [], out: null, json: null, experimental: false, wait: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.urls.push(argv[++i]);
    else if (a === '--file') args.files.push(argv[++i]);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--experimental') args.experimental = true;
    else if (a === '--wait') args.wait = Number(argv[++i]) || 0;
    else if (a === '-h' || a === '--help') { args.help = true; }
    else { console.error(`알 수 없는 인자: ${a}`); process.exit(2); }
  }
  return args;
}

// 설치 안내는 프로젝트 lockfile에 맞춘 패키지 매니저로 출력한다.
function pm() {
  const has = (f) => fs.existsSync(path.join(process.cwd(), f));
  if (has('pnpm-lock.yaml')) return { add: 'pnpm add -D', exec: 'pnpm exec' };
  if (has('yarn.lock')) return { add: 'yarn add -D', exec: 'yarn' };
  if (has('bun.lockb') || has('bun.lock')) return { add: 'bun add -d', exec: 'bunx' };
  return { add: 'npm i -D', exec: 'npx' };
}

async function importFromProject(name, installHint) {
  try {
    const resolved = projectRequire.resolve(name);
    return await import(pathToFileURL(resolved).href);
  } catch {
    console.error(`[kwcag-scan] '${name}' 패키지를 프로젝트에서 찾지 못했습니다. 설치: ${installHint}`);
    process.exit(3);
  }
}

// pnpm은 하위 의존성을 끌어올리지 않으므로, axe-core는 그것을 쓰는 패키지 기준으로 찾는다.
function loadKoLocale(req = projectRequire) {
  try {
    const p = req.resolve('axe-core/locales/ko.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

// axe 4.7+에서 duplicate-id 규칙은 기본 비활성이라, KWCAG 4.1.1 검사를 위해 id 중복을 직접 센다.
const DUP_ID_FN = `(() => {
  const seen = new Map();
  for (const el of document.querySelectorAll('[id]')) {
    const id = el.getAttribute('id');
    if (!id) continue;
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(el.outerHTML.slice(0, 200));
  }
  return [...seen].filter(([, els]) => els.length > 1).map(([id, els]) => ({ id, els }));
})()`;

// axe의 duplicate-id* 규칙이 이미 돌았으면(구버전 axe) 직접 센 결과는 넣지 않는다 — 같은 요소가 두 번 집계되는 것을 막는다.
function addDupIds(r, dups) {
  const axeRan = [...r.violations, ...r.passes, ...r.incomplete].some((x) => x.id.startsWith('duplicate-id'));
  if (axeRan || !dups.length) return;
  r.violations.push(dupIdViolation(dups));
}

function dupIdViolation(dups) {
  return {
    id: 'kwcag-duplicate-id',
    impact: 'minor',
    help: '같은 id가 문서에 두 번 이상 사용되었습니다',
    helpUrl: '',
    nodes: dups.flatMap(({ id, els }) => els.map((html) => ({ target: ['#' + id], html, failureSummary: `Fix:\n id "${id}"가 ${els.length}번 사용됨` }))),
  };
}

function experimentalRules(enabled) {
  if (!enabled) return {};
  return { 'label-content-name-mismatch': { enabled: true }, 'focus-order-semantics': { enabled: true } };
}

async function scanUrls(urls, opts) {
  const { add, exec } = pm();
  // playwright·jsdom은 CommonJS라 import() 시 이름 있는 export가 안 잡힐 수 있어 default로도 꺼낸다.
  const pw = await importFromProject('playwright',`${add} playwright @axe-core/playwright && ${exec} playwright install chromium`);
  const { chromium } = pw.chromium ? pw : pw.default;
  const axeMod = await importFromProject('@axe-core/playwright', `${add} @axe-core/playwright`);
  const AxeBuilder = axeMod.default?.default ?? axeMod.default ?? axeMod.AxeBuilder;
  // AxeBuilder에는 configure()가 없으므로, 로케일 설정을 axe 소스 뒤에 붙여 주입한다.
  let axeSource;
  try {
    const axeRequire = createRequire(projectRequire.resolve('@axe-core/playwright'));
    const locale = loadKoLocale(axeRequire);
    if (locale) axeSource = `${axeRequire('axe-core').source};axe.configure({ locale: ${JSON.stringify(locale)} });`;
  } catch {
    // 로케일을 못 찾으면 기본(영어) 메시지로 진행한다.
  }
  const browser = await chromium.launch();
  const results = [];
  try {
    // URL 하나가 실패해도 나머지는 계속 검사하고, 실패한 URL은 보고서에 따로 적는다.
    for (const url of urls) {
      // AxeBuilder는 browser.newPage()로 만든 페이지를 거부하므로 컨텍스트를 따로 만든다.
      // 로컬 개발 서버의 자체 서명 HTTPS 인증서도 검사할 수 있게 인증서 오류는 무시한다.
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle' });
        if (opts.wait) await page.waitForTimeout(opts.wait);
        const r = await new AxeBuilder({ page, axeSource })
          .options({ rules: experimentalRules(opts.experimental) })
          .analyze();
        addDupIds(r, await page.evaluate(DUP_ID_FN));
        results.push({ target: url, mode: 'url', raw: r });
      } catch (e) {
        console.error(`[kwcag-scan] ${url} 검사 실패: ${e.message.split('\n')[0]}`);
        results.push({ target: url, mode: 'url', error: e.message.split('\n')[0] });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

async function scanFiles(files, opts) {
  const { add } = pm();
  const jsdom = await importFromProject('jsdom', `${add} jsdom axe-core`);
  const { JSDOM, VirtualConsole } = jsdom.JSDOM ? jsdom : jsdom.default;
  const axeMod = await importFromProject('axe-core', `${add} axe-core`);
  const axe = axeMod.default ?? axeMod;
  const locale = loadKoLocale();
  const results = [];
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const virtualConsole = new VirtualConsole(); // jsdom 미구현 경고(canvas 등)는 출력하지 않는다
    const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole, url: pathToFileURL(path.resolve(file)).href });
    dom.window.eval(axe.source);
    if (locale) dom.window.axe.configure({ locale });
    const r = JSON.parse(JSON.stringify(await dom.window.axe.run(dom.window.document, { rules: experimentalRules(opts.experimental) })));
    addDupIds(r, dom.window.eval(DUP_ID_FN));
    results.push({ target: file, mode: 'file', raw: r });
    dom.window.close();
  }
  return results;
}

function itemFor(ruleId) {
  const m = MAP.rules[ruleId];
  if (m) return { item: m.item, ref: !!m.ref };
  if (ruleId.startsWith('aria-')) return { item: '4.2.1', ref: false };
  return { item: '미분류', ref: true };
}

function trim(s, n = 160) {
  if (!s) return '';
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n) + '…' : one;
}

const ENGINE_ERROR = /Axe encountered an error/i;

function engineErrors(raw) {
  return raw.incomplete
    .filter((r) => r.nodes.length && r.nodes.every((n) => ENGINE_ERROR.test(n.failureSummary || '')))
    .map((r) => r.id);
}

function group(raw) {
  const byItem = {};
  const skip = new Set(engineErrors(raw));
  const add = (kind, rule) => {
    const { item, ref } = itemFor(rule.id);
    byItem[item] ??= { violations: [], incomplete: [] };
    byItem[item][kind].push({
      rule: rule.id,
      ref,
      impact: rule.impact,
      help: rule.help,
      helpUrl: rule.helpUrl,
      nodes: rule.nodes.map((n) => ({
        target: Array.isArray(n.target) ? n.target.flat().join(' ') : String(n.target),
        html: trim(n.html),
        summary: trim((n.failureSummary || '').split('\n').filter(Boolean).slice(1).join(' / '), 200),
      })),
    });
  };
  raw.violations.forEach((r) => add('violations', r));
  raw.incomplete.filter((r) => !skip.has(r.id)).forEach((r) => add('incomplete', r));
  return byItem;
}

function sortItems(keys) {
  const num = (k) => (k === '미분류' ? [9, 9, 9] : k.split('.').map(Number));
  return keys.sort((a, b) => {
    const x = num(a), y = num(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}

function itemName(k) {
  if (k === '미분류') return 'KWCAG 직접 대응 없음 (WCAG 전용 규칙, 참고)';
  return MAP.items[k] ?? '';
}

function render(results, opts) {
  const lines = [];
  const autoCovered = new Set(Object.values(MAP.rules).filter((r) => !r.ref).map((r) => r.item));
  autoCovered.add('4.2.1');
  const uncovered = Object.keys(MAP.items).filter((k) => !autoCovered.has(k));

  lines.push('# KWCAG 2.2 자동 스캔 결과');
  lines.push('');
  lines.push(`- 실행 시각: ${new Date().toISOString()}`);
  lines.push(`- 엔진: axe-core ${results.find((r) => r.raw)?.raw.testEngine?.version ?? '?'}${opts.experimental ? ' (실험 규칙 포함)' : ''}`);
  lines.push('- 이 결과는 자동 판정 가능한 일부 항목만 다룹니다. 위반 0건은 "준수"를 뜻하지 않습니다.');
  lines.push('');

  const failed = results.filter((r) => r.error);
  if (failed.length) {
    lines.push('## 검사하지 못한 대상');
    lines.push('');
    for (const f of failed) lines.push(`- ${f.target} — ${f.error}`);
    lines.push('');
  }

  for (const res of results.filter((r) => r.raw)) {
    const byItem = group(res.raw);
    const keys = sortItems(Object.keys(byItem));
    const direct = (list) => list.filter((r) => !r.ref).reduce((t, r) => t + r.nodes.length, 0);
    const vCount = keys.reduce((s, k) => s + direct(byItem[k].violations), 0);
    const iCount = keys.reduce((s, k) => s + direct(byItem[k].incomplete), 0);

    lines.push(`## 대상: ${res.target}`);
    lines.push('');
    lines.push(`모드: ${res.mode === 'url' ? '렌더링된 페이지 (Playwright)' : '정적 HTML (jsdom — 레이아웃·색 대비 계산 불가)'} · 위반 요소 ${vCount}개 · 검토 필요 요소 ${iCount}개`);
    lines.push('');
    const errs = engineErrors(res.raw);
    if (errs.length) {
      lines.push(`이 환경에서 계산하지 못한 규칙: ${errs.map((id) => `${id}(${itemFor(id).item})`).join(', ')} — 렌더링 모드(--url)나 수동으로 확인하세요.`);
      lines.push('');
    }
    if (keys.length === 0) {
      lines.push('자동 규칙에서 위반이나 검토 필요 항목이 발견되지 않았습니다.');
      lines.push('');
      continue;
    }
    lines.push('| 항목 | 이름 | 위반 요소 | 검토 필요 요소 | 관련 규칙(참고) |');
    lines.push('|---|---|---|---|---|');
    for (const k of keys) {
      const cnt = (list, ref) => list.filter((r) => r.ref === ref).reduce((t, r) => t + r.nodes.length, 0);
      const v = cnt(byItem[k].violations, false);
      const i = cnt(byItem[k].incomplete, false);
      const ref = cnt(byItem[k].violations, true) + cnt(byItem[k].incomplete, true);
      lines.push(`| ${k} | ${itemName(k)} | ${v} | ${i} | ${ref} |`);
    }
    lines.push('');

    for (const k of keys) {
      const g = byItem[k];
      lines.push(`### ${k} ${itemName(k)}`);
      lines.push('');
      for (const [label, list] of [['위반', g.violations], ['검토 필요', g.incomplete]]) {
        for (const r of list) {
          lines.push(`- **[${label}] ${r.rule}**${r.ref ? ' (관련 규칙, 직접 대응 아님)' : ''} — ${r.help} (${r.impact ?? 'n/a'})`);
          const limit = r.ref ? 3 : 10;
          for (const n of r.nodes.slice(0, limit)) {
            lines.push(`  - \`${n.target}\` — \`${n.html.replace(/`/g, "'")}\``);
            if (n.summary) lines.push(`    - ${n.summary}`);
          }
          if (r.nodes.length > limit) lines.push(`  - …외 ${r.nodes.length - limit}개`);
        }
      }
      lines.push('');
    }
  }

  lines.push('## 자동 스캔으로 판정하지 않는 항목');
  lines.push('');
  lines.push('아래 항목은 코드 검토(AI)나 수동 확인으로 판정해야 합니다.');
  lines.push('');
  for (const k of uncovered) lines.push(`- ${k} ${itemName(k)}`);
  lines.push('');
  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));
if (args.help || (args.urls.length === 0 && args.files.length === 0)) {
  console.log('사용법: node kwcag-scan.mjs (--url <url> | --file <html>)... [--out report.md] [--json report.json] [--experimental] [--wait ms]');
  process.exit(args.help ? 0 : 1);
}

const results = [
  ...(args.urls.length ? await scanUrls(args.urls, args) : []),
  ...(args.files.length ? await scanFiles(args.files, args) : []),
];

const md = render(results, args);
if (args.out) fs.writeFileSync(args.out, md);
else process.stdout.write(md + '\n');
if (args.json) {
  const slim = results.map((r) => (r.error ? { target: r.target, mode: r.mode, error: r.error } : { target: r.target, mode: r.mode, byItem: group(r.raw) }));
  fs.writeFileSync(args.json, JSON.stringify(slim, null, 2));
}
if (results.some((r) => r.error)) process.exitCode = 4;
