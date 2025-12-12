import { segmentEmojiSequence } from './emojiConversion';

interface ConfettiOptions {
  duration?: number;
  particleCount?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  type: 'emoji' | 'paper';
  emoji?: string;
  color?: string;
  size: number;
  width?: number;
  height?: number;
}

const GRAVITY = 0.25;
const DEFAULT_PARTICLE_COUNT = 36;
const DEFAULT_DURATION = 3500;
const PAPER_COLORS = [
  '#FF6B6B', // 赤
  '#4ECDC4', // 青緑
  '#45B7D1', // 水色
  '#FFA07A', // オレンジ
  '#98D8C8', // ミント
  '#F7DC6F', // 黄色
  '#BB8FCE', // 紫
  '#85C1E2', // 空色
];

export function showEmojiConfetti(
  emojiSequence: string,
  options?: ConfettiOptions
): void {
  if (!emojiSequence || typeof emojiSequence !== 'string') {
    return;
  }

  const duration = options?.duration ?? DEFAULT_DURATION;
  const particleCount = options?.particleCount ?? DEFAULT_PARTICLE_COUNT;

  try {
    // 絵文字を配列に分解
    const emojiArray = segmentEmojiSequence(emojiSequence);
    if (emojiArray.length === 0) {
      return;
    }

    // Canvas を作成
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.zIndex = '9999';
    canvas.style.pointerEvents = 'none';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      document.body.removeChild(canvas);
      return;
    }

    // パーティクルを生成
    const particles: Particle[] = [];
    const centerX = canvas.width / 2;
    const startY = canvas.height * 0.9;

    for (let i = 0; i < particleCount; i++) {
      const isEmoji = Math.random() < 0.5; // 50%がファンマーク絵文字、50%が紙吹雪
      
      if (isEmoji) {
        particles.push({
          x: centerX + (Math.random() - 0.5) * canvas.width * 0.8,
          y: startY,
          vx: (Math.random() - 0.5) * 12,
          vy: -(Math.random() * 10 + 18),
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.4,
          opacity: 1,
          type: 'emoji',
          emoji: emojiArray[Math.floor(Math.random() * emojiArray.length)],
          size: Math.random() * 20 + 40, // 40-60px
        });
      } else {
        particles.push({
          x: centerX + (Math.random() - 0.5) * canvas.width * 0.8,
          y: startY,
          vx: (Math.random() - 0.5) * 12,
          vy: -(Math.random() * 10 + 18),
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.4,
          opacity: 1,
          type: 'paper',
          color: PAPER_COLORS[Math.floor(Math.random() * PAPER_COLORS.length)],
          width: Math.random() * 4 + 8, // 8-12px
          height: Math.random() * 5 + 15, // 15-20px
          size: 0,
        });
      }
    }

    // アニメーション
    const startTime = Date.now();
    const fadeStartTime = startTime + duration - 500;

    function animate() {
      const now = Date.now();
      const elapsed = now - startTime;

      if (elapsed > duration) {
        document.body.removeChild(canvas);
        return;
      }

      // Canvas をクリア
      ctx!.clearRect(0, 0, canvas.width, canvas.height);

      // 各パーティクルを更新して描画
      particles.forEach((particle) => {
        // 物理演算（頂点付近でスローモーション効果）
        const isNearPeak = Math.abs(particle.vy) < 3;
        const effectiveGravity = isNearPeak ? GRAVITY * 0.3 : GRAVITY;
        particle.vy += effectiveGravity;
        
        // 落下時は空気抵抗を適用してふわっと落下
        if (particle.vy > 0) {
          particle.vy *= 0.985;
          particle.vx *= 0.99;
        }
        
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rotation += particle.rotationSpeed;

        // 画面上端で跳ね返り
        if (particle.y < 0) {
          particle.y = 0;
          particle.vy = Math.abs(particle.vy) * 0.6; // 60%のエネルギーで跳ね返り
        }

        // フェードアウト
        if (now > fadeStartTime) {
          const fadeProgress = (now - fadeStartTime) / 500;
          particle.opacity = 1 - fadeProgress;
        }

        // 描画
        ctx!.save();
        ctx!.translate(particle.x, particle.y);
        ctx!.rotate(particle.rotation);
        ctx!.globalAlpha = particle.opacity;
        
        if (particle.type === 'emoji') {
          ctx!.font = `${particle.size}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
          ctx!.textAlign = 'center';
          ctx!.textBaseline = 'middle';
          ctx!.fillText(particle.emoji!, 0, 0);
        } else {
          ctx!.fillStyle = particle.color!;
          ctx!.fillRect(-particle.width! / 2, -particle.height! / 2, particle.width!, particle.height!);
        }
        
        ctx!.restore();
      });

      requestAnimationFrame(animate);
    }

    animate();
  } catch (error) {
    console.error('Error in emoji confetti animation:', error);
  }
}
