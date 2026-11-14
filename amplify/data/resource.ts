import { type ClientSchema, a, defineData } from '@aws-amplify/backend'

// Single-user app: every model is readable and writable by the signed-in user
// only, with no per-owner rules. Requests without a Cognito token are refused.
const schema = a
  .schema({
    // Only what the library screen reads. Later tickets add feed and refresh fields.
    Podcast: a.model({
      title: a.string().required(),
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
