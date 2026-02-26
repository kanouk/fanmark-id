import { useEffect, useState } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { normalizeSocialUrlForSave, socialPlatforms } from '@/lib/social-platforms';
import { SocialLinkInputCard } from '@/components/SocialLinkInputCard';

const profileSchema = z.object({
  display_name: z.string().min(1, '名前を入力してください').max(50, '名前は50文字以内で入力してください'),
  bio: z.string().max(500, 'Bio must be 500 characters or less').optional(),
  social_links: z.object({
    instagram: z.string().url('Invalid URL').optional().or(z.literal('')),
    tiktok: z.string().url('Invalid URL').optional().or(z.literal('')),
    x: z.string().url('Invalid URL').optional().or(z.literal('')),
    youtube: z.string().url('Invalid URL').optional().or(z.literal('')),
    bereal: z.string().url('Invalid URL').optional().or(z.literal('')),
    line: z.string().url('Invalid URL').optional().or(z.literal('')),
    threads: z.string().url('Invalid URL').optional().or(z.literal('')),
    bluesky: z.string().url('Invalid URL').optional().or(z.literal('')),
    github: z.string().url('Invalid URL').optional().or(z.literal('')),
    discord: z.string().url('Invalid URL').optional().or(z.literal('')),
    snapchat: z.string().url('Invalid URL').optional().or(z.literal('')),
    twitch: z.string().url('Invalid URL').optional().or(z.literal('')),
    facebook: z.string().url('Invalid URL').optional().or(z.literal('')),
    website: z.string().url('Invalid URL').optional().or(z.literal('')),
  }).optional(),
  theme_settings: z.object({
    cover_image_url: z.string().optional(),
    cover_image_dimensions: z.object({
      width: z.number(),
      height: z.number(),
    }).optional(),
    cover_image_position: z.number().optional(),
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
  draftStorageKey?: string;
}

const buildDefaultValues = (profile: EmojiProfile | null): ProfileFormData => ({
  display_name: profile?.display_name || '',
  bio: profile?.bio || '',
  social_links: {
    instagram: profile?.social_links?.instagram || '',
    tiktok: profile?.social_links?.tiktok || '',
    x: profile?.social_links?.x || '',
    youtube: profile?.social_links?.youtube || '',
    bereal: profile?.social_links?.bereal || '',
    line: profile?.social_links?.line || '',
    threads: profile?.social_links?.threads || '',
    bluesky: profile?.social_links?.bluesky || '',
    github: profile?.social_links?.github || '',
    discord: profile?.social_links?.discord || '',
    snapchat: profile?.social_links?.snapchat || '',
    twitch: profile?.social_links?.twitch || '',
    facebook: profile?.social_links?.facebook || '',
    website: profile?.social_links?.website || '',
  },
  theme_settings: {
    cover_image_url: profile?.theme_settings?.cover_image_url || '',
    cover_image_dimensions: (profile?.theme_settings?.cover_image_dimensions as { width: number; height: number } | undefined),
    cover_image_position: typeof profile?.theme_settings?.cover_image_position === 'number'
      ? profile?.theme_settings?.cover_image_position
      : 50,
    profile_image_url: profile?.theme_settings?.profile_image_url || '',
    theme_color: profile?.theme_settings?.theme_color || '#3B82F6',
    button_style: profile?.theme_settings?.button_style || 'rounded',
  },
});

export const EmojiProfileForm = ({
  profile,
  onSave,
  isSubmitting,
  onClose,
  onPreview,
  draftStorageKey,
}: EmojiProfileFormProps) => {
  const { t } = useTranslation();
  const { uploadAvatar, uploading } = useAvatarUpload();
  const { uploadCoverImage, uploading: coverUploading } = useCoverImageUpload();
  const initialCoverUrl = profile?.theme_settings?.cover_image_url;
  const initialCoverDimensions = profile?.theme_settings?.cover_image_dimensions as { width: number; height: number } | undefined;
  const initialCoverPosition = profile?.theme_settings?.cover_image_position;
  const initialProfileUrl = profile?.theme_settings?.profile_image_url;
  const [hydratedDraftKey, setHydratedDraftKey] = useState<string | null>(null);

  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(
    typeof initialCoverUrl === 'string' && initialCoverUrl.length > 0 ? initialCoverUrl : null
  );
  const [coverImageUploading, setCoverImageUploading] = useState(false);
  const [coverImageDimensions, setCoverImageDimensions] = useState<{ width: number; height: number } | null>(
    initialCoverDimensions || null
  );
  const [coverImagePosition, setCoverImagePosition] = useState<number>(
    typeof initialCoverPosition === 'number' ? initialCoverPosition : 50
  );
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(
    typeof initialProfileUrl === 'string' && initialProfileUrl.length > 0 ? initialProfileUrl : null
  );
  const [profileImageUploading, setProfileImageUploading] = useState(false);
  const [isDraggingCover, setIsDraggingCover] = useState(false);
  const [socialInputModes, setSocialInputModes] = useState<Record<string, 'handle' | 'url'>>(() => {
    const initialModes: Record<string, 'handle' | 'url'> = {};
    socialPlatforms.forEach((platform) => {
      initialModes[platform.key] = platform.baseUrl ? 'handle' : 'url';
    });
    return initialModes;
  });

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: buildDefaultValues(profile),
  });

  useEffect(() => {
    if (!draftStorageKey) return;

    const DRAFT_TTL = 24 * 60 * 60 * 1000;
    let nextFormData = buildDefaultValues(profile);

    try {
      const cached = sessionStorage.getItem(draftStorageKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { timestamp?: number; form?: Partial<ProfileFormData> } | null;
        if (parsed && parsed.timestamp && Date.now() - parsed.timestamp <= DRAFT_TTL && parsed.form) {
          nextFormData = {
            ...nextFormData,
            ...parsed.form,
            social_links: {
              ...nextFormData.social_links,
              ...(parsed.form.social_links ?? {}),
            },
            theme_settings: {
              ...nextFormData.theme_settings,
              ...(parsed.form.theme_settings ?? {}),
            },
          };
        } else if (parsed?.timestamp) {
          sessionStorage.removeItem(draftStorageKey);
        }
      }
    } catch (error) {
      console.warn('Failed to load emoji profile draft:', error);
    }

    reset(nextFormData);
    setCoverImageUrl(nextFormData.theme_settings?.cover_image_url || null);
    setCoverImageDimensions((nextFormData.theme_settings?.cover_image_dimensions as { width: number; height: number } | undefined) || null);
    setCoverImagePosition(typeof nextFormData.theme_settings?.cover_image_position === 'number' ? nextFormData.theme_settings.cover_image_position : 50);
    setProfileImageUrl(nextFormData.theme_settings?.profile_image_url || null);
    setHydratedDraftKey(draftStorageKey);
  }, [draftStorageKey, profile, reset]);

  useEffect(() => {
    if (!draftStorageKey || hydratedDraftKey !== draftStorageKey) return;

    const subscription = watch((values) => {
      try {
        sessionStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            timestamp: Date.now(),
            form: values,
          })
        );
      } catch (error) {
        console.warn('Failed to persist emoji profile draft:', error);
      }
    });

    return () => subscription.unsubscribe();
  }, [draftStorageKey, hydratedDraftKey, watch]);

  useEffect(() => {
    setSocialInputModes((prev) => {
      const updatedModes: Record<string, 'handle' | 'url'> = { ...prev };
      socialPlatforms.forEach((platform) => {
        const existingValue = profile?.social_links?.[platform.key as keyof EmojiProfile['social_links']] as string | undefined;
        if (platform.baseUrl) {
          if (!existingValue) {
            updatedModes[platform.key] = 'handle';
          } else {
            updatedModes[platform.key] = existingValue.startsWith(platform.baseUrl) ? 'handle' : 'url';
          }
        } else {
          updatedModes[platform.key] = 'url';
        }
      });
      return updatedModes;
    });
  }, [profile]);

  useEffect(() => {
    if (!profile?.theme_settings) {
      setCoverImageUrl(null);
      setCoverImageDimensions(null);
      setCoverImagePosition(50);
      setProfileImageUrl(null);
      return;
    }

    const themeSettings = profile.theme_settings;
    setCoverImageUrl(
      typeof themeSettings.cover_image_url === 'string' && themeSettings.cover_image_url.length > 0
        ? themeSettings.cover_image_url
        : null
    );
    setCoverImageDimensions(
      (themeSettings.cover_image_dimensions as { width: number; height: number } | undefined) || null
    );
    setCoverImagePosition(
      typeof themeSettings.cover_image_position === 'number' ? themeSettings.cover_image_position : 50
    );
    setProfileImageUrl(
      typeof themeSettings.profile_image_url === 'string' && themeSettings.profile_image_url.length > 0
        ? themeSettings.profile_image_url
        : null
    );
  }, [profile?.theme_settings]);

  const themeColor = watch('theme_settings.theme_color');

  const handleCoverImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCoverImageUploading(true);
    try {
      const result = await uploadCoverImage(file);
      setCoverImageUrl(result.url);
      setCoverImageDimensions({ width: result.width, height: result.height });
      setValue('theme_settings.cover_image_url', result.url);
      setValue('theme_settings.cover_image_dimensions', { width: result.width, height: result.height });
      toast({
        title: t('common.coverImageUploaded'),
        description: t('common.coverImageUploadedDesc'),
      });
    } catch (error) {
      console.error('Cover image upload error:', error);
      toast({
        title: t('common.uploadFailed'),
        description: error instanceof Error ? error.message : t('common.coverUploadFailedDesc'),
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
        title: t('common.profileImageUploaded'),
        description: t('common.profileImageUploadedDesc'),
      });
    } catch (error) {
      console.error('Profile image upload error:', error);
      toast({
        title: t('common.uploadFailed'),
        description: error instanceof Error ? error.message : t('common.profileUploadFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setProfileImageUploading(false);
    }
  };

  const removeCoverImage = () => {
    setCoverImageUrl(null);
    setValue('theme_settings.cover_image_url', '');
    setCoverImageDimensions(null);
    setValue('theme_settings.cover_image_dimensions', undefined);
    setCoverImagePosition(50);
    setValue('theme_settings.cover_image_position', 50);
  };

  const removeProfileImage = () => {
    setProfileImageUrl(null);
    setValue('theme_settings.profile_image_url', '');
  };

  const onSubmit = async (data: ProfileFormData) => {
    try {
      const normalizedSocialLinks = Object.fromEntries(
        Object.entries(data.social_links || {}).map(([key, value]) => [
          key,
          normalizeSocialUrlForSave(value),
        ])
      );

      // Filter out empty social links
      const filteredSocialLinks = Object.fromEntries(
        Object.entries(normalizedSocialLinks).filter(([_, value]) => value && value.trim() !== '')
      );

      await onSave({
        ...data,
        social_links: filteredSocialLinks,
        theme_settings: {
          ...data.theme_settings,
          cover_image_url: coverImageUrl ?? '',
          cover_image_dimensions: coverImageDimensions ?? undefined,
          cover_image_position: coverImagePosition,
          profile_image_url: profileImageUrl ?? '',
        },
      });
      if (draftStorageKey) {
        sessionStorage.removeItem(draftStorageKey);
      }
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
            {(profile as any)?.fanmark && (
              <div className="flex justify-center pt-2">
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/10 text-primary text-2xl md:text-3xl font-semibold tracking-[0.6em]">
                  {(profile as any).fanmark.split('').join(' ')}
                </span>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-8 p-10">
            {/* Profile Preview Display */}
            <div className="relative">
              {/* Cover Image Area */}
          <div
            className={`group relative w-full h-60 md:h-72 rounded-2xl overflow-hidden bg-gradient-to-br from-primary/10 via-accent/10 to-primary/5 border-2 border-dashed border-primary/20 transition-colors ${coverImageUrl ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:border-primary/30'}`}
            onClick={() => {
              if (!coverImageUrl) {
                document.getElementById('cover-image-upload')?.click();
              }
            }}
            onMouseDown={coverImageUrl ? (event) => {
              const container = event.currentTarget as HTMLDivElement;
              const containerHeight = container.clientHeight;
              const startY = event.clientY;
              const startPosition = coverImagePosition;
              setIsDraggingCover(true);

              const handleMouseMove = (moveEvent: MouseEvent) => {
                const deltaY = moveEvent.clientY - startY;
                const percentDelta = (deltaY / containerHeight) * 100;
                const nextPosition = Math.min(100, Math.max(0, startPosition - percentDelta));
                setCoverImagePosition(nextPosition);
                setValue('theme_settings.cover_image_position', nextPosition);
              };

              const handleMouseUp = () => {
                setIsDraggingCover(false);
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
              };

              window.addEventListener('mousemove', handleMouseMove);
              window.addEventListener('mouseup', handleMouseUp);
            } : undefined}
          >
                {coverImageUrl ? (
                  <>
                    <img
                      src={coverImageUrl}
                      alt="Cover preview"
                  className="w-full h-full object-cover"
                  style={{ objectPosition: `50% ${coverImagePosition}%` }}
                    />
                    {coverImageUrl && (
                    <div className="absolute bottom-3 left-4 right-4 flex items-center gap-3 rounded-full bg-background/80 px-4 py-2 text-xs font-medium text-muted-foreground shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                            ⇕
                          </span>
                          ドラッグして表示位置を調整できます
                        </div>
                        <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/70">{Math.round(coverImagePosition)}%</span>
                      </div>
                    )}
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
                  {profileImageUrl ? (
                    <>
                      <div className="w-full h-full rounded-full overflow-hidden">
                        <img
                          src={profileImageUrl}
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
              SNSのプロフィールリンクを追加してください。基本はユーザー名だけでOK、右側のボタンでフルURL入力にも切り替えられます。
            </p>
          </CardHeader>
          <CardContent className="p-10">
            <div className="grid gap-6 md:grid-cols-2">
              {socialPlatforms.map((platform) => {
                const inputId = `social-${platform.key}`;
                return (
                  <Controller
                    key={platform.key}
                    control={control}
                    name={`social_links.${platform.key as keyof ProfileFormData['social_links']}`}
                    render={({ field }) => {
                      const errorMessage = errors.social_links?.[platform.key as keyof ProfileFormData['social_links']]?.message;

                      return (
                        <SocialLinkInputCard
                          platform={platform}
                          inputId={inputId}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          inputRef={field.ref}
                          mode={socialInputModes[platform.key] || (platform.baseUrl ? 'handle' : 'url')}
                          onModeChange={(nextMode) => {
                            setSocialInputModes((prev) => ({
                              ...prev,
                              [platform.key]: nextMode,
                            }));
                          }}
                          errorMessage={errorMessage}
                        />
                      );
                    }}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Spacer for fixed bottom bar */}
        <div className="h-24" />

        {/* Action Button */}
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-border/40 p-6 z-50">
          <div className="flex justify-center gap-4">
            {onPreview && (
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                className="px-6 h-10 text-sm rounded-2xl border-primary/20 hover:border-primary/40 hover:bg-primary/5"
                onClick={onPreview}
              >
                <Eye className="h-5 w-5 mr-2" />
                {t('emojiProfile.preview')}
              </Button>
            )}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="px-6 h-10 text-sm rounded-2xl bg-primary hover:bg-primary/90 btn-pop"
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
      </form>
    </div>
  );
};
