// Only this application boundary executes the Effect runtime.
import { mkdirSync, openSync, closeSync, readSync } from 'node:fs';
function readBounded(path: string, limit: number) {
  const fd = openSync(path, 'r');
  try {
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > limit) throw new Error('input-budget');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally {
    closeSync(fd);
  }
}
import { resolve } from 'node:path';
import { Cause, Effect, Exit, Schema } from 'effect';
import { runLabScenario } from './platform/scenario-runner';
const Artifact = Schema.Struct({
  version: Schema.Literal(1),
  syntheticOnly: Schema.Literal(true),
  run: Schema.Struct({
    verdict: Schema.Literals([
      'pass',
      'violation',
      'unavailable',
      'outside-model',
      'harness-error',
    ]),
  }),
});
const [command, output, plan] = process.argv.slice(2);
const main = Effect.gen(function* () {
  if (command === 'inspect' && output) {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(readBounded(resolve(output), 64 * 1024 * 1024)) as unknown,
      catch: (cause) => cause,
    });
    const artifact = yield* Effect.fromResult(Schema.decodeUnknownResult(Artifact)(parsed));
    console.log(JSON.stringify(artifact));
    process.exitCode =
      artifact.run.verdict === 'pass' ? 0 : artifact.run.verdict === 'harness-error' ? 1 : 2;
    return;
  }
  if (command !== 'run' || !output) {
    console.error(
      'Usage: e2ee-lab run <new-output-directory> [actions.json] | inspect <evidence.json>'
    );
    process.exitCode = 64;
    return;
  }
  const directory = resolve(output);
  const actions = plan
    ? yield* Effect.try({
        try: () => {
          const body = readBounded(resolve(plan), 1024 * 1024);
          if (body.length > 1024 * 1024) throw new Error('plan-budget');
          return JSON.parse(body) as unknown[];
        },
        catch: (cause) => cause,
      })
    : undefined;
  yield* Effect.try({ try: () => mkdirSync(directory, { mode: 0o700 }), catch: (cause) => cause });
  const result = yield* runLabScenario({ directory, actions });
  console.log(
    JSON.stringify({
      directory,
      verdict: result.run.verdict,
      actions: result.run.observations.length,
      report: result.report,
      limits: result.limits,
    })
  );
  process.exitCode =
    result.run.verdict === 'pass' ? 0 : result.run.verdict === 'harness-error' ? 1 : 2;
});
const abort = new AbortController();
const stop = () => abort.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const exit = await Effect.runPromiseExit(main, { signal: abort.signal });
process.off('SIGINT', stop);
process.off('SIGTERM', stop);
if (Exit.isFailure(exit)) {
  console.error(
    JSON.stringify({ error: 'Lab execution failed', cause: String(Cause.squash(exit.cause)) })
  );
  process.exitCode = 1;
}
