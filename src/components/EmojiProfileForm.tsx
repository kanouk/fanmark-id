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
  FiGlobe,
  FiMessageCircle
} from 'react-icons/fi';

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
    theme_color: z.string().optional(),
    button_style: z.string().optional(),
  }).optional(),
  is_public: z.boolean().default(true),
});

type ProfileFormData = z.infer<typeof profileSchema>;

interface EmojiProfileFormProps {
  profile: EmojiProfile | null;
  onSave: (data: Partial<EmojiProfile>) => Promise<void>;
  isSubmitting: boolean;
}

const socialPlatforms = [
  { key: 'instagram', label: 'Instagram', icon: FiInstagram, placeholder: 'https://instagram.com/username' },
  { key: 'tiktok', label: 'TikTok', icon: FiMessageCircle, placeholder: 'https://tiktok.com/@username' },
  { key: 'x', label: 'X (Twitter)', icon: FiTwitter, placeholder: 'https://x.com/username' },
  { key: 'github', label: 'GitHub', icon: FiGithub, placeholder: 'https://github.com/username' },
  { key: 'youtube', label: 'YouTube', icon: FiYoutube, placeholder: 'https://youtube.com/@username' },
  { key: 'line', label: 'LINE', icon: FiMessageCircle, placeholder: 'https://line.me/ti/p/username' },
  { key: 'twitch', label: 'Twitch', icon: FiMessageCircle, placeholder: 'https://twitch.tv/username' },
  { key: 'discord', label: 'Discord', icon: FiMessageCircle, placeholder: 'https://discord.gg/invite' },
  { key: 'website', label: 'Website', icon: FiGlobe, placeholder: 'https://yourwebsite.com' },
];

export const EmojiProfileForm = ({ profile, onSave, isSubmitting }: EmojiProfileFormProps) => {
  const { t } = useTranslation();
  const { uploadAvatar, uploading } = useAvatarUpload();
  const [coverImageUrl, setCoverImageUrl] = useState(profile?.theme_settings?.cover_image_url || '');
  const [coverImageUploading, setCoverImageUploading] = useState(false);

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
        theme_color: profile?.theme_settings?.theme_color || '#3B82F6',
        button_style: profile?.theme_settings?.button_style || 'rounded',
      },
      is_public: profile?.is_public ?? true,
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

  const removeCoverImage = () => {
    setCoverImageUrl('');
    setValue('theme_settings.cover_image_url', '');
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
        },
      });
    } catch (error) {
      console.error('Profile save error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Cover Image */}
      <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <ImageIcon className="h-5 w-5" />
            {t('emojiProfile.coverImage')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {coverImageUrl ? (
            <div className="relative">
              <img
                src={coverImageUrl}
                alt="Cover"
                className="w-full h-48 object-cover rounded-xl"
              />
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={removeCoverImage}
                className="absolute top-2 right-2"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground mb-4">
                {t('emojiProfile.coverImageHint')}
              </p>
              <Label htmlFor="cover-upload" className="cursor-pointer">
                <Button type="button" variant="outline" disabled={coverImageUploading}>
                  {coverImageUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  {t('emojiProfile.uploadCover')}
                </Button>
              </Label>
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

      {/* Bio */}
      <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur">
        <CardContent className="p-6 space-y-4">
          <Label htmlFor="bio" className="text-sm font-semibold text-muted-foreground">
            {t('emojiProfile.bio')}
          </Label>
          <Textarea
            id="bio"
            {...register('bio')}
            placeholder={t('emojiProfile.bioPlaceholder')}
            rows={4}
            className="rounded-xl border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
          />
          {errors.bio && (
            <p className="text-sm text-destructive">{errors.bio.message}</p>
          )}
        </CardContent>
      </Card>

      {/* Theme Color */}
      <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur">
        <CardContent className="p-6 space-y-4">
          <Label htmlFor="themeColor" className="text-sm font-semibold text-muted-foreground">
            {t('emojiProfile.themeColor')}
          </Label>
          <div className="flex items-center gap-4">
            <Controller
              name="theme_settings.theme_color"
              control={control}
              render={({ field }) => (
                <input
                  type="color"
                  {...field}
                  className="w-16 h-10 rounded-lg border border-border cursor-pointer"
                />
              )}
            />
            <div 
              className="flex-1 h-10 rounded-lg border border-border"
              style={{ backgroundColor: themeColor }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Social Links */}
      <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">
            {t('emojiProfile.socialLinks')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {socialPlatforms.map((platform) => {
            const Icon = platform.icon;
            return (
              <div key={platform.key} className="space-y-2">
                <Label 
                  htmlFor={platform.key}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <Icon className="h-4 w-4" />
                  {platform.label}
                </Label>
                <Input
                  id={platform.key}
                  {...register(`social_links.${platform.key as keyof ProfileFormData['social_links']}`)}
                  placeholder={platform.placeholder}
                  className="h-11 rounded-xl border border-border focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                />
                {errors.social_links?.[platform.key as keyof ProfileFormData['social_links']] && (
                  <p className="text-sm text-destructive">
                    {errors.social_links[platform.key as keyof ProfileFormData['social_links']]?.message}
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Privacy Settings */}
      <Card className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-sm shadow-primary/5 backdrop-blur">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold text-muted-foreground">
                {t('emojiProfile.publicProfile')}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
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
                  className="h-5 w-5 rounded border-border text-primary focus:ring-primary"
                />
              )}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full h-12 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground shadow-[0_12px_30px_rgba(101,195,200,0.18)] transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {isSubmitting ? (
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('common.saving')}
          </div>
        ) : (
          t('common.save')
        )}
      </Button>
    </form>
  );
};