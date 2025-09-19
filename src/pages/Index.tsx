const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50" data-theme="cupcake">
      {/* Navigation */}
      <div className="navbar bg-base-100/80 backdrop-blur-sm shadow-lg">
        <div className="navbar-start">
          <div className="text-xl font-bold text-primary">
            <span className="text-2xl">✨</span> fanmark.id
          </div>
        </div>
        <div className="navbar-end">
          <button className="btn btn-primary btn-sm mr-2">ログイン</button>
          <button className="btn btn-outline btn-primary btn-sm">新規登録</button>
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
              絵文字で作る印象的なプロフィールアドレス！
            </h1>
            <p className="text-xl mb-8 text-base-content/80">
              つまらないリンクを忘れられない絵文字の組み合わせに変えましょう。"musician-profile-link-123"ではなく🎵🎤🎸をシェアしませんか
            </p>
            <div className="flex flex-wrap gap-4 justify-center mb-8">
              <button className="btn btn-primary btn-lg hover:scale-105 transition-transform">
                始める ✨
              </button>
              <button className="btn btn-outline btn-lg hover:scale-105 transition-transform">
                例を見る 👀
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Examples Section */}
      <div className="py-20 bg-base-100">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-4">実際の使用例をご覧ください！ 🚀</h2>
          <p className="text-center text-base-content/70 mb-12 text-lg">
            クリエイターが絵文字アドレスをどのように使っているかの実例
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="card bg-gradient-to-br from-pink-100 to-purple-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🎵🎤🎸</div>
                <h3 className="card-title justify-center text-lg">音楽アーティスト</h3>
                <p className="text-sm text-base-content/70">音楽リンク、ツアー日程、グッズを含む完全なプロフィールページ</p>
                <div className="badge badge-secondary">プロフィールページ</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-orange-100 to-red-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🍔🍟</div>
                <h3 className="card-title justify-center text-lg">レストラン</h3>
                <p className="text-sm text-base-content/70">メニュー、デリバリーアプリ、予約のリンク集</p>
                <div className="badge badge-accent">リンク集</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-blue-100 to-cyan-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">💼📊⚡</div>
                <h3 className="card-title justify-center text-lg">プロフェッショナル</h3>
                <p className="text-sm text-base-content/70">ポートフォリオと連絡先情報を含む名刺ページ</p>
                <div className="badge badge-info">名刺ページ</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-purple-100 to-pink-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🔥🔥🔥</div>
                <h3 className="card-title justify-center text-lg">ゲーミングストリーマー</h3>
                <p className="text-sm text-base-content/70">Twitchチャンネルへの直接リダイレクト</p>
                <div className="badge badge-error">直接リダイレクト</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="py-20 bg-gradient-to-br from-purple-50 to-pink-50">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-12">使い方 🛠️</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-bounce-soft">🎯</div>
                <h3 className="card-title justify-center text-xl mb-4">1. 絵文字を選ぶ</h3>
                <p className="text-base-content/70">
                  あなたやブランドを表す1〜3個の絵文字を選択。💕💕💕で気持ちを表現したり、🌸でシンプルに
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-pulse-slow">📝</div>
                <h3 className="card-title justify-center text-xl mb-4">2. プロフィールを作成</h3>
                <p className="text-base-content/70">
                  美しいプロフィールページ、リンク集、またはメインコンテンツへの直接リダイレクトを設定
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-float">🚀</div>
                <h3 className="card-title justify-center text-xl mb-4">3. アドレスをシェア</h3>
                <p className="text-base-content/70">
                  覚えやすい絵文字アドレスをどこでもシェア - SNS、名刺、口コミで！
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
            <h2 className="text-3xl font-bold mb-6">シンプルで公正な料金 💖</h2>
            <div className="card bg-gradient-to-r from-pink-100 to-purple-100 shadow-xl">
              <div className="card-body">
                <p className="text-lg mb-4">
                  <span className="badge badge-primary badge-lg">1〜2個の絵文字はプレミアム ✨</span>
                </p>
                <p className="text-lg mb-4">
                  <span className="badge badge-secondary badge-lg">3個以上の絵文字は無料！ 🎉</span>
                </p>
                <p className="text-base-content/70">
                  無料の3個以上の絵文字組み合わせから始めて、準備ができたらプレミアムの短いアドレスにアップグレード
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison */}
      <div className="py-16 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-8">LinkTreeのURLより簡単！ 💝</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="card bg-base-100 shadow-lg">
              <div className="card-body">
                <h3 className="card-title text-error justify-center">😵 従来の方法</h3>
                <p className="text-sm font-mono bg-base-200 p-3 rounded">
                  linktr.ee/my_awesome_musician_profile_2024
                </p>
                <p className="text-base-content/70">覚えにくく、シェアしにくく、口頭で伝えにくい</p>
              </div>
            </div>
            
            <div className="card bg-gradient-to-br from-green-100 to-blue-100 shadow-lg">
              <div className="card-body">
                <h3 className="card-title text-success justify-center">✨ fanmarkなら</h3>
                <p className="text-2xl p-3">🎵🎤🎸</p>
                <p className="text-base-content/70">瞬時に覚えられて、シェアも楽しい！</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-20 bg-primary text-primary-content">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold mb-6">絵文字アドレスを作成する準備はできましたか？ ✨</h2>
          <p className="text-xl mb-8 opacity-90">
            リンクを忘れられないものにした数千人のクリエイターに参加しましょう
          </p>
          <button className="btn btn-secondary btn-lg hover:scale-105 transition-transform">
            無料で始める 🚀
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="footer footer-center p-10 bg-base-200 text-base-content">
        <div>
          <div className="text-2xl font-bold text-primary mb-4">
            <span className="text-3xl">✨</span> fanmark.id
          </div>
          <p className="text-base-content/70">絵文字ひとつずつで、インターネットをもっと印象的に</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
