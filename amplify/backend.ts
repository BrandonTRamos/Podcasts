import { defineBackend } from '@aws-amplify/backend'
import { auth } from './auth/resource'
import { data } from './data/resource'

const backend = defineBackend({
  auth,
  data,
})

const { cfnUserPool, cfnIdentityPool } = backend.auth.resources.cfnResources

// Only an admin can create accounts: there is no self-sign-up.
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true }

// No guest (unauthenticated) identities.
cfnIdentityPool.allowUnauthenticatedIdentities = false
