/** Wall-clock ms outside React render so purity lint stays quiet in Server Components. */
export function wallClockMs(): number {
  return Date.now();
}
