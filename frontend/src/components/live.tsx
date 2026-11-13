import { useEffect, useState } from 'react'
import { type Freshness, type Photo, placePhoto } from '../live'
import { useDictation } from '../voice'

const FRESH: Record<Freshness, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'fr-live' },
  cached: { label: 'Cached', cls: 'fr-cached' },
  simulated: { label: 'Simulated', cls: 'fr-sim' },
}

/** Says where a number came from and how fresh it is. */
export function TrustBadge({ freshness, at, source, url }: { freshness: Freshness; at?: string; source?: string; url?: string }) {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(navigator.onLine)
    window.addEventListener('online', up)
    window.addEventListener('offline', up)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up) }
  }, [])
  const f = !online && freshness === 'live' ? 'cached' : freshness
  const time = at ? new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''
  const body = <><span className="fr-dot" aria-hidden />{FRESH[f].label}{time && f !== 'simulated' ? ` · ${time}` : ''}{source ? ` · ${source}` : ''}</>
  return url ? <a className={`fr ${FRESH[f].cls}`} href={url} target="_blank" rel="noreferrer">{body}</a> : <span className={`fr ${FRESH[f].cls}`}>{body}</span>
}

/** Credited Wikipedia thumbnail for a place; renders nothing when no licensed photo is available. */
export function PlacePhoto({ id, alt, className = '' }: { id?: string; alt: string; className?: string }) {
  const [photo, setPhoto] = useState<Photo | null>(null)
  useEffect(() => {
    let live = true
    if (id) placePhoto(id).then((p) => live && setPhoto(p))
    return () => { live = false }
  }, [id])
  if (!photo) return null
  return (
    <figure className={`pphoto ${className}`}>
      <img src={photo.src} alt={alt} loading="lazy" referrerPolicy="no-referrer" />
      <figcaption><a href={photo.page} target="_blank" rel="noreferrer">Photo: Wikipedia</a></figcaption>
    </figure>
  )
}

/** Tap-to-talk button for any text input. */
export function MicButton({ onText, title = 'Speak' }: { onText: (t: string) => void; title?: string }) {
  const { listening, error, start, stop, supported } = useDictation(onText)
  if (!supported) return null
  return (
    <span className="mic-wrap">
      <button type="button" className={`btn mic ${listening ? 'mic-on' : ''}`} onClick={listening ? stop : start}
        aria-label={listening ? 'Stop listening' : title} title={listening ? 'Listening… tap to stop' : title}>
        {listening ? '⏹' : '🎙️'}
      </button>
      {error && <span className="mic-err small" role="alert">{error}</span>}
    </span>
  )
}
