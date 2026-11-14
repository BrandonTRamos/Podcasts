import { defineBackend } from '@aws-amplify/backend'
import { Stack } from 'aws-cdk-lib'
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { EventSourceMapping, FilterCriteria, FilterRule, StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { auth } from './auth/resource'
import { data } from './data/resource'
import { ingestFeedFunction } from './functions/ingest-feed/resource'
import { subscribeFunction } from './functions/subscribe/resource'

const backend = defineBackend({
  auth,
  data,
  subscribeFunction,
  ingestFeedFunction,
})

const { cfnUserPool, cfnIdentityPool } = backend.auth.resources.cfnResources

// Only an admin can create accounts: there is no self-sign-up.
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true }

// No guest (unauthenticated) identities.
cfnIdentityPool.allowUnauthenticatedIdentities = false

// Each new subscribe request starts the background ingest, through the request
// table's stream. Requests expire a day after they are made.
const requestTable = backend.data.resources.tables['SubscribeRequest']
backend.data.resources.cfnResources.amplifyDynamoDbTables['SubscribeRequest'].timeToLiveAttribute = {
  attributeName: 'expiresAt',
  enabled: true,
}
const ingestFeedLambda = backend.ingestFeedFunction.resources.lambda
const streamPolicy = new Policy(Stack.of(requestTable), 'IngestFeedStreamPolicy', {
  statements: [
    new PolicyStatement({
      actions: ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:ListStreams'],
      resources: [requestTable.tableStreamArn!],
    }),
  ],
})
ingestFeedLambda.role?.attachInlinePolicy(streamPolicy)
const streamMapping = new EventSourceMapping(Stack.of(requestTable), 'IngestFeedStreamMapping', {
  target: ingestFeedLambda,
  eventSourceArn: requestTable.tableStreamArn,
  startingPosition: StartingPosition.LATEST,
  batchSize: 1,
  retryAttempts: 2,
  filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual('INSERT') })],
})
streamMapping.node.addDependency(streamPolicy)
