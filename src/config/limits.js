export const MAX_DAILY_STUDY_SECONDS = 14 * 60 * 60; // 50400

export function clampDailyStudySeconds(seconds) {
  const n = Math.floor(Number(seconds) || 0);
  if (n <= 0) return 0;
  return Math.min(n, MAX_DAILY_STUDY_SECONDS);
}
