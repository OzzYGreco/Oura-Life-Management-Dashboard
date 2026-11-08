/**
 * Light or dark now belongs to the active skin (see skins/core.tsx), which
 * sets `data-skin` and the `light` class on <html>. This hook stays so older
 * callers compile; it reports the current appearance and never changes it.
 */
export function useTheme() {
  const theme: 'dark' | 'light' = document.documentElement.classList.contains('light') ? 'light' : 'dark'
  return { theme, toggle: () => {} }
}
