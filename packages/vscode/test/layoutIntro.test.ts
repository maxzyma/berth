import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutIntroduction } from '../src/layoutIntro.js';

test('Keep explicitly persists the opt-out across reloads', async () => {
  const events: string[] = [];
  let seen = false;
  const host = {
    eligible: () => true, seen: () => seen,
    remember: async () => { seen = true; events.push('remember'); },
    show: async () => { events.push('show'); return 'Keep Current Layout'; },
    create: async () => { assert.fail('Keep must not create a Profile'); },
  };
  const offer = createLayoutIntroduction(host);
  await Promise.all([offer(), offer()]);
  await createLayoutIntroduction(host)();
  assert.deepEqual(events, ['show', 'remember']);
});

test('failed Use remains eligible after reload without repeating within one activation', async () => {
  let shown = 0;
  const host = {
    eligible: () => true, seen: () => false,
    remember: async () => { assert.fail('Use must not persist an opt-out'); },
    show: async () => { shown++; return 'Use Berth Layout'; },
    create: async () => { throw new Error('setup failed'); },
  };
  const offer = createLayoutIntroduction(host);
  await assert.rejects(offer, /setup failed/);
  await offer();
  assert.equal(shown, 1);
  await assert.rejects(createLayoutIntroduction(host), /setup failed/);
  assert.equal(shown, 2);
});

test('successful Use is suppressed by active Profile eligibility, not opt-out', async () => {
  let active = false;
  let shown = 0;
  const host = {
    eligible: () => !active, seen: () => false,
    remember: async () => { assert.fail('Use must not persist an opt-out'); },
    show: async () => { shown++; return 'Use Berth Layout'; },
    create: async () => { active = true; },
  };
  await createLayoutIntroduction(host)();
  await createLayoutIntroduction(host)();
  assert.equal(shown, 1);
});

test('ineligible and previously introduced windows do not prompt or persist', async () => {
  for (const [eligible, seen] of [[false, false], [true, true]]) {
    const unexpected = async () => { assert.fail('unexpected layout action'); };
    await createLayoutIntroduction({ eligible: () => eligible, seen: () => seen,
      remember: unexpected, show: unexpected, create: unexpected })();
  }
});

test('persistence failure is reported and can retry without running the chosen action', async () => {
  let attempts = 0;
  let shown = 0;
  const offer = createLayoutIntroduction({ eligible: () => true, seen: () => false,
    remember: async () => { if (++attempts === 1) throw new Error('storage unavailable'); },
    show: async () => { shown++; return 'Keep Current Layout'; },
    create: async () => { assert.fail('unexpected creation'); },
  });
  await assert.rejects(offer, /storage unavailable/);
  assert.equal(shown, 1);
  await offer();
  assert.equal(shown, 2);
});


test('dismissal is session-local and is offered again after reload', async () => {
  let shown = 0;
  const host = { eligible: () => true, seen: () => false,
    remember: async () => { assert.fail('dismissal is not acknowledgement'); },
    show: async () => { shown++; return undefined; },
    create: async () => { assert.fail('dismissal must not change layout'); },
  };
  const offer = createLayoutIntroduction(host);
  await Promise.all([offer(), offer()]);
  assert.equal(shown, 1);
  await createLayoutIntroduction(host)();
  assert.equal(shown, 2);
});

test('a pending notification never persists acknowledgement', async () => {
  let complete!: (choice: string | undefined) => void;
  let persisted = false;
  const offer = createLayoutIntroduction({ eligible: () => true, seen: () => false,
    remember: async () => { persisted = true; },
    show: () => new Promise<string | undefined>(resolve => { complete = resolve; }),
    create: async () => { assert.fail('no choice was made'); },
  });
  const pending = offer();
  assert.equal(persisted, false);
  await offer();
  complete(undefined);
  await pending;
  assert.equal(persisted, false);
});
