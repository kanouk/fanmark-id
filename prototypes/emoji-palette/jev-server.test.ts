import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findWithJev, makeGroups } from './jev-server';
import { byId, catalog, searchEmoji } from './search';

type Question = { criteria: Record<string, string> };

test('place suggestions omit weak country-flag alternatives', async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    const { questions } = JSON.parse(String(init?.body)) as { questions: Record<string, Question> };
    const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
      const entries = Object.entries(question.criteria);
      const routing = entries.some(([, text]) => text.includes('. Contains:'));
      const probabilities = Object.fromEntries(entries.map(([id]) => [id, 0]));
      let choice = 'none';
      if (name === 'place') {
        choice = entries.find(([, text]) => text.includes(routing ? 'flag japan' : '🇯🇵'))![0];
        if (!routing) {
          const unrelatedFlag = entries.find(([, text]) => text.includes('🇸🇹'))![0];
          probabilities[choice] = 0.95;
          probabilities[unrelatedFlag] = 0.03;
          probabilities.none = 0.02;
        } else probabilities[choice] = 1;
      } else probabilities.none = 1;
      return [name, { type: 'choice', choice, probabilities }];
    }));
    return new Response(JSON.stringify({ model: 'test-model', answers }));
  };
  const result = await findWithJev({ query: '原宿', category: '', variants: false }, 'test-key', new AbortController().signal, fetcher);
  assert.deepEqual(result.ids.map(id => byId.get(id)?.emoji), ['🇯🇵']);
});

function mockProvider(withContext: boolean): typeof fetch {
  return async (_url, init) => {
    const { questions } = JSON.parse(String(init?.body)) as { questions: Record<string, Question> };
    const routing = Object.values(Object.values(questions)[0].criteria).some(text => text.includes('. Contains:'));
    const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
      assert.ok(Object.keys(question.criteria).length <= 255, 'every question obeys provider limit');
      const symbol = name === 'place' ? '🗼' : name === 'feeling' ? '😋' : name === 'reaction' ? '🤤' : '🍜';
      const isAbsent = name === 'symbolic' || (!withContext && (name === 'place' || name === 'feeling' || name === 'reaction'));
      const choice = isAbsent ? 'none' : Object.keys(question.criteria).find(id => question.criteria[id].includes(routing ? catalog.find(entry => entry.emoji === symbol)!.name : symbol));
      assert.ok(choice, `${name} must retain ${symbol} in its own candidates`);
      if (!routing && !withContext) assert.ok(name !== 'place' && name !== 'feeling' && name !== 'reaction', 'absent aspects are not expanded');
      return [name, { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map(id => [id, id === choice ? 1 : 0])) }];
    }));
    return new Response(JSON.stringify({ model: 'test-model', answers }), { status: 200 });
  };
}

test('a dominant subject does not suppress place, feeling, or a reaction from a different face subgroup', async () => {
  const result = await findWithJev({ query: '東京の美味しいラーメン', category: '', variants: false }, 'test-key', new AbortController().signal, mockProvider(true));
  assert.deepEqual(result.ids.map(id => byId.get(id)?.emoji), ['🍜', '🗼', '😋', '🤤']);
});

test('a neutral subject does not force location or emotion suggestions', async () => {
  const result = await findWithJev({ query: 'ラーメン', category: '', variants: false }, 'test-key', new AbortController().signal, mockProvider(false));
  assert.deepEqual(result.ids.map(id => byId.get(id)?.emoji), ['🍜']);
});

test('related tools are retrieved through their own category without lexical matches', async () => {
  const query = '東京の床屋';
  assert.equal(searchEmoji(query).length, 0);
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    const { questions } = JSON.parse(String(init?.body)) as { questions: Record<string, Question> };
    calls++;
    const routing = Object.values(Object.values(questions)[0].criteria).some(text => text.includes('. Contains:'));
    const targets: Record<string, string> = { subject: '💈', place: '🗼', related: '✂️' };
    const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
      assert.ok(Object.keys(questions).length <= 2, 'bound request size in both stages');
      assert.ok(Object.keys(question.criteria).length <= 255);
      const symbol = targets[name];
      const choice = symbol ? Object.keys(question.criteria).find(id => question.criteria[id].includes(routing ? catalog.find(entry => entry.emoji === symbol)!.name : symbol)) : 'none';
      assert.ok(choice, `${name} must be able to reach its independently selected emoji`);
      if (!routing && name === 'subject') assert.ok(!Object.values(question.criteria).some(text => text.includes('✂️')), 'tool is outside the subject category');
      return [name, { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map(id => [id, id === choice ? 1 : 0])) }];
    }));
    return new Response(JSON.stringify({ model: 'test-model', answers }));
  };
  const result = await findWithJev({ query, category: '', variants: false }, 'test-key', new AbortController().signal, fetcher);
  assert.deepEqual(result.ids.map(id => byId.get(id)?.emoji), ['💈', '🗼', '✂️']);
  assert.equal(calls, 5, 'three category batches followed by two batches for the three active aspects');
});

test('routing covers all IDs, respects filters, and stays within Choice limits', () => {
  for (const variants of [false, true]) {
    const groups = makeGroups({ query: 'test', category: '', variants });
    assert.ok(groups.length + 1 <= 255);
    assert.ok(groups.every(group => group.items.length <= 125));
    const ids = groups.flatMap(group => group.items.map(entry => entry.id));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, catalog.filter(entry => variants || !entry.variant).length);
  }
  const groups = makeGroups({ query: '東京の美味しいラーメン', category: 'Food & Drink', variants: false });
  assert.ok(groups.flatMap(group => group.items).every(entry => entry.category === 'Food & Drink'));
});

test('a symbolic concept has its own route even when the concrete subject has no match', async () => {
  const query = 'AIを使ったコンサル';
  assert.equal(searchEmoji(query).length, 0);
  const seenSymbolicStages: boolean[] = [];
  const fetcher: typeof fetch = async (_url, init) => {
    const { questions } = JSON.parse(String(init?.body)) as { questions: Record<string, Question> };
    const routing = Object.values(Object.values(questions)[0].criteria).some(text => text.includes('. Contains:'));
    const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
      assert.ok(Object.keys(questions).length <= 2, 'bound request size in both stages');
      assert.ok(Object.keys(question.criteria).length <= 255);
      const target = name === 'symbolic' ? '🤖' : name === 'related' ? '💻️' : undefined;
      const choice = target ? Object.keys(question.criteria).find(id => question.criteria[id].includes(routing ? catalog.find(entry => entry.emoji === target)!.name : target)) : 'none';
      assert.ok(choice);
      if (name === 'symbolic') seenSymbolicStages.push(routing);
      if (!routing && name === 'related') assert.ok(!Object.values(question.criteria).some(text => text.includes('🤖')), 'symbol does not depend on tool candidates');
      return [name, { type: 'choice', choice, probabilities: Object.fromEntries(Object.keys(question.criteria).map(id => [id, id === choice ? 1 : 0])) }];
    }));
    return new Response(JSON.stringify({ model: 'test-model', answers }));
  };
  const result = await findWithJev({ query, category: '', variants: false }, 'test-key', new AbortController().signal, fetcher);
  assert.deepEqual(seenSymbolicStages, [true, false]);
  assert.deepEqual(result.ids.map(id => byId.get(id)?.emoji), ['🤖', '💻️']);
});

for (const example of [{ facet: 'symbolic', query: 'AIを使ったコンサル', emoji: '🤖' }, { facet: 'place', query: '京都', emoji: '👘' }]) {
  test(`${example.facet} imagery in the sixth category survives routing within the option limit`, async () => {
    let symbolWasEvaluated = false;
    const fetcher: typeof fetch = async (_url, init) => {
      const { questions } = JSON.parse(String(init?.body)) as { questions: Record<string, Question> };
      assert.ok(Object.keys(questions).length <= 2);
      const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
        const entries = Object.entries(question.criteria);
        assert.ok(entries.length <= 255);
        const routing = entries.some(([, text]) => text.includes('. Contains:'));
        const probabilities = Object.fromEntries(entries.map(([id]) => [id, 0]));
        let choice = 'none';
        if (routing && name === example.facet) {
          const robotGroup = entries.find(([, text]) => text.includes(catalog.find(entry => entry.emoji === example.emoji)!.name))![0];
          const others = entries.filter(([id]) => id !== 'none' && id !== robotGroup).slice(0, 5);
          [0.3, 0.25, 0.2, 0.1, 0.08].forEach((p, index) => { probabilities[others[index][0]] = p; });
          probabilities[robotGroup] = 0.07;
          choice = others[0][0];
        } else {
          if (!routing && name.startsWith(example.facet)) {
            const robot = entries.find(([, text]) => text.includes(example.emoji));
            if (robot) { choice = robot[0]; symbolWasEvaluated = true; }
          }
          probabilities[choice] = 1;
        }
        return [name, { type: 'choice', choice, probabilities }];
      }));
      return new Response(JSON.stringify({ model: 'test-model', answers }));
    };
    const result = await findWithJev({ query: example.query, category: '', variants: false }, 'test-key', new AbortController().signal, fetcher);
    assert.equal(symbolWasEvaluated, true);
    assert.deepEqual(result.ids.map(id => byId.get(id)?.emoji), [example.emoji]);
  });
}
