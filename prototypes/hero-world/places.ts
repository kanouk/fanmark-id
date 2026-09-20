const styles = [
  { kind: 'human', shirt: '#eaa2b8', skin: '#f3c9a7', hair: '#72534a' },
  { kind: 'human', shirt: '#aa9cce', skin: '#b88360', hair: '#403733' },
  { kind: 'cat', shirt: '#e5bb74', skin: '#f4d4b7', hair: '#b58052' },
  { kind: 'human', shirt: '#73b9b1', skin: '#d8a179', hair: '#5a433c' },
  { kind: 'human', shirt: '#b4bb8e', skin: '#f1c6a2', hair: '#52403a' },
  { kind: 'rabbit', shirt: '#86b0d4', skin: '#a97150', hair: '#39343c' },
] as const;

// Equal-area distribution, including the back and southern hemisphere.
export const people = Array.from({ length: 18 }, (_, i) => ({
  ...styles[i % styles.length],
  id: `walker-${i}`,
  lat: Math.asin(1 - 2 * (i + .5) / 18),
  lon: i * 2.399963 + .6,
  speed: .036 + (i % 4) * .006,
}));
export type PersonId = string;

export const fallbackFanmarks = [
  '🌸🌿', '☕🥐', '🎧✨', '🐈⭐', '📷🌏', '🎮💫', '🍋🫧', '🦊🍂',
  '🍞🧈', '🌙💜', '🐻🍯', '🐰🎀', '🌵☀️', '🌊🐚', '🧶🪡', '🎨🌈',
  '🍓🍰', '🦋💐', '📚☕', '🍀🐾', '🪐🚀', '🦁👑', '🎹🎶', '🏕️🔥',
  '🥨🧀', '🦉🌙', '🍇🍷', '🌻🐝', '🐧❄️', '🎸⚡', '🍑🩷', '🪴🏡',
];
