export function getMondayDate(): Date {
  // Get current date/time
  const now = new Date()

  // Calculate this Monday midnight Central Time
  const dayOfWeek = now.getUTCDay() // 0 = Sunday, 1 = Monday, etc.
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const thisMonday = new Date(now)
  thisMonday.setUTCDate(now.getUTCDate() + daysToMonday)

  // Set to midnight Central Time (UTC-6 in standard time, UTC-5 in daylight time)
  // To be safe, we'll use UTC-6 and set to 06:00 UTC which is midnight CT
  thisMonday.setUTCHours(6, 0, 0, 0)

  // If thisMonday is in the future, go back one week
  if (thisMonday > now) {
    thisMonday.setUTCDate(thisMonday.getUTCDate() - 7)
  }
  return thisMonday
}
