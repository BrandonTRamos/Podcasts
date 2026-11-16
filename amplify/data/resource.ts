import { type ClientSchema, a, defineData } from '@aws-amplify/backend'
import { DIRECTORY_GENRES } from '../directory/genres'
import { ingestFeedFunction } from '../functions/ingest-feed/resource'
import { refreshFeedsFunction } from '../functions/refresh-feeds/resource'
import { searchPodcastsFunction } from '../functions/search-podcasts/resource'
import { stageDownloadFunction } from '../functions/stage-download/resource'
import { subscribeFunction } from '../functions/subscribe/resource'
import { topPodcastsFunction } from '../functions/top-podcasts/resource'
import { unsubscribeFunction } from '../functions/unsubscribe/resource'

// Single-user app: every model is readable and writable by the signed-in user
// only, with no per-owner rules. Requests without a Cognito token are refused.
// The feed functions reach the data API with their own IAM role.
const schema = a
  .schema({
    Podcast: a
      .model({
        // A secret: private feeds carry access tokens. Only the signed-in user can read it.
        feedUrl: a.string().required(),
        title: a.string().required(),
        author: a.string(),
        artworkUrl: a.string(),
        // The feed's version as last fetched in full, sent back with each refresh
        // to ask whether it has changed (a conditional GET).
        etag: a.string(),
        lastModified: a.string(),
        // When the feed was last fetched in full. A refresh that finds it unchanged writes nothing.
        lastFetchedAt: a.datetime(),
        // Why the latest refresh failed; absent when it succeeded.
        lastFetchError: a.ref('FeedError'),
        // The listener's category for it, set by the client; absent for none (Other).
        // Not a relationship: deleting a category leaves its podcasts naming it, which counts as none.
        categoryId: a.id(),
        // Where the listener put it in its category's list: lowest first, then
        // those with none, by title. Absent until moved. Fractional, so a move is
        // usually one write.
        libraryOrder: a.float(),
        // Where it is among the listener's favorites, lowest first; absent when
        // not a favorite. A favorite stays in its category too: Favorites shows a copy.
        favoriteOrder: a.float(),
        episodes: a.hasMany('Episode', 'podcastId'),
      })
      .secondaryIndexes((index) => [index('feedUrl')]),

    // A group of podcasts the listener made, such as News or Movies.
    Category: a.model({
      name: a.string().required(),
    }),

    FeedError: a.enum(['invalidUrl', 'unreachable', 'notAFeed', 'failed']),

    Episode: a
      .model({
        // Derived from the podcast and the item's GUID (see feeds/storeEpisodes.ts).
        id: a.id().required(),
        podcastId: a.id().required(),
        podcast: a.belongsTo('Podcast', 'podcastId'),
        guid: a.string().required(),
        title: a.string().required(),
        // Absent, never null, when the feed gives no date: it is the latest-episodes index's sort key.
        publishedAt: a.datetime(),
        durationSeconds: a.integer(),
        enclosureUrl: a.string().required(),
        enclosureType: a.string(),
        showNotes: a.string(),
        // Always LATEST_LISTING (see latestEpisodes.ts): puts every episode in one index partition.
        listing: a.string(),
      })
      // The latest episodes across all podcasts, by date. Undated episodes are not in it.
      .secondaryIndexes((index) => [index('listing').sortKeys(['publishedAt']).queryField('listEpisodesByDate')]),

    // The listener's place in an episode, whether they have heard it, and
    // where it is in the queue, synced across devices. One per episode, created
    // the first time it is saved. A save carries when its change was made, and
    // is kept only if no later change is held, so the most recent change wins
    // even when an older one, made offline, arrives after it. `updatedAt`
    // (kept by the data API) orders the saves the backend kept.
    EpisodeState: a.model({
      // The episode's ID.
      id: a.id().required(),
      podcastId: a.id().required(),
      positionSeconds: a.float().required(),
      played: a.boolean().required(),
      // Queued episodes play lowest first. Absent when not queued: saving null
      // removes the attribute. Fractional, so a move is one write.
      queueOrder: a.float(),
      // When the change last kept was made, by the device's clock (ISO 8601).
      // Absent on states saved before it was recorded: any change then wins.
      changedAt: a.datetime(),
    }),

    SubscribeStatus: a.enum([
      'pending',
      'subscribed',
      'alreadySubscribed',
      'invalidUrl',
      'unreachable',
      'notAFeed',
      'failed',
    ]),

    // One subscribe in progress. Creating it starts the background ingest (its
    // table's stream triggers ingest-feed); the client watches it for the outcome.
    SubscribeRequest: a.model({
      feedUrl: a.string().required(),
      status: a.ref('SubscribeStatus').required(),
      podcastId: a.id(),
      // DynamoDB deletes the request a day after it was made (time to live, set in backend.ts).
      expiresAt: a.integer().required(),
    }),

    SubscribeOutcome: a.enum(['pending', 'alreadySubscribed', 'invalidUrl']),

    SubscribeResult: a.customType({
      outcome: a.ref('SubscribeOutcome').required(),
      requestId: a.id(),
      podcastId: a.id(),
    }),

    // Returns at once with a pending request (or says the URL is invalid or
    // already subscribed). The feed is fetched, checked and ingested in the
    // background; the client learns the outcome through data subscriptions.
    subscribe: a
      .mutation()
      .arguments({ feedUrl: a.string().required() })
      .returns(a.ref('SubscribeResult').required())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(subscribeFunction)),

    // Removes the podcast, its episodes and their listening state (queue
    // places included). Returns true once they are gone, or were already.
    unsubscribe: a
      .mutation()
      .arguments({ podcastId: a.id().required() })
      .returns(a.boolean().required())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(unsubscribeFunction)),

    // Returns at once; the feed is refreshed in the background. The client
    // learns the outcome through data subscriptions: new episodes, and the
    // podcast's refresh time or error.
    refreshPodcast: a
      .mutation()
      .arguments({ podcastId: a.id().required() })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(refreshFeedsFunction).async()),

    DownloadStagingStatus: a.enum(['preparing', 'ready', 'unavailable', 'failed']),

    // A temporary copy of an episode's file, made for a publisher whose host
    // doesn't let a web page download it directly. Its ID is chosen by the
    // client, which watches it for the outcome.
    DownloadStaging: a.model({
      id: a.id().required(),
      episodeId: a.id().required(),
      status: a.ref('DownloadStagingStatus').required(),
      // Where the copy is in the private staging bucket, once ready. The bucket deletes it within a day.
      objectKey: a.string(),
      // A short-lived link to the copy, once ready, and when it stops working.
      url: a.string(),
      urlExpiresAt: a.datetime(),
      // DynamoDB deletes the record a day after it was made (time to live, set in backend.ts).
      expiresAt: a.integer().required(),
    }),

    // Returns at once; the copy is made in the background. The client learns
    // the outcome by watching the `DownloadStaging` record with `requestId`.
    stageDownload: a
      .mutation()
      .arguments({ requestId: a.id().required(), episodeId: a.id().required() })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(stageDownloadFunction).async()),

    // A podcast as the public directory lists it. Its feed URL is public.
    DirectoryPodcast: a.customType({
      title: a.string().required(),
      author: a.string(),
      artworkUrl: a.string(),
      feedUrl: a.string().required(),
      // Set when the podcast is already in the library.
      podcastId: a.id(),
    }),

    SearchOutcome: a.enum(['found', 'directoryUnavailable']),

    SearchPodcastsResult: a.customType({
      outcome: a.ref('SearchOutcome').required(),
      // Empty when nothing matched, or when the directory is unavailable.
      podcasts: a.ref('DirectoryPodcast').required().array().required(),
    }),

    // Searches the public podcast directory by name. Subscribing to a result
    // goes through `subscribe` with its feed URL.
    searchPodcasts: a
      .query()
      .arguments({ term: a.string().required() })
      .returns(a.ref('SearchPodcastsResult').required())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(searchPodcastsFunction)),

    // The genres the directory's charts can be browsed by (directory/genres.ts).
    DirectoryGenre: a.enum([...DIRECTORY_GENRES]),

    // The public podcast directory's most popular podcasts, in one genre or,
    // with none given, over all. Answers as a search does.
    topPodcasts: a
      .query()
      .arguments({ genre: a.ref('DirectoryGenre') })
      .returns(a.ref('SearchPodcastsResult').required())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(topPodcastsFunction)),
  })
  .authorization((allow) => [
    allow.authenticated(),
    allow.resource(subscribeFunction),
    allow.resource(unsubscribeFunction),
    allow.resource(ingestFeedFunction),
    allow.resource(refreshFeedsFunction),
    allow.resource(searchPodcastsFunction),
    allow.resource(topPodcastsFunction),
    allow.resource(stageDownloadFunction),
  ])

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
})
