const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createQueueAdminService } = require('../packages/api/src/services/queueAdminService');
const { getReservedCreditAmount } = require('../packages/common/src/jobRepository');

async function testQueueFlushReconciliation() {
  const calls = [];
  const jobs = [
    { id: 'job-1', remove: async () => calls.push('remove:job-1') },
    { id: 'job-2', remove: async () => { throw new Error('already active'); } },
    { id: 'job-3', remove: async () => calls.push('remove:job-3') },
  ];
  const queue = {
    name: 'test-queue',
    isPaused: async () => false,
    pause: async () => calls.push('pause'),
    resume: async () => calls.push('resume'),
    getJobs: async (states) => {
      assert.deepStrictEqual(states, ['waiting', 'delayed', 'prioritized', 'paused']);
      return jobs;
    },
  };
  const jobRepository = {
    cancelJobs: async (ids) => {
      calls.push(`cancel:${ids.join(',')}`);
      return { cancelledIds: ids, releasedCredits: 25 };
    },
  };
  const logger = { warn: () => calls.push('warn') };
  const service = createQueueAdminService({ jobRepository, logger });

  const result = await service.flushQueue(queue);
  assert.deepStrictEqual(result, { removed: 2, cancelled: 2, releasedCredits: 25 });
  assert.deepStrictEqual(calls, [
    'pause',
    'remove:job-1',
    'warn',
    'remove:job-3',
    'cancel:job-1,job-3',
    'resume',
  ]);
}

async function testAlreadyPausedQueueStaysPaused() {
  let resumed = false;
  const queue = {
    name: 'paused-queue',
    isPaused: async () => true,
    pause: async () => { throw new Error('must not pause again'); },
    resume: async () => { resumed = true; },
    getJobs: async () => [],
  };
  const service = createQueueAdminService({
    jobRepository: {
      cancelJobs: async () => ({ cancelledIds: [], releasedCredits: 0 }),
    },
    logger: null,
  });

  await service.flushQueue(queue);
  assert.strictEqual(resumed, false);
}

async function testActiveJobCancellationIsRejected() {
  let cancelledInDatabase = false;
  const service = createQueueAdminService({
    jobRepository: {
      cancelJobs: async () => {
        cancelledInDatabase = true;
        return { cancelledIds: [], releasedCredits: 0 };
      },
    },
    logger: { warn: () => {} },
  });
  const activeJob = {
    remove: async () => { throw new Error('Job is locked by a worker'); },
  };
  const result = await service.removePendingJob([
    { name: 'api', getJob: async () => activeJob },
    { name: 'browser', getJob: async () => null },
  ], 'job-active');

  assert.strictEqual(result.found, true);
  assert.strictEqual(result.removed, false);
  assert.strictEqual(cancelledInDatabase, false);
}

async function testPendingJobCanBeRemoved() {
  let removed = false;
  const service = createQueueAdminService({
    jobRepository: {
      cancelJobs: async () => ({ cancelledIds: [], releasedCredits: 0 }),
    },
    logger: null,
  });
  const result = await service.removePendingJob([
    {
      name: 'api',
      getJob: async () => ({
        remove: async () => { removed = true; },
      }),
    },
    { name: 'browser', getJob: async () => null },
  ], 'job-pending');

  assert.strictEqual(removed, true);
  assert.deepStrictEqual(result, { found: true, removed: true, error: null });
}

function testReservedCreditDetection() {
  assert.strictEqual(getReservedCreditAmount({
    payload: { __billing: { creditReserved: true, creditCost: 50 } },
  }), 50);
  assert.strictEqual(getReservedCreditAmount({
    payload: { __billing: { creditReserved: false, creditCost: 50 } },
  }), 0);
  assert.strictEqual(getReservedCreditAmount({ payload: {} }), 0);
}

function testBootstrapIncludesRequiredDashboardData() {
  const routerPath = path.join(__dirname, '../packages/api/src/routes/adminRouter.js');
  const source = fs.readFileSync(routerPath, 'utf8');
  assert.match(source, /planRepository\.getAllPlans\(\)/, 'bootstrap must load subscription plans');
  assert.match(source, /\bplans,\s*\n\s*services,/, 'bootstrap response must include plans');
  assert.match(source, /jobRepository\.queryJobs\(\{\s*limit:\s*50\s*\}\)/, 'bootstrap must load recent jobs across statuses and queues');
}

function testAdminUiWiringContracts() {
  const groupsSource = fs.readFileSync(
    path.join(__dirname, '../frontend/src/app/components/GroupsPanel.jsx'),
    'utf8'
  );
  const authRepoSource = fs.readFileSync(
    path.join(__dirname, '../packages/common/src/authorizationRepository.js'),
    'utf8'
  );
  const jobRepoSource = fs.readFileSync(
    path.join(__dirname, '../packages/common/src/jobRepository.js'),
    'utf8'
  );
  const adminRouterSource = fs.readFileSync(
    path.join(__dirname, '../packages/api/src/routes/adminRouter.js'),
    'utf8'
  );
  const usersSource = fs.readFileSync(
    path.join(__dirname, '../frontend/src/app/components/UsersPanel.jsx'),
    'utf8'
  );
  const authHookSource = fs.readFileSync(
    path.join(__dirname, '../frontend/src/app/hooks/useAuth.js'),
    'utf8'
  );
  const loginSource = fs.readFileSync(
    path.join(__dirname, '../frontend/src/app/components/LoginPage.jsx'),
    'utf8'
  );

  assert.doesNotMatch(groupsSource, /setShowAddModal/, 'Groups empty state must use the existing form state setter');
  assert.match(groupsSource, /onClick=\{\(\) => setShowAdd\(true\)\}/, 'Groups empty state must open the add form');
  assert.match(jobRepoSource, /user_phone = \?/, 'Jobs must support filtering by the phone shown in the UI');
  assert.match(authRepoSource, /canonical_phone = \?/, 'Activity must support filtering by the phone shown in the UI');
  assert.match(
    adminRouterSource,
    /getUsersWithSpentCredits\(\{ includeInactive: true \}\)/,
    'Admin user lists must include inactive users so they can be reactivated'
  );
  assert.match(usersSource, /typeof value === 'object'/, 'User editor must accept JSONB overrides returned as objects');
  assert.match(usersSource, /parsed\.slice\(0, 10\)/, 'User expiry timestamps must be normalized for date inputs');
  assert.match(authHookSource, /queryClient\.clear\(\)/, 'Logout must clear cached protected data');
  assert.match(loginSource, /removeQueries\(\{ queryKey: \['session-verify'\] \}\)/, 'Login must force fresh session verification');
}

function testWorkflowScope() {
  const workflows = path.join(__dirname, '../.github/workflows');
  assert.strictEqual(fs.existsSync(path.join(workflows, 'ci.yml')), false, 'CI workflow should be removed');
  assert.strictEqual(fs.existsSync(path.join(workflows, 'container-smoke.yml')), false, 'Container smoke workflow should be removed');
  assert.strictEqual(fs.existsSync(path.join(workflows, 'docker-publish.yml')), true, 'GHCR publishing workflow must remain');
}

async function run() {
  await testQueueFlushReconciliation();
  await testAlreadyPausedQueueStaysPaused();
  await testActiveJobCancellationIsRejected();
  await testPendingJobCanBeRemoved();
  testReservedCreditDetection();
  testBootstrapIncludesRequiredDashboardData();
  testAdminUiWiringContracts();
  testWorkflowScope();
  console.log('Admin dashboard regression tests passed.');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
