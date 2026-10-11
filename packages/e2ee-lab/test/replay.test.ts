import { describe, expect, it } from 'vitest';
import { firstReplayDivergence, type ReplayMaterial } from '../src/pure/replay';

function material() {
  return {
    events: [
      {
        eventId: 'e1',
        step: 0,
        time: 100,
        actor: 'alice',
        operation: 'pull',
        phase: 'fetch',
        status: 'completed' as const,
      },
    ],
    entropy: [{ label: 'synthetic-peer', bytes: new Uint8Array([1, 2]) }],
    frames: [
      {
        eventId: 'e1',
        actor: 'alice',
        operation: 'pull',
        phase: 'fetch',
        url: '/ds/synthetic-A/loro',
        requestHex: '0102',
        responseHex: '0304',
        responseStatus: 200,
      },
    ],
  } satisfies ReplayMaterial;
}
describe('recorded fixture replay comparison without resealing', () => {
  it('locates changed resource, actor, event identity, payload, status and entropy rather than treating a final verdict as replay evidence', () => {
    const expected = material();
    expect(firstReplayDivergence(expected, material())).toBeNull();
    for (const [field, value] of [
      ['url', '/ds/synthetic-B/loro'],
      ['actor', 'bob'],
      ['eventId', 'e2'],
      ['requestHex', '0103'],
      ['responseHex', '0305'],
      ['responseStatus', 403],
    ] as const) {
      const actual = material();
      actual.frames[0] = { ...actual.frames[0]!, [field]: value };
      const divergent = firstReplayDivergence(expected, actual)!;
      expect(divergent.index).toBe(0);
      expect(divergent.field).toBe(
        `frame.${field === 'requestHex' ? 'request' : field === 'responseHex' ? 'response' : field === 'responseStatus' ? 'status' : field}`
      );
      expect(divergent.expected).not.toBe(divergent.actual);
    }
    const event = material();
    event.events[0] = { ...event.events[0]!, phase: 'persist' };
    expect(firstReplayDivergence(expected, event)?.field).toBe('phase');
    const missing = material();
    missing.entropy.length = 0;
    expect(firstReplayDivergence(expected, missing)?.field).toBe('entropy');
    const bytes = material();
    bytes.entropy[0]!.bytes[1] = 3;
    expect(firstReplayDivergence(expected, bytes)?.field).toBe('entropy.bytes');
  });
});
