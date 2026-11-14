import { type ClientSchema, a, defineData } from '@aws-amplify/backend'
import { ingestFeedFunction } from '../functions/ingest-feed/resource'
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
        episodes: a.hasMany('Episode', 'podcastId'),
      })
      .secondaryIndexes((index) => [index('feedUrl')]),

    Episode: a.model({
      // Derived from the podcast and the item's GUID (see feeds/ingestFeed.ts).
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

    // The listener's place in an episode and whether they have heard it, synced
    // across devices. One per episode, created the first time it is saved;
    // `updatedAt` (kept by the data API) settles which of two saves wins.
    EpisodeState: a.model({
      // The episode's ID.
      id: a.id().required(),
      podcastId: a.id().required(),
      positionSeconds: a.float().required(),
      played: a.boolean().required(),
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
  })
  .authorization((allow) => [
    allow.authenticated(),
    allow.resource(subscribeFunction),
    allow.resource(ingestFeedFunction),
  ])

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
})
