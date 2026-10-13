import {Effect, Result} from 'effect';
import {StreamsClient} from '@loro-dev/streams-client';
import {Bytes} from '@lody/e2ee-core';
import {makeStreamsSubmissionRemote} from '@lody/e2ee-core/submission/streams';
import {SubmissionRemote,resumeSubmission} from '@lody/e2ee-core/submission';
import {sqliteSubmissionJournal} from '@lody/e2ee-core/submission/sqlite';
const input=JSON.parse(process.argv[2]!);
const anchor=Result.getOrThrow(Bytes.genesisHash(Buffer.from(input.genesis,'hex')));
const result=await Effect.runPromise(Effect.scoped(Effect.gen(function*(){
 const remote=yield*makeStreamsSubmissionRemote({genesis:anchor,stream:new StreamsClient({url:input.url,retry:{maxAttempts:1}}),checkpoint:()=>Effect.succeed({head:Result.getOrThrow(Bytes.recordHash(Buffer.from(input.head,'hex'))),length:input.count}),budget:{maxRecords:100,maxBytes:100000}});
 return yield*resumeSubmission(anchor).pipe(Effect.provideService(SubmissionRemote,remote),Effect.provide(sqliteSubmissionJournal(input.path)));
})));
console.log(JSON.stringify({pid:process.pid,outcome:result?.outcome,record:result?Buffer.from(result.record).toString('hex'):null}));
