import { defineBackend } from '@aws-amplify/backend'
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam'
import { EventSourceMapping, FilterCriteria, FilterRule, StartingPosition } from 'aws-cdk-lib/aws-lambda'
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from 'aws-cdk-lib/aws-s3'
import { backendFunctions, defineAlerts, deploymentType, readAlertsConfig } from './alerts/alerts'
import { auth } from './auth/resource'
import { data } from './data/resource'
import { ingestFeedFunction } from './functions/ingest-feed/resource'
import { keepEpisodeFunction } from './functions/keep-episode/resource'
import { refreshFeedsFunction } from './functions/refresh-feeds/resource'
import { searchEpisodesFunction } from './functions/search-episodes/resource'
import { searchPodcastsFunction } from './functions/search-podcasts/resource'
import { stageDownloadFunction } from './functions/stage-download/resource'
import { subscribeFunction } from './functions/subscribe/resource'
import { topPodcastsFunction } from './functions/top-podcasts/resource'
import { unsubscribeFunction } from './functions/unsubscribe/resource'

const backend = defineBackend({
  auth,
  data,
  subscribeFunction,
  unsubscribeFunction,
  ingestFeedFunction,
  refreshFeedsFunction,
  searchPodcastsFunction,
  searchEpisodesFunction,
  keepEpisodeFunction,
  topPodcastsFunction,
  stageDownloadFunction,
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

// Download fallback: a private bucket for temporary copies of episodes whose
// hosts block direct download. Reachable only through the presigned links the
// stager makes; every copy is deleted within a day of its making.
const stageDownloadLambda = backend.stageDownloadFunction.resources.lambda
const stagingBucket = new Bucket(Stack.of(stageDownloadLambda), 'DownloadStagingBucket', {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  lifecycleRules: [{ expiration: Duration.days(1), abortIncompleteMultipartUploadAfter: Duration.days(1) }],
  // The app downloads a copy straight from the bucket, resuming with range requests.
  cors: [
    {
      allowedOrigins: ['https://main.d1s9jkcv1hp6j9.amplifyapp.com', 'http://localhost:5173'],
      allowedMethods: [HttpMethods.GET, HttpMethods.HEAD],
      allowedHeaders: ['Range'],
      exposedHeaders: ['Content-Length', 'Content-Range', 'ETag'],
      maxAge: 3600,
    },
  ],
  removalPolicy: RemovalPolicy.DESTROY,
  autoDeleteObjects: true,
})
stagingBucket.grantPut(stageDownloadLambda)
// The hourly run deletes copies older than a day (stageDownload.ts); the lifecycle rule is the backstop.
stagingBucket.grantDelete(stageDownloadLambda)
// Presigned links act as the function's role, so it must be able to read the copies.
stagingBucket.grantRead(stageDownloadLambda)
backend.stageDownloadFunction.addEnvironment('STAGING_BUCKET', stagingBucket.bucketName)
backend.data.resources.cfnResources.amplifyDynamoDbTables['DownloadStaging'].timeToLiveAttribute = {
  attributeName: 'expiresAt',
  enabled: true,
}
// The listener is told of a failure and can try again; Lambda retrying it as well would copy the file again unseen.
stageDownloadLambda.configureAsyncInvoke({ retryAttempts: 0 })

// Cost and failure alerts, emailed to the owner (amplify/alerts/alerts.ts).
// Every backend function is covered, including ones added later.
const alerts = readAlertsConfig(process.env, deploymentType(backend.stack))
if (alerts) defineAlerts(backend.createStack('alerts'), { ...alerts, functions: backendFunctions(backend.stack) })
