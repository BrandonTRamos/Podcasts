import { type ClientSchema, a, defineData } from '@aws-amplify/backend'

// Single-user app: every model is readable and writable by the signed-in user
// only, with no per-owner rules. Requests without a Cognito token are refused.
const schema = a
  .schema({
    Podcast: a.model({
      feedUrl: a.url().required(),
      title: a.string(),
      author: a.string(),
      artworkUrl: a.url(),
      etag: a.string(),
      lastModified: a.string(),
      lastFetchedAt: a.datetime(),
      lastFetchError: a.string(),
    }),
  })
  .authorization((allow) => [allow.authenticated()])

export type Schema = ClientSchema<typeof schema>

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
})
