import { Duration, Stack } from 'aws-cdk-lib'
import { CfnBudget } from 'aws-cdk-lib/aws-budgets'
import { Alarm, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam'
import { Function, type IFunction } from 'aws-cdk-lib/aws-lambda'
import { Topic } from 'aws-cdk-lib/aws-sns'
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions'
import type { Construct, IConstruct } from 'constructs'

/**
 * Alerts emailed to the owner (spec, "Delivery"): when the month's AWS spend
 * passes a budget, and when a backend function fails repeatedly. Both go
 * through one SNS topic with one email subscription, so the owner confirms
 * one subscription.
 */

/** The owner's email address. Configuration, never committed. */
const ALERT_EMAIL_VARIABLE = 'TINCAN_ALERT_EMAIL'
/** The monthly budget in US dollars. Optional. */
const MONTHLY_BUDGET_VARIABLE = 'TINCAN_MONTHLY_BUDGET_USD'
const DEFAULT_MONTHLY_BUDGET_USD = 5

/**
 * A function "fails repeatedly" when it fails this many times within this
 * many hours (CloudWatch periods are fixed windows, not rolling). The hourly
 * refresh failing three runs in a row always alerts; so does a burst of
 * failing requests.
 */
export const FAILURE_ALERT = { failures: 2, withinHours: 3 }

export interface AlertsConfig {
  email: string
  monthlyBudgetUsd: number
}

/** Amplify's deployment type: `branch` is the pipeline's, `sandbox` a developer's. */
type DeploymentType = 'sandbox' | 'branch' | 'standalone'

/** The deployment type Amplify synthesizes the backend for (its `amplify-backend-type` CDK context). */
export function deploymentType(backendStack: Stack): DeploymentType {
  return backendStack.node.getContext('amplify-backend-type') as DeploymentType
}

/**
 * Reads the alerts' configuration from the environment the backend is
 * synthesized in (Amplify Hosting's environment variables, for the pipeline).
 * A pipeline deploy without the owner's email fails, so production never runs
 * unwatched. A sandbox without it gets no alerts.
 */
export function readAlertsConfig(env: Record<string, string | undefined>, deployment: DeploymentType): AlertsConfig | undefined {
  const email = env[ALERT_EMAIL_VARIABLE]?.trim()
  if (!email) {
    if (deployment === 'sandbox') return undefined
    throw new Error(`Set ${ALERT_EMAIL_VARIABLE} to the email address that receives TinCan's cost and failure alerts.`)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`${ALERT_EMAIL_VARIABLE} is not an email address.`)
  }
  const budget = env[MONTHLY_BUDGET_VARIABLE]
  const monthlyBudgetUsd = budget === undefined ? DEFAULT_MONTHLY_BUDGET_USD : Number(budget.trim() || Number.NaN)
  if (!Number.isFinite(monthlyBudgetUsd) || monthlyBudgetUsd <= 0) {
    throw new Error(`${MONTHLY_BUDGET_VARIABLE} must be a positive number of US dollars, such as 5 or 12.50.`)
  }
  return { email, monthlyBudgetUsd }
}

/**
 * Every function made with Amplify's `defineFunction` anywhere in the
 * backend, by its name: those listed in `defineBackend` and those only the
 * data schema refers to. A new one is found, and alerted on, with no further
 * change. Amplify's own custom-resource functions are not included.
 */
export function backendFunctions(backendStack: IConstruct): Record<string, IFunction> {
  const functions: Record<string, IFunction> = {}
  for (const construct of backendStack.node.findAll()) {
    const lambda: unknown = (construct as { resources?: { lambda?: unknown } }).resources?.lambda
    if (lambda instanceof Function) functions[construct.node.id] = lambda
  }
  return functions
}

export function defineAlerts(scope: Construct, config: AlertsConfig & { functions: Record<string, IFunction> }): void {
  const { account } = Stack.of(scope)
  const topic = new Topic(scope, 'AlertTopic', { displayName: 'TinCan alerts' })
  topic.addSubscription(new EmailSubscription(config.email))
  topic.addToResourcePolicy(
    new PolicyStatement({
      principals: [new ServicePrincipal('budgets.amazonaws.com'), new ServicePrincipal('cloudwatch.amazonaws.com')],
      actions: ['sns:Publish'],
      resources: [topic.topicArn],
      conditions: { StringEquals: { 'aws:SourceAccount': account } },
    }),
  )

  // The whole account's spend, so nothing that costs money goes unseen.
  const budget = new CfnBudget(scope, 'MonthlyCostBudget', {
    budget: {
      budgetType: 'COST',
      timeUnit: 'MONTHLY',
      budgetLimit: { amount: config.monthlyBudgetUsd, unit: 'USD' },
    },
    notificationsWithSubscribers: [
      {
        notification: {
          notificationType: 'ACTUAL',
          comparisonOperator: 'GREATER_THAN',
          threshold: 100,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{ subscriptionType: 'SNS', address: topic.topicArn }],
      },
    ],
  })
  // Budgets checks it may publish to the topic when it creates the notification.
  budget.node.addDependency(topic)

  const emailOwner = new SnsAction(topic)
  for (const [name, fn] of Object.entries(config.functions)) {
    const alarm = new Alarm(scope, `${name}Failing`, {
      alarmDescription: `TinCan's ${name} failed ${FAILURE_ALERT.failures} or more times within ${FAILURE_ALERT.withinHours} hours. See its logs in CloudWatch.`,
      metric: fn.metricErrors({ statistic: 'Sum', period: Duration.hours(FAILURE_ALERT.withinHours) }),
      threshold: FAILURE_ALERT.failures,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    })
    alarm.addAlarmAction(emailOwner)
  }
}
