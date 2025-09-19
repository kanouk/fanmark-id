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
          <button className="btn btn-primary btn-sm mr-2">Sign In</button>
          <button className="btn btn-outline btn-primary btn-sm">Sign Up</button>
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
              Your memorable profile address with emoji!
            </h1>
            <p className="text-xl mb-8 text-base-content/80">
              Replace boring links with unforgettable emoji combinations. Share 🎵🎤🎸 instead of "musician-profile-link-123"
            </p>
            <div className="flex flex-wrap gap-4 justify-center mb-8">
              <button className="btn btn-primary btn-lg hover:scale-105 transition-transform">
                Get Started ✨
              </button>
              <button className="btn btn-outline btn-lg hover:scale-105 transition-transform">
                See Examples 👀
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Examples Section */}
      <div className="py-20 bg-base-100">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-4">See it in action! 🚀</h2>
          <p className="text-center text-base-content/70 mb-12 text-lg">
            Real examples of how creators use emoji addresses
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="card bg-gradient-to-br from-pink-100 to-purple-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🎵🎤🎸</div>
                <h3 className="card-title justify-center text-lg">Music Artist</h3>
                <p className="text-sm text-base-content/70">Complete profile page with music links, tour dates, and merch</p>
                <div className="badge badge-secondary">Profile Page</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-orange-100 to-red-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🍔🍟</div>
                <h3 className="card-title justify-center text-lg">Restaurant</h3>
                <p className="text-sm text-base-content/70">Link collection with menu, delivery apps, and reservations</p>
                <div className="badge badge-accent">Link Collection</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-blue-100 to-cyan-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">💼📊⚡</div>
                <h3 className="card-title justify-center text-lg">Professional</h3>
                <p className="text-sm text-base-content/70">Business card page with portfolio and contact info</p>
                <div className="badge badge-info">Business Card</div>
              </div>
            </div>

            <div className="card bg-gradient-to-br from-purple-100 to-pink-100 shadow-xl hover:scale-105 transition-transform">
              <div className="card-body text-center">
                <div className="text-4xl mb-4">🔥🔥🔥</div>
                <h3 className="card-title justify-center text-lg">Gaming Streamer</h3>
                <p className="text-sm text-base-content/70">Direct redirect to Twitch channel</p>
                <div className="badge badge-error">Direct Redirect</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="py-20 bg-gradient-to-br from-purple-50 to-pink-50">
        <div className="container mx-auto px-4">
          <h2 className="text-4xl font-bold text-center mb-12">How it works 🛠️</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-bounce-soft">🎯</div>
                <h3 className="card-title justify-center text-xl mb-4">1. Choose your emoji</h3>
                <p className="text-base-content/70">
                  Pick 1-3 emojis that represent you or your brand. Express intensity with 💕💕💕 or keep it simple with 🌸
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-pulse-slow">📝</div>
                <h3 className="card-title justify-center text-xl mb-4">2. Create your profile</h3>
                <p className="text-base-content/70">
                  Set up a beautiful profile page, link collection, or direct redirect to your main content
                </p>
              </div>
            </div>

            <div className="card bg-base-100 shadow-xl">
              <div className="card-body text-center">
                <div className="text-5xl mb-4 animate-float">🚀</div>
                <h3 className="card-title justify-center text-xl mb-4">3. Share your address</h3>
                <p className="text-base-content/70">
                  Share your memorable emoji address everywhere - social media, business cards, or word of mouth!
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
            <h2 className="text-3xl font-bold mb-6">Simple, fair pricing 💖</h2>
            <div className="card bg-gradient-to-r from-pink-100 to-purple-100 shadow-xl">
              <div className="card-body">
                <p className="text-lg mb-4">
                  <span className="badge badge-primary badge-lg">1-2 emojis are premium ✨</span>
                </p>
                <p className="text-lg mb-4">
                  <span className="badge badge-secondary badge-lg">3+ emojis are free! 🎉</span>
                </p>
                <p className="text-base-content/70">
                  Start with free 3+ emoji combinations, upgrade to premium short addresses when you're ready
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comparison */}
      <div className="py-16 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-8">Easier than linktree URLs! 💝</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="card bg-base-100 shadow-lg">
              <div className="card-body">
                <h3 className="card-title text-error justify-center">😵 Traditional way</h3>
                <p className="text-sm font-mono bg-base-200 p-3 rounded">
                  linktr.ee/my_awesome_musician_profile_2024
                </p>
                <p className="text-base-content/70">Hard to remember, share, or say out loud</p>
              </div>
            </div>
            
            <div className="card bg-gradient-to-br from-green-100 to-blue-100 shadow-lg">
              <div className="card-body">
                <h3 className="card-title text-success justify-center">✨ With fanmark</h3>
                <p className="text-2xl p-3">🎵🎤🎸</p>
                <p className="text-base-content/70">Instantly memorable and fun to share!</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="py-20 bg-primary text-primary-content">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-4xl font-bold mb-6">Ready to get your emoji address? ✨</h2>
          <p className="text-xl mb-8 opacity-90">
            Join thousands of creators who've made their links unforgettable
          </p>
          <button className="btn btn-secondary btn-lg hover:scale-105 transition-transform">
            Get Started Free 🚀
          </button>
        </div>
      </div>

      {/* Footer */}
      <footer className="footer footer-center p-10 bg-base-200 text-base-content">
        <div>
          <div className="text-2xl font-bold text-primary mb-4">
            <span className="text-3xl">✨</span> fanmark.id
          </div>
          <p className="text-base-content/70">Making the internet more memorable, one emoji at a time</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
