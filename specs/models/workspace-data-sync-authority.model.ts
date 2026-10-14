// Proposed finite authority/placement model, not SDK/IPC/SQLite acceptance.
// Explores at most five steps, two owner generations and one persisted mode.
// Historical baseline and current provider/schedule gates intentionally differ.

type AuthorityModel = {
  mode: 'local' | 'cloud';
  placement: 'embedded' | 'independent';
  owner: 1 | 2;
  hydrated: boolean;
  baseline: boolean;
  current: boolean;
  connected: boolean;
  agentActive: boolean;
  admission: boolean;
  cancelledSetup: boolean;
};
type AuthorityEvent =
  | 'hydrate'
  | 'sync-1'
  | 'sync-2'
  | 'disconnect'
  | 'reconnect'
  | 'start-agent'
  | 'stop-agent'
  | 'switch'
  | 'restart'
  | 'cancel-setup';
function checkAuthority(value: unknown, rule: string): asserts value {
  if (!value) throw new Error(rule);
}
function baselineAllows(s: AuthorityModel): boolean {
  return s.hydrated && (s.mode === 'local' || s.baseline);
}
function currentAllows(s: AuthorityModel): boolean {
  return baselineAllows(s) && (s.mode === 'local' || (s.connected && s.current));
}
function stepAuthority(s: AuthorityModel, e: AuthorityEvent): AuthorityModel {
  const n = { ...s };
  if (e === 'hydrate') n.hydrated = true;
  const readyEpoch = e === 'sync-1' ? 1 : e === 'sync-2' ? 2 : undefined;
  if (readyEpoch === n.owner && n.connected && n.hydrated) {
    n.baseline = true;
    n.current = true;
  }
  if (e === 'disconnect') {
    n.connected = false;
    n.current = false;
  }
  if (e === 'reconnect') {
    n.connected = true;
    n.current = false;
  }
  // Execution is already authorized outside this model; cached/offline turns
  // must not acquire an accidental current-remote-authority prerequisite.
  if (e === 'start-agent' && n.admission && n.hydrated) n.agentActive = true;
  if (e === 'stop-agent') n.agentActive = false;
  if (e === 'cancel-setup') n.cancelledSetup = true;
  // This models the switch's committed end, after actual writers/ACP release.
  if (e === 'switch' && !n.agentActive && n.owner === 1) {
    n.placement = n.placement === 'embedded' ? 'independent' : 'embedded';
    n.owner = 2;
    n.hydrated = false;
    n.baseline = false;
    n.current = false;
  }
  if (e === 'restart' && n.owner === 1 && !n.agentActive) {
    n.owner = 2;
    n.hydrated = false;
    n.baseline = false;
    n.current = false;
    // Restart reads persisted placement; startup order cannot choose a new mode.
  }
  return n;
}

const events: readonly AuthorityEvent[] = [
  'hydrate',
  'sync-1',
  'sync-2',
  'disconnect',
  'reconnect',
  'start-agent',
  'stop-agent',
  'switch',
  'restart',
  'cancel-setup',
];
let states = 0,
  transitions = 0;
for (const mode of ['local', 'cloud'] as const) {
  for (const placement of ['embedded', 'independent'] as const) {
    const first: AuthorityModel = {
      mode,
      placement,
      owner: 1,
      hydrated: false,
      baseline: false,
      current: false,
      connected: true,
      agentActive: false,
      admission: true,
      cancelledSetup: false,
    };
    const visited = new Set<string>();
    const queue = [{ state: first, depth: 0 }];
    while (queue.length) {
      const entry = queue.shift()!;
      const s = entry.state,
        key = JSON.stringify(s);
      if (visited.has(key)) continue;
      visited.add(key);
      states++;
      const canStartSetup = currentAllows(s) && !s.cancelledSetup;
      checkAuthority(!canStartSetup || s.hydrated, 'AUTH: no execution from unhydrated index');
      checkAuthority(!s.cancelledSetup || !canStartSetup, 'CMD: cancel vetoes stale setup');
      if (mode === 'cloud' && !s.current)
        checkAuthority(!canStartSetup, 'AUTH: historical baseline cannot authorize current setup');
      if (mode === 'local' && s.hydrated)
        checkAuthority(currentAllows(s), 'AUTH: local-only does not wait for remote transport');
      if (entry.depth === 5) continue;
      for (const event of events) {
        const n = stepAuthority(s, event);
        transitions++;
        if (s.agentActive && event === 'switch')
          checkAuthority(
            n.placement === s.placement && n.owner === s.owner,
            'PLACE: no owner takeover while an Agent retains its resources'
          );
        if (event === 'restart')
          checkAuthority(n.placement === s.placement, 'PLACE: restart obeys persisted placement');
        if (n.owner !== s.owner)
          checkAuthority(
            !n.current && !n.baseline && !n.hydrated,
            'AUTH: new owner cannot retain an old authority proof'
          );
        queue.push({ state: n, depth: entry.depth + 1 });
      }
    }
  }
}

const cloud: AuthorityModel = {
  mode: 'cloud',
  placement: 'independent',
  owner: 1,
  hydrated: true,
  baseline: true,
  current: true,
  connected: true,
  agentActive: false,
  admission: true,
  cancelledSetup: false,
};
const disconnected = stepAuthority(cloud, 'disconnect');
checkAuthority(
  baselineAllows(disconnected) && !currentAllows(disconnected),
  'WITNESS: completed initial index differs from current execution authority'
);
checkAuthority(
  stepAuthority(disconnected, 'start-agent').agentActive,
  'WITNESS: this authority service does not veto an independently authorized offline Agent'
);
const reconnecting = stepAuthority(disconnected, 'reconnect');
checkAuthority(!currentAllows(reconnecting), 'WITNESS: connected is not synchronized');
const rebound = stepAuthority(cloud, 'restart');
const staleReplyEpoch = 1;
checkAuthority(
  rebound.owner !== staleReplyEpoch && !baselineAllows(rebound),
  'WITNESS: old ready reply cannot establish new-owner baseline'
);
const hydratedNewOwner = stepAuthority(rebound, 'hydrate');
const lateReady = stepAuthority(hydratedNewOwner, 'sync-1');
checkAuthority(
  !baselineAllows(lateReady) && !currentAllows(lateReady),
  'WITNESS: old ready delivery cannot publish authority after new owner hydration'
);
checkAuthority(
  currentAllows(stepAuthority(lateReady, 'sync-2')),
  'WITNESS: only a matching new-owner ready delivery establishes current authority'
);
console.log(
  JSON.stringify({
    validation: 'finite proposed authority/placement only',
    states,
    transitions,
    depth: 5,
    generations: 2,
    excludes: 'SDK, raw release, command codecs, persistence, IPC, clocks and real recovery',
  })
);

// Independent finite phase-two execution-publication model. One daemon, one
// turn, two lease generations, two local-clock ticks and two viewing refs.
// This tests proposed transitions, not actual IPC/Clock/SDK delivery.
type ExecutionLeaseModel = {
  host: boolean;
  linked: boolean;
  generation: 1 | 2;
  held: boolean;
  age: 0 | 1 | 2;
  rawActive: boolean;
  machine: boolean;
  turn: boolean;
  remoteGeneration: 0 | 1 | 2;
  clearing: 0 | 1 | 2;
  viewers: 0 | 1 | 2;
};
type ExecutionLeaseEvent =
  | 'heartbeat-1'
  | 'heartbeat-2'
  | 'silent-loss'
  | 'link-close'
  | 'tick'
  | 'reconnect'
  | 'acquire-2'
  | 'clear-delivery'
  | 'host-crash'
  | 'host-restart'
  | 'close-viewer'
  | 'raw-release';

function retirePublication(s: ExecutionLeaseModel): void {
  if (s.held) s.clearing = s.generation;
  s.held = false;
  s.machine = false;
  s.turn = false;
}
function stepExecutionLease(s: ExecutionLeaseModel, e: ExecutionLeaseEvent): ExecutionLeaseModel {
  const n = { ...s };
  if (e === 'silent-loss') n.linked = false; // no close event yet
  if (e === 'link-close') {
    n.linked = false;
    if (n.host) retirePublication(n);
  }
  if (e === 'tick' && n.host && n.held) {
    n.age = Math.min(2, n.age + 1) as 0 | 1 | 2;
    if (n.age === 2) retirePublication(n);
  }
  const heartbeat = e === 'heartbeat-1' ? 1 : e === 'heartbeat-2' ? 2 : 0;
  if (heartbeat === n.generation && n.host && n.linked && n.held) n.age = 0;
  if (e === 'reconnect' && n.host) n.linked = true;
  if (e === 'acquire-2' && n.host && n.linked && !n.held && n.generation === 1) {
    n.generation = 2;
    n.age = 0;
    n.held = true;
    n.machine = true;
    n.turn = n.rawActive;
    n.remoteGeneration = 2;
  }
  if (e === 'clear-delivery' && n.host) {
    if (n.clearing === n.remoteGeneration) n.remoteGeneration = 0;
    n.clearing = 0; // delivery for an old generation cannot clear a successor
  }
  if (e === 'host-crash') {
    n.host = false;
    n.linked = false;
    retirePublication(n);
    // Remote TTL/freshness is outside this local invalidation model.
  }
  if (e === 'host-restart') {
    n.host = true;
    n.linked = false;
    retirePublication(n);
  }
  if (e === 'close-viewer' && n.viewers) n.viewers = (n.viewers - 1) as 0 | 1;
  if (e === 'raw-release') {
    n.rawActive = false;
    n.turn = false;
  }
  return n;
}
const firstLease: ExecutionLeaseModel = {
  host: true,
  linked: true,
  generation: 1,
  held: true,
  age: 0,
  rawActive: true,
  machine: true,
  turn: true,
  remoteGeneration: 1,
  clearing: 0,
  viewers: 2,
};
const leaseEvents: readonly ExecutionLeaseEvent[] = [
  'heartbeat-1',
  'heartbeat-2',
  'silent-loss',
  'link-close',
  'tick',
  'reconnect',
  'acquire-2',
  'clear-delivery',
  'host-crash',
  'host-restart',
  'close-viewer',
  'raw-release',
];
const leaseQueue = [{ state: firstLease, depth: 0 }];
const leaseVisited = new Set<string>();
let leaseTransitions = 0;
while (leaseQueue.length) {
  const { state: s, depth } = leaseQueue.shift()!;
  const key = JSON.stringify(s);
  if (leaseVisited.has(key)) continue;
  leaseVisited.add(key);
  checkAuthority(
    !s.machine || (s.host && s.held && s.age < 2),
    'PRESENCE: online requires a live unexpired execution publication lease'
  );
  checkAuthority(
    !s.turn || (s.machine && s.rawActive),
    'PRESENCE: active turn requires both machine lease and actual execution'
  );
  if (depth === 5) continue;
  for (const event of leaseEvents) {
    const n = stepExecutionLease(s, event);
    leaseTransitions++;
    if (event !== 'raw-release')
      checkAuthority(n.rawActive === s.rawActive, 'EXEC: publication loss is not raw release');
    if (event === 'link-close' && s.host)
      checkAuthority(
        !n.machine && !n.turn && !n.held,
        'PRESENCE: close actively retires publication'
      );
    if (event === 'close-viewer')
      checkAuthority(
        n.held === s.held && n.machine === s.machine,
        'PRESENCE: viewing cannot renew or retire execution'
      );
    leaseQueue.push({ state: n, depth: depth + 1 });
  }
}
const lostLease = stepExecutionLease(firstLease, 'link-close');
checkAuthority(
  lostLease.host && lostLease.rawActive && !lostLease.machine && !lostLease.turn,
  'WITNESS: surviving host and Agent do not extend a disconnected publication'
);
const silentLease = stepExecutionLease(firstLease, 'silent-loss');
const expiredLease = stepExecutionLease(stepExecutionLease(silentLease, 'tick'), 'tick');
checkAuthority(
  !expiredLease.held && expiredLease.rawActive,
  'WITNESS: bounded local expiry does not wait for remote TTL or release the Agent'
);
const reboundLease = stepExecutionLease(stepExecutionLease(lostLease, 'reconnect'), 'acquire-2');
const lateHeartbeat = stepExecutionLease(stepExecutionLease(reboundLease, 'tick'), 'heartbeat-1');
checkAuthority(lateHeartbeat.age === 1, 'WITNESS: stale heartbeat cannot renew a successor lease');
checkAuthority(
  stepExecutionLease(reboundLease, 'clear-delivery').remoteGeneration === 2,
  'WITNESS: late clear cannot erase a successor publication'
);
checkAuthority(
  !stepExecutionLease(lostLease, 'heartbeat-1').held,
  'WITNESS: heartbeat cannot reacquire a retired lease'
);
checkAuthority(
  stepExecutionLease(stepExecutionLease(firstLease, 'host-crash'), 'host-restart').machine ===
    false,
  'WITNESS: restart must not republish cached execution'
);

console.log(
  JSON.stringify({
    validation: 'independent finite execution-publication proposal',
    states: leaseVisited.size,
    transitions: leaseTransitions,
    depth: 5,
    leaseGenerations: 2,
    localDeadlineTicks: 2,
    excludes:
      'real IPC, Effect Clock, SDK clear/freshness, remote TTL, raw release and server recovery',
  })
);
