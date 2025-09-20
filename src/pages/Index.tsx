import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
const Index = () => {
  const {
    user,
    signOut
  } = useAuth();
  const navigate = useNavigate();
  const handleAuthAction = () => {
    if (user) {
      signOut();
    } else {
      navigate("/auth");
    }
  };
  return <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50" data-theme="cupcake">
      {/* Navigation */}
      <div className="navbar bg-base-100/80 backdrop-blur-sm shadow-lg">
        <div className="navbar-start">
          <div className="text-xl font-bold text-primary">
            <span className="text-2xl">✨</span> fanmark.id
          </div>
        </div>
        <div className="navbar-end">
          {user ? <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {user.email}
              </span>
              <Button variant="outline" size="sm" onClick={handleAuthAction}>
                ログアウト
              </Button>
            </div> : <Button variant="default" size="sm" onClick={handleAuthAction}>
              ログイン・新規登録
            </Button>}
        </div>
      </div>

      {/* Hero Section */}
      <div className="hero min-h-[80vh] bg-gradient-to-br from-pink-100 via-purple-100 to-blue-100">
        <div className="hero-content text-center">
          <div className="max-w-4xl">
            <div className="animate-float mb-8">
              <span className="text-8xl">✨</span>
            </div>
            <h1 className="text-6xl font-bold bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 bg-clip-text text-transparent mb-6">
              ファンマだけでつくる<br />
              あなただけのアドレス
            </h1>
            <p className="text-xl mb-8 text-base-content/80">
              長くて覚えにくいリンクはもうおしまい<br />
              🎵🎤🎸みたいに、一目で「あなた」ってわかるアドレスを作ろう
            </p>
            <div className="flex flex-wrap gap-4 justify-center mb-8">
              <Button size="lg" className="hover:scale-105 transition-transform" onClick={() => user ? console.log("Create fanmark") : navigate("/auth")}>
                さっそく作ってみる ✨
              </Button>
              <Button variant="outline" size="lg" className="hover:scale-105 transition-transform">
                みんなの使い方を見る 👀
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Examples Section */}
      <div className="py-20 bg-base-100">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-4">こんな風に使われてます 🚀</h2>
          <p className="text-center text-base-content/70 mb-12 text-lg">
            みんなそれぞれ、自分らしい絵文字アドレスを作ってる
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="card bg-gradient-to-br from-pink-100 to-purple-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🎵🎤🎸</div>
                <h3 className="card-title justify-center text-lg">ミュージシャン</h3>
                <p className="text-sm text-base-content/70">楽曲・ライブ情報・グッズがまとめて見れるページ</p>
                <div className="badge badge-secondary px-[10px]">プロフィール</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-orange-100 to-red-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🍔🍟</div>
                <h3 className="card-title justify-center text-lg">お店</h3>
                <p className="text-sm text-base-content/70">メニュー・出前・予約のリンクをひとまとめ</p>
                <div className="badge badge-accent px-[10px]">リンク集</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-blue-100 to-cyan-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">💼📊⚡</div>
                <h3 className="card-title justify-center text-lg">ビジネス</h3>
                <p className="text-sm text-base-content/70">実績・経歴・連絡先がわかりやすい名刺代わり</p>
                <div className="badge badge-info px-[10px]">名刺</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-purple-100 to-pink-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🔥🔥🔥</div>
                <h3 className="card-title justify-center text-lg">ストリーマー</h3>
                <p className="text-sm text-base-content/70">Twitchチャンネルに直接ジャンプ</p>
                <div className="badge badge-error px-[10px]">ワンクリック</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="py-20 bg-gradient-to-br from-purple-50 to-pink-50">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-12">3ステップで完成 🛠️</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-bounce-soft">🎯</div>
                <h3 className="card-title justify-center text-xl mb-4">1. 絵文字を選ぶ</h3>
                <p className="text-base-content/70">
                  あなたらしい絵文字を1〜3個選んで<br />
                  💕💕💕で気持ちを込めても<br />
                  🌸でシンプルでもOK
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-pulse-slow">📝</div>
                <h3 className="card-title justify-center text-xl mb-4">2. ページを作る</h3>
                <p className="text-base-content/70">
                  プロフィールページにするか<br />
                  リンク集にするか<br />
                  どこかに飛ばすか、お好みで
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-float">🚀</div>
                <h3 className="card-title justify-center text-xl mb-4">3. みんなにシェア</h3>
                <p className="text-base-content/70">
                  絵文字アドレスをSNSでも名刺でも<br />
                  どこでもシェア<br />
                  覚えてもらいやすくて便利！
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pricing Hint */}
      <div className="py-16 bg-base-100">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold mb-6">料金はとってもシンプル 💖</h2>
            <div className="card bg-gradient-to-r from-pink-100 to-purple-100 shadow-xl">
              <div className="card-body">
                <p className="text-lg mb-4">
                  <span className="badge badge-primary badge-lg px-[10px]">短い絵文字（1〜2個）は有料 ✨</span>
                </p>
                <p className="text-lg mb-4">
                  <span className="badge badge-secondary badge-lg px-[10px]">長い絵文字（3個以上）は無料！ 🎉</span>
                </p>
                <p className="text-base-content/70">
                  まずは無料で試してみて<br />
                  気に入ったら短いアドレスにグレードアップ
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison */}
      <div className="py-16 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-8">LinkTreeより断然覚えやすい！ 💝</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="card bg-base-100 shadow-lg">
              <div className="card-body">
                <h3 className="card-title text-error justify-center">😵 今までのやり方</h3>
                <p className="text-sm font-mono bg-base-200 p-3 rounded">
                  linktr.ee/my_awesome_musician_profile_2024
                </p>
                <p className="text-base-content/70">
                  長すぎて覚えられない<br />
                  打ち間違える<br />
                  伝えにくい...
                </p>
              </div>
            </div>
            
            <div className="card bg-gradient-to-br from-green-100 to-blue-100 shadow-lg">
              <div className="card-body">
                <h3 className="card-title text-success justify-center">✨ fanmarkなら</h3>
                <p className="text-2xl p-3">🎵🎤🎸</p>
                <p className="text-base-content/70">
                  一度見たら忘れない<br />
                  口で言える<br />
                  シェアしたくなる！
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-20 bg-primary text-primary-content">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold mb-6">あなただけのファンマ、作ってみよう ✨</h2>
          <p className="text-xl mb-8 opacity-90">
            もう何千人ものクリエイターが<br />
            自分だけの絵文字アドレスを持ってる
          </p>
          <Button variant="secondary" size="lg" className="hover:scale-105 transition-transform" onClick={() => user ? console.log("Create fanmark") : navigate("/auth")}>
            無料で作ってみる 🚀
          </Button>
        </div>
      </div>

      {/* Footer */}
      <footer className="footer footer-center p-10 bg-base-200 text-base-content">
        <div>
          <div className="text-2xl font-bold text-primary mb-4">
            <span className="text-3xl">✨</span> fanmark.id
          </div>
          <p className="text-base-content/70">絵文字ひとつひとつで、ネットをもっと楽しく</p>
        </div>
      </footer>
    </div>;
};
export default Index;