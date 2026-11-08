/**
 * The Arete mark: a gold A cut like a gem, three facets lit from the top
 * left, with a spark at the apex. `size` under 24px draws the small cut
 * (no hairlines, no glow) so it stays crisp in tabs and tight spots.
 */
import { useId } from 'react'

export function AreteMark({ size = 28, className, title }: { size?: number; className?: string; title?: string }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '')
  const id = (s: string) => `ar${raw}${s}`
  const small = size < 24
  return (
    <svg width={size} height={size} viewBox={small ? '12 8 96 100' : '8 0 104 112'} className={className}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={id('l')} gradientUnits="userSpaceOnUse" x1="44" y1="12" x2="26" y2="104"><stop offset="0" stopColor="#FFF7E2" /><stop offset=".42" stopColor="#EBD19A" /><stop offset="1" stopColor="#B4894A" /></linearGradient>
        <linearGradient id={id('r')} gradientUnits="userSpaceOnUse" x1="62" y1="12" x2="104" y2="104"><stop offset="0" stopColor="#D9B776" /><stop offset=".55" stopColor="#8E6935" /><stop offset="1" stopColor="#5A401E" /></linearGradient>
        <linearGradient id={id('b')} gradientUnits="userSpaceOnUse" x1="60" y1="74" x2="60" y2="104"><stop offset="0" stopColor="#8A6634" /><stop offset="1" stopColor="#2C1F0F" /></linearGradient>
        <linearGradient id={id('s')} gradientUnits="userSpaceOnUse" x1="30" y1="40" x2="56" y2="70"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <mask id={id('m')} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><rect width="120" height="120" fill="#fff" /><path d="M60 83L48.5 104.5H71.5Z" fill="#000" /></mask>
        {!small && <filter id={id('g')} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.6" /></filter>}
      </defs>
      <g mask={`url(#${id('m')})`}>
        <path d="M60 12L14 104L60 74Z" fill={`url(#${id('l')})`} />
        <path d="M60 12L106 104L60 74Z" fill={`url(#${id('r')})`} />
        <path d="M14 104L106 104L60 74Z" fill={`url(#${id('b')})`} />
        <path d="M60 12L30 72L60 58Z" fill={`url(#${id('s')})`} />
        {!small && <>
          <path d="M60 12V74M14 104L60 74M106 104L60 74" stroke="#FFF6E0" strokeOpacity=".7" strokeWidth=".7" fill="none" />
          <path d="M60 12L14 104H106Z" stroke="#FFE7B3" strokeOpacity=".5" strokeWidth=".8" fill="none" strokeLinejoin="round" />
        </>}
      </g>
      {!small && <>
        <circle cx="60" cy="12.5" r="5" fill="#FFF3D6" opacity=".9" filter={`url(#${id('g')})`} />
        <path d="M60 3.5L61 11.5L69 12.5L61 13.5L60 21.5L59 13.5L51 12.5L59 11.5Z" fill="#fff" />
      </>}
    </svg>
  )
}

/** Mark and wordmark together, as the app's name in every frame. */
export function AreteBrand({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`arete-brand ${className}`}>
      <AreteMark size={size} />
      <span className="arete-word">ARETE</span>
    </span>
  )
}
