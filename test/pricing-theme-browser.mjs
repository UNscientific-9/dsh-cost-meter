// #282: the merged single-field model picker, plus #258's themed controls.
// Chromium drives the real component; this fixture is not a full DSH app.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { sanitizeConfig, zeroDay } from '../lib/store.js'
import { javascriptLiteral as literal } from '../scripts/javascript-literal.mjs'

const uiModules = resolve(process.env.DSH_TEST_UI_MODULES ?? process.env.DSH_TEST_NODE_MODULES ?? '.tmp-context-host/node_modules')
const req = createRequire(join(uiModules, '__pricing_theme.cjs'))
const browserReq = createRequire(join(resolve(process.env.DSH_TEST_BROWSER_MODULES ?? uiModules), '__pricing_theme.cjs'))
const { chromium } = browserReq('playwright-core')
const executablePath = process.env.CM_TEST_BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync)
assert.ok(executablePath, 'a local Chromium browser is required')
const baseline = process.argv.includes('--baseline') ? process.argv[process.argv.indexOf('--baseline') + 1] : null
const readSource = file => baseline
  ? execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })
  : readFileSync(file, 'utf8')
const client = readdirSync('src/client').filter(name => name.endsWith('.js')).sort()
  .map(name => readSource('src/client/' + name)).join('')
  .replace('exports.apply = apply', 'exports.preview = { CostSection, parseConfig }; exports.apply = apply')
const day = { ...zeroDay('2026-10-12'), byProviderModel: {
  'fixture:unknown': { input: 1, output: 1, calls: 1, cost: 0 },
  'deepseek:deepseek-v4-flash': { input: 1, output: 1, calls: 1, cost: .001 },
} }
const initialState = { config: sanitizeConfig({ locale: 'zh' }), today: day, month: day, total: day, history: [], balance: {} }
const code = `
import React from ${literal(req.resolve('react'))};
import {createRoot} from ${literal(req.resolve('react-dom/client'))};
import {createPortal} from ${literal(req.resolve('react-dom'))};
window.__ModuleLoader__={load:mod=>{const value=mod.factory(name=>name==='react'?React:name==='react-dom'?{createPortal}:{Tooltip:({children})=>children});if(mod.chunk==='client.pricing.js')window.priceUI=value;else window.costUI=value}};
${client}
${readSource('src/pricing/index.js')}
const {CostSection,parseConfig}=window.costUI.preview;
const state=${literal(initialState)};state.config=parseConfig(state.config,'config');
window.patches=[];window.reprices=[];
const pricing=window.priceUI.mount({effect:fn=>fn(),get:key=>key==='remote'?{$mount:async()=>()=>{}}:{getRepricingHistory:async()=>({ok:true,value:window.reprices.length?[{at:1792050000000,before:1,after:2,days:1,sessions:1,skipped:0}]:[]}),repriceHistory:async confirmed=>{window.reprices.push(confirmed);return {ok:true,value:{ok:true,message:'已重算，原金额已保留。'}}}}});
const api={reload:async()=>{},loadPricing:()=>pricing,loadOpenRouter:async()=>()=>null,updateConfig:async patch=>{window.patches.push(patch)}};
createRoot(document.getElementById('root')).render(React.createElement(CostSection,{useCost:()=>({state,status:'ready'}),api}));
window.fixtureReady=true;
`
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'js' }, bundle: true, write: false, format: 'iife', platform: 'browser' })
// Token values copied from the published skin source, with provenance pinned.
// https://github.com/RevolutionLA/dsh-dream-skin/blob/86761e4106874f3c0646c74f95a1a2d252c4b9ce/lib/client.js
// bg-layer-2 / elevation-panel 取自宿主 ui-theme:浅色下浮层与页面同为白底,靠 elevation 分层。
const ELEVATION = '0 0 0 .5px rgba(0,0,0,.16), 0 3px 8px 0 rgba(0,0,0,.04), 0 0 16px 0 rgba(0,0,0,.05)'
const light = { '--dsw-alias-label-primary': '#25262b', '--dsw-alias-label-secondary': '#737780', '--dsw-alias-label-tertiary': '#858a94', '--dsw-alias-bg-base': '#fff', '--dsw-alias-bg-layer-1': '#f7f8fa', '--dsw-alias-bg-layer-2': '#fff', '--dsw-elevation-panel': ELEVATION, '--dsw-alias-border-l1': '#e5e7eb', '--dsw-alias-button-elevated-fill': '#fff', '--dsw-alias-state-business-primary': '#4d6bfe' }
const midnight = { '--dsw-alias-label-primary': '#eff0f1', '--dsw-alias-label-secondary': '#c0c1c2', '--dsw-alias-label-tertiary': '#a3a4a5', '--dsw-alias-bg-base': '#0b0b0c', '--dsw-alias-bg-layer-1': '#141415', '--dsw-alias-bg-layer-2': '#212123', '--dsw-elevation-panel': ELEVATION, '--dsw-alias-border-l1': 'rgba(255,255,255,.062)', '--dsw-alias-button-elevated-fill': '#141415', '--dsw-alias-state-business-primary': '#889ef6' }
const dark = { ...midnight, '--dsw-alias-label-primary': '#ececee', '--dsw-alias-bg-base': '#202022', '--dsw-alias-bg-layer-1': '#29292c', '--dsw-alias-bg-layer-2': '#2c2c2e' }
// 设置页滚动容器会裁剪就地定位的面板;宿主页面在这里用 overflow 复现该裁剪条件。
const html = '<!doctype html><html style="color-scheme:light"><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:13px/1.5 system-ui}#root{max-width:900px;margin:auto;max-height:520px;overflow:auto}</style></head><body><div id="root"></div><select id="host-control"><option>Host control</option><option>Other plugin</option></select><script src="/app.js"></script></body></html>'
const server = createServer((request, response) => {
  if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(compiled.outputFiles[0].contents) }
  else if (request.url === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html) }
  else { response.statusCode = 404; response.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
const errors = [], external = [], checks = []
page.on('pageerror', error => errors.push(String(error)))
await page.route('**/*', route => {
  if (new URL(route.request().url()).origin !== new URL(url).origin) { external.push(route.request().url()); return route.abort() }
  return route.continue()
})
const luminance = color => {
  const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
    const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
  })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return (values[1] + .05) / (values[0] + .05)
}
// 悬停底色是半透明的;先按 alpha 合成到面板底色,再算对比度,否则会把 14% 的灰当成实色。
const rgba = color => { const parts = color.match(/[\d.]+/g).map(Number); return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 } }
const blend = (front, back) => {
  const f = rgba(front), b = rgba(back)
  const mix = (x, y) => Math.round(x * f.a + y * (1 - f.a))
  return `rgb(${mix(f.r, b.r)}, ${mix(f.g, b.g)}, ${mix(f.b, b.b)})`
}
const output = resolve('.tmp-pricing-theme-browser'); mkdirSync(output, { recursive: true })
try {
  await page.goto(url); await page.waitForFunction(() => window.fixtureReady)
  await page.getByRole('tab', { name: '价格', exact: true }).click()
  const fields = page.locator('.cm-match-row [role=combobox]')
  await fields.first().waitFor()
  assert.equal(await fields.count(), 2, 'unknown and matched model rows each render one merged field')
  assert.equal(await page.locator('.cm-match-row select').count(), 0, 'the separate search box and native dropdown are gone')
  for (const [theme, tokens, scheme] of [['midnight-light-host', midnight, 'light'], ['host-dark', dark, 'dark'], ['host-light', light, 'light']]) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.evaluate(({ tokens, scheme }) => {
      document.documentElement.style.colorScheme = scheme
      for (const [key, value] of Object.entries(tokens)) document.documentElement.style.setProperty(key, value)
    }, { tokens, scheme })
    await page.mouse.move(0, 0)
    await fields.first().click()
    await page.locator('.cm-combo-panel').waitFor()
    const panel = await page.locator('.cm-combo-panel').evaluate(node => ({
      parent: node.parentElement.tagName,
      background: getComputedStyle(node).backgroundColor,
      shadow: getComputedStyle(node).boxShadow,
      rect: node.getBoundingClientRect().toJSON(),
      options: [...node.querySelectorAll('.cm-combo-option')].map(option => ({
        color: getComputedStyle(option).color, background: getComputedStyle(option).backgroundColor,
        height: option.getBoundingClientRect().height,
      })),
    }))
    // 面板必须脱离滚动容器(否则被 overflow 裁掉),且完整落在视口内。
    assert.equal(panel.parent, 'BODY', `${theme}: the open list is portaled out of the scrolling settings container`)
    assert.ok(panel.rect.top >= 0 && panel.rect.bottom <= 950 && panel.rect.left >= 0 && panel.rect.right <= 1100,
      `${theme}: the open list stays inside the viewport`)
    assert.ok(panel.options.length > 1, `${theme}: the open list shows candidates`)
    // 限高面板里的行不能被压扁:压扁后文字被裁成一条,颜色断言仍会通过,所以这里必须查几何。
    const heights = panel.options.map(option => option.height)
    assert.ok(Math.min(...heights) >= 20, `${theme}: every candidate row keeps a readable height (min ${Math.min(...heights)})`)
    for (const option of panel.options) {
      assert.ok(contrast(option.color, blend(option.background, panel.background)) >= 4.5, `${theme}: option text stays readable, hovered or not`)
    }
    // 浅色主题下浮层与页面同为白底,必须靠宿主的 elevation 分层,否则看起来是「平贴」的。
    assert.notEqual(panel.shadow, 'none', `${theme}: the open list keeps the host elevation shadow`)
    if (theme === 'midnight-light-host') await page.screenshot({ path: join(output, 'open-light-host.png'), fullPage: true })
    if (theme === 'host-dark') await page.screenshot({ path: join(output, 'open-dark.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await page.locator('.cm-combo-panel').waitFor({ state: 'detached' })
    await page.screenshot({ path: join(output, theme + '.png'), fullPage: true })
    checks.push({ theme, panelOptions: panel.options.length, portaled: panel.parent === 'BODY' })
  }
  const field = fields.first()
  const options = page.locator('.cm-combo-panel .cm-combo-option')
  const note = page.locator('.cm-combo-note')
  // 打字实时筛选;未选中的空值字段不写入任何映射。
  await field.click()
  await field.fill('opencode gpt')
  await options.first().waitFor()
  const filtered = await options.allTextContents()
  assert.ok(filtered.length > 1 && filtered.every(label => /opencode/i.test(label) && /gpt/i.test(label)), 'typing filters the list by every keyword')
  assert.equal(await page.evaluate(() => window.patches.length), 0, 'searching never saves a mapping')
  // 只打了筛选词、还没点选时,清空按钮必须可用(原生 × 已被隐藏)。
  await page.locator('.cm-match-row .cm-combo-clear').first().click()
  assert.equal(await field.inputValue(), '', 'the clear button also clears a typed query')
  await page.locator('.cm-combo-panel').waitFor()
  assert.ok(await options.count() > 100, 'clearing the query keeps the list open and restores every candidate')
  assert.equal(await page.evaluate(() => window.patches.length), 0, 'clearing a typed query never saves a mapping')
  await field.fill('no-model-matches-this-query')
  await note.filter({ hasText: '没有匹配的模型' }).waitFor()
  assert.equal(await page.locator('.cm-combo-panel .cm-combo-option').count(), 0, 'an unmatched query lists no candidates')
  assert.equal(await note.count(), 1, 'the no-match feedback is stated exactly once')
  assert.equal(await page.evaluate(() => window.patches.length), 0, 'an empty result set never saves a mapping')
  await field.press('Escape')
  await page.locator('.cm-combo-panel').waitFor({ state: 'detached' })
  assert.equal(await field.inputValue(), '', 'Escape closes the list and clears the typed query')
  // Escape 必须真的关掉面板:type=search 的原生输入框会自己清空并派发 input 事件,
  // 不 preventDefault 就会被随后的 onChange 重新打开(实测连按三次仍是打开态)。
  await field.click()
  await field.fill('本地')
  await options.first().waitFor()
  await field.press('Escape')
  await page.locator('.cm-combo-panel').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.cm-combo-panel').count(), 0, 'Escape leaves the list closed, not reopened')
  // 键盘操作:↓ 打开并移动,Enter 选中。
  await field.click()
  await field.fill('本地')
  await options.first().waitFor()
  await field.press('ArrowDown')
  await field.press('Enter')
  await page.waitForFunction(() => window.patches.length === 1)
  assert.deepEqual(await page.evaluate(() => window.patches[0]), { priceOverrides: { 'fixture:unknown': '__local__' } }, 'choosing from the merged field saves only the chosen model override')
  assert.equal(await field.inputValue(), '本地模型（零消耗）', 'the field shows the chosen label after the list closes')
  await page.locator('.cm-combo-panel').waitFor({ state: 'detached' })
  // 输入法选词时按 Enter 不能当成选中模型(中文/日文输入法都会踩)。
  // 直接构造 isComposing:true 的 keydown(合成事件可带该标志,实测构造时传入即生效),
  // 并挑一个与当前值不同的候选,否则同值守卫会让断言假通过。
  await field.click()
  await field.fill('gpt-6-astra')
  await options.first().waitFor()
  const current = '本地模型（零消耗）'
  const candidates = await options.allTextContents()
  const otherIndex = candidates.findIndex(label => label !== current)
  assert.ok(otherIndex > 0, 'the query offers a candidate other than the current choice')
  await page.locator('.cm-combo-option').nth(otherIndex).hover()
  const imeTarget = candidates[otherIndex]
  await field.locator('xpath=.').evaluate(node => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
  })
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.patches.length), 1, `Enter during IME composition never picks a model (would have picked ${imeTarget})`)
  assert.equal(await field.inputValue(), 'gpt-6-astra', 'the typed query stays while the IME is composing')
  await field.press('Escape')
  await page.locator('.cm-combo-panel').waitFor({ state: 'detached' })
  // 选中后直接打字:输入框里显示的是已选标签,新字符不能被拼成「标签+字」的查询词。
  await field.click()
  await page.locator('.cm-combo-panel').waitFor()
  await field.press('Escape')
  await page.locator('.cm-combo-panel').waitFor({ state: 'detached' })
  await field.click()
  await field.type('claude')
  const typed = await field.inputValue()
  assert.equal(typed, 'claude', 'typing right after a choice drops the selected label instead of appending to it')
  assert.ok(await options.count() > 1, 'the typed query still matches candidates')
  await field.press('Escape')
  await page.locator('.cm-combo-panel').waitFor({ state: 'detached' })
  // 选中后重新打开:显示全部候选,已选项标记为当前,且高亮行滚入可视区。
  await field.click()
  await page.locator('.cm-combo-panel').waitFor()
  assert.ok(await options.count() > 100, 'reopening lists every candidate, not only the previous query')
  assert.equal(await page.locator('.cm-combo-option[aria-selected=true]').innerText(), '本地模型（零消耗）', 'the current choice is marked in the list')
  // 已选项排在很后面时,打开后必须滚动到它,否则用户看不到自己选的是哪一行。
  await page.locator('.cm-match-row [role=combobox]').nth(1).click()
  await page.locator('.cm-combo-panel').waitFor()
  await page.waitForTimeout(120)
  const scrolled = await page.locator('.cm-combo-list').evaluate(list => {
    const active = list.querySelector('[data-active="true"]')
    return { scrollTop: list.scrollTop, visible: active ? active.getBoundingClientRect().top >= list.getBoundingClientRect().top && active.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom : null }
  })
  assert.ok(scrolled.visible === true, `the highlighted row is scrolled into view (scrollTop ${scrolled.scrollTop})`)
  await page.keyboard.press('Escape')
  await page.locator('.cm-combo-panel').waitFor({ state: 'detached' })
  // 已选中后打一个不匹配的筛选词:已选项仍留在列表里(旧版原生下拉同样始终显示当前值)。
  await field.click()
  await field.fill('claude')
  assert.equal(await page.locator('.cm-combo-option[aria-selected=true]').first().innerText(), '本地模型（零消耗）', 'the current choice survives a non-matching query and stays marked')
  // 重新点当前已选项不产生第二次写入(旧原生 select 同值不触发 change)。
  const before = await page.evaluate(() => window.patches.length)
  await page.locator('.cm-combo-option[aria-selected=true]').first().click()
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.patches.length), before, 're-picking the current value does not save again')
  assert.equal(await field.inputValue(), '本地模型（零消耗）', 'the field keeps the chosen label')
  // 清空按钮把该行还原为「未手动指定」。
  await page.locator('.cm-match-row .cm-combo-clear').first().click()
  await page.waitForFunction(count => window.patches.length === count + 1, before)
  assert.deepEqual(await page.evaluate(count => window.patches[count], before), { priceOverrides: {} }, 'clearing removes the manual override')
  assert.equal(await field.inputValue(), '', 'the field is empty again after clearing')
  assert.equal(await page.locator('#host-control option').first().evaluate(option => getComputedStyle(option).backgroundColor), 'rgba(0, 0, 0, 0)', 'the change leaves host and other plugins untouched')
  const reprice = page.getByRole('button', { name: '按当前价格重算历史', exact: true })
  await reprice.click()
  await page.getByRole('alert').filter({ hasText: '这会改变历史费用' }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.reprices), [], 'warning does not execute recalculation')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.reprices), [], 'cancel leaves history untouched')
  await reprice.click()
  await page.getByRole('button', { name: '确认重算', exact: true }).click()
  await page.waitForFunction(() => window.reprices.length === 1)
  assert.deepEqual(await page.evaluate(() => window.reprices), [true])
  await page.getByText('重算记录 · 原金额已保留', { exact: true }).click()
  await page.getByRole('columnheader', { name: '原金额', exact: true }).waitFor()
  assert.deepEqual(external, [], 'theme test sends no external requests')
  assert.deepEqual(errors, [], 'settings render without browser errors')
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, baseline, errors, external }, null, 2) + '\n')
  console.log(JSON.stringify({ checks, selectionSaved: true, browserErrors: errors.length, externalRequests: external.length }))
} catch (error) {
  console.error(await page.locator('.cm-repricing').evaluateAll(nodes => nodes.map(node => node.outerHTML)))
  console.error(JSON.stringify({ browserErrors: errors, panel: await page.locator('.cm-combo-panel').evaluateAll(nodes => nodes.map(node => node.outerHTML.slice(0, 400))), sample: await page.locator('.cm-match-row [role=combobox]').evaluateAll(nodes => nodes.map(node => ({ html: node.outerHTML.slice(0, 200), value: node.value }))) }))
  throw error
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve))
}
