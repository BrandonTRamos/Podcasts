import { type ClientSchema, a, defineData } from '@aws-amplify/backend'
import { refreshPodcastFunction } from '../functions/refresh-podcast/resource'
import { subscribeFunction } from '../functions/subscribe/resource'

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
        etag: a.string(),
        lastModified: a.string(),
        lastFetchedAt: a.datetime(),
        lastFetchError: a.string(),
        episodes: a.hasMany('Episode', 'podcastId'),
      })
      .secondaryIndexes((index) => [index('feedUrl')]),

    Episode: a.model({
      // Derived from the podcast and the item's GUID (see feeds/refreshPodcast.ts).
      id: a.id().required(),
      podcastId: a.id().required(),
      podcast: a.belongsTo('Podcast', 'podcastId'),
      guid: a.string().required(),
      title: a.string().required(),
      publishedAt: a.datetime(),
      durationSeconds: a.integer(),
      enclosureUrl: a.string().required(),
      enclosureType: a.string(),
      showNotes: a.string(),
    }),

    SubscribeOutcome: a.enum(['subscribed', 'alreadySubscribed', 'invalidUrl', 'unreachable', 'notAFeed']),

    SubscribeResult: a.customType({
      outcome: a.ref('SubscribeOutcome').required(),
      podcastId: a.id(),
    }),

    // Returns once the podcast is added. Its episodes arrive through data
    // subscriptions as the background refresh ingests them.
    subscribe: a
      .mutation()
      .arguments({ feedUrl: a.string().required() })
      .returns(a.ref('SubscribeResult').required())
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(subscribeFunction)),

    // Asynchronous: returns at once, and the refresh runs in the background.
    refreshPodcast: a
      .mutation()
      .arguments({ podcastId: a.id().required() })
      .authorization((allow) => [allow.authenticated()])
      .handler(a.handler.function(refreshPodcastFunction).async()),
  })
  .authorization((allow) => [
    allow.authenticated(),
    allow.resource(subscribeFunction),
    allow.resource(refreshPodcastFunction),
  ])

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
})
