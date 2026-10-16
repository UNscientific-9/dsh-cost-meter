/** Settings-only model search and explicit historical recalculation. */
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter', chunk: 'client.pricing.js',
  factory: require => {
    const { createElement: el, Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef, useId } = require('react')
    // 候选面板 portal 到 body:设置面板是宿主 overlay 里 role=dialog 的 div(不是 <dialog>
    // 元素),它带 overflow 与自己的层叠上下文;挂到 body 才既不被裁、也不被压在下层。
    // 宿主未提供 react-dom 时退回就地渲染(测试桩与老宿主)。
    let createPortal = null
    try { createPortal = require('react-dom')?.createPortal ?? null } catch {}
    const runFields = ['at', 'before', 'after', 'days', 'sessions', 'skipped']
    const historySchema = { parse: value => {
      if (!Array.isArray(value) || !value.every(row => runFields.every(key => Number.isFinite(row?.[key]) && row[key] >= 0))) throw new Error('Invalid recalculation history')
      return value
    } }
    const resultSchema = { parse: value => {
      if (typeof value?.ok !== 'boolean' || typeof value?.message !== 'string') throw new Error('Invalid recalculation result')
      return value
    } }
    const boolSchema = { parse: value => { if (typeof value !== 'boolean') throw new Error('Expected confirmation'); return value } }
    const catalogSchema = { parse: value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid price catalog')
      return value
    } }
    const codec = (name, schema) => ({ mode: 'strict', typeSymbol: 'dsh-cost-meter#' + name, schema, create: () => schema })
    const CONTRIBUTION = { package: 'dsh-cost-meter-pricing', face: 'host', descriptors: [
      { id: 'dsh-cost-meter#costMeter/getPriceCatalog', service: 'costMeter', namespace: 'costMeter', method: 'getPriceCatalog', invocation: { kind: 'direct' }, parameters: [], result: codec('PriceCatalog', catalogSchema) },
      { id: 'dsh-cost-meter#costMeter/getRepricingHistory', service: 'costMeter', namespace: 'costMeter', method: 'getRepricingHistory', invocation: { kind: 'direct' }, parameters: [], result: codec('RepricingHistory', historySchema) },
      { id: 'dsh-cost-meter#costMeter/repriceHistory', service: 'costMeter', namespace: 'costMeter', method: 'repriceHistory', invocation: { kind: 'direct' }, parameters: [{ name: 'confirmed', wire: 'confirmed', source: 'json', codec: codec('RepricingConfirmation', boolSchema) }], result: codec('FetchPricesResult', resultSchema) },
    ] }

    // 单框选择器(issue #282):原来的「搜索框 + 原生下拉」两块合并成一个输入框——
    // 点进去列出全部候选,打字实时筛选,直接在列表里选。展开列表用主题变量绘制,
    // 不再依赖原生下拉配色(#258 的深色皮肤问题随之消失)。
    // 候选全量渲染(当前目录 331 条):旧版每行原生下拉都要生成一份同样多的 option,
    // 20 行即 6642 个节点;这里一个面板只建一份,不需要截断——截断会让排在后段的
    // 厂商只能靠打字才够得着。
    const comboText = option => (option.label + ' ' + option.value).toLowerCase()
    function SearchPriceSelect({ options, value, placeholder, label, locale, onChange }) {
      const en = locale === 'en'
      // 稳定且互不相同的 id:aria-controls / aria-activedescendant 要按 id 引用被 portal
      // 出输入框子树的候选表。用 React 的 useId(与 statistics 用 useSyncExternalStore
      // 一样,仓库已按 React 18 宿主写),不在渲染期改模块级变量。
      const uid = useId()
      const listId = uid + '-list'
      const [query, setQuery] = useState(''), [open, setOpen] = useState(false), [active, setActive] = useState(0)
      const [box, setBox] = useState(null)
      const rootRef = useRef(null), inputRef = useRef(null), panelRef = useRef(null)
      const selected = options.find(option => option.value === value)
      const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
      // 候选文本只在 options 变化时小写化一次(上游 1.8.29 的做法),不每帧现算。
      const indexed = useMemo(() => options.map(option => ({ option, search: comboText(option) })), [options])
      const matched = words.length ? indexed.filter(row => words.every(word => row.search.includes(word))).map(row => row.option) : options
      // 已选项始终留在列表里(旧版原生下拉一直显示当前值):筛选词不匹配时也不能让用户
      // 看不出自己选了什么、点不回它。
      const shown = selected && !matched.includes(selected) ? [selected, ...matched] : matched
      const index = Math.max(0, Math.min(active, shown.length - 1))
      // 关闭一律丢弃未提交的筛选词:输入框回到「显示已选值」,不会把半截关键词当成值。
      const closeList = () => { setOpen(false); setQuery('') }
      const openList = () => {
        if (open) return
        // 清掉上次的坐标:否则重新打开时面板会先按旧位置画一帧再跳到新位置。
        setBox(null); setQuery('')
        // 关闭态下 query 必为空,故 shown 就是即将渲染的全量列表:直接复用它定位已选项。
        setActive(Math.max(0, shown.findIndex(option => option.value === value)))
        setOpen(true)
      }
      const choose = option => {
        if (!option) return
        // 同值不重复提交:旧原生 select 只在值真的改变时才触发 change。
        if (option.value !== value) onChange(option.value)
        closeList()
      }
      // 有筛选词时先清词(列表回到全部候选);否则清掉已选值,交回「未手动指定」。
      const clear = () => { if (open && query) { setQuery(''); setActive(0); return } if (value) onChange(''); closeList() }
      useEffect(() => {
        if (!open || typeof document === 'undefined') return
        const node = inputRef.current, browser = typeof window === 'undefined' ? null : window
        // 面板恒挂到 body:设置面板是宿主 overlay 里 role=dialog 的 div(不是 <dialog> 元素),
        // 它带 overflow 与自己的层叠上下文;portal 到 body 才既不被裁、也不被压在下层。
        // 贴着输入框展开;下方空间不足时翻到上方,并按可用空间限高,避免超出窗口。
        const place = () => {
          const rect = node?.getBoundingClientRect?.()
          if (!rect || !browser) return
          const below = browser.innerHeight - rect.bottom - 12, above = rect.top - 12
          const flip = below < 180 && above > below
          const maxHeight = Math.max(120, Math.min(280, flip ? above : below))
          const top = flip ? rect.top - maxHeight - 6 : rect.bottom + 6
          // 坐标没变就保留原对象:监听挂在 window 的 capture 上,滚动设置页里任意容器
          // 都会命中,否则每帧都要把整个候选面板重渲染一遍。
          setBox(prev => prev && prev.left === rect.left && prev.top === top && prev.width === rect.width && prev.maxHeight === maxHeight
            ? prev : { left: rect.left, top, width: rect.width, maxHeight })
        }
        place()
        if (typeof browser?.addEventListener !== 'function') return
        browser.addEventListener('scroll', place, true); browser.addEventListener('resize', place)
        return () => { browser.removeEventListener('scroll', place, true); browser.removeEventListener('resize', place) }
      }, [open])
      useEffect(() => {
        if (!open || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
        const dismiss = event => {
          if (rootRef.current?.contains?.(event.target) || panelRef.current?.contains?.(event.target)) return
          // 点空白关闭即丢弃未提交的筛选词,避免输入框里留着一段不是所选值的文字。
          closeList()
        }
        document.addEventListener('pointerdown', dismiss, true)
        return () => document.removeEventListener('pointerdown', dismiss, true)
      }, [open])
      // 用 useLayoutEffect 而不是 useEffect:面板刚挂载时列表还没完成布局,普通 effect
      // 里 scrollIntoView 会空跑(实测打开时调用计数为 0),高亮行留在可视区外。
      useLayoutEffect(() => {
        if (!open) return
        panelRef.current?.querySelector?.('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
      }, [open, index])
      const optionId = i => uid + '-opt-' + i
      // 结果数按真实匹配数给:被补进列表的已选项并不匹配筛选词,不能算进「结果」。
      // 已选项被补进列表时列表非空,就不能再报「没有匹配的模型」——否则列表里明明有
      // 一行、提示却说没有,自相矛盾。此时改为说明「无匹配,下面是当前选择」。
      const note = !words.length ? null
        : matched.length ? (en ? `${matched.length} matches` : `${matched.length} 个结果`)
          : shown.length ? (en ? 'No matches · showing the current choice' : '没有匹配的模型 · 下面是当前选择')
            : (en ? 'No matches' : '没有匹配的模型')
      // 面板直接建在 portal 目标里,不做「先就地渲染再搬家」:否则首帧会白建一整份候选。
      const panel = open ? el('div', { ref: panelRef, className: 'cm-combo-panel', style: box ?? { visibility: 'hidden' } },
        shown.length ? el('div', { className: 'cm-combo-list', id: listId, role: 'listbox', 'aria-label': label },
          shown.map((option, i) => el('button', {
            key: option.value, id: optionId(i), type: 'button', role: 'option',
            className: 'cm-combo-option' + (i === index ? ' active' : ''),
            'data-active': String(i === index), 'aria-selected': String(option.value === value),
            onMouseEnter: () => setActive(i), onMouseDown: event => event.preventDefault(), onClick: () => choose(option),
          }, option.label))) : null,
        note ? el('p', { className: 'cm-combo-note', role: 'status' }, note) : null) : null
      return el('div', { ref: rootRef, className: 'cm-price-search cm-combo' },
        el('div', { className: 'cm-combo-control' },
          el('input', {
            ref: inputRef, type: 'search', className: 'cm-input cm-combo-input', autoComplete: 'off',
            value: open ? query : selected?.label ?? '', role: 'combobox', 'aria-expanded': String(open), 'aria-autocomplete': 'list',
            'aria-controls': open && shown.length ? listId : undefined,
            // 候选表被 portal 出输入框子树,读屏靠 activedescendant 才知道高亮项。
            'aria-activedescendant': open && shown.length ? optionId(index) : undefined,
            'aria-label': label + (en ? ' · Price model' : ' · 价格模型'),
            placeholder: open && selected ? selected.label : placeholder,
            onFocus: openList, onClick: () => { if (!open) openList() },
            onChange: event => {
              // 关闭态输入框显示的是已选标签(不是查询词):用户点选后直接打字时,浏览器会把
              // 字符插在标签后面,若整串当查询词就会得到「标签+字」这种永不匹配的关键词。
              // 这里剥掉标签前缀,只把新输入的部分当查询词。
              const raw = event.target.value
              const next = !open && selected && raw.startsWith(selected.label) ? raw.slice(selected.label.length) : raw
              setQuery(next); setOpen(true); setActive(0)
            },
            onKeyDown: event => {
              // 输入法正在选词(中文/日文):Enter 是确认候选词,不能当成选中模型。
              // React 的合成事件不带 isComposing,必须读 nativeEvent。
              if (event.nativeEvent?.isComposing) return
              // Escape:type=search 的原生输入框会自己清空并派发 input 事件。必须一律
              // preventDefault,否则关闭态下(输入框显示已选标签)也会被 onChange 当成查询词、
              // 把面板重新打开。只在真的关掉候选列表时才阻断冒泡,以免拦住宿主设置面板
              // 自己的 document 级 Esc 关闭逻辑。
              if (event.key === 'Escape') {
                event.preventDefault()
                if (!open) return
                closeList(); event.stopPropagation(); return
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                if (!open) { openList(); return }
                setActive(Math.max(0, Math.min(shown.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
                return
              }
              if (event.key === 'Enter' && open && shown[index]) { event.preventDefault(); choose(shown[index]); return }
              if (event.key === 'Tab') closeList()
            },
          }),
          // 有筛选词时也能清(隐藏了原生 ×,这是唯一的鼠标入口);有选中值时可清回未指定。
          value || query ? el('button', { type: 'button', className: 'cm-combo-clear', 'aria-label': (en ? 'Clear ' : '清空 ') + label, onMouseDown: event => event.preventDefault(), onClick: clear }, '×') : null,
          el('button', {
            type: 'button', className: 'cm-combo-caret', tabIndex: -1, 'aria-hidden': 'true',
            onMouseDown: event => event.preventDefault(),
            onClick: () => { if (open) closeList(); else { inputRef.current?.focus?.(); openList() } },
          }, '▾')),
        panel && createPortal ? createPortal(panel, document.body) : panel)
    }

    function RestorePrices({ state, draft, setDraft, locale, rpc }) {
      const [open, setOpen] = useState(false), [catalog, setCatalog] = useState(null), [selected, setSelected] = useState(''), [error, setError] = useState(''), [retry, setRetry] = useState(0)
      const currency = state.config.prices.currency ?? 'USD', en = locale === 'en'
      useEffect(() => {
        if (!open) return
        let active = true
        setCatalog(null); setError(''); setSelected('')
        rpc('getPriceCatalog').then(value => { if (active) setCatalog(value) }, e => { if (active) setError(String(e.message ?? e)) })
        return () => { active = false }
      }, [open, currency, retry, rpc])
      const options = []
      for (const [provider, families] of Object.entries(catalog ?? {})) for (const models of Object.values(families)) for (const [id, entry] of Object.entries(models)) {
        const mounted = provider === 'deepseek' ? draft?.prices.models[id] : draft?.prices.providers?.[provider]?.models?.[id]
        if (!mounted && !entry.unpriced) options.push({ value: provider + ':' + id, label: provider + ' · ' + id, provider, id, entry })
      }
      const choice = options.find(option => option.value === selected)
      const restore = () => {
        if (!choice || !draft) return
        const { provider, id, entry } = choice, copy = JSON.parse(JSON.stringify(entry)), prices = draft.prices
        setDraft({ ...draft, prices: provider === 'deepseek'
          ? { ...prices, models: { ...prices.models, [id]: copy } }
          : { ...prices, providers: { ...prices.providers, [provider]: { ...prices.providers?.[provider], models: { ...prices.providers?.[provider]?.models, [id]: copy } } } } })
        setSelected('')
      }
      return el('div', { className: 'cm-restore-prices' },
        el('button', { type: 'button', className: 'cm-btn small', 'aria-expanded': open, onClick: () => setOpen(value => !value) }, open ? (en ? 'Close restore' : '收起恢复入口') : (en ? 'Restore bundled model' : '恢复内置模型')),
        open ? el('div', { className: 'cm-collapse-body' },
          error ? el('div', { role: 'alert', className: 'cm-err' }, error, el('button', { type: 'button', className: 'cm-btn small', onClick: () => setRetry(n => n + 1) }, en ? 'Retry' : '重试'))
            : catalog === null ? el('p', { role: 'status', className: 'cm-hint' }, en ? 'Loading prices…' : '读取价格…')
            : options.length ? el(Fragment, null,
              el(SearchPriceSelect, { options, value: choice ? selected : '', placeholder: en ? 'Select a model' : '选择模型', label: en ? 'Restore model' : '恢复模型', locale, onChange: setSelected }),
              el('button', { type: 'button', className: 'cm-btn small', disabled: !choice, onClick: restore }, en ? 'Restore' : '恢复'))
            : el('p', { className: 'cm-hint' }, en ? 'All bundled models are mounted.' : '内置模型均已挂载。')) : null)
    }

    function Matching({ state, draft, setDraft, t, locale, resolveClientPrice, prettyProviderKey, setField }) {
      const config = state.config
          const overrides = draft?.priceOverrides ?? config.priceOverrides ?? {}
          const dismissed = draft?.priceMatchDismissed ?? config.priceMatchDismissed ?? []
          const pricesNow = draft?.prices ?? config.prices
          const byProvider = state.today.byProviderModel ?? {}
          // 今日出现但未命中价格条目的 provider:model 键:判定走 resolveClientPrice 完整
          // 解析链(精确/归一化/宽泛/跨厂商兑底,按当前匹配模式),与计费口径一致——
          // 路由 provider 前缀(go:/opencode: 等)下实际已正确计价的模型不再误报,
          // 仅 DeepSeek 默认价兜底与完全未命中者需要人工指定。
          const matchPrices = { prices: pricesNow, priceMatch: draft?.priceMatch ?? config.priceMatch }
          const unmatchedKeys = Object.keys(byProvider).filter(key => {
            if (dismissed.includes(key)) return false
            if (overrides[key] !== undefined) return false // 已手动指定的键由下方 rows 展示
            const sep = key.indexOf(':')
            const provider = (sep > 0 ? key.slice(0, sep) : 'deepseek').toLowerCase()
            const modelId = sep > 0 ? key.slice(sep + 1) : key
            return resolveClientPrice(provider, modelId, matchPrices).matched !== true
          })
          const rows = [...new Set([...unmatchedKeys, ...Object.keys(overrides)])].filter(key => !dismissed.includes(key))
          // 本月已命中价格且未手动指定的 provider:model 键(v1.6.11):同样允许
          // 改挂其它条目或标记为本地模型(零消耗)。数据取 state.month.byProviderModel
          // (比今日覆盖面广);override 写入后该键转入上方 rows(手动指定区)展示。
          const monthByProvider = state.month?.byProviderModel ?? {}
          const matchedKeys = Object.keys(monthByProvider).filter(key => {
            if (dismissed.includes(key)) return false
            if (overrides[key] !== undefined) return false
            const sep = key.indexOf(':')
            const provider = (sep > 0 ? key.slice(0, sep) : 'deepseek').toLowerCase()
            const modelId = sep > 0 ? key.slice(sep + 1) : key
            return resolveClientPrice(provider, modelId, matchPrices).matched === true
          }).sort()
  const targetOptions = [
    // 「本地模型(零消耗)」哨兵(v1.6.11):__local__ 由服务端解析为未定价
    // (token 照记、后续调用费用为 0)。
    { value: '__local__', label: t('overrideTargetLocal') },
    { value: 'deepseek:__default__', label: t('overrideTargetDefault') },
    // DeepSeek 目标必须带 'deepseek:' 前缀存储(issue #56):裸名会被按
    // 「同渠道换名」解析,跨渠道映射(如 cephalon:x → deepseek-v4-flash)查无此价。
    ...Object.keys(pricesNow.models ?? {}).map(id => ({ value: 'deepseek:' + id, label: 'DeepSeek · ' + id })),
    ...Object.entries(pricesNow.providers ?? {}).flatMap(([p, table]) =>
      Object.keys(table?.models ?? {}).map(id => ({ value: p + ':' + id, label: p + ' · ' + id }))),
  ]
          const setOverride = (key, value) => {
            if (draft === null) return
            const next = { ...(draft.priceOverrides ?? {}) }
            if (value === '') delete next[key]
            else next[key] = value
            setDraft({ ...draft, priceOverrides: next })
          }
          const dismissMatch = key => {
            if (draft === null) return
            const next = { ...(draft.priceOverrides ?? {}) }
            delete next[key]
            setDraft({ ...draft, priceOverrides: next, priceMatchDismissed: [...new Set([...dismissed, key])] })
          }
          return el('div', null,
            el('h3', { className: 'cm-h' }, t('priceMatchLabel')),
            el('div', { className: 'cm-field' },
              el('select', {
                className: 'cm-input',
                value: draft?.priceMatch === 'exact' ? 'exact' : 'auto',
                onChange: event => setField('priceMatch', event.target.value),
              },
                el('option', { value: 'auto' }, t('priceMatchAuto')),
                el('option', { value: 'exact' }, t('priceMatchExact')))),
            el('p', { className: 'cm-note' }, t('priceMatchNote')),
            rows.length > 0
              ? el(Fragment, null,
                el('h3', { className: 'cm-h' }, t('unmatchedTitle')),
                el('p', { className: 'cm-hint' }, t('unmatchedHint')),
                rows.map(key =>
                  el('div', { key, className: 'cm-match-row' },
                    el('span', null, prettyProviderKey(key)),
                    el(SearchPriceSelect, { value: overrides[key] ?? '', options: targetOptions, placeholder: '—', label: prettyProviderKey(key), locale, onChange: value => setOverride(key, value) }),
                    el('button', { className: 'cm-btn small', title: t('removePriceMatchHint'), onClick: () => dismissMatch(key) }, t('overrideRemove')))))
              : el('p', { className: 'cm-hint' }, t('overrideNone')),
            dismissed.length > 0 ? el('button', { className: 'cm-btn small', onClick: () => setField('priceMatchDismissed', []) }, t('restorePriceMatches', { count: dismissed.length })) : null,
            // 已命中模型改映射(v1.6.11):默认「保持自动命中」,选择目标即写入手动覆盖。
            matchedKeys.length > 0
              ? el(Fragment, null,
                el('h3', { className: 'cm-h' }, t('matchedTitle')),
                el('p', { className: 'cm-hint' }, t('matchedHint')),
                matchedKeys.map(key =>
                  el('div', { key, className: 'cm-match-row' },
                    el('span', null, prettyProviderKey(key)),
                    el(SearchPriceSelect, { value: '', options: targetOptions, placeholder: t('matchedKeepAuto'), label: prettyProviderKey(key), locale, onChange: value => { if (value) setOverride(key, value) } }))))
              : null)

    }

    function History({ state, locale, formatMoneyUsd, api, rpc, disabled }) {
      const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [runs, setRuns] = useState([]), [error, setError] = useState('')
      const en = locale === 'en', money = amount => formatMoneyUsd(amount, state.config)
      const refresh = () => rpc('getRepricingHistory').then(value => { setRuns(historySchema.parse(value)); setError('') }).catch(e => setError(String(e.message ?? e)))
      useEffect(() => { let active = true; rpc('getRepricingHistory').then(value => { if (active) setRuns(historySchema.parse(value)) }, e => { if (active) setError(String(e.message ?? e)) }); return () => { active = false } }, [rpc])
      const run = async () => {
        if (!confirm || busy || disabled) return
        setBusy(true); setError(''); setMessage('')
        try {
          const result = await rpc('repriceHistory', true)
          if (!result.ok) throw new Error(result.message)
          setMessage(result.message); setConfirm(false)
          await refresh(); await api.reload()
        } catch (error) { setError(String(error.message ?? error)) }
        finally { setBusy(false) }
      }
      return el('section', { className: 'cm-repricing' },
        el('h3', { className: 'cm-h' }, en ? 'Historical pricing' : '历史费用'),
        el('p', { className: 'cm-note' }, en ? 'Rate changes apply to new calls. Recorded historical rates remain fixed.' : '修改价格只影响后续调用，历史费用沿用原价格。'),
        confirm ? el('div', { className: 'cm-repricing-warning', role: 'alert', onKeyDown: event => { if (event.key === 'Escape' && !busy) { setConfirm(false); event.stopPropagation() } } },
          el('strong', null, en ? 'This changes historical amounts' : '这会改变历史费用'),
          el('p', null, en ? 'Recalculate retained calls using current rates and replace their amounts in statistics. Original amounts, price versions and a full ledger backup are kept. Records with incomplete logs are unchanged.' : '确认后，将按当前价格重新计算保留的历史调用，并更新统计金额。原金额、原价格版本和完整账本备份都会保留；日志不完整的记录不改。'),
          el('div', { className: 'cm-buttons' }, el('button', { type: 'button', className: 'cm-btn', disabled: busy, onClick: () => setConfirm(false) }, en ? 'Cancel' : '取消'),
            el('button', { type: 'button', className: 'cm-btn danger', disabled: busy || disabled, onClick: run }, busy ? (en ? 'Recalculating…' : '正在重算…') : (en ? 'Confirm recalculation' : '确认重算'))))
          : el('button', { type: 'button', className: 'cm-btn', disabled: disabled || busy, onClick: () => setConfirm(true) }, en ? 'Recalculate history at current rates' : '按当前价格重算历史'),
        message ? el('p', { role: 'status', className: 'cm-note' }, message) : null,
        error ? el('p', { role: 'alert', className: 'cm-err' }, error) : null,
        runs.length ? el('details', { className: 'cm-repricing-history' }, el('summary', null, en ? 'Recalculation records · original amounts retained' : '重算记录 · 原金额已保留'),
          el('div', { className: 'cm-stat-scroll' }, el('table', { className: 'cm-stat-table' },
            el('thead', null, el('tr', null, ...(en ? ['Time', 'Before', 'After', 'Session/day records'] : ['重算时间', '原金额', '重算后', '会话日期记录']).map(s => el('th', { key: s, scope: 'col' }, s)))),
            el('tbody', null, ...runs.map(row => el('tr', { key: row.at }, el('td', null, new Date(row.at).toLocaleString(locale)), el('td', null, money(row.before)), el('td', null, money(row.after)), el('td', null, row.sessions))))))) : null)
    }

    async function mount(ctx) {
      const unmount = await ctx.get('remote').$mount(CONTRIBUTION)
      ctx.effect(() => () => unmount(), 'cost-meter: pricing settings contribution')
      const service = ctx.get('remote.costMeter')
      const rpc = async (method, ...args) => {
        if (method === 'repriceHistory') boolSchema.parse(args[0])
        const result = await service[method](...args)
        if (result?.ok !== true) throw new Error(result?.error?.message ?? 'Pricing request failed')
        return (method === 'getPriceCatalog' ? catalogSchema : method === 'getRepricingHistory' ? historySchema : resultSchema).parse(result.value)
      }
      const style = document.createElement('style')
      style.textContent = [
        '.cm-price-search{display:block;min-width:0}',
        '.cm-combo-control{position:relative;display:flex;align-items:center;min-width:0}',
        '.cm-combo .cm-input{width:100%;min-width:0;padding-right:46px;text-overflow:ellipsis}',
        // 自带清空按钮,隐藏 WebKit 的原生 ×,避免同一位置出现两个清除入口。
        '.cm-combo .cm-combo-input::-webkit-search-cancel-button{display:none}',
        // 清空与箭头是同一颗小图标按钮,只差位置与字号。
        '.cm-combo-clear,.cm-combo-caret{position:absolute;display:flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);line-height:1;cursor:pointer}',
        '.cm-combo-clear{right:26px;border-radius:50%;font-size:14px}',
        '.cm-combo-clear:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}',
        '.cm-combo-caret{right:6px;font-size:10px}',
        // 浮层固定定位挂到 body:设置面板是宿主 overlay 里 role=dialog 的 div,它带 overflow
        // 与自己的层叠上下文;底色沿用宿主浮层令牌(bg-layer-2),靠 elevation 的描边+阴影分层。
        '.cm-combo-panel{position:fixed;z-index:10000;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;padding:4px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));box-shadow:var(--dsw-elevation-panel,0 3px 8px rgba(0,0,0,.06),0 0 16px rgba(0,0,0,.04))}',
        '.cm-combo-list{display:flex;flex-direction:column;gap:2px;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}',
        // flex:none 不可省:面板限高后,列内子项默认可收缩,会把每行压扁成一条、文字被裁掉。
        '.cm-combo-option{flex:none;font:inherit;font-size:12px;line-height:1.5;text-align:left;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.cm-combo-option.active{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
        '.cm-combo-option[aria-selected="true"]{color:var(--dsw-alias-state-business-primary);font-weight:600}',
        '.cm-combo-note{margin:0;padding:4px 8px;font-size:10px;color:var(--dsw-alias-label-tertiary)}',
        '.cm-match-row .cm-combo{flex:1;min-width:160px}',
        '.cm-repricing-warning{padding:12px;border:1px solid var(--dsw-alias-state-warn-primary,#c58a25);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}.cm-repricing-warning p{margin:8px 0 12px;line-height:1.6}.cm-repricing-history{margin-top:12px}.cm-repricing-history table{width:100%;text-align:left;font-variant-numeric:tabular-nums}.cm-repricing-history td,.cm-repricing-history th{padding:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      ].join('')
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove(), 'cost-meter: pricing settings styles')
      return props => props.mode === 'matching' ? el(Matching, props) : el(props.mode === 'restore' ? RestorePrices : History, { ...props, rpc })
    }
    return { mount, CONTRIBUTION }
  },
})
