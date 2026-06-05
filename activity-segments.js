export function isIdleSegment(segment) {
  const app = String(segment?.app || '').toLowerCase();
  return app === 'idle' || app === 'loginwindow';
}

export function getLocalDateString(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
}

export function getLocalDayBounds(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!match) {
    throw new Error(`Invalid local date: ${dateString}`);
  }

  const [, year, month, day] = match.map(Number);
  const startDate = new Date(year, month - 1, day);
  const endDate = new Date(year, month - 1, day + 1);
  if (
    startDate.getFullYear() !== year ||
    startDate.getMonth() !== month - 1 ||
    startDate.getDate() !== day
  ) {
    throw new Error(`Invalid local date: ${dateString}`);
  }

  return { start: startDate.getTime(), end: endDate.getTime() };
}

export function getLocalDateRangeBounds(startDate, endDate = startDate, maxDays = 366) {
  const startBounds = getLocalDayBounds(startDate);
  const endBounds = getLocalDayBounds(endDate);
  if (endBounds.end <= startBounds.start) {
    throw new Error('Date range end must not precede start');
  }

  const cappedEndDate = new Date(startBounds.start);
  cappedEndDate.setDate(cappedEndDate.getDate() + maxDays);
  return { start: startBounds.start, end: Math.min(endBounds.end, cappedEndDate.getTime()) };
}

export function activeEndAtIdleThreshold(activityStart, now, idleSeconds, thresholdSeconds) {
  const idleCutoff = now - (idleSeconds * 1000) + (thresholdSeconds * 1000);
  return Math.max(activityStart, Math.min(now, idleCutoff));
}

export function splitSegmentByLocalDay(segment) {
  if (!segment || isIdleSegment(segment) || segment.end <= segment.start) return [];

  const slices = [];
  let start = segment.start;
  while (start < segment.end) {
    const localDate = getLocalDateString(start);
    const { end: dayEnd } = getLocalDayBounds(localDate);
    const end = Math.min(dayEnd, segment.end);
    slices.push({ ...segment, start, end });
    start = end;
  }
  return slices;
}

export function clipSegmentToInterval(segment, intervalStart, intervalEnd) {
  if (!segment || isIdleSegment(segment)) return null;
  const start = Math.max(segment.start, intervalStart);
  const end = Math.min(segment.end, intervalEnd);
  if (end <= start) return null;
  return { ...segment, start, end };
}

export function normalizeActivitySegments(segments) {
  return segments
    .flatMap(splitSegmentByLocalDay)
    .sort((first, second) => first.start - second.start);
}
