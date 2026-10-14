import { Effect } from 'effect';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
/** Test process ownership: cancellation kills, and finalization awaits actual close. */
export function runOwnedChild(args: string[]) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const started = performance.now();
      let complete!: (value: string) => void, reject!: (error: Error) => void;
      const output = new Promise<string>((resolve, fail) => {
        complete = resolve;
        reject = fail;
      });
      const child = execFile(
        process.execPath,
        args,
        { maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) reject(error);
          else complete(stdout);
        }
      );
      const closed = new Promise<void>((resolve) =>
        child.once('close', () => {
          // Diagnostics only, never a timing assertion or a product deadline.
          console.info(
            'LAB_CHILD_SETTLED',
            JSON.stringify({
              script: basename(args[2] ?? 'node'),
              elapsedMs: Math.round(performance.now() - started),
              code: child.exitCode,
              signal: child.signalCode,
            })
          );
          resolve();
        })
      );
      output.catch(() => undefined);
      return { child, closed, output };
    }),
    (lease) => Effect.tryPromise({ try: () => lease.output, catch: (cause) => cause }),
    (lease) =>
      Effect.promise(async () => {
        if (lease.child.exitCode === null && lease.child.signalCode === null) lease.child.kill();
        await lease.closed;
      })
  );
}
