import { defineBackend } from '@aws-amplify/backend'
import { Stack } from 'aws-cdk-lib'
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { EventSourceMapping, FilterCriteria, FilterRule, StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { auth } from './auth/resource'
import { data } from './data/resource'
import { ingestFeedFunction } from './functions/ingest-feed/resource'
import { refreshFeedsFunction } from './functions/refresh-feeds/resource'
import { searchPodcastsFunction } from './functions/search-podcasts/resource'
import { subscribeFunction } from './functions/subscribe/resource'
import { unsubscribeFunction } from './functions/unsubscribe/resource'

const backend = defineBackend({
  auth,
  data,
  subscribeFunction,
  unsubscribeFunction,
  ingestFeedFunction,
  refreshFeedsFunction,
  searchPodcastsFunction,
})

const { cfnUserPool, cfnIdentityPool } = backend.auth.resources.cfnResources

// Only an admin can create accounts: there is no self-sign-up.
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true }

// No guest (unauthenticated) identities.
cfnIdentityPool.allowUnauthenticatedIdentities = false

// Each new subscribe request starts the background ingest, through the request
// table's stream. Requests expire a day after they are made. A few are ingested
// at once, so an OPML import of many feeds is not ingested one after another.
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
  parallelizationFactor: 4,
  retryAttempts: 2,
  filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual('INSERT') })],
})
streamMapping.node.addDependency(streamPolicy)

// A failed run is not retried: the next hourly run is the retry. Lambda's
// default of two retries would fetch every feed again for one failing podcast.
backend.refreshFeedsFunction.resources.lambda.configureAsyncInvoke({ retryAttempts: 0 })
