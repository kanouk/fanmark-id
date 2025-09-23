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
import { Loader2, Upload, X, Image as ImageIcon } from 'lucide-react';
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
    <div className="space-y-8">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        {/* Cover Image */}
        <Card className="overflow-hidden rounded-3xl border border-border/50 bg-card/80 shadow-lg shadow-primary/10 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-3 text-xl font-semibold">
              <ImageIcon className="h-6 w-6 text-primary" />
              {t('emojiProfile.coverImage')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {coverImageUrl ? (
              <div className="relative">
                <img
                  src={coverImageUrl}
                  alt="Cover"
                  className="w-full h-56 object-cover rounded-2xl"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={removeCoverImage}
                  className="absolute top-3 right-3 rounded-full"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-border rounded-2xl p-12 text-center">
                <ImageIcon className="h-16 w-16 mx-auto text-muted-foreground mb-6" />
                <p className="text-base text-muted-foreground mb-6 max-w-sm mx-auto">
                  {t('emojiProfile.coverImageHint')}
                </p>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="lg"
                  disabled={coverImageUploading}
                  onClick={() => document.getElementById('cover-upload')?.click()}
                  className="rounded-full px-8"
                >
                  {coverImageUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-5 w-5 mr-2" />
                  )}
                  {t('emojiProfile.uploadCover')}
                </Button>
                <input
                  id="cover-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleCoverImageUpload}
                  className="hidden"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Profile Image */}
        <Card className="overflow-hidden rounded-3xl border border-border/50 bg-card/80 shadow-lg shadow-primary/10 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-3 text-xl font-semibold">
              <ImageIcon className="h-6 w-6 text-primary" />
              {t('emojiProfile.profileImage')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {profileImageUrl ? (
              <div className="relative w-40 h-40 mx-auto">
                <img
                  src={profileImageUrl}
                  alt="Profile"
                  className="w-full h-full object-cover rounded-full border-4 border-primary/20"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={removeProfileImage}
                  className="absolute top-2 right-2 rounded-full"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-border rounded-2xl p-12 text-center">
                <ImageIcon className="h-16 w-16 mx-auto text-muted-foreground mb-6" />
                <p className="text-base text-muted-foreground mb-6 max-w-sm mx-auto">
                  {t('emojiProfile.profileImageHint')}
                </p>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="lg"
                  disabled={profileImageUploading}
                  onClick={() => document.getElementById('profile-upload')?.click()}
                  className="rounded-full px-8"
                >
                  {profileImageUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-5 w-5 mr-2" />
                  )}
                  {t('emojiProfile.uploadProfile')}
                </Button>
                <input
                  id="profile-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleProfileImageUpload}
                  className="hidden"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bio */}
        <Card className="overflow-hidden rounded-3xl border border-border/50 bg-card/80 shadow-lg shadow-primary/10 backdrop-blur">
          <CardContent className="p-8 space-y-6">
            <Label htmlFor="bio" className="text-base font-semibold text-foreground">
              {t('emojiProfile.bio')}
            </Label>
            <Textarea
              id="bio"
              {...register('bio')}
              placeholder={t('emojiProfile.bioPlaceholder')}
              rows={5}
              className="rounded-2xl border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 text-base p-4"
            />
            {errors.bio && (
              <p className="text-sm text-destructive">{errors.bio.message}</p>
            )}
          </CardContent>
        </Card>

        {/* Theme Color */}
        <Card className="overflow-hidden rounded-3xl border border-border/50 bg-card/80 shadow-lg shadow-primary/10 backdrop-blur">
          <CardContent className="p-8 space-y-6">
            <Label htmlFor="themeColor" className="text-base font-semibold text-foreground">
              {t('emojiProfile.themeColor')}
            </Label>
            <div className="flex items-center gap-6">
              <Controller
                name="theme_settings.theme_color"
                control={control}
                render={({ field }) => (
                  <input
                    type="color"
                    {...field}
                    className="w-20 h-12 rounded-2xl border border-border cursor-pointer"
                  />
                )}
              />
              <div 
                className="flex-1 h-12 rounded-2xl border border-border"
                style={{ backgroundColor: themeColor }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Social Links */}
        <Card className="overflow-hidden rounded-3xl border border-border/50 bg-card/80 shadow-lg shadow-primary/10 backdrop-blur">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold">
              {t('emojiProfile.socialLinks')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 sm:grid-cols-2">
              {socialPlatforms.map((platform) => {
                const Icon = platform.icon;
                return (
                  <div key={platform.key} className="space-y-3">
                    <Label 
                      htmlFor={platform.key}
                      className="flex items-center gap-3 text-base font-medium"
                    >
                      <Icon className="h-5 w-5 text-primary" />
                      {platform.label}
                    </Label>
                    <Input
                      id={platform.key}
                      {...register(`social_links.${platform.key as keyof ProfileFormData['social_links']}`)}
                      placeholder={platform.placeholder}
                      className="h-12 rounded-2xl border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 text-base"
                    />
                    {errors.social_links?.[platform.key as keyof ProfileFormData['social_links']] && (
                      <p className="text-sm text-destructive">
                        {errors.social_links[platform.key as keyof ProfileFormData['social_links']]?.message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Privacy Settings */}
        <Card className="overflow-hidden rounded-3xl border border-border/50 bg-card/80 shadow-lg shadow-primary/10 backdrop-blur">
          <CardContent className="p-8">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <Label className="text-base font-semibold text-foreground">
                  {t('emojiProfile.publicProfile')}
                </Label>
                <p className="text-sm text-muted-foreground max-w-md">
                  {t('emojiProfile.publicProfileDescription')}
                </p>
              </div>
              <Controller
                name="is_public"
                control={control}
                render={({ field }) => (
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={field.onChange}
                    className="h-6 w-6 rounded border-border text-primary focus:ring-primary mt-1"
                  />
                )}
              />
            </div>
          </CardContent>
        </Card>
      </form>

      {/* Action Buttons */}
      <div className="sticky bottom-0 bg-gradient-to-t from-background to-background/80 backdrop-blur pt-8 pb-6">
        <div className="flex gap-4 justify-end">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={onClose}
            className="px-8 rounded-full"
          >
            {t('common.close')}
          </Button>
          <Button
            type="submit"
            form="profile-form"
            disabled={isSubmitting}
            size="lg"
            className="px-8 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all duration-200"
            onClick={handleSubmit(onSubmit)}
          >
            {isSubmitting ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('common.saving')}
              </div>
            ) : (
              t('common.save')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};