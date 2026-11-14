import { useMemo, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, BarChart, Bar } from 'recharts'

type UserNovel = {
  id: string; title: string; fiction_url: string; author_name: string | null
  genre: string | null; publication_status: string | null; published_at: string | null
  page_count: number | null; chapter_count: number | null; tags: string[]
}
type UserSnapshot = {
  views: number | null; average_views: number | null; followers: number | null
  favorites: number | null; rating: number | null; rating_count: number | null
  chapters: number | null; pages: number | null; raw_data: Record<string, unknown> | null
  captured_at: string
}
type MetricKey = 'views' | 'average_views' | 'followers' | 'favorites' | 'follow_rate' | 'rating' | 'rating_count' | 'pages' | 'words' | 'chapters'
const SCORE_WEIGHTS: { key: MetricKey; label: string; weight: number }[] = [
  { key: 'followers', label: 'Followers', weight: 25 },
  { key: 'average_views', label: 'Average views', weight: 20 },
  { key: 'follow_rate', label: 'Followers / average views', weight: 20 },
  { key: 'rating', label: 'Overall rating', weight: 15 },
  { key: 'rating_count', label: 'Ratings count', weight: 10 },
  { key: 'favorites', label: 'Favorites', weight: 10 },
]
const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'views', label: 'Total views' }, { key: 'average_views', label: 'Average views' },
  { key: 'followers', label: 'Followers' }, { key: 'favorites', label: 'Favorites' },
  { key: 'follow_rate', label: 'Followers / average views (%)' },
  { key: 'rating', label: 'Overall rating' }, { key: 'rating_count', label: 'Ratings count' },
  { key: 'pages', label: 'Pages' }, { key: 'words', label: 'Word count' }, { key: 'chapters', label: 'Chapters' },
]
const numberFrom = (raw: Record<string, unknown> | null, ...keys: string[]): number | null => {
  if (!raw) return null
  for (const key of keys) {
    const value = raw[key]
    if (value !== null && value !== undefined && value !== '') {
      const n = Number(value)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}
const metricValue = (novel: UserNovel, snapshot: UserSnapshot | undefined, key: MetricKey): number | null => {
  if (!snapshot) return null
  const raw = snapshot.raw_data
  if (key === 'views') return snapshot.views
  if (key === 'average_views') return snapshot.average_views
  if (key === 'followers') return snapshot.followers
  if (key === 'favorites') return snapshot.favorites
  if (key === 'rating') return snapshot.rating ?? numberFrom(raw, 'overall_score', 'overallScore', 'overall_rating')
  if (key === 'rating_count') return snapshot.rating_count
  if (key === 'pages') return snapshot.pages ?? novel.page_count
  if (key === 'chapters') return snapshot.chapters ?? novel.chapter_count
  if (key === 'words') return numberFrom(raw, 'word_count', 'wordCount', 'words')
  if (key === 'follow_rate') return snapshot.average_views && snapshot.average_views > 0 && snapshot.followers != null ? snapshot.followers / snapshot.average_views * 100 : null
  return null
}
const ageOf = (date: string | null) => date && Number.isFinite(new Date(date).getTime()) ? Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000)) : null
const percentileRank = (values: number[], value: number) => values.length ? values.filter(v => v <= value).length / values.length * 100 : null
const fmt = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : Intl.NumberFormat('en-US', { notation: Math.abs(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(value)
const gradeFor = (score: number | null) => score == null ? 'N/A' : score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'E'

export default function BenchmarkExplorer({ novels, latestByNovel }: {
  novels: UserNovel[]; latestByNovel: Map<string, UserSnapshot>;
  onCreateNovel?: (input: { title: string; url: string; publishedAt: string; genre: string; tags: string; metrics: Record<string, number | null> }) => Promise<string>
}) {
  const [genreFilter, setGenreFilter] = useState('All genres')
  const [statusFilter, setStatusFilter] = useState('All statuses')
  const [tagFilter, setTagFilter] = useState('All tags')
  const [ageFilter, setAgeFilter] = useState('all')
  const [metricKey, setMetricKey] = useState<MetricKey>('followers')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'score' | 'percentile' | 'followers' | 'views'>('score')
  const [selectedId, setSelectedId] = useState('')

  const scored = useMemo(() => {
    const eligible = novels.filter(n => !n.fiction_url.includes('/fiction/183032') && !n.title.toLowerCase().includes('dungeons in denver'))
    const rows = eligible.map(novel => {
      const snapshot = latestByNovel.get(novel.id)
      const values = Object.fromEntries(METRICS.map(m => [m.key, metricValue(novel, snapshot, m.key)])) as Record<MetricKey, number | null>
      return { novel, snapshot, age: ageOf(novel.published_at), values, score: null as number | null, percentile: null as number | null, coverage: 0, grade: 'N/A' }
    })
    for (const component of SCORE_WEIGHTS) {
      const available = rows.map(r => r.values[component.key]).filter((v): v is number => v != null && Number.isFinite(v))
      for (const row of rows) {
        const value = row.values[component.key]
        if (value == null || !available.length) continue
        const pct = percentileRank(available, value)
        if (pct != null) {
          const current = (row as any)._weighted || 0
          ;(row as any)._weighted = current + pct * component.weight
          ;(row as any)._weight = ((row as any)._weight || 0) + component.weight
          row.coverage++
        }
      }
    }
    for (const row of rows) {
      const weight = (row as any)._weight || 0
      row.score = weight ? (row as any)._weighted / weight : null
      row.grade = gradeFor(row.score)
    }
    const scoredValues = rows.map(r => r.score).filter((v): v is number => v != null)
    for (const row of rows) row.percentile = row.score == null ? null : percentileRank(scoredValues, row.score)
    return rows.sort((a,b) => (b.score ?? -1) - (a.score ?? -1))
  }, [novels, latestByNovel])

  const genres = [...new Set(novels.filter(n => !n.fiction_url.includes('/fiction/183032')).flatMap(n => (n.genre || '').split(/[;,]/).map(x => x.trim()).filter(Boolean)))].sort()
  const tags = [...new Set(novels.filter(n => !n.fiction_url.includes('/fiction/183032')).flatMap(n => n.tags || []))].sort()
  const statuses = [...new Set(novels.map(n => n.publication_status).filter((x): x is string => !!x))].sort()
  const filtered = useMemo(() => scored.filter(row => {
    const n = row.novel
    const genreMatches = genreFilter === 'All genres' || (n.genre || '').split(/[;,]/).map(x => x.trim()).includes(genreFilter)
    const tagMatches = tagFilter === 'All tags' || (n.tags || []).includes(tagFilter)
    const statusMatches = statusFilter === 'All statuses' || n.publication_status === statusFilter
    const ageMatches = ageFilter === 'all' || (row.age != null && (ageFilter === '1-30' ? row.age <= 30 : ageFilter === '31-90' ? row.age >= 31 && row.age <= 90 : ageFilter === '91-180' ? row.age >= 91 && row.age <= 180 : row.age >= 181))
    const queryMatches = !search || n.title.toLowerCase().includes(search.toLowerCase()) || (n.author_name || '').toLowerCase().includes(search.toLowerCase())
    return genreMatches && tagMatches && statusMatches && ageMatches && queryMatches
  }), [scored, genreFilter, tagFilter, statusFilter, ageFilter, search])
  const selected = filtered.find(r => r.novel.id === selectedId) || filtered[0]
  const metricValues = filtered.map(r => r.values[metricKey]).filter((v): v is number => v != null)
  const selectedMetric = selected?.values[metricKey] ?? null
  const metricPct = selectedMetric == null ? null : percentileRank(metricValues, selectedMetric)
  const mean = metricValues.length ? metricValues.reduce((a,b) => a+b,0) / metricValues.length : null
  const sorted = [...filtered].sort((a,b) => {
    const av = sortBy === 'score' ? a.score : sortBy === 'percentile' ? a.percentile : sortBy === 'followers' ? a.values.followers : a.values.average_views
    const bv = sortBy === 'score' ? b.score : sortBy === 'percentile' ? b.percentile : sortBy === 'followers' ? b.values.followers : b.values.average_views
    return (bv ?? -1) - (av ?? -1)
  })
  const chartData = filtered.flatMap(r => r.score == null ? [] : [{ name: r.novel.title, score: Number(r.score.toFixed(2)) }])
  const scatterData = filtered.flatMap(r => r.values.average_views == null || r.values.followers == null ? [] : [{ x: r.values.average_views, y: r.values.followers, name: r.novel.title }])
  const selectedCount = scored.length
  const withScores = scored.filter(r => r.score != null).length

  return <div className="benchmark-explorer">
    <div className="page-heading"><div><p className="eyebrow">CATALOGUE-POWERED ANALYTICS</p><h1>Novel performance</h1><p className="muted">The benchmark is calculated directly from your Catalogue. Import more novels to expand the comparison set.</p></div></div>
    <div className="stat-grid">
      <div className="stat-card"><div className="stat-top"><span>Benchmark novels</span></div><strong>{fmt(selectedCount)}</strong><small>Catalogue records, excluding your own fiction</small></div>
      <div className="stat-card"><div className="stat-top"><span>Scored novels</span></div><strong>{fmt(withScores)}</strong><small>Have at least one score component</small></div>
      <div className="stat-card"><div className="stat-top"><span>Mean performance score</span></div><strong>{withScores ? fmt(scored.reduce((sum,r)=>sum+(r.score ?? 0),0)/withScores) : '—'}</strong><small>0–100 relative composite</small></div>
      <div className="stat-card"><div className="stat-top"><span>Latest data</span></div><strong>{fmt(scored.filter(r=>r.snapshot).length)}</strong><small>Novels with metric snapshots</small></div>
    </div>
    <div className="panel">
      <div className="benchmark-controls">
        <label>Search catalogue<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Title or author"/></label>
        <label>Genre<select value={genreFilter} onChange={e=>setGenreFilter(e.target.value)}><option>All genres</option>{genres.map(g=><option key={g}>{g}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option>All statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Tag<select value={tagFilter} onChange={e=>setTagFilter(e.target.value)}><option>All tags</option>{tags.map(t=><option key={t}>{t}</option>)}</select></label>
        <label>Age cohort<select value={ageFilter} onChange={e=>setAgeFilter(e.target.value)}><option value="all">All ages</option><option value="1-30">1–30 days</option><option value="31-90">31–90 days</option><option value="91-180">91–180 days</option><option value="181+">181+ days</option></select></label>
        <label>Metric to inspect<select value={metricKey} onChange={e=>setMetricKey(e.target.value as MetricKey)}>{METRICS.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
      </div>
      <div className="benchmark-kpis">
        <div><span>Comparison records</span><strong>{filtered.length}</strong></div>
        <div><span>Mean {METRICS.find(m=>m.key===metricKey)?.label}</span><strong>{fmt(mean)}</strong></div>
        <div><span>Median</span><strong>{fmt(metricValues.length ? [...metricValues].sort((a,b)=>a-b)[Math.floor(metricValues.length/2)] : null)}</strong></div>
        <div><span>Metric coverage</span><strong>{metricValues.length} / {filtered.length}</strong></div>
      </div>
      {selected && <div className="benchmark-position benchmark-percentile"><div><b>{selected.novel.title}</b><span>Selected catalogue novel · {selected.snapshot ? 'Latest snapshot: ' + new Date(selected.snapshot.captured_at).toLocaleDateString() : 'No metric snapshot'}</span></div><div className="percentile-score">{selected.score == null ? '—' : selected.score.toFixed(1) + ' / 100'}<small>overall performance score · Grade {selected.grade}</small></div><div className="percentile-detail">{selected.percentile == null ? 'Overall percentile unavailable' : selected.percentile.toFixed(1) + 'th percentile overall'}<br/>{metricPct == null ? 'Selected metric percentile unavailable' : metricPct.toFixed(1) + 'th percentile for ' + (METRICS.find(m=>m.key===metricKey)?.label || 'metric')}</div></div>}
      <p className="benchmark-note">The composite score and overall percentile are calculated against the full eligible Catalogue set; filters only narrow the visible table and metric comparison. The overall score is a weighted average of each available metric's percentile: followers 25%, average views 20%, follower-to-average-view ratio 20%, rating 15%, ratings count 10%, and favorites 10%. Missing components are excluded and the remaining weights are renormalized. This measures relative platform performance, not literary quality. Grade bands: A ≥90, B ≥80, C ≥70, D ≥60, E below 60.</p>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h2>Overall score distribution</h2><p>Composite score for each novel in the current comparison set.</p></div></div>
      <div className="benchmark-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#293342"/><XAxis dataKey="name" hide/><YAxis domain={[0,100]} tick={{fill:'#93a0b2',fontSize:10}}/><Tooltip contentStyle={{background:'#151e2a',border:'1px solid #344154',borderRadius:8,color:'#eef2f7'}}/><Bar dataKey="score" name="Performance score" fill="#78bfa0"/></BarChart></ResponsiveContainer></div>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h2>Followers vs. average views</h2><p>Each point represents one Catalogue novel.</p></div></div>
      <div className="benchmark-chart"><ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{top:16,right:20,bottom:24,left:8}}><CartesianGrid strokeDasharray="3 3" stroke="#293342"/><XAxis type="number" dataKey="x" name="Average views" tick={{fill:'#93a0b2',fontSize:10}}/><YAxis type="number" dataKey="y" name="Followers" tick={{fill:'#93a0b2',fontSize:10}}/><Tooltip cursor={{strokeDasharray:'3 3'}} contentStyle={{background:'#151e2a',border:'1px solid #344154',borderRadius:8,color:'#eef2f7'}}/><Scatter name="Catalogue novels" data={scatterData} fill="#78bfa0" fillOpacity={0.65}/></ScatterChart></ResponsiveContainer></div>
      <p className="benchmark-note">{scatterData.length} novels have both metrics available.</p>
    </div>
    <div className="panel">
      <div className="panel-heading"><div><h2>Novel rankings</h2><p>Every novel receives one composite score and an overall percentile.</p></div><label>Sort by<select value={sortBy} onChange={e=>setSortBy(e.target.value as typeof sortBy)}><option value="score">Performance score</option><option value="percentile">Percentile</option><option value="followers">Followers</option><option value="views">Average views</option></select></label></div>
      <div className="table-wrap"><table><thead><tr><th>Overall rank</th><th>Novel</th><th>Score / 100</th><th>Grade</th><th>Overall percentile</th><th>Followers</th><th>Avg. views</th><th>Follower ratio</th><th>Coverage</th></tr></thead><tbody>{sorted.map(row=><tr key={row.novel.id} onClick={()=>setSelectedId(row.novel.id)} style={{cursor:'pointer',background:selected?.novel.id===row.novel.id?'#202e39':undefined}}><td>{scored.findIndex(item=>item.novel.id===row.novel.id)+1}</td><td><a className="novel-title" href={row.novel.fiction_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>{row.novel.title}</a><small>{row.novel.author_name || 'Unknown author'}</small></td><td>{row.score == null ? '—' : row.score.toFixed(1)}</td><td>{row.grade}</td><td>{row.percentile == null ? '—' : row.percentile.toFixed(1) + 'th'}</td><td>{fmt(row.values.followers)}</td><td>{fmt(row.values.average_views)}</td><td>{row.values.follow_rate == null ? '—' : row.values.follow_rate.toFixed(2)+'%'}</td><td>{row.coverage} / {SCORE_WEIGHTS.length}</td></tr>)}</tbody></table></div>
      {!sorted.length && <p className="muted">No Catalogue novels match these filters. Import novels or adjust the filters.</p>}
    </div>
  </div>
}
