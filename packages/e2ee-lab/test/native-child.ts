import { Effect } from 'effect';
import { execFile } from 'node:child_process';
/** Test process ownership: cancellation kills, and finalization awaits actual close. */
export function runOwnedChild(args: string[]) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
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
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
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
