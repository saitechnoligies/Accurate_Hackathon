/* Voice input (Web Speech API), spoken replies and spoken reminders, all in the browser. */
import { useCallback, useEffect, useRef, useState } from 'react'

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean
  start: () => void; stop: () => void; abort: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> ; resultIndex: number }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecCtor = new () => Rec

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was denied. Allow it in the browser and try again.',
  'service-not-allowed': 'The browser blocked its speech service.',
  'audio-capture': 'No microphone was found.',
  network: 'The browser could not reach its speech service.',
  'no-speech': "I didn't hear anything. Tap the mic and try again.",
}

export function voiceSupported() {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return Boolean(window.isSecureContext && (w.SpeechRecognition || w.webkitSpeechRecognition))
}

/** One-shot dictation: tap, speak, get the text. */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const rec = useRef<Rec | null>(null)
  const cb = useRef(onText)
  cb.current = onText

  const stop = useCallback(() => {
    rec.current?.abort()
    rec.current = null
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) return setError('Voice input is not supported in this browser (try Chrome or Edge).')
    stop()
    setError('')
    const r = new Ctor()
    r.lang = 'en-IN'
    r.continuous = false
    r.interimResults = false
    r.onresult = (e) => {
      const res = e.results[e.resultIndex]
      if (res?.isFinal) cb.current(res[0].transcript.trim())
    }
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? 'Voice input stopped. Try again.')
    }
    r.onend = () => { rec.current = null; setListening(false) }
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      setError('Voice input could not start. Try again.')
    }
  }, [stop])

  useEffect(() => stop, [stop])
  return { listening, error, start, stop, supported: voiceSupported() }
}

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text.replace(/[\u{1F300}-\u{1FAFF}]/gu, ''))
  u.lang = 'en-IN'
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(u)
}

// ------------------------------------------------------------------ reminders
export type Reminder = { id: string; label: string; due: number }
const KEY = 'delayproof.reminders'
const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'half an': 0.5 }

/** "remind me to buy water in 10 minutes" → reminder, or null. */
export function parseReminder(text: string): Omit<Reminder, 'id'> | null {
  const m = text.trim().match(/^remind me\s+(?:to\s+)?(.+?)\s+in\s+(\d+|[a-z]+(?: an)?)\s+(minute|min|hour|hr)s?\.?$/i)
  if (!m) return null
  const n = WORDS[m[2].toLowerCase()] ?? Number(m[2])
  const ms = n * (/^h/i.test(m[3]) ? 3_600_000 : 60_000)
  if (!Number.isFinite(ms) || ms < 30_000 || ms > 2 * 86_400_000) return null
  return { label: m[1].slice(0, 160), due: Date.now() + ms }
}

function read(): Reminder[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function write(v: Reminder[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('delayproof-reminders'))
}

export function addReminder(r: Omit<Reminder, 'id'>) {
  write([...read(), { ...r, id: Math.random().toString(36).slice(2) }].slice(-25))
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
}
export function removeReminder(id: string) {
  write(read().filter((r) => r.id !== id))
}

/** Fires due reminders: toast + voice + system notification. */
export function useReminders(onDue: (label: string) => void) {
  const [items, setItems] = useState<Reminder[]>(read)
  const cb = useRef(onDue)
  cb.current = onDue
  useEffect(() => {
    const sync = () => setItems(read())
    window.addEventListener('delayproof-reminders', sync)
    window.addEventListener('storage', sync)
    const t = setInterval(() => {
      const now = Date.now()
      const due = read().filter((r) => r.due <= now)
      if (!due.length) return
      write(read().filter((r) => r.due > now))
      for (const r of due) {
        cb.current(r.label)
        speak(`Reminder: ${r.label}`)
        try {
          if ('Notification' in window && Notification.permission === 'granted') new Notification('DelayProof reminder', { body: r.label })
        } catch {
          /* ignore */
        }
      }
    }, 1000)
    return () => {
      clearInterval(t)
      window.removeEventListener('delayproof-reminders', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])
  return items
}
