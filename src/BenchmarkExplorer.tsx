import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'

type UserNovel = { id: string; title: string; fiction_url: string; published_at: string | null; page_count: number | null; chapter_count: number | null }
type UserSnapshot = { views: number | null; average_views: number | null; followers: number | null; favorites: number | null; rating: number | null; rating_count: number | null; chapters: number | null; pages: number | null; raw_data: Record<string, unknown> | null; captured_at: string }
type Row = { age: number; v: number | null; av: number | null; f: number | null; fav: number | null; rc: number | null; p: number | null; w: number | null; ch: number | null; r: number | null; st: number | null; sr: number | null; g: number | null; c: number | null; genres: string[]; tags: string[]; status: string; fictionType: string }
type Metric = { key: string; label: string; short: string; log?: boolean }
const METRICS: Metric[] = [
  { key: 'v', label: 'Total views', short: 'Views', log: true },
  { key: 'av', label: 'Average views', short: 'Avg. views', log: true },
  { key: 'f', label: 'Followers', short: 'Followers', log: true },
  { key: 'fav', label: 'Favorites', short: 'Favorites', log: true },
  { key: 'followRate', label: 'Follower-to-average-view ratio (%)', short: 'Follower ratio', log: true },
  { key: 'rc', label: 'Ratings count', short: 'Ratings', log: true },
  { key: 'p', label: 'Pages', short: 'Pages', log: true },
  { key: 'w', label: 'Word count', short: 'Words', log: true },
  { key: 'ch', label: 'Chapter count', short: 'Chapters', log: true },
  { key: 'wordsPerPage', label: 'Words per page', short: 'Words/page' },
  { key: 'r', label: 'Overall score', short: 'Overall score' },
  { key: 'st', label: 'Style score', short: 'Style' },
  { key: 'sr', label: 'Story score', short: 'Story' },
  { key: 'g', label: 'Grammar score', short: 'Grammar' },
  { key: 'c', label: 'Character score', short: 'Character' },
]
const AGE_FILTERS = [
  { value: 'all', label: 'All ages', test: (_: number) => true },
  { value: '1-30', label: '1–30 days', test: (a: number) => a >= 1 && a <= 30 },
  { value: '31-60', label: '31–60 days', test: (a: number) => a >= 31 && a <= 60 },
  { value: '61-90', label: '61–90 days', test: (a: number) => a >= 61 && a <= 90 },
  { value: '91-180', label: '91–180 days', test: (a: number) => a >= 91 && a <= 180 },
  { value: '181-365', label: '181–365 days', test: (a: number) => a >= 181 && a <= 365 },
  { value: '366+', label: '366+ days', test: (a: number) => a >= 366 },
]
const COLUMNS = ['age','v','av','f','fav','rc','p','w','ch','r','st','sr','g','c'] as const
const fmt = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : Intl.NumberFormat('en-US', { notation: Math.abs(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(value)
const getMetric = (row: Row, key: string): number | null => {
  if (key === 'followRate') return row.av && row.av > 0 && row.f != null ? row.f / row.av * 100 : null
  if (key === 'wordsPerPage') return row.p && row.p > 0 && row.w != null ? row.w / row.p : null
  return row[key as keyof Row] as number | null
}
const getUserMetric = (novel: UserNovel, snapshot: UserSnapshot | undefined, key: string): number | null => {
  if (key === 'p') return snapshot?.pages ?? novel.page_count
  if (key === 'ch') return snapshot?.chapters ?? novel.chapter_count
  if (!snapshot) return null
  if (key === 'v') return snapshot.views
  if (key === 'av') return snapshot.average_views
  if (key === 'f') return snapshot.followers
  if (key === 'fav') return snapshot.favorites
  if (key === 'rc') return snapshot.rating_count
  const raw = snapshot.raw_data || {}
  const rawMetric = (...keys: string[]) => {
    for (const name of keys) {
      const value = raw[name]
      if (value !== undefined && value !== null && value !== '') {
        const number = Number(value)
        if (Number.isFinite(number)) return number
      }
    }
    return null
  }
  if (key === 'r') return snapshot.rating ?? rawMetric('overall_score', 'overallScore')
  if (key === 'w') return rawMetric('word_count', 'wordCount', 'words')
  if (key === 'st') return rawMetric('style_score', 'styleScore')
  if (key === 'sr') return rawMetric('story_score', 'storyScore')
  if (key === 'g') return rawMetric('grammar_score', 'grammarScore')
  if (key === 'c') return rawMetric('character_score', 'characterScore')
  if (key === 'wordsPerPage') {
    const words = rawMetric('word_count', 'wordCount', 'words')
    const pages = snapshot.pages ?? novel.page_count
    return words != null && pages && pages > 0 ? words / pages : null
  }
  if (key === 'followRate') return snapshot.average_views && snapshot.average_views > 0 && snapshot.followers != null ? snapshot.followers / snapshot.average_views * 100 : null
  return null
}
const percentile = (values: number[], value: number) => values.length ? values.filter(x => x <= value).length / values.length * 100 : null
const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((a,b) => a-b), m = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[m] : (sorted[m-1] + sorted[m]) / 2
}
const summary = (values: number[]) => {
  if (!values.length) return { mean: null, median: null, mode: '—', count: 0 }
  const counts = new Map<number, number>()
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1))
  const maxCount = Math.max(...counts.values())
  const modes = [...counts.entries()].filter(([,n]) => n === maxCount).map(([v]) => v).sort((a,b)=>a-b)
  return { mean: values.reduce((a,b)=>a+b,0)/values.length, median: median(values), mode: modes.slice(0,3).map(fmt).join(', ') + (modes.length > 3 ? '…' : ''), count: values.length }
}
const cohort = (age: number) => age <= 90 ? '0–90 days' : age <= 180 ? '91–180 days' : age <= 270 ? '181–270 days' : age <= 360 ? '271–360 days' : '361+ days'
const ageOf = (publishedAt: string | null) => publishedAt ? Math.max(0, Math.floor((Date.now() - new Date(publishedAt).getTime()) / 86400000)) : null

type CreateNovelInput = { title: string; url: string; publishedAt: string; genre: string; tags: string; metrics: Record<string, number | null> }
export default function BenchmarkExplorer({ novels, latestByNovel, onCreateNovel }: { novels: UserNovel[]; latestByNovel: Map<string, UserSnapshot>; onCreateNovel: (input: CreateNovelInput) => Promise<string> }) {
  const [baseline, setBaseline] = useState<Row[]>([])
  const [genreFilter, setGenreFilter] = useState('All genres')
  const [typeFilter, setTypeFilter] = useState('All types')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [tagFilter, setTagFilter] = useState('All tags')
  const [loadError, setLoadError] = useState('')
  const [metricKey, setMetricKey] = useState('f')
  const [ageFilter, setAgeFilter] = useState('all')
  const [selectedNovelId, setSelectedNovelId] = useState('')
  const [xMetric, setXMetric] = useState('av')
  const [yMetric, setYMetric] = useState('f')
  const [createOpen, setCreateOpen] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState('')
  const [draftTitle, setDraftTitle] = useState('')
  const [draftUrl, setDraftUrl] = useState('')
  const [draftPublishedAt, setDraftPublishedAt] = useState('')
  const [draftGenre, setDraftGenre] = useState('')
  const [draftTags, setDraftTags] = useState('')
  const [draftMetrics, setDraftMetrics] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await fetch('/benchmark-baseline.csv.gz.b64')
        if (!response.ok) throw new Error('Could not load the frozen benchmark data.')
        const encoded = (await response.text()).trim()
        const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
        const csv = await new Response(stream).text()
        const categoryResponse = await fetch('/benchmark-categories.json.gz.b64')
        if (!categoryResponse.ok) throw new Error('Could not load benchmark categories.')
        const categoryBytes = Uint8Array.from(atob((await categoryResponse.text()).trim()), c => c.charCodeAt(0))
        const categoryStream = new Blob([categoryBytes]).stream().pipeThrough(new DecompressionStream('gzip'))
        const categories = JSON.parse(await new Response(categoryStream).text()) as Array<{ genres: string[]; tags: string[]; status: string; fictionType: string }>
        const rows = csv.trim().split(/\r?\n/).map((line, index) => {
          const values = line.split(',')
          const row: Record<string, number | null> = {}
          COLUMNS.forEach((key, i) => row[key] = values[i] === '' || values[i] === undefined ? null : Number(values[i]))
          return { ...row, ...(categories[index] || { genres: [], tags: [], status: 'Unknown', fictionType: 'Unknown' }) } as Row
        })
        if (!cancelled) setBaseline(rows)
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Benchmark data failed to load.')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedNovelId && novels.length) {
      const own = novels.find(n => n.fiction_url.includes('/fiction/183032')) || novels[0]
      setSelectedNovelId(own.id)
    }
  }, [novels, selectedNovelId])

  const selectedNovel = novels.find(n => n.id === selectedNovelId)
  const selectedSnapshot = selectedNovel ? latestByNovel.get(selectedNovel.id) : undefined
  const selectedAge = selectedNovel ? ageOf(selectedNovel.published_at) : null
  const activeAge = AGE_FILTERS.find(x => x.value === ageFilter) || AGE_FILTERS[0]
  const genres = [...new Set(baseline.flatMap(r => r.genres || []))].sort()
  const types = [...new Set(baseline.map(r => r.fictionType).filter(Boolean))].sort()
  const statuses = [...new Set(baseline.map(r => r.status).filter(Boolean))].sort()
  const tags = [...new Set(baseline.flatMap(r => r.tags || []))].sort()
  const categoryFiltered = baseline.filter(r => (genreFilter === 'All genres' || r.genres.includes(genreFilter)) && (typeFilter === 'All types' || r.fictionType === typeFilter) && (statusFilter === 'All statuses' || r.status === statusFilter) && (tagFilter === 'All tags' || r.tags.includes(tagFilter)))
  const filtered = useMemo(() => categoryFiltered.filter(r => activeAge.test(r.age)), [baseline, activeAge, genreFilter, typeFilter, statusFilter, tagFilter])
  const metric = METRICS.find(m => m.key === metricKey) || METRICS[2]
  const values = filtered.map(r => getMetric(r, metricKey)).filter((v): v is number => v != null && Number.isFinite(v))
  const ownValue = selectedNovel ? getUserMetric(selectedNovel, selectedSnapshot, metricKey) : null
  const stats = summary(values)
  const rawPct = ownValue == null ? null : percentile(values, ownValue)
  const agePeers = selectedAge == null ? [] : categoryFiltered.filter(r => Math.floor((r.age - 1) / 30) === Math.floor((selectedAge - 1) / 30)).map(r => getMetric(r, metricKey)).filter((v): v is number => v != null && Number.isFinite(v))
  const agePct = ownValue == null ? null : percentile(agePeers, ownValue)

  const histogram = useMemo(() => {
    if (!values.length) return []
    const transformed = values.map(v => metric.log ? Math.log10(Math.max(0, v) + 1) : v)
    const min = Math.min(...transformed), max = Math.max(...transformed)
    const binCount = 18, step = max === min ? 1 : (max - min) / binCount
    return Array.from({ length: binCount }, (_, i) => {
      const lo = min + i * step, hi = i === binCount - 1 ? max : lo + step
      const count = transformed.filter(v => v >= lo && (i === binCount - 1 ? v <= hi : v < hi)).length
      const inverse = (v: number) => metric.log ? Math.pow(10, v) - 1 : v
      return { index: i, range: fmt(inverse(lo)) + '–' + fmt(inverse(hi)), count, midpoint: (lo + hi) / 2 }
    })
  }, [values, metric.log])
  const markerIndex = ownValue == null || !values.length ? null : (() => {
    const transformed = values.map(v => metric.log ? Math.log10(Math.max(0,v)+1) : v)
    const min = Math.min(...transformed), max = Math.max(...transformed)
    const point = metric.log ? Math.log10(Math.max(0,ownValue)+1) : ownValue
    return Math.max(0, Math.min(17, Math.floor((point-min) / (max === min ? 1 : (max-min)/18))))
  })()

  const xDef = METRICS.find(m => m.key === xMetric) || METRICS[1]
  const yDef = METRICS.find(m => m.key === yMetric) || METRICS[2]
  const scatterData = filtered.flatMap(row => {
    const x = getMetric(row, xMetric), y = getMetric(row, yMetric)
    return x == null || y == null ? [] : [{ x, y }]
  })
  const ownX = selectedNovel ? getUserMetric(selectedNovel, selectedSnapshot, xMetric) : null
  const ownY = selectedNovel ? getUserMetric(selectedNovel, selectedSnapshot, yMetric) : null
  const ownScatter = ownX == null || ownY == null ? [] : [{ x: ownX, y: ownY, name: selectedNovel?.title }]
  const ageGroups = ['0–90 days','91–180 days','181–270 days','271–360 days','361+ days']
  const ageRows = ageGroups.map(group => {
    const peers = categoryFiltered.filter(r => cohort(r.age) === group)
    const f = peers.map(r=>r.f).filter((v):v is number=>v!=null)
    const av = peers.map(r=>r.av).filter((v):v is number=>v!=null)
    const rate = peers.map(r=>getMetric(r,'followRate')).filter((v):v is number=>v!=null)
    return { group, count: peers.length, followers: median(f), avgViews: median(av), followRate: median(rate) }
  })

  if (loadError) return <div className="panel"><h2>Benchmark unavailable</h2><p className="error">{loadError}</p></div>
  if (!baseline.length) return <div className="panel"><h2>Loading benchmark…</h2><p className="muted">Loading the 410-novel baseline.</p></div>

  return <div className="benchmark-explorer">
    <div className="page-heading"><div><p className="eyebrow">FROZEN REFERENCE DATA · AUG 29, 2026</p><h1>Novel performance</h1><p className="muted">See where your novel ranks against the 410-novel reference dataset. Your novels stay separate from the baseline.</p></div><button className="primary" onClick={() => { setCreateOpen(v => !v); setCreateError('') }}>{createOpen ? 'Close form' : '+ Add my novel'}</button></div>
    {createOpen && <div className="panel create-novel-panel">
      <div className="panel-heading"><div><h2>Add a novel to compare</h2><p>Enter its Royal Road URL and latest available metrics. It will be saved to your catalogue, not added to the reference dataset.</p></div></div>
      <div className="create-novel-grid">
        <label>Novel title<input value={draftTitle} onChange={e=>setDraftTitle(e.target.value)} placeholder="Novel title" /></label>
        <label>Royal Road URL<input value={draftUrl} onChange={e=>setDraftUrl(e.target.value)} placeholder="https://www.royalroad.com/fiction/..." /></label>
        <label>Publication date<input type="date" value={draftPublishedAt} onChange={e=>setDraftPublishedAt(e.target.value)} /></label>
        <label>Genre<input value={draftGenre} onChange={e=>setDraftGenre(e.target.value)} placeholder="Fantasy, LitRPG…" /></label>
        <label className="create-tags">Tags<input value={draftTags} onChange={e=>setDraftTags(e.target.value)} placeholder="Comma-separated tags" /></label>
      </div>
      <p className="eyebrow create-metrics-label">LATEST METRICS</p>
      <div className="create-metric-grid">
        {[
          ['views','Total views'],['average_views','Average views'],['followers','Followers'],['favorites','Favorites'],
          ['rating_count','Ratings count'],['rating','Overall rating'],['pages','Pages'],['word_count','Word count'],
          ['chapters','Chapters'],['overall_score','Overall score'],['style_score','Style score'],['story_score','Story score'],
          ['grammar_score','Grammar score'],['character_score','Character score']
        ].map(([key,label])=><label key={key}>{label}<input type="number" min="0" step="any" value={draftMetrics[key] || ''} onChange={e=>setDraftMetrics(old=>({...old,[key]:e.target.value}))} placeholder="—"/></label>)}
      </div>
      {createError && <p className="error">{createError}</p>}
      <div className="create-novel-actions"><span className="muted">You can leave unavailable metrics blank.</span><button className="primary" disabled={createBusy || !draftTitle.trim() || !draftUrl.trim()} onClick={async()=>{
        setCreateBusy(true); setCreateError('')
        try {
          const metrics=Object.fromEntries(Object.entries(draftMetrics).map(([k,v])=>[k,v.trim()===''?null:Number(v)]))
          if(Object.values(metrics).some(v=>v!==null && (!Number.isFinite(v as number) || (v as number)<0))) throw new Error('Metrics must be non-negative numbers.')
          if(metrics.rating != null && metrics.rating > 5) throw new Error('Overall rating must be between 0 and 5.')
          const id=await onCreateNovel({title:draftTitle.trim(),url:draftUrl.trim(),publishedAt:draftPublishedAt,genre:draftGenre.trim(),tags:draftTags,metrics})
          setSelectedNovelId(id); setCreateOpen(false); setDraftTitle(''); setDraftUrl(''); setDraftPublishedAt(''); setDraftGenre(''); setDraftTags(''); setDraftMetrics({})
        } catch(error) { setCreateError(error instanceof Error?error.message:'Could not save this novel.') }
        finally { setCreateBusy(false) }
      }}>{createBusy?'Saving…':'Save and compare'}</button></div>
    </div>}
    <div className="stat-grid">
      <div className="stat-card"><div className="stat-top"><span>Baseline novels</span></div><strong>{baseline.length}</strong><small>Unique fiction records</small></div>
      <div className="stat-card"><div className="stat-top"><span>Baseline median followers</span></div><strong>{fmt(median(baseline.map(r=>r.f).filter((v):v is number=>v!=null)))}</strong><small>Mean: {fmt(summary(baseline.map(r=>r.f).filter((v):v is number=>v!=null)).mean)}</small></div>
      <div className="stat-card"><div className="stat-top"><span>Baseline median avg. views</span></div><strong>{fmt(median(baseline.map(r=>r.av).filter((v):v is number=>v!=null)))}</strong><small>Mean: {fmt(summary(baseline.map(r=>r.av).filter((v):v is number=>v!=null)).mean)}</small></div>
      <div className="stat-card"><div className="stat-top"><span>Age ≤ 30 days</span></div><strong>{baseline.filter(r=>r.age<=30).length}</strong><small>Novel records in this cohort</small></div>
    </div>
    <div className="panel">
      <div className="benchmark-controls">
        <label>Genre category<select value={genreFilter} onChange={e=>setGenreFilter(e.target.value)}><option>All genres</option>{genres.map(g=><option key={g}>{g}</option>)}</select></label>
        <label>Fiction type<select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option>All types</option>{types.map(t=><option key={t}>{t}</option>)}</select></label>
        <label>Publication status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option>All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Tag<select value={tagFilter} onChange={e=>setTagFilter(e.target.value)}><option>All tags</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label>
        <label>Novel to compare<select value={selectedNovelId} onChange={e=>setSelectedNovelId(e.target.value)}><option value="">Select a novel</option>{novels.map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label>
        <label>Metric<select value={metricKey} onChange={e=>setMetricKey(e.target.value)}>{METRICS.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
        <label>Age cohort<select value={ageFilter} onChange={e=>setAgeFilter(e.target.value)}>{AGE_FILTERS.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
      </div>
      <div className="benchmark-kpis">
        <div><span>Baseline records</span><strong>{fmt(values.length)}</strong></div>
        <div><span>Mean</span><strong>{fmt(stats.mean)}</strong></div>
        <div><span>Median</span><strong>{fmt(stats.median)}</strong></div>
        <div><span>Mode</span><strong>{stats.mode}</strong></div>
      </div>
      <div className="benchmark-chart-head"><div><h2>{metric.label} distribution curve</h2><p className="muted">Observed frequency across the selected cohort. This is an empirical curve, not an assumed normal bell curve.</p></div></div>
      <div className="benchmark-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={histogram} margin={{top:16,right:14,left:0,bottom:28}}><CartesianGrid strokeDasharray="3 3" stroke="#293342"/><XAxis dataKey="range" interval={3} angle={-20} textAnchor="end" height={58} tick={{fill:'#93a0b2',fontSize:10}}/><YAxis allowDecimals={false} tick={{fill:'#93a0b2',fontSize:10}}/><Tooltip contentStyle={{background:'#151e2a',border:'1px solid #344154',borderRadius:8,color:'#eef2f7'}} formatter={(v:any)=>[v,'Novels']}/><Line type="monotone" dataKey="count" stroke="#78bfa0" strokeWidth={2.5} dot={{r:2.5,fill:'#78bfa0'}} activeDot={{r:5}} isAnimationActive={false}/>{markerIndex != null && <ReferenceLine x={histogram[markerIndex]?.range} stroke="#f0b66b" strokeWidth={2} label={{value:'Your novel',fill:'#f0b66b',position:'top'}}/>}</LineChart></ResponsiveContainer></div>
      {selectedNovel && <div className="benchmark-position benchmark-percentile"><div><b>{selectedNovel.title}</b><span>{ownValue == null ? 'This metric is missing from the latest snapshot.' : <>Your value: <strong>{fmt(ownValue)}</strong></>}</span></div><div className="percentile-score">{rawPct == null ? '—' : rawPct.toFixed(1)+'th'}<small>percentile in current comparison</small></div><div className="percentile-detail">{agePct == null ? 'Age-adjusted percentile unavailable' : agePct.toFixed(1)+'th percentile in its 30-day age band'}</div></div>}
      <p className="benchmark-note">Counts and percentiles use available values only. The curve uses log-spaced bins for count metrics because the observed distributions are highly skewed; it does not assume a normal distribution. The follower-to-average-view ratio is a comparison proxy, not a true visitor-to-follower conversion rate.</p>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h2>Combine two metrics</h2><p>Explore how two measures relate across the same benchmark novels.</p></div></div>
      <div className="benchmark-controls"><label>X-axis metric<select value={xMetric} onChange={e=>setXMetric(e.target.value)}>{METRICS.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</select></label><label>Y-axis metric<select value={yMetric} onChange={e=>setYMetric(e.target.value)}>{METRICS.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</select></label></div>
      <div className="benchmark-chart"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{top:16,right:20,bottom:24,left:8}}><CartesianGrid strokeDasharray="3 3" stroke="#293342"/><XAxis type="number" dataKey="x" name={xDef.label} tick={{fill:'#93a0b2',fontSize:10}} label={{value:xDef.short,position:'insideBottom',offset:-12,fill:'#93a0b2'}}/><YAxis type="number" dataKey="y" name={yDef.label} tick={{fill:'#93a0b2',fontSize:10}} label={{value:yDef.short,angle:-90,position:'insideLeft',fill:'#93a0b2'}}/><Tooltip cursor={{strokeDasharray:'3 3'}} contentStyle={{background:'#151e2a',border:'1px solid #344154',borderRadius:8,color:'#eef2f7'}}/><Scatter name="Benchmark novels" data={scatterData} fill="#7c91ae" fillOpacity={0.45}/><Scatter name="Your novel" data={ownScatter} fill="#f0b66b" shape="star"/></ScatterChart></ResponsiveContainer></div>
      <p className="benchmark-note">{scatterData.length} benchmark novels have both metrics available. Your selected novel is highlighted separately when both values exist.</p>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h2>Overall benchmark values</h2><p>Mean, median and mode across all 410 records. Ratings are available for only a subset.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Metric</th><th>Available</th><th>Mean</th><th>Median</th><th>Mode</th><th>Range</th></tr></thead><tbody>{METRICS.map(m=>{const vals=baseline.map(r=>getMetric(r,m.key)).filter((v):v is number=>v!=null);const s=summary(vals);return <tr key={m.key}><td>{m.label}</td><td>{s.count}</td><td>{fmt(s.mean)}</td><td>{fmt(s.median)}</td><td>{s.mode}</td><td>{vals.length?fmt(Math.min(...vals))+' – '+fmt(Math.max(...vals)):'—'}</td></tr>})}</tbody></table></div>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h2>Performance by 90-day age cohort</h2><p>Median values from the original scrape date, August 29, 2026.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Age cohort</th><th>Novels</th><th>Median followers</th><th>Median avg. views</th><th>Median followers / avg. views</th></tr></thead><tbody>{ageRows.map(row=><tr key={row.group}><td>{row.group}</td><td>{row.count}</td><td>{fmt(row.followers)}</td><td>{fmt(row.avgViews)}</td><td>{row.followRate==null?'—':row.followRate.toFixed(2)+'%'}</td></tr>)}</tbody></table></div>
    </div>
  </div>
}
