import { describe, expect, it } from 'vitest'
import { fakeHttp, fixture } from '../test/fakes'
import { feedHandlers } from '../test/feedHandlers'

/** The iTunes Search API, asked for podcasts matching "rome". */
const romeSearch = 'https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=rome'

describe('the searchPodcasts query', () => {
  it('returns matching podcasts from the directory, in its order, with title, author, artwork and feed URL', async () => {
    const http = fakeHttp({ [romeSearch]: fixture('itunes-search.json') })
    const { search } = feedHandlers()

    const result = await search('rome')

    expect(http.requested).toEqual([romeSearch])
    expect(result).toEqual({
      outcome: 'found',
      podcasts: [
        {
          title: 'The History of Rome',
          author: 'Mike Duncan',
          artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/rome/600x600bb.jpg',
          feedUrl: 'https://feeds.example.com/history-of-rome.xml',
          podcastId: null,
        },
        // A show the directory lists without a feed can't be subscribed to, so it is left out.
        {
          title: 'Rome Daily',
          author: null,
          artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/daily/100x100bb.jpg',
          feedUrl: 'https://feeds.example.com/rome-daily.xml',
          podcastId: null,
        },
        {
          title: 'Rome Gossip',
          author: 'Anon',
          artworkUrl: null,
          feedUrl: 'https://feeds.example.com/rome-gossip.xml',
          podcastId: null,
        },
      ],
    })
  })

  it('marks the podcasts already in the library with their ID', async () => {
    fakeHttp({ [romeSearch]: fixture('itunes-search.json') })
    const { data, search } = feedHandlers()
    const inLibrary = await data.store.createPodcast({
      feedUrl: 'https://feeds.example.com/rome-daily.xml',
      title: 'Rome Daily',
      author: null,
      artworkUrl: null,
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastFetchError: null,
    })

    const result = await search('rome')

    expect(result.podcasts.map(({ title, podcastId }) => [title, podcastId])).toEqual([
      ['The History of Rome', null],
      ['Rome Daily', inLibrary.id],
      ['Rome Gossip', null],
    ])
  })

  it('passes the term to the directory as typed, encoded', async () => {
    const url = 'https://itunes.apple.com/search?media=podcast&entity=podcast&limit=25&term=hardcore+history+%26+more'
    const http = fakeHttp({ [url]: '{"resultCount":0,"results":[]}' })
    const { search } = feedHandlers()

    await search('  hardcore history & more ')

    expect(http.requested).toEqual([url])
  })

  it('finds nothing when the directory has no matches', async () => {
    fakeHttp({ [romeSearch]: '{"resultCount":0,"results":[]}' })
    const { search } = feedHandlers()

    expect(await search('rome')).toEqual({ outcome: 'found', podcasts: [] })
  })

  it('finds nothing for a blank term, without asking the directory', async () => {
    const http = fakeHttp({})
    const { search } = feedHandlers()

    expect(await search('   ')).toEqual({ outcome: 'found', podcasts: [] })
    expect(http.requested).toEqual([])
  })

  it('leaves out results whose feed or artwork URL is not http or https', async () => {
    const body = JSON.stringify({
      resultCount: 2,
      results: [
        { collectionName: 'Bad Feed', feedUrl: 'ftp://feeds.example.com/bad.xml' },
        { collectionName: 'Bad Art', feedUrl: 'https://feeds.example.com/art.xml', artworkUrl600: 'javascript:alert(1)' },
      ],
    })
    fakeHttp({ [romeSearch]: body })
    const { search } = feedHandlers()

    expect(await search('rome')).toEqual({
      outcome: 'found',
      podcasts: [
        { title: 'Bad Art', author: null, artworkUrl: null, feedUrl: 'https://feeds.example.com/art.xml', podcastId: null },
      ],
    })
  })

  it.each([
    ['is unreachable', {}],
    ['answers with an error', { [romeSearch]: { status: 503, body: 'Service Unavailable' } }],
    ['answers with something other than search results', { [romeSearch]: '<html>Rate limited</html>' }],
    ['answers with JSON of another shape', { [romeSearch]: '{"errorMessage":"Invalid value(s) for key(s): [term]"}' }],
  ])('says the directory is unavailable when it %s', async (_case, responses) => {
    fakeHttp(responses)
    const { search } = feedHandlers()

    expect(await search('rome')).toEqual({ outcome: 'directoryUnavailable', podcasts: [] })
  })
})
