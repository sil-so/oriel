const SUPPORTED_FIELDS = new Set(['app', 'title', 'url']);
const SUPPORTED_MATCH_TYPES = new Set(['contains', 'equals', 'regex']);

export function normalizeTrackingExclusion(input) {
  if (!input || !SUPPORTED_FIELDS.has(input.field) || !SUPPORTED_MATCH_TYPES.has(input.matchType)) {
    return null;
  }

  const pattern = typeof input.pattern === 'string' ? input.pattern.trim() : '';
  if (!pattern) return null;

  if (input.matchType === 'regex') {
    try {
      new RegExp(pattern, 'i');
    } catch {
      return null;
    }
  }

  return {
    field: input.field,
    matchType: input.matchType,
    pattern,
    applyToHistory: Boolean(input.applyToHistory)
  };
}

export function matchesTrackingExclusion(activity, exclusions) {
  return exclusions.some((rule) => {
    const normalizedRule = normalizeTrackingExclusion(rule);
    if (!normalizedRule) return false;

    const candidate = String(activity[normalizedRule.field] || '');
    const pattern = normalizedRule.pattern;
    if (normalizedRule.matchType === 'regex') {
      return new RegExp(pattern, 'i').test(candidate);
    }

    const normalizedCandidate = candidate.toLowerCase();
    const normalizedPattern = pattern.toLowerCase();
    return normalizedRule.matchType === 'equals'
      ? normalizedCandidate === normalizedPattern
      : normalizedCandidate.includes(normalizedPattern);
  });
}

export function pruneActivitiesByExclusion(activities, exclusion) {
  const normalizedRule = normalizeTrackingExclusion(exclusion);
  if (!normalizedRule) return { kept: activities, removed: [] };

  const kept = [];
  const removed = [];
  for (const activity of activities) {
    if (matchesTrackingExclusion(activity, [normalizedRule])) {
      removed.push(activity);
    } else {
      kept.push(activity);
    }
  }

  return { kept, removed };
}
