import { App, NestedStack, Stack } from 'aws-cdk-lib'
import { Match, Template } from 'aws-cdk-lib/assertions'
import { Code, Function, Runtime, type IFunction } from 'aws-cdk-lib/aws-lambda'
import { Construct } from 'constructs'
import { describe, expect, it } from 'vitest'
import { readAlertsConfig, backendFunctions, defineAlerts, type AlertsConfig } from './alerts'

const OWNER = 'owner@example.com'

function lambda(scope: Construct, id: string) {
  return new Function(scope, id, {
    runtime: Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: Code.fromInline('exports.handler = async () => {}'),
  })
}

/** Synthesizes the alerts for a backend with these functions. */
function synthesize(functionNames: string[], config: AlertsConfig = { email: OWNER, monthlyBudgetUsd: 5 }) {
  const stack = new Stack(new App(), 'Backend')
  const functions: Record<string, IFunction> = {}
  for (const name of functionNames) functions[name] = lambda(stack, name)
  defineAlerts(stack, { ...config, functions })
  return { template: Template.fromStack(stack), stack, functions }
}

function topicRef(template: Template) {
  const topics = Object.keys(template.findResources('AWS::SNS::Topic'))
  expect(topics).toHaveLength(1)
  return { Ref: topics[0] }
}

describe('cost alert', () => {
  it('emails the owner when monthly spend passes the budget, 5 US dollars by default', () => {
    const config = readAlertsConfig({ TINCAN_ALERT_EMAIL: OWNER }, 'branch')
    const { template } = synthesize([], config)

    template.resourceCountIs('AWS::Budgets::Budget', 1)
    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: { BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: 5, Unit: 'USD' } },
      NotificationsWithSubscribers: [
        {
          Notification: {
            NotificationType: 'ACTUAL',
            ComparisonOperator: 'GREATER_THAN',
            Threshold: 100,
            ThresholdType: 'PERCENTAGE',
          },
          Subscribers: [{ SubscriptionType: 'SNS', Address: topicRef(template) }],
        },
      ],
    })
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: OWNER,
      TopicArn: topicRef(template),
    })
  })

  it('creates the budget only once AWS Budgets may publish to the topic', () => {
    // Budgets checks it may publish when the notification is created.
    const { template } = synthesize([])
    const [policy] = Object.keys(template.findResources('AWS::SNS::TopicPolicy'))
    const [budget] = Object.values(template.findResources('AWS::Budgets::Budget'))

    expect(budget.DependsOn).toContain(policy)
  })

  it('takes the budget from configuration', () => {
    const config = readAlertsConfig({ TINCAN_ALERT_EMAIL: OWNER, TINCAN_MONTHLY_BUDGET_USD: '12.5' }, 'branch')
    const { template } = synthesize([], config)

    template.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: { BudgetLimit: { Amount: 12.5, Unit: 'USD' } },
    })
  })

  it('lets AWS Budgets and CloudWatch publish to the alert topic', () => {
    const { template } = synthesize(['subscribe'])

    template.hasResourceProperties('AWS::SNS::TopicPolicy', {
      Topics: [topicRef(template)],
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: 'sns:Publish',
            Principal: { Service: Match.arrayWith(['budgets.amazonaws.com', 'cloudwatch.amazonaws.com']) },
          }),
        ]),
      },
    })
  })
})

describe('failure alerts', () => {
  it('emails the owner when any backend function fails repeatedly', () => {
    const { template, stack, functions } = synthesize(['subscribe', 'ingestFeed', 'refreshFeeds'])

    template.resourceCountIs('AWS::CloudWatch::Alarm', 3)
    for (const fn of Object.values(functions)) {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        Namespace: 'AWS/Lambda',
        MetricName: 'Errors',
        Dimensions: [{ Name: 'FunctionName', Value: { Ref: stack.getLogicalId(fn.node.defaultChild as never) } }],
        Statistic: 'Sum',
        Period: 3 * 60 * 60,
        EvaluationPeriods: 1,
        Threshold: 2,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        TreatMissingData: 'notBreaching',
        AlarmActions: [topicRef(template)],
      })
    }
    // One email subscription serves both kinds of alert, so the owner confirms once.
    template.resourceCountIs('AWS::SNS::Subscription', 1)
  })

  it('names the function in the alert', () => {
    const { template } = synthesize(['refreshFeeds'])

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmDescription: Match.stringLikeRegexp('refreshFeeds'),
    })
  })
})

describe('backend functions', () => {
  /** What Amplify's `defineFunction` makes: a construct whose `resources.lambda` is the function. */
  class AmplifyFunctionLike extends Construct {
    readonly resources: { lambda: IFunction }
    constructor(scope: Construct, id: string) {
      super(scope, id)
      this.resources = { lambda: lambda(scope, `${id}-lambda`) }
    }
  }

  it('finds every function in the backend, including ones added later', () => {
    const backend = new Stack(new App(), 'Backend')
    const data = new NestedStack(backend, 'data')
    const subscribe = new AmplifyFunctionLike(data, 'subscribe')
    // Not listed in defineBackend, only referenced from the data schema.
    const addedLater = new AmplifyFunctionLike(new NestedStack(backend, 'function'), 'added-later')
    // Amplify's own custom-resource functions are not the app's backend functions.
    lambda(data, 'AmplifyTableManagerOnEvent')

    expect(backendFunctions(backend)).toEqual({
      subscribe: subscribe.resources.lambda,
      'added-later': addedLater.resources.lambda,
    })
  })
})

describe('alerts configuration', () => {
  it('requires the owner email for a pipeline deploy', () => {
    expect(() => readAlertsConfig({}, 'branch')).toThrow(/TINCAN_ALERT_EMAIL/)
    expect(() => readAlertsConfig({ TINCAN_ALERT_EMAIL: '  ' }, 'branch')).toThrow(/TINCAN_ALERT_EMAIL/)
  })

  it('leaves alerts out of a sandbox with no owner email', () => {
    expect(readAlertsConfig({}, 'sandbox')).toBeUndefined()
  })

  it('adds alerts to a sandbox that sets the owner email', () => {
    expect(readAlertsConfig({ TINCAN_ALERT_EMAIL: OWNER }, 'sandbox')).toEqual({ email: OWNER, monthlyBudgetUsd: 5 })
  })

  it('refuses an address that is not an email', () => {
    expect(() => readAlertsConfig({ TINCAN_ALERT_EMAIL: 'owner' }, 'branch')).toThrow(/TINCAN_ALERT_EMAIL/)
  })

  it('refuses a budget that is not a positive number of dollars', () => {
    for (const budget of ['', 'five', '0', '-3']) {
      expect(() => readAlertsConfig({ TINCAN_ALERT_EMAIL: OWNER, TINCAN_MONTHLY_BUDGET_USD: budget }, 'branch')).toThrow(
        /TINCAN_MONTHLY_BUDGET_USD/,
      )
    }
  })
})
