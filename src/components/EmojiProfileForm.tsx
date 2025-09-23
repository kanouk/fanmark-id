import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { useAvatarUpload } from '@/hooks/useAvatarUpload';
import { EmojiProfile } from '@/hooks/useEmojiProfile';
import { Loader2, Upload, X, Image as ImageIcon, FileText, Link, Shield } from 'lucide-react';
import { 
  FiInstagram, 
  FiTwitter, 
  FiGithub, 
  FiYoutube,
  FiGlobe
} from 'react-icons/fi';
import { 
  SiTiktok, 
  SiLine, 
  SiTwitch, 
  SiDiscord 
} from 'react-icons/si';
import { Checkbox } from '@/components/ui/checkbox';

const profileSchema = z.object({
  bio: z.string().max(500, 'Bio must be 500 characters or less').optional(),
  social_links: z.object({
    instagram: z.string().url('Invalid URL').optional().or(z.literal('')),
    tiktok: z.string().url('Invalid URL').optional().or(z.literal('')),
    x: z.string().url('Invalid URL').optional().or(z.literal('')),
    github: z.string().url('Invalid URL').optional().or(z.literal('')),
    youtube: z.string().url('Invalid URL').optional().or(z.literal('')),
    line: z.string().url('Invalid URL').optional().or(z.literal('')),
    twitch: z.string().url('Invalid URL').optional().or(z.literal('')),
    discord: z.string().url('Invalid URL').optional().or(z.literal('')),
    website: z.string().url('Invalid URL').optional().or(z.literal('')),
  }).optional(),
  theme_settings: z.object({
    cover_image_url: z.string().optional(),
    profile_image_url: z.string().optional(),
    theme_color: z.string().optional(),
    button_style: z.string().optional(),
  }).optional(),
  is_public: z.boolean().default(false),
});

type ProfileFormData = z.infer<typeof profileSchema>;

interface EmojiProfileFormProps {
  profile: EmojiProfile | null;
  onSave: (data: Partial<EmojiProfile>) => Promise<void>;
  isSubmitting: boolean;
  onClose: () => void;
}

const socialPlatforms = [
  { key: 'instagram', label: 'Instagram', icon: FiInstagram, placeholder: 'https://instagram.com/username' },
  { key: 'tiktok', label: 'TikTok', icon: SiTiktok, placeholder: 'https://tiktok.com/@username' },
  { key: 'x', label: 'X (Twitter)', icon: FiTwitter, placeholder: 'https://x.com/username' },
  { key: 'github', label: 'GitHub', icon: FiGithub, placeholder: 'https://github.com/username' },
  { key: 'youtube', label: 'YouTube', icon: FiYoutube, placeholder: 'https://youtube.com/@username' },
  { key: 'line', label: 'LINE', icon: SiLine, placeholder: 'https://line.me/ti/p/username' },
  { key: 'twitch', label: 'Twitch', icon: SiTwitch, placeholder: 'https://twitch.tv/username' },
  { key: 'discord', label: 'Discord', icon: SiDiscord, placeholder: 'https://discord.gg/invite' },
  { key: 'website', label: 'Website', icon: FiGlobe, placeholder: 'https://yourwebsite.com' },
];

export const EmojiProfileForm = ({ profile, onSave, isSubmitting, onClose }: EmojiProfileFormProps) => {
  const { t } = useTranslation();
  const { uploadAvatar, uploading } = useAvatarUpload();
  const [coverImageUrl, setCoverImageUrl] = useState(profile?.theme_settings?.cover_image_url || '');
  const [coverImageUploading, setCoverImageUploading] = useState(false);
  const [profileImageUrl, setProfileImageUrl] = useState(profile?.theme_settings?.profile_image_url || '');
  const [profileImageUploading, setProfileImageUploading] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      bio: profile?.bio || '',
      social_links: {
        instagram: profile?.social_links?.instagram || '',
        tiktok: profile?.social_links?.tiktok || '',
        x: profile?.social_links?.x || '',
        github: profile?.social_links?.github || '',
        youtube: profile?.social_links?.youtube || '',
        line: profile?.social_links?.line || '',
        twitch: profile?.social_links?.twitch || '',
        discord: profile?.social_links?.discord || '',
        website: profile?.social_links?.website || '',
      },
      theme_settings: {
        cover_image_url: profile?.theme_settings?.cover_image_url || '',
        profile_image_url: profile?.theme_settings?.profile_image_url || '',
        theme_color: profile?.theme_settings?.theme_color || '#3B82F6',
        button_style: profile?.theme_settings?.button_style || 'rounded',
      },
      is_public: profile?.is_public ?? false,
    },
  });

  const themeColor = watch('theme_settings.theme_color');

  const handleCoverImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCoverImageUploading(true);
    try {
      const imageUrl = await uploadAvatar(file);
      setCoverImageUrl(imageUrl);
      setValue('theme_settings.cover_image_url', imageUrl);
      toast({
        title: 'Cover image uploaded',
        description: 'Your cover image has been updated successfully.',
      });
    } catch (error) {
      console.error('Cover image upload error:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload cover image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setCoverImageUploading(false);
    }
  };

  const handleProfileImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProfileImageUploading(true);
    try {
      const imageUrl = await uploadAvatar(file);
      setProfileImageUrl(imageUrl);
      setValue('theme_settings.profile_image_url', imageUrl);
      toast({
        title: 'Profile image uploaded',
        description: 'Your profile image has been updated successfully.',
      });
    } catch (error) {
      console.error('Profile image upload error:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload profile image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setProfileImageUploading(false);
    }
  };

  const removeCoverImage = () => {
    setCoverImageUrl('');
    setValue('theme_settings.cover_image_url', '');
  };

  const removeProfileImage = () => {
    setProfileImageUrl('');
    setValue('theme_settings.profile_image_url', '');
  };

  const onSubmit = async (data: ProfileFormData) => {
    try {
      // Filter out empty social links
      const filteredSocialLinks = Object.fromEntries(
        Object.entries(data.social_links || {}).filter(([_, value]) => value && value.trim() !== '')
      );

      await onSave({
        ...data,
        social_links: filteredSocialLinks,
        theme_settings: {
          ...data.theme_settings,
          cover_image_url: coverImageUrl,
          profile_image_url: profileImageUrl,
        },
      });
    } catch (error) {
      console.error('Profile save error:', error);
    }
  };

  return (
    <div className="space-y-10">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-10">
        {/* Cover Image */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-6">
            <div className="flex items-center gap-3">
              <ImageIcon className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">カバー画像</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              プロフィールページの背景として表示される画像をアップロードしてください
            </p>
          </CardHeader>
          <CardContent className="space-y-6 p-10">
            <div className="space-y-6">
              {(coverImageUrl || profile?.theme_settings?.cover_image_url) && (
                <div className="relative">
                  <img
                    src={coverImageUrl || profile?.theme_settings?.cover_image_url}
                    alt="Cover preview"
                    className="w-full h-40 object-cover rounded-lg border border-border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="absolute top-2 right-2"
                    onClick={removeCoverImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById('cover-image-upload')?.click()}
                  disabled={coverImageUploading}
                  className="flex items-center gap-2 h-9"
                >
                  {coverImageUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span className="text-sm">{coverImageUploading ? 'アップロード中...' : 'カバー画像をアップロード'}</span>
                </Button>
                <input
                  id="cover-image-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleCoverImageUpload}
                  className="hidden"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Profile Image */}
        <Card>
          <CardHeader className="pb-6">
            <div className="flex items-center gap-3">
              <ImageIcon className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">プロフィール画像</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              プロフィールの顔となる画像をアップロードしてください
            </p>
          </CardHeader>
          <CardContent className="space-y-6 p-10">
            <div className="space-y-6">
              {(profileImageUrl || profile?.theme_settings?.profile_image_url) && (
                <div className="relative w-24 h-24 mx-auto">
                  <img
                    src={profileImageUrl || profile?.theme_settings?.profile_image_url}
                    alt="Profile preview"
                    className="w-full h-full object-cover rounded-full border-2 border-border"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full p-0"
                    onClick={removeProfileImage}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => document.getElementById('profile-image-upload')?.click()}
                  disabled={profileImageUploading}
                  className="flex items-center gap-2 h-9"
                >
                  {profileImageUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  <span className="text-sm">{profileImageUploading ? 'アップロード中...' : 'プロフィール画像をアップロード'}</span>
                </Button>
                <input
                  id="profile-image-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleProfileImageUpload}
                  className="hidden"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Bio */}
        <Card>
          <CardHeader className="pb-6">
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">自己紹介</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              あなたについて教えてください
            </p>
          </CardHeader>
          <CardContent className="p-10">
            <div className="space-y-3">
              <Textarea
                {...register('bio')}
                placeholder="あなたの自己紹介を書いてください..."
                className="min-h-[100px] resize-none text-sm"
              />
              {errors.bio && (
                <p className="text-xs text-destructive">{errors.bio.message}</p>
              )}
            </div>
          </CardContent>
        </Card>


        {/* Social Links */}
        <Card>
          <CardHeader className="pb-6">
            <div className="flex items-center gap-3">
              <Link className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">ソーシャルリンク</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              SNSのプロフィールリンクを追加してください
            </p>
          </CardHeader>
          <CardContent className="p-10">
            <div className="space-y-8">
              {socialPlatforms.map((platform) => (
                <div key={platform.key} className="space-y-3">
                  <Label className="text-sm font-medium flex items-center gap-2">
                    <platform.icon className="h-4 w-4" />
                    {platform.label}
                  </Label>
                  <Input
                    {...register(`social_links.${platform.key as keyof ProfileFormData['social_links']}`)}
                    placeholder={platform.placeholder}
                    className="w-full h-9 text-sm"
                  />
                  {errors.social_links?.[platform.key as keyof ProfileFormData['social_links']] && (
                    <p className="text-xs text-destructive">
                      {errors.social_links[platform.key as keyof ProfileFormData['social_links']]?.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Privacy Settings */}
        <Card>
          <CardHeader className="pb-6">
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">プライバシー設定</CardTitle>
            </div>
            <p className="text-xs text-muted-foreground">
              プロフィールの公開設定を選択してください
            </p>
          </CardHeader>
          <CardContent className="p-10">
            <div className="space-y-6">
              <div className="flex items-center space-x-3">
                <Controller
                  name="is_public"
                  control={control}
                  render={({ field }) => (
                    <Checkbox
                      id="is_public"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
                <Label htmlFor="is_public" className="text-sm">
                  プロフィールを公開する
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                公開すると、他のユーザーがあなたのプロフィールを閲覧できるようになります
              </p>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Action Buttons */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border p-8 mt-12">
        <div className="flex gap-4 justify-end max-w-5xl mx-auto">
          <Button type="button" variant="outline" onClick={onClose} className="px-8 h-10 text-sm">
            閉じる
          </Button>
          <Button type="submit" disabled={isSubmitting} className="px-8 h-10 text-sm"
            onClick={handleSubmit(onSubmit)}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                保存中...
              </>
            ) : (
              '保存'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};