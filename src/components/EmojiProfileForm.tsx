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
import { useCoverImageUpload } from '@/hooks/useCoverImageUpload';
import { EmojiProfile } from '@/hooks/useEmojiProfile';
import { Loader2, Upload, X, Image as ImageIcon, FileText, Link, Shield, User, Eye } from 'lucide-react';
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
  display_name: z.string().min(1, '名前を入力してください').max(50, '名前は50文字以内で入力してください'),
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
});

type ProfileFormData = z.infer<typeof profileSchema>;

interface EmojiProfileFormProps {
  profile: EmojiProfile | null;
  onSave: (data: Partial<EmojiProfile>) => Promise<void>;
  isSubmitting: boolean;
  onClose: () => void;
  onPreview?: () => void;
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

export const EmojiProfileForm = ({ profile, onSave, isSubmitting, onClose, onPreview }: EmojiProfileFormProps) => {
  const { t } = useTranslation();
  const { uploadAvatar, uploading } = useAvatarUpload();
  const { uploadCoverImage, uploading: coverUploading } = useCoverImageUpload();
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
      display_name: profile?.display_name || '',
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
    },
  });

  const themeColor = watch('theme_settings.theme_color');

  const handleCoverImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCoverImageUploading(true);
    try {
      const imageUrl = await uploadCoverImage(file);
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
    <div className="space-y-8">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Profile Preview */}
        <Card className="rounded-3xl border border-primary/20 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur card-pop">
          <CardHeader className="pb-6 px-10 pt-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <ImageIcon className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg font-semibold">プロフィール画像</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              カバー画像とプロフィール画像をアップロードして、完成イメージを確認してください
            </p>
          </CardHeader>
          <CardContent className="space-y-8 p-10">
            {/* Profile Preview Display */}
            <div className="relative">
              {/* Cover Image Area */}
              <div className="group relative w-full h-48 rounded-2xl overflow-hidden bg-gradient-to-br from-primary/10 via-accent/10 to-primary/5 border-2 border-dashed border-primary/20 hover:border-primary/30 transition-colors cursor-pointer"
                   onClick={() => document.getElementById('cover-image-upload')?.click()}
              >
                {(coverImageUrl || profile?.theme_settings?.cover_image_url) ? (
                  <>
                    <img
                      src={coverImageUrl || profile?.theme_settings?.cover_image_url}
                      alt="Cover preview"
                      className="w-full h-full object-cover"
                    />
                    {/* Cover Image Overlay with Edit Button */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200 flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="bg-background/90 backdrop-blur rounded-full p-3 shadow-lg">
                          {(coverImageUploading || coverUploading) ? (
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                          ) : (
                            <Upload className="h-6 w-6 text-primary" />
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="absolute top-3 right-3 h-8 w-8 rounded-full p-0 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCoverImage();
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                        {(coverImageUploading || coverUploading) ? (
                          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                        ) : (
                        <div className="bg-primary/5 rounded-full p-4 group-hover:bg-primary/10 transition-colors">
                          <Upload className="h-8 w-8 text-primary/60" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <input
                  id="cover-image-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleCoverImageUpload}
                  className="hidden"
                  disabled={coverImageUploading || coverUploading}
                />
              </div>

              {/* Profile Image Area - Positioned over cover image */}
              <div className="absolute -bottom-12 left-6">
                <div className="group relative w-24 h-24 rounded-full bg-background border-4 border-background shadow-lg cursor-pointer hover:shadow-xl transition-shadow"
                     onClick={() => document.getElementById('profile-image-upload')?.click()}
                >
                  {(profileImageUrl || profile?.theme_settings?.profile_image_url) ? (
                    <>
                      <div className="w-full h-full rounded-full overflow-hidden">
                        <img
                          src={profileImageUrl || profile?.theme_settings?.profile_image_url}
                          alt="Profile preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {/* Profile Image Overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200 flex items-center justify-center rounded-full">
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <div className="bg-background/90 backdrop-blur rounded-full p-2 shadow-lg">
                            {profileImageUploading ? (
                              <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            ) : (
                              <Upload className="h-4 w-4 text-primary" />
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="absolute -top-1 -right-1 w-7 h-7 rounded-full p-0 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity z-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeProfileImage();
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <div className="w-full h-full bg-primary/10 border-2 border-dashed border-primary/20 group-hover:border-primary/40 group-hover:bg-primary/15 transition-colors flex items-center justify-center rounded-full">
                      {profileImageUploading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      ) : (
                        <Upload className="h-6 w-6 text-primary/60" />
                      )}
                    </div>
                  )}
                  <input
                    id="profile-image-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleProfileImageUpload}
                    className="hidden"
                    disabled={profileImageUploading}
                  />
                </div>
              </div>
            </div>

            {/* Display Name & Bio Section - positioned under profile image */}
            <div className="pt-8 pl-6 pr-6">
              <div className="grid gap-6 md:grid-cols-2">
                {/* Display Name */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <User className="h-4 w-4 text-primary" />
                    表示名
                  </Label>
                  <Input
                    {...register('display_name')}
                    placeholder="あなたの名前"
                    className="w-full h-10 text-sm rounded-xl border-2 border-border hover:border-primary/30 focus:border-primary transition-colors px-3 placeholder:text-muted-foreground/40"
                  />
                  {errors.display_name && (
                    <p className="text-xs text-destructive font-medium">{errors.display_name.message}</p>
                  )}
                </div>

                {/* Bio */}
                <div className="space-y-3">
                  <Label className="text-sm font-medium text-foreground flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    自己紹介
                  </Label>
                  <Textarea
                    {...register('bio')}
                    placeholder="簡単な自己紹介..."
                    className="min-h-[80px] resize-none text-sm rounded-xl border-2 border-border hover:border-primary/30 focus:border-primary transition-colors p-3 leading-relaxed placeholder:text-muted-foreground/40"
                    maxLength={200}
                  />
                  {errors.bio && (
                    <p className="text-xs text-destructive font-medium">{errors.bio.message}</p>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>



        {/* Social Links */}
        <Card className="rounded-3xl border border-primary/20 bg-background/90 shadow-[0_20px_45px_rgba(101,195,200,0.14)] backdrop-blur card-pop">
          <CardHeader className="pb-6 px-10 pt-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-primary/10">
                <Link className="h-5 w-5 text-primary" />
              </div>
              <CardTitle className="text-lg font-semibold">ソーシャルリンク</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              SNSのプロフィールリンクを追加してください
            </p>
          </CardHeader>
          <CardContent className="p-10">
            <div className="grid gap-6 md:grid-cols-2">
              {socialPlatforms.map((platform) => (
                <div key={platform.key} className="space-y-3">
                  <Label className="text-sm font-medium flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-primary/5">
                      <platform.icon className="h-4 w-4 text-primary" />
                    </div>
                    {platform.label}
                  </Label>
                  <Input
                    {...register(`social_links.${platform.key as keyof ProfileFormData['social_links']}`)}
                    placeholder={platform.placeholder}
                    className="w-full h-12 text-base rounded-2xl border-2 border-border hover:border-primary/30 focus:border-primary transition-colors px-4 placeholder:text-muted-foreground/40"
                  />
                  {errors.social_links?.[platform.key as keyof ProfileFormData['social_links']] && (
                    <p className="text-sm text-destructive font-medium">
                      {errors.social_links[platform.key as keyof ProfileFormData['social_links']]?.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Privacy Settings */}
      </form>

      {/* Action Button */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border/40 p-8 mt-12">
        <div className="flex justify-center gap-4">
          {onPreview && (
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              className="px-8 h-12 text-base rounded-2xl border-primary/20 hover:border-primary/40 hover:bg-primary/5"
              onClick={onPreview}
            >
              <Eye className="h-5 w-5 mr-2" />
              {t('emojiProfile.preview')}
            </Button>
          )}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="px-10 h-12 text-base rounded-2xl bg-primary hover:bg-primary/90 btn-pop"
            onClick={handleSubmit(onSubmit)}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-3" />
                保存中...
              </>
            ) : (
              '保存する'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};