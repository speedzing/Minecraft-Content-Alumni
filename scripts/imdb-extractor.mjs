// Runs inside an IMDb title page (via Playwright's page.evaluate) and returns one
// database record built from the page's embedded __NEXT_DATA__ JSON.
// Must stay self-contained: it is serialized and executed in the browser.
export function extractImdbTitle() {
  const p = JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps;
  const a = p.aboveTheFoldData || {}, m = p.mainColumnData || {};
  const nm = c => ({ id: c.name.id, name: c.name.nameText.text });
  const img = i => i ? { url: i.url, width: i.width, height: i.height, caption: i.caption?.plainText || null } : null;
  const pc = {};
  (a.principalCreditsV2 || []).forEach(g => pc[g.grouping.text] = g.credits.map(nm));
  const cast = (m.castV2 || []).flatMap(g => g.credits).map(c => {
    const r = c.creditedRoles?.edges?.[0]?.node;
    return { ...nm(c), role: r?.category?.text || null,
      characters: (r?.characters?.edges || []).map(e => e.node.name),
      creditedAs: (r?.attributes || []).map(x => x.text).join(', ') || null,
      photo: c.name.primaryImage?.url || null };
  });
  return {
    imdbId: a.id, imdbUrl: `https://www.imdb.com/title/${a.id}/`,
    title: a.titleText?.text, originalTitle: a.originalTitleText?.text,
    titleType: a.titleType?.text, isSeries: !!a.titleType?.isSeries,
    year: a.releaseYear?.year, endYear: a.releaseYear?.endYear || null,
    releaseDate: a.releaseDate ? [a.releaseDate.year, a.releaseDate.month, a.releaseDate.day].filter(Boolean).map(n => String(n).padStart(2, '0')).join('-') : null,
    releaseCountry: a.releaseDate?.country?.text || null,
    runtimeMinutes: a.runtime?.seconds ? Math.round(a.runtime.seconds / 60) : null,
    certificate: a.certificate?.rating || null,
    genres: (a.genres?.genres || []).map(g => g.text),
    interests: (a.interests?.edges || []).map(e => e.node.primaryText?.text).filter(Boolean),
    plot: a.plot?.plotText?.plainText || null,
    rating: { value: a.ratingsSummary?.aggregateRating ?? null, votes: a.ratingsSummary?.voteCount ?? 0 },
    metascore: a.metacritic?.metascore?.score ?? null,
    poster: img(a.primaryImage),
    directors: pc.Directors || pc.Director || pc.Creators || pc.Creator || [],
    writers: pc.Writers || pc.Writer || [], stars: pc.Stars || [], creators: pc.Creators || pc.Creator || [],
    cast,
    studios: (m.production?.edges || []).map(e => ({ id: e.node.company.id, name: e.node.company.companyText.text })),
    countries: (a.countriesOfOrigin?.countries || []).map(c => c.text || c.id),
    languages: (m.spokenLanguages?.spokenLanguages || []).map(l => l.text),
    keywords: (a.keywords?.edges || []).map(e => e.node.text),
    akas: (m.akas?.edges || []).map(e => e.node.text),
    filmingLocations: (m.filmingLocations?.edges || []).map(e => e.node.text),
    episodes: m.episodes ? { total: m.episodes.episodes?.total ?? null, seasons: (m.episodes.seasons || []).map(s => s.number), years: (m.episodes.years || []).map(y => y.year) } : null,
    series: a.series ? { id: a.series.series?.id, title: a.series.series?.titleText?.text, season: a.series.episodeNumber?.seasonNumber, episode: a.series.episodeNumber?.episodeNumber } : null,
    videos: [...(a.primaryVideos?.edges || []), ...(m.videoStrip?.edges || [])].map(e => e.node)
      .filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i)
      .map(v => ({ id: v.id, name: v.name?.value || null, type: v.contentType?.displayName?.value || null,
        url: `https://www.imdb.com/video/${v.id}/`, thumbnail: v.thumbnail?.url || null, runtimeSeconds: v.runtime?.value || null })),
    gallery: (m.titleMainImages?.edges || []).map(e => img(e.node)),
    trivia: (m.trivia?.edges || []).map(e => e.node.text?.plaidHtml?.replace(/<[^>]+>/g, '')).filter(Boolean),
    externalLinks: (a.externalLinks?.edges || []).map(e => ({ label: e.node.label, url: e.node.url })),
    awards: { wins: m.wins?.total ?? 0, nominations: m.nominationsExcludeWins?.total ?? 0 },
    fetchedAt: new Date().toISOString(),
  };
}
