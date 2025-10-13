import { extractEmojiString } from '@/lib/emojiConversion';

const samples: Array<{ label: string; input: string }> = [
  { label: 'Simple mixed ASCII + emoji', input: 'Hello🙂world🌈!' },
  { label: 'Japanese text with complex emoji', input: '文章🙂‍↔️🙂‍↔️🙂‍↔️混ざり' },
  { label: 'Full-width characters and family ZWJ', input: '全角ＡＢＣと👨‍👩‍👧‍👦のテスト' },
  { label: 'Flags and punctuation', input: 'Flags🇯🇵🇺🇸 with text & symbols #!' },
  { label: 'Skin tone variations', input: '肌色 🙋🏻‍♂️ と 🙋🏿‍♀️ の組み合わせ' },
  { label: 'Hearts comparison', input: '♥と❤️と💕と💖が並ぶ' },
  { label: 'Keycap and numbers', input: '番号1️⃣2️⃣3️⃣と文字' },
  {
    label: 'Whitespace and control characters',
    input: String.raw`
  改行やスペースを含む🙂テキスト
	タブやベル音と❤️ハート
  終端には🌟があります。
`,
  },
];

samples.forEach(({ label, input }, index) => {
  const extracted = extractEmojiString(input);
  console.log(`\n[${index + 1}] ${label}`);
  console.log('  Input   :', input);
  console.log('  Extract :', extracted || '(none)');
});
