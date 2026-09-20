export const places = [
  { id: 'garden', emoji: '🌸🌿', name: '花と、暮らす。', en: 'A little room to bloom.', label: '小さな花屋', labelEn: 'Flower shop', color: '#efa8bb', position: [-3.3, 0, -.7] },
  { id: 'cafe', emoji: '☕🥐', name: 'ひと息つける場所。', en: 'Your happy coffee place.', label: '森のカフェ', labelEn: 'Forest café', color: '#e8b878', position: [3.1, 0, -.5] },
  { id: 'music', emoji: '🎧✨', name: '好きな音で、つながろう。', en: 'Good sounds. Good company.', label: '音楽のアトリエ', labelEn: 'Music studio', color: '#b4a0d5', position: [.3, 0, -3] },
  { id: 'cat', emoji: '🐈⭐', name: '気ままな、わたしの居場所。', en: 'A place to be yourself.', label: 'ねこのおうち', labelEn: 'Cat’s little home', color: '#72bfc0', position: [0, 0, 2] },
] as const;
export type PlaceId = typeof places[number]['id'];
