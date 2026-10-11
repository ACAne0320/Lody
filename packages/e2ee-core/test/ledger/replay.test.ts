import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Result } from 'effect';
import * as Bytes from '../../src/bytes';
import { encodeCbor, type CborValue } from '../../src/cbor';
import { keyId } from '../../src/identifiers';
import * as Ledger from '@lody/e2ee-core/ledger';

const ok = <A, E>(r: Result.Result<A, E>): A => Result.getOrThrow(r);
const filled = (n: number, size = 32) => new Uint8Array(size).fill(n);
const id = (n: number) => filled(n, 16);
const hex = (v: { toBytes(): Uint8Array }) => keyId(v.toBytes());
function keys(n: number) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), filled(n)]),
    format: 'der',
    type: 'pkcs8',
  });
  const pk = new Uint8Array(
    createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32)
  );
  return {
    pk,
    enc: filled(n + 100),
    sign: (message: Uint8Array) => new Uint8Array(sign(null, message, privateKey)),
  };
}
type Keys = ReturnType<typeof keys>;
const owner = keys(1),
  bob = keys(2),
  carol = keys(3),
  phone = keys(4),
  machine = keys(5),
  recovery = keys(6),
  attacker = keys(7);
function domain(name: string, payload: Uint8Array) {
  return new Uint8Array(Buffer.concat([Buffer.from(`lody-e2ee/${name}\0`), payload]));
}
function signed(body: readonly CborValue[], signer: Keys, signature?: Uint8Array) {
  const bytes = ok(encodeCbor(body));
  return ok(encodeCbor([body, signature ?? signer.sign(domain('sig/v1', bytes))]));
}
function checkpoint(records: Uint8Array[]): Ledger.LedgerCheckpoint {
  return { head: Ledger.hashRecordBytes(records[records.length - 1]!), length: records.length };
}
function org() {
  const genesis = signed([1, owner.pk, filled(10), id(10), owner.enc, filled(20)], owner);
  const anchor = ok(Bytes.genesisHash(Ledger.hashRecordBytes(genesis).toBytes()));
  const records = [genesis];
  const verify = () => Ledger.verifyLedger({ anchor, records, checkpoint: checkpoint(records) });
  const append = (
    signer: Keys,
    op: readonly CborValue[],
    sig?: Uint8Array,
    parent = checkpoint(records).head.toBytes()
  ) => {
    const record = signed([parent, signer.pk, op], signer, sig);
    records.push(record);
    return record;
  };
  const join = (target: Keys, n: number, proofAnchor = anchor) => {
    const body = [id(n), filled(n), target.pk, target.enc, null] as const;
    return [
      1,
      id(n),
      [...body, target.sign(domain('join/v1', ok(encodeCbor([proofAnchor.toBytes(), ...body]))))],
    ] as const;
  };
  const device = (target: Keys, kind: number, membership = id(10), proofAnchor = anchor) => {
    const message = domain(
      'possess/v2',
      ok(encodeCbor([proofAnchor.toBytes(), membership, target.pk, target.enc, kind]))
    );
    return [4, kind, target.pk, target.enc, target.sign(message)] as const;
  };
  return { anchor, records, verify, append, join, device };
}
function code<A>(r: Result.Result<A, Ledger.LedgerError>) {
  return Result.isFailure(r) ? r.failure.code : 'accepted';
}
function comparable(view: Ledger.LedgerView) {
  const s = view.inspectState();
  return {
    head: hex(view.head),
    length: view.length,
    owner: hex(s.owner),
    epoch: { ...s.epoch, keyCommitment: hex(s.epoch.keyCommitment) },
    members: [...s.members].map(([k, v]) => [k, hex(v.userId), v.role]),
    devices: [...s.devices].map(([k, v]) => [
      k,
      hex(v.membershipId),
      v.kind,
      hex(v.encryptionPublicKey),
    ]),
  };
}

describe('strict records and caller-pinned chain', () => {
  it('uses unchanged native-signed byte domains and P07-a verifier', () => {
    const o = org();
    const parsed = ok(Ledger.decodeRecord(o.records[0]));
    expect(Ledger.hashRecordBytes(o.records[0]!).toBytes()).toEqual(
      new Uint8Array(createHash('sha256').update(domain('rec/v1', o.records[0]!)).digest())
    );
    expect(Ledger.recordSigningBytes(parsed.bodyBytes)).toEqual(domain('sig/v1', parsed.bodyBytes));
    o.append(owner, o.join(bob, 11));
    const op = ok(Ledger.decodeRecord(o.records[1])).body;
    if (op.type !== 'ordinary' || op.operation.type !== 'admitMember') throw new Error('fixture');
    expect(ok(Ledger.joinRequestSigningBytes(o.anchor, op.operation.request))).toEqual(
      domain(
        'join/v1',
        ok(encodeCbor([o.anchor.toBytes(), id(11), filled(11), bob.pk, bob.enc, null]))
      )
    );
    o.append(owner, o.device(phone, 0));
    const d = ok(Ledger.decodeRecord(o.records[2])).body;
    if (d.type !== 'ordinary' || d.operation.type !== 'admitDevice') throw new Error('fixture');
    expect(
      ok(
        Ledger.possessionSigningBytes({
          genesis: o.anchor,
          targetMembershipId: ok(Bytes.membershipId(id(10))),
          ...d.operation,
        })
      )
    ).toEqual(
      domain('possess/v2', ok(encodeCbor([o.anchor.toBytes(), id(10), phone.pk, phone.enc, 0])))
    );
    expect(ok(o.verify()).length).toBe(3);
  });
  it('rejects every byte truncation, trailing bytes, noncanonical integers and unknown versions/tags', () => {
    const o = org(),
      record = o.records[0]!;
    for (let n = 0; n < record.length; n++)
      expect(Result.isFailure(Ledger.decodeRecord(record.slice(0, n))), `cut ${n}`).toBe(true);
    expect(Result.isFailure(Ledger.decodeRecord(new Uint8Array([...record, 0])))).toBe(true);
    expect(
      Result.isFailure(
        Ledger.decodeRecord(new Uint8Array([...record.slice(0, 2), 0x18, 1, ...record.slice(3)]))
      )
    ).toBe(true);
    expect(
      code(
        Ledger.decodeRecord(signed([2, owner.pk, filled(10), id(10), owner.enc, filled(20)], owner))
      )
    ).toBe('unknown-version');
    for (const op of [[99], [2, id(11)]]) {
      expect(code(Ledger.decodeRecord(signed([o.anchor.toBytes(), owner.pk, op], owner)))).toBe(
        'unknown-operation'
      );
    }
    for (const op of [
      [3, id(11), 0],
      [4, 3, phone.pk, phone.enc, filled(0, 64)],
      [7, 0, filled(1), filled(2, 72)],
      [7, 1, filled(1), filled(2, 71)],
    ])
      expect(
        Result.isFailure(Ledger.decodeRecord(signed([o.anchor.toBytes(), owner.pk, op], owner)))
      ).toBe(true);
  });
  it('rejects empty/missing/duplicated/reordered records and mismatched checkpoints', () => {
    const o = org();
    o.append(owner, o.join(bob, 11));
    o.append(owner, [3, id(11), 1]);
    const endpoint = checkpoint(o.records);
    for (const records of [
      [],
      o.records.slice(0, 2),
      [o.records[0]!, o.records[2]!],
      [...o.records, o.records[2]!],
      [o.records[0]!, o.records[2]!, o.records[1]!],
    ])
      expect(
        Result.isFailure(Ledger.verifyLedger({ anchor: o.anchor, records, checkpoint: endpoint }))
      ).toBe(true);
    const dup = [o.records[0]!, o.records[1]!, o.records[1]!];
    expect(
      code(Ledger.verifyLedger({ anchor: o.anchor, records: dup, checkpoint: checkpoint(dup) }))
    ).toBe('wrong-parent');
    expect(
      code(
        Ledger.verifyLedger({
          anchor: o.anchor,
          records: o.records,
          checkpoint: { ...endpoint, head: ok(Bytes.recordHash(filled(99))) },
        })
      )
    ).toBe('checkpoint-mismatch');
  });
  it('rejects wrong genesis, signatures, predecessor and cross-Org proofs', () => {
    const o = org();
    expect(
      code(
        Ledger.verifyLedger({
          anchor: ok(Bytes.genesisHash(filled(99))),
          records: o.records,
          checkpoint: checkpoint(o.records),
        })
      )
    ).toBe('wrong-anchor');
    o.append(owner, [7, 1, filled(21), filled(30, 72)], filled(0, 64));
    const r = o.verify();
    expect(code(r)).toBe('bad-signature');
    expect(Result.isFailure(r) && r.failure.position).toBe(1);
    for (const attack of [
      'parent',
      'join-org',
      'possession-org',
      'possession-membership',
      'possession-kind',
      'join-key',
      'outer-key',
    ]) {
      const p = org();
      if (attack === 'parent')
        p.append(owner, [7, 1, filled(21), filled(30, 72)], undefined, filled(90));
      if (attack === 'join-org')
        p.append(owner, p.join(bob, 11, ok(Bytes.genesisHash(filled(99)))));
      if (attack === 'possession-org')
        p.append(owner, p.device(phone, 0, id(10), ok(Bytes.genesisHash(filled(99)))));
      if (attack === 'possession-membership') p.append(owner, p.device(phone, 0, id(11)));
      if (attack === 'possession-kind') {
        const d = [...p.device(phone, 0)];
        d[1] = 1;
        p.append(owner, d);
      }
      if (attack === 'join-key') {
        const j = p.join(bob, 11);
        const req = [...j[2]];
        req[2] = carol.pk;
        p.append(owner, [1, id(11), req]);
      }
      if (attack === 'outer-key') {
        const body = [p.anchor.toBytes(), owner.pk, [7, 1, filled(21), filled(30, 72)]] as const;
        p.records.push(signed(body, attacker));
      }
      expect(code(p.verify()), attack).toBe(
        attack === 'parent'
          ? 'wrong-parent'
          : attack === 'outer-key'
            ? 'bad-signature'
            : 'bad-proof'
      );
    }
  });
});

describe('deterministic permissions from preceding state', () => {
  it.each(['member', 'guest', 'admin'] as const)(
    '%s cannot change roles or transfer Owner',
    (role) => {
      for (const op of [
        [3, id(12), 1],
        [6, id(12)],
      ]) {
        const o = org();
        o.append(owner, o.join(bob, 11));
        o.append(owner, o.join(carol, 12));
        if (role !== 'member') o.append(owner, [3, id(11), role === 'guest' ? 3 : 1]);
        o.append(bob, op);
        expect(code(o.verify())).toBe('unauthorized');
      }
    }
  );
  it.each(['member', 'guest'] as const)('%s cannot invite or publish epochs', (role) => {
    for (const operation of ['join', 'epoch']) {
      const o = org();
      o.append(owner, o.join(bob, 11));
      if (role === 'guest') o.append(owner, [3, id(11), 3]);
      o.append(bob, operation === 'join' ? o.join(carol, 12) : [7, 1, filled(21), filled(30, 72)]);
      expect(code(o.verify())).toBe('unauthorized');
    }
  });
  it.each([1, 2])('Owner device kind %i cannot manage, revoke, or invite', (kind) => {
    for (const op of ['epoch', 'join', 'revoke', 'transfer']) {
      const o = org();
      o.append(owner, o.join(bob, 11));
      o.append(owner, o.device(machine, kind));
      o.append(
        machine,
        op === 'epoch'
          ? [7, 1, filled(21), filled(30, 72)]
          : op === 'join'
            ? o.join(carol, 12)
            : op === 'revoke'
              ? [5, owner.pk]
              : [6, id(11)]
      );
      expect(code(o.verify())).toBe('unauthorized');
    }
  });
  it('Admin can invite Member and rotate; demotion removes management from all personal devices', () => {
    const o = org();
    o.append(owner, o.join(bob, 11));
    o.append(owner, [3, id(11), 1]);
    o.append(bob, o.device(phone, 0, id(11)));
    o.append(phone, o.join(carol, 12));
    o.append(phone, [7, 1, filled(21), filled(30, 72)]);
    expect(
      ok(o.verify())
        .inspectState()
        .members.get(keyId(id(12)))?.role
    ).toBe('member');
    o.append(owner, [3, id(11), 2]);
    const view = ok(o.verify());
    for (const signer of [bob, phone]) {
      const record = signed(
        [view.head.toBytes(), signer.pk, [7, 2, filled(22), filled(30, 72)]],
        signer
      );
      expect(
        code(
          Ledger.extendLedger(view, [record], {
            head: Ledger.hashRecordBytes(record),
            length: view.length + 1,
          })
        )
      ).toBe('unauthorized');
    }
  });
  it('Owner cannot demote itself or revoke its last governing device, and cannot revoke another member device', () => {
    for (const op of [
      [3, id(10), 1],
      [5, owner.pk],
      [5, bob.pk],
    ]) {
      const o = org();
      o.append(owner, o.join(bob, 11));
      o.append(owner, op);
      expect(code(o.verify())).toBe('unauthorized');
    }
  });
  it('recovery admits only own personal devices; revoked approver does not revoke its approved child', () => {
    const o = org();
    o.append(owner, o.device(recovery, 2));
    o.append(recovery, o.device(phone, 0));
    o.append(owner, [5, recovery.pk]);
    const view = ok(o.verify());
    expect(view.inspectState().devices.has(keyId(phone.pk))).toBe(true);
    o.append(phone, [7, 1, filled(21), filled(30, 72)]);
    expect(code(o.verify())).toBe('accepted');
    for (const kind of [1, 2]) {
      const p = org();
      p.append(owner, p.device(recovery, 2));
      p.append(recovery, p.device(phone, kind));
      expect(code(p.verify())).toBe('unauthorized');
    }
  });
  it('Guest can recover own personal device, cannot register machine; Owner may transfer to a Guest with R', () => {
    const o = org();
    o.append(owner, o.join(bob, 11));
    o.append(bob, o.device(recovery, 2, id(11)));
    o.append(owner, [3, id(11), 3]);
    o.append(recovery, o.device(phone, 0, id(11)));
    o.append(bob, [5, bob.pk]);
    o.append(owner, [6, id(11)]);
    const s = ok(o.verify()).inspectState();
    expect(hex(s.owner)).toBe(keyId(id(11)));
    expect(s.members.get(keyId(id(10)))?.role).toBe('admin');
    const p = org();
    p.append(owner, p.join(bob, 11));
    p.append(owner, [3, id(11), 3]);
    p.append(bob, p.device(machine, 1, id(11)));
    expect(code(p.verify())).toBe('unauthorized');
  });
  it('transfer rejects a member whose only remaining device is a machine', () => {
    const o = org();
    o.append(owner, o.join(bob, 11));
    o.append(bob, o.device(machine, 1, id(11)));
    o.append(bob, [5, bob.pk]);
    o.append(owner, [6, id(11)]);
    expect(code(o.verify())).toBe('unauthorized');
  });
  it('rejects used membership, user, signing/encryption keys, revoked key reuse and repeated epoch commitments', () => {
    for (const replay of ['membership', 'user', 'signing', 'encryption', 'revoked', 'commitment']) {
      const o = org();
      o.append(owner, o.join(bob, 11));
      if (replay === 'membership') o.append(owner, o.join(carol, 11));
      if (replay === 'user') {
        const j = o.join(carol, 11);
        o.append(owner, [1, id(12), j[2]]);
      }
      if (replay === 'signing') o.append(bob, o.device(bob, 0, id(11)));
      if (replay === 'encryption') {
        const reused = { ...phone, enc: bob.enc };
        o.append(bob, o.device(reused, 0, id(11)));
      }
      if (replay === 'revoked') {
        o.append(owner, o.device(phone, 0));
        o.append(owner, [5, phone.pk]);
        o.append(owner, o.device(phone, 0));
      }
      if (replay === 'commitment') o.append(owner, [7, 1, filled(20), filled(30, 72)]);
      expect(code(o.verify()), replay).toBe('replay');
    }
  });
  it('enforces epoch order and revoked signer authorization', () => {
    const o = org();
    o.append(owner, o.device(phone, 0));
    o.append(owner, [5, phone.pk]);
    o.append(phone, [7, 1, filled(21), filled(30, 72)]);
    expect(code(o.verify())).toBe('unauthorized');
    const p = org();
    p.append(owner, [7, 2, filled(21), filled(30, 72)]);
    expect(code(p.verify())).toBe('invalid-operation');
  });
});

describe('verified view is a runtime boundary', () => {
  it('full replay equals every incremental split and repeated replay', () => {
    const o = org();
    o.append(owner, o.join(bob, 11));
    o.append(owner, [3, id(11), 1]);
    o.append(bob, o.device(recovery, 2, id(11)));
    o.append(recovery, o.device(phone, 0, id(11)));
    o.append(bob, [5, recovery.pk]);
    o.append(owner, [6, id(11)]);
    o.append(phone, [7, 1, filled(21), filled(30, 72)]);
    const full = ok(o.verify());
    for (let split = 1; split <= o.records.length; split++) {
      const prefix = o.records.slice(0, split);
      const view = ok(
        Ledger.verifyLedger({ anchor: o.anchor, records: prefix, checkpoint: checkpoint(prefix) })
      );
      expect(
        comparable(ok(Ledger.extendLedger(view, o.records.slice(split), checkpoint(o.records))))
      ).toEqual(comparable(full));
    }
    expect(comparable(ok(o.verify()))).toEqual(comparable(full));
  });
  it('failed suffix, checkpoint and inspection mutation cannot advance or alter a view', () => {
    const o = org();
    const view = ok(o.verify()),
      before = comparable(view);
    const inspection = view.inspectState();
    (inspection.devices as Map<string, unknown>).clear();
    (inspection.members as Map<string, unknown>).clear();
    inspection.owner.toBytes().fill(99);
    expect(comparable(view)).toEqual(before);
    const good = signed([view.head.toBytes(), owner.pk, [7, 1, filled(21), filled(30, 72)]], owner);
    const bad = signed(
      [Ledger.hashRecordBytes(good).toBytes(), owner.pk, [7, 2, filled(22), filled(30, 72)]],
      owner,
      filled(0, 64)
    );
    expect(
      code(Ledger.extendLedger(view, [good, bad], { head: Ledger.hashRecordBytes(bad), length: 3 }))
    ).toBe('bad-signature');
    expect(comparable(view)).toEqual(before);
    expect(code(Ledger.extendLedger(view, [good], { head: view.head, length: 2 }))).toBe(
      'checkpoint-mismatch'
    );
    expect(comparable(view)).toEqual(before);
    expect(
      ok(
        Ledger.extendLedger(view, [good], { head: Ledger.hashRecordBytes(good), length: 2 })
      ).inspectState().epoch.number
    ).toBe(1);
  });
  it('refuses structural/prototype clones and cannot expose a constructor to mint trusted state', () => {
    const o = org();
    const view = ok(o.verify());
    expect(Object.getPrototypeOf(view)).toBe(null);
    expect(Reflect.get(view, 'constructor')).toBeUndefined();
    for (const fake of [{ ...view }, Object.create(view), Object.assign(Object.create(null), view)])
      expect(code(Ledger.extendLedger(fake, [], { head: view.head, length: view.length }))).toBe(
        'unauthorized'
      );
    // Permissive verifier injection is not a public capability; even forced extra arguments cannot bypass verification.
    o.append(owner, [7, 1, filled(21), filled(30, 72)], filled(0, 64));
    expect(
      code(
        Ledger.verifyLedger({
          anchor: o.anchor,
          records: o.records,
          checkpoint: checkpoint(o.records),
          verifier: () => true,
        } as Parameters<typeof Ledger.verifyLedger>[0])
      )
    ).toBe('bad-signature');
  });
});

describe('verified historical facts and current content permissions', () => {
  const publicKey = (key: Keys) => ok(Bytes.signingPublicKey(key.pk));
  const permissions = (view: Ledger.LedgerView, key: Keys) =>
    ok(Ledger.contentPermissions(view, publicKey(key)));
  it('retains admission identity after revocation without granting current write rights', () => {
    const o = org();
    o.append(owner, o.join(bob, 11));
    o.append(bob, o.device(phone, 0, id(11)));
    const prior = ok(o.verify());
    expect(permissions(prior, phone)).toEqual({ mayWriteDocument: true, maySealNewContent: true });
    o.append(bob, [5, phone.pk]);
    const current = ok(o.verify());
    const author = ok(Ledger.historicalContentAuthor(current, publicKey(phone)));
    expect(hex(author.device)).toBe(keyId(phone.pk));
    expect(hex(author.actor)).toBe(keyId(filled(11)));
    expect(hex(author.memberInstance)).toBe(keyId(id(11)));
    author.actor.toBytes().fill(0);
    author.memberInstance.toBytes().fill(0);
    expect(hex(ok(Ledger.historicalContentAuthor(current, publicKey(phone))).actor)).toBe(
      keyId(filled(11))
    );
    expect(permissions(current, phone)).toEqual({
      mayWriteDocument: false,
      maySealNewContent: false,
    });
    expect(permissions(prior, phone)).toEqual({ mayWriteDocument: true, maySealNewContent: true });
    expect(code(Ledger.historicalContentAuthor(current, publicKey(attacker)))).toBe('unauthorized');
  });
  it('distinguishes host admission from the honest seal rotation gate', () => {
    const o = org();
    o.append(owner, o.device(phone, 0));
    o.append(owner, [5, phone.pk]);
    const pending = ok(o.verify());
    expect(permissions(pending, owner)).toEqual({
      mayWriteDocument: true,
      maySealNewContent: false,
    });
    o.append(owner, [7, 1, filled(21), filled(30, 72)]);
    const rotated = ok(
      Ledger.extendLedger(pending, [o.records[o.records.length - 1]!], checkpoint(o.records))
    );
    expect(permissions(rotated, owner)).toEqual({
      mayWriteDocument: true,
      maySealNewContent: true,
    });
    expect(permissions(pending, owner).maySealNewContent).toBe(false);
    expect(permissions(rotated, phone).mayWriteDocument).toBe(false);
  });
  it('uses current role/kind for permission and admission history for attribution', () => {
    const o = org();
    o.append(owner, o.join(bob, 11));
    o.append(bob, o.device(machine, 1, id(11)));
    o.append(bob, o.device(recovery, 2, id(11)));
    const member = ok(o.verify());
    expect(permissions(member, bob).mayWriteDocument).toBe(true);
    expect(permissions(member, machine).mayWriteDocument).toBe(true);
    expect(permissions(member, recovery)).toEqual({
      mayWriteDocument: false,
      maySealNewContent: false,
    });
    o.append(owner, [3, id(11), 3]);
    const guest = ok(o.verify());
    for (const key of [bob, machine, recovery]) {
      expect(permissions(guest, key)).toEqual({
        mayWriteDocument: false,
        maySealNewContent: false,
      });
      expect(hex(ok(Ledger.historicalContentAuthor(guest, publicKey(key))).actor)).toBe(
        keyId(filled(11))
      );
    }
    expect(permissions(guest, attacker)).toEqual({
      mayWriteDocument: false,
      maySealNewContent: false,
    });
    o.append(owner, [3, id(11), 1]);
    const admin = ok(o.verify());
    expect(permissions(admin, machine).mayWriteDocument).toBe(true);
    expect(permissions(admin, recovery).mayWriteDocument).toBe(false);
  });
  it('returns owned signed epoch facts, not invented keys or packet validity', () => {
    const o = org();
    const genesis = ok(o.verify());
    expect(ok(Ledger.epochHistoryPacket(genesis, 0)).packet).toHaveLength(0);
    expect(hex(ok(Ledger.epochHistoryPacket(genesis, 0)).commitment)).toBe(keyId(filled(20)));
    expect(code(Ledger.epochHistoryPacket(genesis, 1))).toBe('unauthorized');
    o.append(owner, [7, 1, filled(21), filled(30, 72)]);
    o.append(owner, [7, 2, filled(22), filled(31, 72)]);
    const full = ok(o.verify());
    for (let split = 1; split <= o.records.length; split++) {
      const prefix = o.records.slice(0, split);
      const view = ok(
        Ledger.extendLedger(
          ok(
            Ledger.verifyLedger({
              anchor: o.anchor,
              records: prefix,
              checkpoint: checkpoint(prefix),
            })
          ),
          o.records.slice(split),
          checkpoint(o.records)
        )
      );
      for (const epoch of [1, 2]) {
        const row = ok(Ledger.epochHistoryPacket(view, epoch));
        expect(row.epoch).toBe(epoch);
        expect(row.packet).toEqual(filled(29 + epoch, 72));
        expect(hex(row.commitment)).toBe(keyId(filled(20 + epoch)));
        row.packet.fill(0);
        expect(ok(Ledger.epochHistoryPacket(view, epoch)).packet).toEqual(filled(29 + epoch, 72));
      }
    }
    for (const invalid of [-1, 1.5, NaN, Infinity, 2 ** 32])
      expect(Result.isFailure(Ledger.epochHistoryPacket(full, invalid))).toBe(true);
    expect(code(Ledger.epochHistoryPacket(full, 3))).toBe('unauthorized');
    expect(code(Ledger.epochHistoryPacket(genesis, 1))).toBe('unauthorized');
  });
  it('does not disclose facts or permissions through forged/cloned views or failed suffixes', () => {
    const o = org(),
      view = ok(o.verify());
    for (const fake of [
      { ...view },
      { ...view, inspectState: () => view.inspectState() },
      Object.create(view),
    ] as Ledger.LedgerView[]) {
      expect(code(Ledger.historicalContentAuthor(fake, publicKey(owner)))).toBe('unauthorized');
      expect(code(Ledger.contentPermissions(fake, publicKey(owner)))).toBe('unauthorized');
      expect(code(Ledger.epochHistoryPacket(fake, 0))).toBe('unauthorized');
    }
    o.append(owner, o.join(bob, 11));
    o.append(owner, [7, 1, filled(21), filled(30, 72)], new Uint8Array(64));
    expect(
      Result.isFailure(Ledger.extendLedger(view, o.records.slice(1), checkpoint(o.records)))
    ).toBe(true);
    expect(code(Ledger.historicalContentAuthor(view, publicKey(bob)))).toBe('unauthorized');
    expect(code(Ledger.epochHistoryPacket(view, 1))).toBe('unauthorized');
    expect(permissions(view, owner).maySealNewContent).toBe(true);
  });
});
