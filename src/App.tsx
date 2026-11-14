import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import {
  Activity, BookOpen, ChartNoAxesCombined, ChevronRight, CircleHelp, CloudUpload,
  Database, Eye, LogOut, Plus, RefreshCw, Search, ShieldCheck, Star,
  Users, X, Globe
} from 'lucide-react'
import { supabase, supabaseConfigured } from './lib/supabase'
const BenchmarkExplorer = lazy(() => import('./BenchmarkExplorer'))

type Novel = {
  id: string; fiction_url: string; title: string; author_name: string | null;
  genre: string | null; publication_status: string | null; chapter_count: number | null;
  page_count: number | null; published_at: string | null; tags: string[];
}
type Snapshot = {
  id: string; novel_id: string; captured_at: string; views: number | null;
  followers: number | null; favorites: number | null; rating: number | null;
  rating_count: number | null; review_count: number | null; average_views: number | null;
  chapters: number | null; pages: number | null; raw_data: Record<string, unknown> | null;
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
  const [latestPage, setLatestPage] = useState('1')
  const [discoverBusy, setDiscoverBusy] = useState(false)
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
    const pageSize = 1000
    const [n, s, w] = await Promise.all([
      (async () => {
        const all: Novel[] = []
        for (let offset = 0; ; offset += pageSize) {
          const page = await supabase.from('novels').select('id,fiction_url,title,author_name,genre,publication_status,chapter_count,page_count,published_at,tags').eq('user_id', uid).order('updated_at', { ascending: false }).range(offset, offset + pageSize - 1)
          if (page.error) return { data: null, error: page.error }
          all.push(...(page.data || []) as Novel[])
          if (!page.data || page.data.length < pageSize) break
        }
        return { data: all, error: null }
      })(),
      (async () => {
        const all: Snapshot[] = []
        for (let offset = 0; ; offset += pageSize) {
          const page = await supabase.from('metric_snapshots').select('id,novel_id,captured_at,views,followers,favorites,rating,rating_count,review_count,average_views,chapters,pages,raw_data').eq('user_id', uid).order('captured_at', { ascending: false }).range(offset, offset + pageSize - 1)
          if (page.error) return { data: null, error: page.error }
          all.push(...(page.data || []) as Snapshot[])
          if (!page.data || page.data.length < pageSize) break
        }
        return { data: all, error: null }
      })(),
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
  const filteredNovels = useMemo(() => novels.filter(n => {
    const q = search.toLowerCase()
    return !q || n.title.toLowerCase().includes(q) || (n.author_name || '').toLowerCase().includes(q)
  }), [novels, search])

  const benchmarkNovels = useMemo(() => novels.filter(n =>
    !n.fiction_url.includes('/fiction/183032') &&
    !n.title.toLowerCase().includes("dungeons in denver")
  ), [novels])

  const latestMetrics = useMemo(() => benchmarkNovels.map(n => latestByNovel.get(n.id)).filter(Boolean) as Snapshot[], [benchmarkNovels, latestByNovel])
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

  function normalizeImportRows(rows: ImportRow[]) {
    const aliases: Record<string,string> = {
      source_url:'url', fiction_url:'url', royalroad_url:'url', total_views:'views',
      ratings_count:'rating_count', page_count:'pages', words:'word_count',
      overall_rating:'rating', overall_score:'rating', style_rating:'style_score',
      story_rating:'story_score', grammar_rating:'grammar_score', character_rating:'character_score',
      first_published_at:'published_at', authorname:'author', publishedat:'published_at',
      latest_updates_tags:'tags', latest_updates_status:'status', latest_updates_type:'fiction_type'
    }
    return rows.map(source => {
      const row: ImportRow = Object.fromEntries(Object.entries(source).map(([key,value]) => [
        key.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[ -]+/g, '_'), value
      ]))
      for (const [from,to] of Object.entries(aliases)) if (row[to] == null && row[from] != null) row[to] = row[from]
      return row
    })
  }

  const MAX_IMPORT_BYTES = 25 * 1024 * 1024
  const MAX_IMPORT_ROWS = 10000

  function chooseFile(next: File | null) {
    setFile(next); setPreview([]); setImportError('')
    if (!next) return
    if (next.size > MAX_IMPORT_BYTES) {
      setImportError('This file is ' + (next.size / 1024 / 1024).toFixed(1) + ' MB. The current limit is 25 MB.')
      return
    }
    const isJson = next.name.toLowerCase().endsWith('.json') || next.type.includes('json')
    if (isJson) {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result || ''))
          const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.novels) ? parsed.novels : Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.records) ? parsed.records : null
          if (!rows) throw new Error('JSON must contain an array of novels, or a novels/data/records array.')
          if (rows.length > MAX_IMPORT_ROWS) throw new Error('This file contains ' + rows.length.toLocaleString() + ' rows. The current limit is ' + MAX_IMPORT_ROWS.toLocaleString() + '.')
          const normalized = normalizeImportRows(rows as ImportRow[])
          if (!normalized.some(row => row.url || row.fiction_url || row.source_url)) throw new Error('JSON records need a url, fiction_url, or source_url field.')
          setPreview(normalized)
        } catch (error) { setImportError(error instanceof Error ? error.message : 'Could not read this JSON file.') }
      }
      reader.onerror = () => setImportError('Could not read this file.')
      reader.readAsText(next)
      return
    }
    Papa.parse<ImportRow>(next, {
      header: true, skipEmptyLines: true,
      transformHeader: h => h.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[ -]+/g, '_'),
      complete: result => {
        if (result.errors.length) setImportError(result.errors[0].message)
        else if (result.data.length > MAX_IMPORT_ROWS) setImportError('This file contains ' + result.data.length.toLocaleString() + ' rows. The current limit is ' + MAX_IMPORT_ROWS.toLocaleString() + '.')
        else {
          const normalized = normalizeImportRows(result.data)
          if (!normalized.some(row => row.url || row.fiction_url || row.source_url)) setImportError('CSV needs a url, fiction_url, or source_url column. Royal Road scraper exports with sourceUrl are supported.')
          else setPreview(normalized)
        }
      },
      error: err => setImportError(err.message),
    })
  }

  async function runImport() {
    if (!session?.user?.id || !preview.length) return
    setImportBusy(true); setImportError(''); setNotice('')
    const uid = session.user.id
    const runResult = await supabase.from('ingestion_runs').insert({ user_id: uid, source_type: 'file_import', source_label: file?.name || 'File upload' }).select('id').single()
    if (runResult.error) { setImportError(runResult.error.message); setImportBusy(false); return }
    const runId = runResult.data.id
    let created = 0, updated = 0, skipped = 0, failures = 0, snapshotsSaved = 0
    const errors: { user_id: string; run_id: string; row_number: number; fiction_url: string | null; error_code: string; error_message: string; raw_row: ImportRow }[] = []
    const sourceRows: { row: ImportRow; url: string; rowNumber: number }[] = []
    const seenUrls = new Set<string>()

    preview.forEach((row, i) => {
      const url = urlValue(row.url ?? row.fiction_url ?? row.source_url)
      if (!url) { skipped++; errors.push({ user_id: uid, run_id: runId, row_number: i + 2, fiction_url: null, error_code: 'INVALID_URL', error_message: 'Missing or invalid Royal Road fiction URL.', raw_row: {} }); return }
      if (seenUrls.has(url)) { skipped++; errors.push({ user_id: uid, run_id: runId, row_number: i + 2, fiction_url: url, error_code: 'DUPLICATE_URL', error_message: 'Duplicate URL within this file; first occurrence was kept.', raw_row: {} }); return }
      seenUrls.add(url)
      sourceRows.push({ row, url, rowNumber: i + 2 })
    })

    const chunks = <T,>(items: T[], size: number) => {
      const result: T[][] = []
      for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
      return result
    }

    try {
      // Keep database requests small. This avoids sending a large file as one PostgREST payload.
      for (const batch of chunks(sourceRows, 100)) {
        const records = batch.map(({ row, url }) => {
          const rawTags = row.tags ?? row.latest_updates_tags
          const tags = Array.isArray(rawTags) ? rawTags.map(x => String(x).trim()).filter(Boolean) : textValue(rawTags)?.split(/[;,]/).map(x => x.trim()).filter(Boolean) || []
          const chapterTotal = Array.isArray(row.chapters) ? row.chapters.length : row.chapters
          const title = textValue(row.title) || url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || 'Untitled novel'
          return {
            user_id: uid, fiction_url: url, title,
            author_name: textValue(row.author ?? row.author_name),
            published_at: textValue(row.published_at ?? row.first_published_at),
            genre: textValue(row.genre ?? row.genres), tags,
            publication_status: textValue(row.status ?? row.publication_status ?? row.latest_updates_status),
            chapter_count: numberValue(row.chapter_count ?? chapterTotal),
            page_count: numberValue(row.pages ?? row.page_count),
            last_seen_at: new Date().toISOString(),
          }
        })
        const existing = await supabase.from('novels').select('id,fiction_url').eq('user_id', uid).in('fiction_url', batch.map(x => x.url))
        if (existing.error) throw existing.error
        const existed = new Set((existing.data || []).map(x => x.fiction_url))
        records.forEach(r => existed.has(r.fiction_url) ? updated++ : created++)
        const upsert = await supabase.from('novels').upsert(records, { onConflict: 'user_id,fiction_url' })
        if (upsert.error) throw upsert.error

        const saved = await supabase.from('novels').select('id,fiction_url').eq('user_id', uid).in('fiction_url', batch.map(x => x.url))
        if (saved.error) throw saved.error
        const idByUrl = new Map((saved.data || []).map(x => [x.fiction_url, x.id]))
        const snapshotRows: any[] = []
        const exclusionRows: any[] = []
        const watchRows: any[] = []

        batch.forEach(({ row, url }) => {
          const novelId = idByUrl.get(url)
          if (!novelId) return
          const metrics: Record<string, number | null> = {
            views: numberValue(row.views ?? row.total_views), followers: numberValue(row.followers),
            favorites: numberValue(row.favorites), rating: numberValue(row.rating ?? row.overall_rating ?? row.overall_score ?? row.overallscore),
            rating_count: numberValue(row.rating_count ?? row.ratings_count), review_count: numberValue(row.review_count),
            average_views: numberValue(row.average_views),
            chapters: numberValue(row.chapter_count ?? (Array.isArray(row.chapters) ? row.chapters.length : row.chapters)),
            pages: numberValue(row.pages ?? row.page_count),
          }
          const extendedMetrics = {
            word_count: numberValue(row.word_count ?? row.words ?? row.wordcount),
            overall_score: numberValue(row.overall_score ?? row.overall_rating ?? row.overallscore),
            style_score: numberValue(row.style_score ?? row.style_rating ?? row.stylescore),
            story_score: numberValue(row.story_score ?? row.story_rating ?? row.storyscore),
            grammar_score: numberValue(row.grammar_score ?? row.grammar_rating ?? row.grammarscore),
            character_score: numberValue(row.character_score ?? row.character_rating ?? row.characterscore),
          }
          if (metricKeys.some(k => metrics[k] !== null) || Object.values(extendedMetrics).some(v => v !== null)) {
            // Preserve the full source row; small insert batches keep large JSON exports manageable.
            snapshotRows.push({ user_id: uid, novel_id: novelId, source_type: 'file_import', ...metrics, raw_data: { ...row, ...extendedMetrics } })
          }
          const title = String(row.title || '').toLowerCase()
          if (url.includes('/fiction/183032') || title.includes('dungeons in denver')) exclusionRows.push({ user_id: uid, novel_id: novelId, reason: 'User-owned novel; excluded from benchmark calculations.' })
          if (watchImported) watchRows.push({ user_id: uid, novel_id: novelId, cadence: 'weekly', enabled: true })
        })

        // Small snapshot batches also handle exports containing unusually large metadata fields.
        for (const snapshotBatch of chunks(snapshotRows, 10)) {
          const inserted = await supabase.from('metric_snapshots').insert(snapshotBatch)
          if (inserted.error) throw inserted.error
          snapshotsSaved += snapshotBatch.length
        }
        for (const exclusionBatch of chunks(exclusionRows, 100)) {
          const savedExclusions = await supabase.from('benchmark_exclusions').upsert(exclusionBatch, { onConflict: 'user_id,novel_id' })
          if (savedExclusions.error) throw savedExclusions.error
        }
        for (const watchBatch of chunks(watchRows, 100)) {
          const savedWatch = await supabase.from('watchlist').upsert(watchBatch, { onConflict: 'user_id,novel_id' })
          if (savedWatch.error) throw savedWatch.error
        }
      }
    } catch (err) {
      failures = sourceRows.length
      const message = err instanceof Error ? err.message : 'Import failed.'
      errors.push({ user_id: uid, run_id: runId, row_number: 0, fiction_url: null, error_code: 'IMPORT_FAILED', error_message: message, raw_row: {} })
    }

    for (const errorBatch of chunks(errors, 50)) {
      const savedErrors = await supabase.from('ingestion_run_errors').insert(errorBatch)
      if (savedErrors.error) setNotice('Import completed with an error-log issue: ' + savedErrors.error.message)
    }
    await supabase.from('ingestion_runs').update({
      finished_at: new Date().toISOString(), records_seen: preview.length, records_created: created,
      records_updated: updated, records_skipped: skipped, failures,
      run_status: failures ? 'completed_with_errors' : errors.length ? 'completed_with_errors' : 'completed',
    }).eq('id', runId)

    if (!failures) {
      setNotice('Import complete: ' + created + ' new, ' + updated + ' updated, ' + skipped + ' skipped; ' + preview.length + ' rows processed; ' + snapshotsSaved + ' metric snapshots saved.')
      setPreview([]); setFile(null); setTab('catalogue'); await loadData()
    } else setImportError('Import stopped after a database error: ' + (errors[errors.length - 1]?.error_message || 'unknown error') + '. Some earlier batches may already have been saved; re-importing is safe for novel records.')
    setImportBusy(false)
  }

  async function discoverLatestUpdates() {
    if (!session?.access_token || discoverBusy || scrapeBusy) return
    const page = Math.max(1, Math.min(20, Math.floor(Number(latestPage) || 1)))
    setDiscoverBusy(true); setImportError(''); setNotice('')
    try {
      const response = await fetch('/api/royalroad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ mode: 'discover_latest_updates', page }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) {
        setImportError(result.error || 'Could not read Latest Updates.')
      } else if (!result.fictions?.length) {
        setImportError('The page was readable, but no fiction URLs were detected. Royal Road may have changed its markup.')
      } else {
        const urls = result.fictions.map((item: { url: string }) => item.url)
        setScrapeInput(old => [...new Set([...old.split(/[\s,]+/).filter(Boolean), ...urls])].join('\n'))
        setNotice(`Extracted ${urls.length} fiction URLs from Latest Updates page ${page}. Review the list, then start the scrape.`)
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Latest Updates request failed.')
    }
    setDiscoverBusy(false)
  }

  async function runScrape() {
    if (!session?.user?.id || scrapeBusy) return
    const urls = [...new Set(scrapeInput.split(/[\s,]+/).map(value => value.trim()).filter(Boolean))]
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

  async function createNovelFromBenchmark(input: { title: string; url: string; publishedAt: string; genre: string; tags: string; metrics: Record<string, number | null> }) {
    if (!session?.user?.id) throw new Error('You must be signed in to create a novel.')
    const url = urlValue(input.url)
    if (!url) throw new Error('Enter a valid Royal Road fiction URL.')
    const uid = session.user.id
    const saved = await supabase.from('novels').upsert({
      user_id: uid, fiction_url: url, title: input.title,
      published_at: input.publishedAt || null, genre: input.genre || null,
      tags: input.tags.split(/[;,]/).map(x=>x.trim()).filter(Boolean),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'user_id,fiction_url' }).select('id').single()
    if (saved.error) throw saved.error
    const m = input.metrics
    const snapshot = {
      user_id: uid, novel_id: saved.data.id, source_type: 'manual',
      views: m.views ?? null, average_views: m.average_views ?? null,
      followers: m.followers ?? null, favorites: m.favorites ?? null,
      rating_count: m.rating_count ?? null, rating: m.rating ?? m.overall_score ?? null,
      pages: m.pages ?? null, chapters: m.chapters ?? null,
      raw_data: {
        word_count: m.word_count ?? null, overall_score: m.overall_score ?? null,
        style_score: m.style_score ?? null, story_score: m.story_score ?? null,
        grammar_score: m.grammar_score ?? null, character_score: m.character_score ?? null,
      },
    }
    if (Object.values(m).some(value => value != null)) {
      const inserted = await supabase.from('metric_snapshots').insert(snapshot)
      if (inserted.error) throw inserted.error
    }
    await loadData()
    return saved.data.id as string
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
    { id: 'import', label: 'File import', icon: CloudUpload },
    { id: 'scrape', label: 'Royal Road scraper', icon: Globe },
    { id: 'statistics', label: 'Benchmark explorer', icon: Activity },
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
          <div className="page-heading"><div><p className="eyebrow">DATA INGESTION</p><h1>Import novels</h1><p className="muted">Upload a CSV or JSON export up to 25 MB, with as many as 10,000 novels per file.</p></div></div>
          <div className="import-layout"><div className="panel import-panel">
            <h2>Upload CSV or JSON</h2><p className="muted">Required: <code>url</code> or <code>fiction_url</code>. Files are processed in small database batches.</p>
            <label className="dropzone"><CloudUpload size={28}/><b>{file ? file.name : 'Choose a CSV or JSON file'}</b><span>{file ? `${preview.length} rows detected` : 'Up to 25 MB · 10,000 rows per file'}</span><input type="file" accept=".csv,.json,text/csv,application/json" onChange={e => chooseFile(e.target.files?.[0] || null)}/></label>
            <label className="check-row"><input type="checkbox" checked={watchImported} onChange={e => setWatchImported(e.target.checked)}/> Add imported novels to weekly watchlist</label>
            {importError && <p className="error">{importError}</p>}
            <button className="primary full" disabled={!preview.length || importBusy || !!importError} onClick={() => void runImport()}>{importBusy ? 'Importing…' : `Import ${preview.length || 0} novels`}</button>
          </div><div className="panel"><h2>Supported columns</h2><div className="field-list">{['url / fiction_url / source_url','title','author','first_published_at / published_at','tags (array or text)','status / latest_updates_status','chapters (array) / chapter_count','pages','total_views','average_views','followers','favorites','ratings_count','words','overall_rating','style_rating','story_rating','grammar_rating','character_rating'].map(x => <code key={x}>{x}</code>)}</div><div className="info-strip compact"><ShieldCheck size={16}/><span>File imports are stored under your account. Snapshots are preserved as history, not overwritten.</span></div></div></div>
          {preview.length > 0 && <div className="panel preview-panel"><div className="panel-heading"><div><h2>Import preview</h2><p>Showing the first five rows.</p></div><span className="pill">{preview.length} rows</span></div><div className="table-wrap"><table><thead><tr><th>Title</th><th>Author</th><th>Views</th><th>Followers</th><th>Rating</th></tr></thead><tbody>{preview.slice(0,5).map((r,i)=><tr key={i}><td>{String(r.title || r.url || r.fiction_url || '—')}</td><td>{String(r.author || '—')}</td><td>{fmt(numberValue(r.views ?? r.total_views))}</td><td>{fmt(numberValue(r.followers))}</td><td>{fmt(numberValue(r.rating ?? r.overall_rating))}</td></tr>)}</tbody></table></div></div>}
        </>}
        {tab === 'scrape' && <>
          <div className="page-heading scrape-heading">
            <div><p className="eyebrow">DATA INGESTION</p><h1>Collection workspace</h1><p className="muted">Build a URL queue, review it, and save any metadata Royal Road makes publicly accessible.</p></div>
            <div className="scrape-status"><span className="status-dot"/> Manual collection <small>Server access may be restricted</small></div>
          </div>
          <div className="scrape-summary">
            <div><span>URLs queued</span><strong>{scrapeInput.split(/[\s,]+/).filter(Boolean).length}</strong></div>
            <div><span>Batch limit</span><strong>500</strong></div>
            <div><span>Request mode</span><strong>Sequential</strong></div>
          </div>
          <div className="scrape-workspace">
            <section className="panel scrape-main">
              <div className="scrape-section-head"><div><span className="step-number">01</span><div><h2>Discover fiction links</h2><p>Try a Latest Updates page. If Royal Road blocks the server request, add URLs manually or use CSV import.</p></div></div></div>
              <div className="discover-controls">
                <label>Latest Updates page<input type="number" min="1" max="20" value={latestPage} onChange={e => setLatestPage(e.target.value)} disabled={discoverBusy || scrapeBusy}/></label>
                <button className="secondary" disabled={discoverBusy || scrapeBusy} onClick={() => void discoverLatestUpdates()}>{discoverBusy ? 'Checking page…' : 'Extract URLs'}</button>
              </div>
              <div className="scrape-divider"/>
              <div className="scrape-section-head"><div><span className="step-number">02</span><div><h2>Review URL queue</h2><p>Paste one fiction URL per line. Duplicate entries are removed before processing.</p></div></div><span className="queue-count">{scrapeInput.split(/[\s,]+/).filter(Boolean).length} / 500</span></div>
              <textarea className="scrape-input" value={scrapeInput} onChange={e => setScrapeInput(e.target.value)} placeholder={'https://www.royalroad.com/fiction/12345/example\nhttps://www.royalroad.com/fiction/67890/another-example'} disabled={scrapeBusy}/>
              <div className="scrape-actions">
                <button className="text-button" disabled={!scrapeInput.trim() || scrapeBusy} onClick={() => { setScrapeInput(''); setImportError(''); setNotice('') }}>Clear queue</button>
                <button className="primary" disabled={scrapeBusy || discoverBusy || !scrapeInput.trim() || scrapeInput.split(/[\s,]+/).filter(Boolean).length > 500} onClick={() => void runScrape()}>{scrapeBusy ? 'Collecting…' : 'Start collection'}</button>
              </div>
              <label className="check-row"><input type="checkbox" checked={watchScraped} onChange={e => setWatchScraped(e.target.checked)} disabled={scrapeBusy}/> Add successfully collected novels to weekly watchlist</label>
              {scrapeBusy && <div className="scrape-progress"><div><span>Processing queue</span><b>{scrapeProgress.done} / {scrapeProgress.total}</b></div><div className="progress-track"><i style={{ width: (scrapeProgress.total ? scrapeProgress.done / scrapeProgress.total * 100 : 0) + '%' }}/></div></div>}
              {importError && <div className="scrape-alert"><strong>Collection could not continue</strong><p>{importError}</p>{/403|429|denied|blocked/i.test(importError) && <p>Royal Road is refusing server-side access. This tool will not bypass that restriction. You can still import data you collect manually using the CSV / JSON importer.</p>}</div>}
            </section>
            <aside className="scrape-side">
              <div className="panel">
                <span className="step-number">03</span><h2>What gets saved</h2>
                <ul className="scrape-checklist"><li>Fiction title and author, when available</li><li>Publication date, genre and chapter data</li><li>Visible views, followers, favorites and rating</li><li>Timestamped snapshots for historical comparison</li></ul>
              </div>
              <div className="panel scrape-warning">
                <h2><ShieldCheck size={17}/> Access limitation</h2>
                <p>Royal Road may return HTTP 403 or 429 to server requests. A deployment being online does not mean Royal Road will allow the request. No access-control bypass is attempted.</p>
              </div>
              <div className="panel">
                <h2>Manual data import</h2><p className="muted">If Royal Road blocks collection, use the existing CSV importer with data you have gathered yourself.</p>
                <button className="secondary full" onClick={() => { setTab('import'); setImportError(''); }}>Open file importer <ChevronRight size={15}/></button>
              </div>
            </aside>
          </div>
        </>}
        {tab === 'statistics' && <Suspense fallback={<div className="panel"><p className="muted">Loading benchmark explorer…</p></div>}><BenchmarkExplorer novels={novels} latestByNovel={latestByNovel} onCreateNovel={createNovelFromBenchmark} /></Suspense>}
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
