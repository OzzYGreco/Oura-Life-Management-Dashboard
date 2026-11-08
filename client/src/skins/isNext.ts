/**
 * Whether the one-layout redesign (the "next" skin) is active. Shared pages
 * use it to draw their new-style variant without changing any logic; other
 * skins keep the original look until the redesign replaces them.
 */
import { useSkin } from './core'

export const useIsNext = () => useSkin().skin === 'next'
