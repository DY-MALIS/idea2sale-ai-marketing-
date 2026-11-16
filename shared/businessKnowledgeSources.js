export function knowledgeForSavedLinks(knowledge, sources, links) {
  const previous = Array.isArray(sources) ? sources : [];
  const current = links.filter(Boolean);
  const unchanged = previous.length === current.length && current.every((url) => previous.includes(url));
  return unchanged
    ? { businessKnowledgeBase: knowledge || '', businessKnowledgeBaseSources: previous }
    : { businessKnowledgeBase: '', businessKnowledgeBaseSources: [] };
}
