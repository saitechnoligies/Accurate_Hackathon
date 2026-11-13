import type { Trip } from '../types'

type Props = { trip: Trip; day: number; onDay: (d: number) => void }

export default function JourneyStrip({ trip, day, onDay }: Props) {
  const first = trip.days[0].items
  const last = trip.days[trip.days.length - 1].items
  const leave = first.find((i) => i.type === 'home')
  const out = first.find((i) => i.type === 'train')
  const back = last.find((i) => i.type === 'train')
  const home = last.find((i) => i.type === 'arrive_home')

  type Step = { key: string; icon: string; label: string; time: string; warn?: boolean; day?: number }
  const steps: Step[] = [
    { key: 'home', icon: '🏠', label: 'Leave home', time: leave?.start ?? '', day: 1 },
    { key: 'out', icon: '🚆', label: out?.delay_min ? `Train +${out.delay_min}m` : 'Train to Jaipur', time: out?.end ?? '', warn: !!out?.delay_min, day: 1 },
    ...trip.days.map((d) => ({
      key: `d${d.day}`,
      icon: d.day === 1 ? '🏨' : '📍',
      label: `Day ${d.day}`,
      time: `${d.items.filter((i) => i.type === 'visit').length} stops`,
      day: d.day,
    })),
    { key: 'back', icon: '🚆', label: back?.delay_min ? `Return +${back.delay_min}m` : 'Train home', time: back?.start ?? '', warn: !!back?.delay_min, day: trip.days.length },
    { key: 'end', icon: '🏡', label: 'Home', time: home?.start ?? '', day: trip.days.length },
  ]

  return (
    <nav className="journey" aria-label="Door-to-door journey">
      {steps.map((s, i) => (
        <button
          key={s.key}
          className={`journey-step ${s.warn ? 'warn' : ''} ${s.key === `d${day}` ? 'active' : ''}`}
          onClick={() => s.day && onDay(s.day)}
        >
          <span className="journey-icon" aria-hidden>{s.icon}</span>
          <span className="journey-label">{s.label}</span>
          <span className="journey-time">{s.time}</span>
          {i < steps.length - 1 && <span className="journey-line" aria-hidden />}
        </button>
      ))}
    </nav>
  )
}
