import { useCallback, useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import {
  Activity, BookOpen, ChartNoAxesCombined, ChevronRight, CircleHelp, CloudUpload,
  Database, Eye, Heart, LogOut, Plus, RefreshCw, Search, ShieldCheck, Star,
  Users, X, Globe
} from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'

type Novel = {
  id: string; fiction_url: string; title: string; author_name: string | null;
  genre: string | null; publication_status: string | null; chapter_count: number | null;
  page_count: number | null; published_at: string | null; tags: string[];
}
type Snapshot = {
  id: string; novel_id: string; captured_at: string; views: number | null;
  followers: number | null; favorites: number | null; rating: number | null;
  rating_count: number | null; review_count: number | null; average_views: number | null;
  chapters: number | null; pages: number | null;
}
type Tab = 'overview' | 'catalogue' | 'watchlist' | 'import' | 'scrape' | 'statistics'
type ImportRow = Record<string, unknown>

const numberValue = (v: unknown): number | null => {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) && n >= 0 ? n : null
}
const textValue = (v: unknown): string | null => v == null || String(v).trim() === '' ? null : String(v).trim()
const urlValue = (v: unknown) => {
  const raw = textValue(v)
  if (!raw) return null
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://www.royalroad.com${raw.startsWith('/') ? '' : '/'}${raw}`)
    if (!['royalroad.com', 'www.royalroad.com'].includes(u.hostname)) return null
    return u.toString()
  } catch { return null }
}
const metricKeys = ['views','followers','favorites','rating','rating_count','review_count','average_views','chapters','pages']
const fmt = (n: number | null | undefined) => n == null ? '—' : Intl.NumberFormat('en-US', { notation: n >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)
const dateFmt = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString() : '—'
const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((x, y) => x - y)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const ageBand = (days: number | null) => {
  if (days === null || days < 0) return 'Unknown'
  if (days <= 30) return '1–30 days'
  if (days <= 90) return '31–90 days'
  if (days <= 180) return '91–180 days'
  if (days <= 365) return '181–365 days'
  return '366+ days'
}

export default function App() {
  const [session, setSession] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [canResendConfirmation, setCanResendConfirmation] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [novels, setNovels] = useState<Novel[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [watchIds, setWatchIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportRow[]>([])
  const [importError, setImportError] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [watchImported, setWatchImported] = useState(false)
  const [scrapeInput, setScrapeInput] = useState('')
  const [scrapeBusy, setScrapeBusy] = useState(false)
  const [scrapeProgress, setScrapeProgress] = useState({ done: 0, total: 0 })
  const [watchScraped, setWatchScraped] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!supabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => listener.subscription.unsubscribe()
  }, [])

  const loadData = useCallback(async () => {
    if (!session?.user?.id) return
    setLoading(true)
    const uid = session.user.id
    const [n, s, w] = await Promise.all([
      supabase.from('novels').select('id,fiction_url,title,author_name,genre,publication_status,chapter_count,page_count,published_at,tags').eq('user_id', uid).order('updated_at', { ascending: false }),
      supabase.from('metric_snapshots').select('id,novel_id,captured_at,views,followers,favorites,rating,rating_count,review_count,average_views,chapters,pages').eq('user_id', uid).order('captured_at', { ascending: false }),
      supabase.from('watchlist').select('novel_id').eq('user_id', uid).eq('enabled', true),
    ])
    if (n.error || s.error || w.error) setNotice(n.error?.message || s.error?.message || w.error?.message || 'Could not load data.')
    else {
      setNovels((n.data || []) as Novel[])
      setSnapshots((s.data || []) as Snapshot[])
      setWatchIds((w.data || []).map(x => x.novel_id))
    }
    setLoading(false)
  }, [session])

  useEffect(() => { void loadData() }, [loadData])

  const latestByNovel = useMemo(() => {
    const map = new Map<string, Snapshot>()
    for (const s of snapshots) if (!map.has(s.novel_id)) map.set(s.novel_id, s)
    return map
  }, [snapshots])
  const previousByNovel = useMemo(() => {
    const map = new Map<string, Snapshot>()
    const seen = new Set<string>()
    for (const snapshot of snapshots) {
      if (seen.has(snapshot.novel_id) && !map.has(snapshot.novel_id)) map.set(snapshot.novel_id, snapshot)
      seen.add(snapshot.novel_id)
    }
    return map
  }, [snapshots])

  const filteredNovels = useMemo(() => novels.filter(n => {
    const q = search.toLowerCase()
    return !q || n.title.toLowerCase().includes(q) || (n.author_name || '').toLowerCase().includes(q)
  }), [novels, search])

  const benchmarkNovels = useMemo(() => novels.filter(n =>
    !n.fiction_url.includes('/fiction/183032') &&
    !n.title.toLowerCase().includes("dungeons in denver")
  ), [novels])

  const latestMetrics = useMemo(() => benchmarkNovels.map(n => latestByNovel.get(n.id)).filter(Boolean) as Snapshot[], [benchmarkNovels, latestByNovel])
  const growthRows = useMemo(() => benchmarkNovels.flatMap(n => {
    const latest = latestByNovel.get(n.id)
    const previous = previousByNovel.get(n.id)
    if (!latest || !previous) return []
    return [{
      novel: n,
      latest,
      previous,
      followerChange: latest.followers !== null && previous.followers !== null ? latest.followers - previous.followers : null,
      viewChange: latest.views !== null && previous.views !== null ? latest.views - previous.views : null,
    }]
  }), [benchmarkNovels, latestByNovel, previousByNovel])
  const ageAdjustedRows = useMemo(() => {
    const rows = benchmarkNovels.flatMap(n => {
      const snapshot = latestByNovel.get(n.id)
      if (!snapshot) return []
      const publishedTime = n.published_at ? new Date(n.published_at).getTime() : NaN
      const ageDays = Number.isFinite(publishedTime) ? Math.floor((Date.now() - publishedTime) / 86400000) : null
      return [{
        novel: n,
        snapshot,
        ageDays,
        cohort: ageBand(ageDays),
        conversion: snapshot.average_views && snapshot.average_views > 0 && snapshot.followers !== null
          ? snapshot.followers / snapshot.average_views
          : null,
      }]
    })
    return rows.map(row => {
      const peers = rows.filter(peer => peer.cohort === row.cohort)
      const atOrBelow = peers.filter(peer => (peer.snapshot.followers || 0) <= (row.snapshot.followers || 0)).length
      return { ...row, percentile: peers.length ? Math.round((atOrBelow / peers.length) * 100) : null }
    })
  }, [benchmarkNovels, latestByNovel])
  const cohortStats = useMemo(() => {
    const bands = ['1–30 days', '31–90 days', '91–180 days', '181–365 days', '366+ days', 'Unknown']
    return bands.map(cohort => {
      const rows = ageAdjustedRows.filter(row => row.cohort === cohort)
      return {
        cohort,
        count: rows.length,
        followers: median(rows.map(row => row.snapshot.followers).filter((v): v is number => v !== null)),
        averageViews: median(rows.map(row => row.snapshot.average_views).filter((v): v is number => v !== null)),
        conversion: median(rows.map(row => row.conversion).filter((v): v is number => v !== null)),
      }
    }).filter(row => row.count > 0)
  }, [ageAdjustedRows])
  const totals = useMemo(() => ({
    views: latestMetrics.reduce((a, s) => a + (s.views || 0), 0),
    followers: latestMetrics.reduce((a, s) => a + (s.followers || 0), 0),
    favorites: latestMetrics.reduce((a, s) => a + (s.favorites || 0), 0),
  }), [latestMetrics])

  const emailRedirectTo = () => window.location.origin + '/'

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setAuthBusy(true); setAuthError(''); setAuthNotice(''); setCanResendConfirmation(false)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      setAuthError(error.message)
      if (error.message.toLowerCase().includes('email not confirmed')) setCanResendConfirmation(true)
    }
    setAuthBusy(false)
  }

  async function signUp() {
    if (!email.trim() || !password) {
      setAuthError('Enter an email address and password first.')
      return
    }
    setAuthBusy(true); setAuthError(''); setAuthNotice(''); setCanResendConfirmation(false)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: emailRedirectTo() },
    })
    if (error) {
      setAuthError(error.message)
    } else if (data.session) {
      setAuthNotice('Account created and signed in.')
    } else {
      setAuthNotice('Signup accepted. Check your inbox and spam folder for the confirmation email, then open its link on this site.')
      setCanResendConfirmation(true)
    }
    setAuthBusy(false)
  }

  async function resendConfirmation() {
    if (!email.trim()) {
      setAuthError('Enter the email address you used to sign up.')
      return
    }
    setAuthBusy(true); setAuthError(''); setAuthNotice('')
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: { emailRedirectTo: emailRedirectTo() },
    })
    if (error) setAuthError(error.message)
    else setAuthNotice('If this address has a pending signup, Supabase has accepted a new confirmation request. Check your inbox and spam folder.')
    setAuthBusy(false)
  }
  async function signOut() { await supabase.auth.signOut(); setNovels([]); setSnapshots([]); setWatchIds([]) }

  function chooseFile(next: File | null) {
    setFile(next); setPreview([]); setImportError('')
    if (!next) return
    Papa.parse<ImportRow>(next, {
      header: true, skipEmptyLines: true, transformHeader: h => h.trim().toLowerCase().replace(/[ -]+/g, '_'),
      complete: result => {
        if (result.errors.length) setImportError(result.errors[0].message)
        else if (result.data.length > 500) setImportError(`This batch has ${result.data.length} rows. The limit is 500 per import.`)
        else if (!result.meta.fields?.some(k => ['url','fiction_url'].includes(k))) setImportError('CSV needs a url or fiction_url column.')
        else setPreview(result.data)
      },
      error: err => setImportError(err.message),
    })
  }

  async function runImport() {
    if (!session?.user?.id || !preview.length) return
    setImportBusy(true); setImportError(''); setNotice('')
    const uid = session.user.id
    const runResult = await supabase.from('ingestion_runs').insert({ user_id: uid, source_type: 'csv_import', source_label: file?.name || 'CSV upload' }).select('id').single()
    if (runResult.error) { setImportError(runResult.error.message); setImportBusy(false); return }
    const runId = runResult.data.id
    let created = 0, updated = 0, skipped = 0, failures = 0
    const errors: { user_id: string; run_id: string; row_number: number; fiction_url: string | null; error_code: string; error_message: string; raw_row: ImportRow }[] = []
    const records: any[] = []
    const sourceRows: { row: ImportRow; url: string }[] = []
    const seenUrls = new Set<string>()
    preview.forEach((row, i) => {
      const url = urlValue(row.url ?? row.fiction_url)
      if (!url) { skipped++; errors.push({ user_id: uid, run_id: runId, row_number: i + 2, fiction_url: null, error_code: 'INVALID_URL', error_message: 'Missing or invalid Royal Road fiction URL.', raw_row: row }); return }
      if (seenUrls.has(url)) { skipped++; errors.push({ user_id: uid, run_id: runId, row_number: i + 2, fiction_url: url, error_code: 'DUPLICATE_URL', error_message: 'Duplicate URL within this CSV batch; first occurrence was kept.', raw_row: row }); return }
      seenUrls.add(url)
      const title = textValue(row.title) || url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Untitled novel'
      const tags = textValue(row.tags)?.split(/[;,]/).map(x => x.trim()).filter(Boolean) || []
      records.push({ user_id: uid, fiction_url: url, title, author_name: textValue(row.author ?? row.author_name), published_at: textValue(row.published_at), genre: textValue(row.genre), tags, publication_status: textValue(row.status ?? row.publication_status), chapter_count: numberValue(row.chapters ?? row.chapter_count), page_count: numberValue(row.pages ?? row.page_count), last_seen_at: new Date().toISOString() })
      sourceRows.push({ row, url })
    })
    try {
      const existing = await supabase.from('novels').select('id,fiction_url').eq('user_id', uid).in('fiction_url', records.map(x => x.fiction_url))
      if (existing.error) throw existing.error
      const existed = new Set((existing.data || []).map(x => x.fiction_url))
      for (const r of records) existed.has(r.fiction_url) ? updated++ : created++
      if (records.length) {
        const upsert = await supabase.from('novels').upsert(records, { onConflict: 'user_id,fiction_url' })
        if (upsert.error) throw upsert.error
      }
      const saved = records.length ? await supabase.from('novels').select('id,fiction_url').eq('user_id', uid).in('fiction_url', records.map(x => x.fiction_url)) : { data: [], error: null }
      if (saved.error) throw saved.error
      const idByUrl = new Map((saved.data || []).map(x => [x.fiction_url, x.id]))
      const snapshotRows: any[] = []
      const exclusionRows: any[] = []
      const watchRows: any[] = []
      sourceRows.forEach(({ row, url }) => {
        const novelId = idByUrl.get(url)
        if (!novelId) return
        const metrics: Record<string, number | null> = {
          views: numberValue(row.views), followers: numberValue(row.followers), favorites: numberValue(row.favorites),
          rating: numberValue(row.rating), rating_count: numberValue(row.rating_count), review_count: numberValue(row.review_count),
          average_views: numberValue(row.average_views), chapters: numberValue(row.chapters ?? row.chapter_count), pages: numberValue(row.pages ?? row.page_count),
        }
        if (metricKeys.some(k => metrics[k] !== null)) snapshotRows.push({ user_id: uid, novel_id: novelId, source_type: 'csv_import', ...metrics })
        const title = String(row.title || '').toLowerCase()
        if (url.includes('/fiction/183032') || title.includes('dungeons in denver')) exclusionRows.push({ user_id: uid, novel_id: novelId, reason: 'User-owned novel; excluded from benchmark calculations.' })
        if (watchImported) watchRows.push({ user_id: uid, novel_id: novelId, cadence: 'weekly', enabled: true })
      })
      if (snapshotRows.length) { const x = await supabase.from('metric_snapshots').insert(snapshotRows); if (x.error) throw x.error }
      if (exclusionRows.length) { const x = await supabase.from('benchmark_exclusions').upsert(exclusionRows, { onConflict: 'user_id,novel_id' }); if (x.error) throw x.error }
      if (watchRows.length) { const x = await supabase.from('watchlist').upsert(watchRows, { onConflict: 'user_id,novel_id' }); if (x.error) throw x.error }
    } catch (err) {
      failures = records.length
      const message = err instanceof Error ? err.message : 'Import failed.'
      errors.push({ user_id: uid, run_id: runId, row_number: 0, fiction_url: null, error_code: 'IMPORT_FAILED', error_message: message, raw_row: {} })
    }
    if (errors.length) await supabase.from('ingestion_run_errors').insert(errors)
    await supabase.from('ingestion_runs').update({
      finished_at: new Date().toISOString(), records_seen: preview.length, records_created: created,
      records_updated: updated, records_skipped: skipped, failures,
      run_status: failures ? 'completed_with_errors' : errors.length ? 'completed_with_errors' : 'completed',
    }).eq('id', runId)
    if (!failures) {
      setNotice(`Import complete: ${created} new, ${updated} updated, ${skipped} skipped; ${preview.length} rows processed.`)
      setPreview([]); setFile(null); setTab('catalogue'); await loadData()
    } else setImportError('Import failed: ' + (errors[errors.length - 1]?.error_message || 'unknown error'))
    setImportBusy(false)
  }

  async function runScrape() {
    if (!session?.user?.id || scrapeBusy) return
    const urls = [...new Set(scrapeInput.split(/[\\s,]+/).map(value => value.trim()).filter(Boolean))]
    if (!urls.length) { setImportError('Enter at least one Royal Road fiction URL.'); return }
    if (urls.length > 500) { setImportError('The limit is 500 fiction URLs per scrape batch.'); return }
    setScrapeBusy(true); setImportError(''); setNotice('')
    setScrapeProgress({ done: 0, total: urls.length })
    const uid = session.user.id
    const runResult = await supabase.from('ingestion_runs')
      .insert({ user_id: uid, source_type: 'royalroad_scrape', source_label: 'Manual Royal Road scrape' })
      .select('id').single()
    if (runResult.error) { setImportError(runResult.error.message); setScrapeBusy(false); return }
    const runId = runResult.data.id
    const novelsFound: any[] = []
    const snapshotsFound: any[] = []
    const errors: any[] = []
    let stoppedByAccess = false
    for (let i = 0; i < urls.length; i++) {
      const raw = urls[i]
      try {
        const normalized = raw.startsWith('http') ? raw : 'https://' + raw
        const response = await fetch('/api/royalroad', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ url: normalized }),
        })
        const result = await response.json()
        if (!response.ok || !result.ok) {
          errors.push({ user_id: uid, run_id: runId, row_number: i + 1, fiction_url: normalized, error_code: result.status === 403 ? 'HTTP_403' : result.status === 429 ? 'HTTP_429' : 'SCRAPE_FAILED', error_message: result.error || 'Scrape failed.', raw_row: { url: normalized, status: result.status || response.status } })
          if (result.status === 403 || result.status === 429) { stoppedByAccess = true; break }
        } else {
          novelsFound.push({ ...result.novel, user_id: uid, last_seen_at: new Date().toISOString() })
          if (result.metrics) snapshotsFound.push({ url: result.novel.fiction_url, metrics: result.metrics })
          if (result.note) errors.push({ user_id: uid, run_id: runId, row_number: i + 1, fiction_url: normalized, error_code: 'PARTIAL_METADATA', error_message: result.note, raw_row: { url: normalized } })
        }
      } catch (error) {
        errors.push({ user_id: uid, run_id: runId, row_number: i + 1, fiction_url: raw, error_code: 'NETWORK_ERROR', error_message: error instanceof Error ? error.message : 'Network request failed.', raw_row: { url: raw } })
      }
      setScrapeProgress({ done: i + 1, total: urls.length })
      // Keep requests sequential and paced; do not parallelize requests to Royal Road.
      if (i < urls.length - 1) await new Promise(resolve => setTimeout(resolve, 900))
    }
    let created = 0, updated = 0, failures = 0
    try {
      const uniqueNovels = [...new Map(novelsFound.map(n => [n.fiction_url, n])).values()]
      const urlsToSave = uniqueNovels.map(n => n.fiction_url)
      const existing = urlsToSave.length
        ? await supabase.from('novels').select('id,fiction_url').eq('user_id', uid).in('fiction_url', urlsToSave)
        : { data: [], error: null }
      if (existing.error) throw existing.error
      const existed = new Set((existing.data || []).map(x => x.fiction_url))
      uniqueNovels.forEach(n => existed.has(n.fiction_url) ? updated++ : created++)
      if (uniqueNovels.length) {
        const saved = await supabase.from('novels').upsert(uniqueNovels, { onConflict: 'user_id,fiction_url' })
        if (saved.error) throw saved.error
      }
      const savedRows = urlsToSave.length
        ? await supabase.from('novels').select('id,fiction_url').eq('user_id', uid).in('fiction_url', urlsToSave)
        : { data: [], error: null }
      if (savedRows.error) throw savedRows.error
      const idByUrl = new Map((savedRows.data || []).map(x => [x.fiction_url, x.id]))
      const metricRows = snapshotsFound.flatMap(item => {
        const novelId = idByUrl.get(item.url)
        if (!novelId) return []
        const metrics = item.metrics
        return Object.values(metrics).some(value => value !== null)
          ? [{ user_id: uid, novel_id: novelId, source_type: 'royalroad_scrape', ...metrics }]
          : []
      })
      if (metricRows.length) {
        const savedMetrics = await supabase.from('metric_snapshots').insert(metricRows)
        if (savedMetrics.error) throw savedMetrics.error
      }
      const excluded = uniqueNovels.filter(n => n.source_id === '183032' || n.fiction_url.includes('/fiction/183032') || n.title.toLowerCase().includes('dungeons in denver'))
      if (excluded.length) {
        const exclusionRows = excluded.map(n => ({ user_id: uid, novel_id: idByUrl.get(n.fiction_url), reason: 'User-owned novel; excluded from benchmark calculations.' }))
        const savedExclusions = await supabase.from('benchmark_exclusions').upsert(exclusionRows, { onConflict: 'user_id,novel_id' })
        if (savedExclusions.error) throw savedExclusions.error
      }
      if (watchScraped && urlsToSave.length) {
        const watchRows = urlsToSave.map(url => ({ user_id: uid, novel_id: idByUrl.get(url), cadence: 'weekly', enabled: true }))
        const savedWatch = await supabase.from('watchlist').upsert(watchRows, { onConflict: 'user_id,novel_id' })
        if (savedWatch.error) throw savedWatch.error
      }
    } catch (error) {
      failures = novelsFound.length
      errors.push({ user_id: uid, run_id: runId, row_number: 0, fiction_url: null, error_code: 'SAVE_FAILED', error_message: error instanceof Error ? error.message : 'Could not save scraped records.', raw_row: {} })
    }
    if (errors.length) await supabase.from('ingestion_run_errors').insert(errors)
    await supabase.from('ingestion_runs').update({
      finished_at: new Date().toISOString(), records_seen: urls.length,
      records_created: created, records_updated: updated, records_skipped: urls.length - novelsFound.length,
      failures, run_status: failures || errors.length ? 'completed_with_errors' : 'completed',
    }).eq('id', runId)
    await loadData()
    setNotice(`Scrape finished: ${created} new novels, ${updated} updated, ${snapshotsFound.length} metric captures, ${errors.length} issues.${stoppedByAccess ? ' Stopped because Royal Road denied or rate-limited access.' : ''}`)
    setScrapeBusy(false)
    if (novelsFound.length) setTab('catalogue')
  }

  async function toggleWatch(novelId: string) {
    if (!session?.user?.id) return
    const isWatching = watchIds.includes(novelId)
    const result = isWatching
      ? await supabase.from('watchlist').delete().eq('user_id', session.user.id).eq('novel_id', novelId)
      : await supabase.from('watchlist').upsert({ user_id: session.user.id, novel_id: novelId, enabled: true, cadence: 'weekly' }, { onConflict: 'user_id,novel_id' })
    if (result.error) setNotice(result.error.message)
    else setWatchIds(old => isWatching ? old.filter(x => x !== novelId) : [...old, novelId])
  }

  if (!supabaseConfigured) return <div className="setup"><div className="auth-card"><Database size={30}/><h1>Connect Supabase</h1><p>Add your project URL and publishable key to <code>.env.local</code> using <code>.env.example</code>.</p></div></div>
  if (!session) return <div className="setup"><form className="auth-card" onSubmit={signIn}>
    <div className="brand-mark"><BookOpen/></div><p className="eyebrow">ROYAL ROAD ANALYTICS</p><h1>Your catalogue,<br/>with history.</h1>
    <p className="muted">Sign in to manage your novels and track their growth over time.</p>
    <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label>
    <label>Password<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 6 characters"/></label>
    {authError && <p className="error">{authError}</p>}
    {authNotice && <p className="success">{authNotice}</p>}
    <button className="primary full" disabled={authBusy}>{authBusy ? 'Please wait…' : 'Sign in'}</button>
    <button type="button" className="text-button full" disabled={authBusy} onClick={signUp}>Create an account</button>
    {canResendConfirmation && <button type="button" className="text-button full" disabled={authBusy} onClick={resendConfirmation}>Resend confirmation email</button>}
  </form></div>

  const nav: { id: Tab; label: string; icon: typeof Activity }[] = [
    { id: 'overview', label: 'Overview', icon: ChartNoAxesCombined },
    { id: 'catalogue', label: 'Catalogue', icon: BookOpen },
    { id: 'watchlist', label: 'Watchlist', icon: Eye },
    { id: 'import', label: 'CSV import', icon: CloudUpload },
    { id: 'scrape', label: 'Royal Road scraper', icon: Globe },
    { id: 'statistics', label: 'Statistics', icon: Activity },
  ]
  const rows = tab === 'watchlist' ? filteredNovels.filter(n => watchIds.includes(n.id)) : filteredNovels

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><BookOpen size={19}/></div><div><b>Royal Road</b><small>ANALYTICS</small></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{nav.map(item => <button key={item.id} className={tab === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setTab(item.id)}><item.icon size={17}/>{item.label}{item.id === 'watchlist' && <span className="nav-count">{watchIds.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="secure"><ShieldCheck size={15}/><span>Private workspace</span></div><button className="nav-item" onClick={signOut}><LogOut size={17}/>Sign out</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="crumb">Workspace</span><ChevronRight size={14}/><b>{nav.find(x => x.id === tab)?.label}</b></div><div className="top-actions"><span className="user-email">{session.user.email}</span><button className="icon-button" onClick={() => void loadData()} title="Refresh"><RefreshCw size={16}/></button></div></header>
      <div className="content">
        {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}
        {tab === 'overview' && <>
          <div className="page-heading"><div><p className="eyebrow">YOUR ROYAL ROAD DATA</p><h1>Overview</h1><p className="muted">A current snapshot of your catalogue and monitored novels.</p></div><button className="primary" onClick={() => setTab('import')}><Plus size={16}/> Import novels</button></div>
          <div className="stat-grid">
            <Stat icon={BookOpen} label="Catalogue" value={fmt(novels.length)} detail="Total novels saved"/>
            <Stat icon={Eye} label="Tracked novels" value={fmt(watchIds.length)} detail="In your weekly watchlist"/>
            <Stat icon={Activity} label="Total views" value={fmt(totals.views)} detail="Latest available snapshots"/>
            <Stat icon={Users} label="Followers" value={fmt(totals.followers)} detail="Latest available snapshots"/>
          </div>
          <div className="panel"><div className="panel-heading"><div><h2>Recently updated</h2><p>Latest captured metrics per novel</p></div><button className="link-button" onClick={() => setTab('catalogue')}>View catalogue <ChevronRight size={14}/></button></div>
            <NovelTable novels={novels.slice(0,6)} latest={latestByNovel} watchIds={watchIds} onWatch={toggleWatch}/>
            {!novels.length && <Empty title="Your catalogue is empty" text="Import a CSV containing Royal Road fiction URLs to get started." action="Import novels" onClick={() => setTab('import')}/>}
          </div>
          <div className="info-strip"><CircleHelp size={17}/><span><b>Benchmark rule:</b> Dungeons in Denver is excluded from general catalogue totals and benchmark calculations.</span></div>
        </>}
        {(tab === 'catalogue' || tab === 'watchlist') && <>
          <div className="page-heading"><div><p className="eyebrow">LIBRARY</p><h1>{tab === 'catalogue' ? 'Novel catalogue' : 'Weekly watchlist'}</h1><p className="muted">{tab === 'catalogue' ? 'Every novel imported into your workspace.' : 'Novels selected for recurring metric updates.'}</p></div><button className="primary" onClick={() => setTab('import')}><Plus size={16}/> Import novels</button></div>
          <div className="toolbar"><div className="search-box"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search title or author…"/></div><span className="muted small">{rows.length} novels</span></div>
          <div className="panel"><NovelTable novels={rows} latest={latestByNovel} watchIds={watchIds} onWatch={toggleWatch}/>{!rows.length && <Empty title={tab === 'watchlist' ? 'Nothing monitored yet' : 'No novels found'} text="Import novels, then add the ones you want to monitor to your watchlist." action="Import novels" onClick={() => setTab('import')}/>}</div>
        </>}
        {tab === 'import' && <>
          <div className="page-heading"><div><p className="eyebrow">DATA INGESTION</p><h1>Import novels</h1><p className="muted">Upload a CSV export. Each batch supports up to 500 novels.</p></div></div>
          <div className="import-layout"><div className="panel import-panel">
            <h2>Upload CSV</h2><p className="muted">Required: <code>url</code> or <code>fiction_url</code>. Other fields are optional.</p>
            <label className="dropzone"><CloudUpload size={28}/><b>{file ? file.name : 'Choose a CSV file'}</b><span>{file ? `${preview.length} rows detected` : 'Select a file from your device'}</span><input type="file" accept=".csv,text/csv" onChange={e => chooseFile(e.target.files?.[0] || null)}/></label>
            <label className="check-row"><input type="checkbox" checked={watchImported} onChange={e => setWatchImported(e.target.checked)}/> Add imported novels to weekly watchlist</label>
            {importError && <p className="error">{importError}</p>}
            <button className="primary full" disabled={!preview.length || importBusy || !!importError} onClick={() => void runImport()}>{importBusy ? 'Importing…' : `Import ${preview.length || 0} novels`}</button>
          </div><div className="panel"><h2>Supported columns</h2><div className="field-list">{['url (required)','title','author','published_at','genre','tags','status','chapters','pages','views','followers','favorites','rating','rating_count','review_count','average_views'].map(x => <code key={x}>{x}</code>)}</div><div className="info-strip compact"><ShieldCheck size={16}/><span>CSV imports are stored under your account. Snapshots are preserved as history, not overwritten.</span></div></div></div>
          {preview.length > 0 && <div className="panel preview-panel"><div className="panel-heading"><div><h2>Import preview</h2><p>Showing the first five rows.</p></div><span className="pill">{preview.length} rows</span></div><div className="table-wrap"><table><thead><tr><th>Title</th><th>Author</th><th>Views</th><th>Followers</th><th>Rating</th></tr></thead><tbody>{preview.slice(0,5).map((r,i)=><tr key={i}><td>{String(r.title || r.url || r.fiction_url || '—')}</td><td>{String(r.author || '—')}</td><td>{fmt(numberValue(r.views))}</td><td>{fmt(numberValue(r.followers))}</td><td>{fmt(numberValue(r.rating))}</td></tr>)}</tbody></table></div></div>}
        </>}
        {tab === 'scrape' && <>
          <div className="page-heading"><div><p className="eyebrow">DATA INGESTION</p><h1>Royal Road scraper</h1><p className="muted">Fetch public fiction pages and save the metadata and metrics that are visible to this server.</p></div></div>
          <div className="import-layout">
            <div className="panel import-panel">
              <h2>Fiction URLs</h2>
              <p className="muted">Paste one Royal Road fiction URL per line. Up to 500 per batch. Requests are made sequentially with a delay.</p>
              <textarea className="scrape-input" value={scrapeInput} onChange={e => setScrapeInput(e.target.value)} placeholder={'https://www.royalroad.com/fiction/12345/example-novel\\nhttps://www.royalroad.com/fiction/67890/another-novel'} disabled={scrapeBusy}/>
              <label className="check-row"><input type="checkbox" checked={watchScraped} onChange={e => setWatchScraped(e.target.checked)} disabled={scrapeBusy}/> Add successfully scraped novels to weekly watchlist</label>
              {scrapeBusy && <div className="scrape-progress"><div><span>Scraping pages</span><b>{scrapeProgress.done} / {scrapeProgress.total}</b></div><div className="progress-track"><i style={{ width: (scrapeProgress.total ? scrapeProgress.done / scrapeProgress.total * 100 : 0) + '%' }}/></div></div>}
              {importError && <p className="error">{importError}</p>}
              <button className="primary full" disabled={scrapeBusy || !scrapeInput.trim()} onClick={() => void runScrape()}>{scrapeBusy ? 'Scraping…' : 'Start scrape'}</button>
            </div>
            <div className="panel">
              <h2>What it collects</h2>
              <div className="field-list">{['Title and author (when exposed)','Publication date and genre (when exposed)','Chapter count and status (when exposed)','Views, followers, favorites and rating (when exposed)','Timestamped metric snapshots'].map(x => <code key={x}>{x}</code>)}</div>
              <div className="info-strip compact"><ShieldCheck size={16}/><span>Only ordinary public-page requests are used. HTTP 403, 429, CAPTCHA and other access denials are respected; no proxy rotation or access-control bypass.</span></div>
              <p className="muted">Royal Road may change its page markup or block server requests. Missing fields are left blank rather than guessed. CSV import remains available as a fallback.</p>
            </div>
          </div>
        </>}
        {tab === 'statistics' && <>
          <div className="page-heading"><div><p className="eyebrow">BENCHMARKS</p><h1>Statistics</h1><p className="muted">Descriptive metrics from the latest imported snapshots.</p></div></div>
          <div className="stat-grid"><Stat icon={BookOpen} label="Benchmark novels" value={fmt(benchmarkNovels.length)} detail="Dungeons in Denver excluded"/><Stat icon={Eye} label="Combined views" value={fmt(totals.views)} detail="Latest snapshots only"/><Stat icon={Users} label="Combined followers" value={fmt(totals.followers)} detail="Latest snapshots only"/><Stat icon={Heart} label="Combined favorites" value={fmt(totals.favorites)} detail="Latest snapshots only"/></div>
          <div className="panel"><div className="panel-heading"><div><h2>Snapshot coverage</h2><p>How much of your catalogue has metric data.</p></div></div><div className="coverage"><div><b>{latestMetrics.length}</b><span>Novels with metrics</span></div><div><b>{benchmarkNovels.length - latestMetrics.length}</b><span>Without metrics</span></div><div><b>{snapshots.length}</b><span>Total historical snapshots</span></div></div></div>
          <div className="panel">
            <div className="panel-heading"><div><h2>Performance by publication age</h2><p>Cohorts use the imported published_at date and each novel's latest snapshot.</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>Age cohort</th><th>Novels</th><th>Median followers</th><th>Median avg. views</th><th>Median followers / avg. views</th></tr></thead>
              <tbody>{cohortStats.map(row => <tr key={row.cohort}><td>{row.cohort}</td><td>{fmt(row.count)}</td><td>{fmt(row.followers)}</td><td>{fmt(row.averageViews)}</td><td>{row.conversion === null ? '—' : (row.conversion * 100).toFixed(2) + '%'}</td></tr>)}</tbody>
            </table></div>
            {!ageAdjustedRows.length && <p className="muted">Import publication dates and metric snapshots to calculate age cohorts.</p>}
          </div>
          <div className="panel">
            <div className="panel-heading"><div><h2>Growth since previous snapshot</h2><p>Change between the two most recent imported snapshots per novel; intervals may differ.</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>Novel</th><th>Latest capture</th><th>Follower change</th><th>View change</th></tr></thead>
              <tbody>{[...growthRows].sort((x,y)=>(y.followerChange ?? -Infinity)-(x.followerChange ?? -Infinity)).slice(0,10).map(row => <tr key={row.novel.id}>
                <td><a className="novel-title" href={row.novel.fiction_url} target="_blank" rel="noreferrer">{row.novel.title}</a><small>{row.novel.author_name || 'Unknown author'}</small></td>
                <td>{dateFmt(row.latest.captured_at)}</td>
                <td>{row.followerChange === null ? '—' : (row.followerChange > 0 ? '+' : '') + fmt(row.followerChange)}</td>
                <td>{row.viewChange === null ? '—' : (row.viewChange > 0 ? '+' : '') + fmt(row.viewChange)}</td>
              </tr>)}</tbody>
            </table></div>
            {!growthRows.length && <p className="muted">A novel needs at least two metric snapshots before its growth can be calculated.</p>}
          </div>
          <div className="panel">
            <div className="panel-heading"><div><h2>Age-adjusted follower ranking</h2><p>Percentile compares followers only against novels in the same age cohort.</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>Novel</th><th>Age</th><th>Followers</th><th>Avg. views</th><th>Follow conversion</th><th>Age percentile</th></tr></thead>
              <tbody>{[...ageAdjustedRows].sort((x,y)=>(y.percentile || 0)-(x.percentile || 0) || (y.snapshot.followers || 0)-(x.snapshot.followers || 0)).slice(0,15).map(row => <tr key={row.novel.id}>
                <td><a className="novel-title" href={row.novel.fiction_url} target="_blank" rel="noreferrer">{row.novel.title}</a><small>{row.novel.author_name || 'Unknown author'}</small></td>
                <td>{row.ageDays === null ? 'Unknown' : fmt(row.ageDays) + 'd'}</td>
                <td>{fmt(row.snapshot.followers)}</td><td>{fmt(row.snapshot.average_views)}</td>
                <td>{row.conversion === null ? '—' : (row.conversion * 100).toFixed(2) + '%'}</td>
                <td>{row.percentile === null ? '—' : row.percentile + 'th'}</td>
              </tr>)}</tbody>
            </table></div>
          </div>
        </>}
        {loading && <div className="loading-line"><RefreshCw size={14}/> Syncing data…</div>}
        <footer>Royal Road Analytics <span>·</span> Private analytics workspace <span>·</span> Data source: user-provided imports</footer>
      </div>
    </main>
  </div>
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string; detail: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{detail}</small></div>
}
function NovelTable({ novels, latest, watchIds, onWatch }: { novels: Novel[]; latest: Map<string, Snapshot>; watchIds: string[]; onWatch: (id: string) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>Novel</th><th>Views</th><th>Followers</th><th>Rating</th><th>Last captured</th><th></th></tr></thead><tbody>{novels.map(n => {
    const s = latest.get(n.id)
    return <tr key={n.id}><td><a className="novel-title" href={n.fiction_url} target="_blank" rel="noreferrer">{n.title}</a><small>{n.author_name || 'Unknown author'}{n.genre ? ` · ${n.genre}` : ''}</small></td><td>{fmt(s?.views)}</td><td>{fmt(s?.followers)}</td><td>{s?.rating == null ? '—' : <span className="rating"><Star size={13} fill="currentColor"/>{s.rating.toFixed(2)}</span>}</td><td>{dateFmt(s?.captured_at)}</td><td><button className={watchIds.includes(n.id) ? 'watch-button watching' : 'watch-button'} onClick={() => onWatch(n.id)} title={watchIds.includes(n.id) ? 'Remove from watchlist' : 'Add to watchlist'}><Eye size={15}/></button></td></tr>
  })}</tbody></table></div>
}
function Empty({ title, text, action, onClick }: { title: string; text: string; action: string; onClick: () => void }) {
  return <div className="empty"><BookOpen size={25}/><b>{title}</b><p>{text}</p><button className="secondary" onClick={onClick}>{action}</button></div>
}
