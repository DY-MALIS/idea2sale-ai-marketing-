export function facebookPageKnowledgeContent(page) {
  return [page?.about, page?.text, ...(page?.posts || []).map((post) => post.text || post.message || '')]
    .filter(Boolean).join('\n').trim();
}
