import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAuthForm } from '@/hooks/useAuthForm';
import { usePasswordValidation } from '@/hooks/usePasswordValidation';
import { useTranslation } from '@/hooks/useTranslation';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AuthLayout } from '@/components/AuthLayout';
import { PasswordRequirement } from '@/components/PasswordRequirement';
import { InvitationSystem } from '@/components/InvitationSystem';
import { Heart, Sparkles, Users, Mail } from 'lucide-react';

const Auth = () => {
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { settings, loading: settingsLoading } = useSystemSettings();
  const { formData, authState, updateFormData, signUp, signIn, resendConfirmation } = useAuthForm();
  const { requirements, isValid } = usePasswordValidation(formData.password);
  
  const [invitationFlow, setInvitationFlow] = useState({
    showInvitation: false,
    validCode: '',
    invitationPerks: null as any
  });
  const [username, setUsername] = useState('');

  useEffect(() => {
    if (user && session) {
      navigate('/');
    }
  }, [user, session, navigate]);

  useEffect(() => {
    if (!settingsLoading && settings.invitation_mode) {
      setInvitationFlow(prev => ({ ...prev, showInvitation: true }));
    }
  }, [settings.invitation_mode, settingsLoading]);

  const handleValidInvitation = (code: string, perks?: any) => {
    setInvitationFlow({
      showInvitation: false,
      validCode: code,
      invitationPerks: perks
    });
  };

  if (authState.awaitingConfirmation) {
    return (
      <AuthLayout 
        title={t('auth.awaitingConfirmation')} 
        description={t('auth.checkEmail')}
        showBackButton
        backLabel={t('auth.homeButton')}
      >
        <div className="text-center space-y-6">
          <div className="text-7xl animate-bounce-soft">📧✨</div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-primary">
              {t('auth.confirmationSent')}
            </h3>
            <p className="text-muted-foreground">
              {t('auth.checkEmail')}
            </p>
          </div>
          <div className="space-y-3">
            <button 
              onClick={resendConfirmation} 
              className="btn btn-outline btn-primary w-full"
              disabled={authState.loading}
            >
              {authState.loading ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span> 
                  {t('common.loading')}
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4" /> 
                  {t('auth.resendConfirmation')}
                </>
              )}
            </button>
            <button 
              onClick={() => updateFormData('email', '')} 
              className="btn btn-ghost w-full"
            >
              {t('invitation.back')}
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout 
      title={"🌟 " + t('auth.welcome')} 
      description={t('auth.description')}
      showBackButton
      backLabel={t('auth.homeButton')}
    >
      <div className="space-y-6">
        {/* Show invitation info if in invitation mode */}
        {!settingsLoading && settings.invitation_mode && invitationFlow.showInvitation && (
          <div className="alert alert-info">
            <Sparkles className="w-5 h-5" />
            <span>{t('invitation.currentlyInviteOnly')}</span>
          </div>
        )}
        
        {/* Show invitation success banner if user came from invitation flow */}
        {invitationFlow.validCode && (
          <div className="alert alert-success">
            <Heart className="w-5 h-5" />
            <span>{t('invitation.validCodeWelcome')}</span>
          </div>
        )}
        
        <Tabs defaultValue="signin" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">{t('auth.login')}</TabsTrigger>
            <TabsTrigger value="signup">{t('auth.signUp')}</TabsTrigger>
          </TabsList>
          
          <TabsContent value="signin" className="space-y-4">
            <LoginForm 
              formData={formData}
              authState={authState}
              updateFormData={updateFormData}
              signIn={signIn}
              t={t}
            />
          </TabsContent>

          <TabsContent value="signup" className="space-y-4">
            {/* Show invitation system if in invitation mode and no valid code */}
            {!settingsLoading && settings.invitation_mode && invitationFlow.showInvitation ? (
              <div className="space-y-4">
                <InvitationSystem onValidCode={handleValidInvitation} />
              </div>
            ) : (
              <SignUpForm 
                formData={formData}
                authState={authState}
                updateFormData={updateFormData}
                signUp={signUp}
                requirements={requirements}
                isValid={isValid}
                username={username}
                setUsername={setUsername}
                invitationCode={invitationFlow.validCode}
                t={t}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AuthLayout>
  );
};

// Login Form Component
interface LoginFormProps {
  formData: any;
  authState: any;
  updateFormData: (field: string, value: string) => void;
  signIn: () => void;
  t: (key: string) => string;
}

const LoginForm = ({ formData, authState, updateFormData, signIn, t }: LoginFormProps) => (
  <form onSubmit={(e) => { e.preventDefault(); signIn(); }} className="space-y-4">
    <div className="form-control">
      <label className="label">
        <span className="label-text">{t('auth.email')}</span>
      </label>
      <input
        type="email"
        className="input input-bordered w-full"
        value={formData.email}
        onChange={(e) => updateFormData('email', e.target.value)}
        placeholder="your@email.com"
        required
      />
    </div>
    
    <div className="form-control">
      <label className="label">
        <span className="label-text">{t('auth.password')}</span>
      </label>
      <input
        type="password"
        className="input input-bordered w-full"
        value={formData.password}
        onChange={(e) => updateFormData('password', e.target.value)}
        required
      />
    </div>
    
    {authState.error && (
      <div className="alert alert-error">
        <span>{authState.error}</span>
      </div>
    )}
    
    <button 
      type="submit" 
      className="btn btn-primary w-full" 
      disabled={authState.loading}
    >
      {authState.loading ? (
        <>
          <span className="loading loading-spinner loading-sm"></span> 
          {t('common.loading')}
        </>
      ) : (
        <>
          <Users className="w-4 h-4" /> 
          {t('auth.login')}
        </>
      )}
    </button>
    
    <div className="text-center">
      <Link 
        to="/forgot-password" 
        className="link link-primary text-sm"
      >
        {t('auth.forgotPassword')}
      </Link>
    </div>
  </form>
);

// Sign Up Form Component  
interface SignUpFormProps {
  formData: any;
  authState: any;
  updateFormData: (field: string, value: string) => void;
  signUp: () => void;
  requirements: any[];
  isValid: boolean;
  username: string;
  setUsername: (value: string) => void;
  invitationCode: string;
  t: (key: string) => string;
}

const SignUpForm = ({ 
  formData, 
  authState, 
  updateFormData, 
  signUp, 
  requirements, 
  isValid, 
  username, 
  setUsername, 
  invitationCode, 
  t 
}: SignUpFormProps) => (
  <form onSubmit={(e) => { e.preventDefault(); signUp(); }} className="space-y-4">
    <div className="form-control">
      <label className="label">
        <span className="label-text">{t('auth.username')}</span>
      </label>
      <div className="input-group">
        <span>@</span>
        <input
          type="text"
          className="input input-bordered w-full"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          placeholder="yourname"
          maxLength={20}
        />
      </div>
    </div>
    
    <div className="form-control">
      <label className="label">
        <span className="label-text">{t('auth.email')}</span>
      </label>
      <input
        type="email"
        className="input input-bordered w-full"
        value={formData.email}
        onChange={(e) => updateFormData('email', e.target.value)}
        placeholder="your@email.com"
        required
      />
    </div>
    
    <div className="form-control">
      <label className="label">
        <span className="label-text">{t('auth.password')}</span>
      </label>
      <input
        type="password"
        className="input input-bordered w-full"
        value={formData.password}
        onChange={(e) => updateFormData('password', e.target.value)}
        required
      />
    </div>
    
    {formData.password && (
      <div className="space-y-2">
        <p className="text-sm text-base-content/70">{t('password.requirements.title')}:</p>
        <div className="space-y-1">
          {requirements.map((req: any, index: number) => (
            <PasswordRequirement key={index} met={req.met} text={req.text} />
          ))}
        </div>
      </div>
    )}
    
    {invitationCode && (
      <div className="alert alert-success">
        <Sparkles className="w-4 h-4" />
        <span>{t('invitation.codeApplied')}: {invitationCode}</span>
      </div>
    )}
    
    {authState.error && (
      <div className="alert alert-error">
        <span>{authState.error}</span>
      </div>
    )}
    
    <button 
      type="submit" 
      className="btn btn-primary w-full" 
      disabled={authState.loading || !isValid || !username.trim()}
    >
      {authState.loading ? (
        <>
          <span className="loading loading-spinner loading-sm"></span> 
          {t('common.loading')}
        </>
      ) : (
        <>
          <Heart className="w-4 h-4" /> 
          {t('auth.signUp')}
        </>
      )}
    </button>
  </form>
);

export default Auth;