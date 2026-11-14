import { defineAuth } from '@aws-amplify/backend'

/**
 * One Cognito account, signed in by email. Self-sign-up and guest access are
 * switched off in `backend.ts`; the owner's account is created by an admin.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
})
