import { z } from 'zod';
import type { SocialLinkInputMode } from '@/components/SocialLinkInputCard';
import { socialPlatforms } from '@/lib/social-platforms';

export type AccessType = 'profile' | 'redirect' | 'text' | 'inactive';
export type RedirectLinkType = 'url' | 'phone';

export const isValidHttpUrl = (value?: string) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
};

export const sanitizePhoneInput = (value?: string) => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (!digitsOnly) return '';
  return hasPlus ? `+${digitsOnly}` : digitsOnly;
};

export const resolveSocialPlatformFromUrl = (targetUrl?: string) => {
  if (!targetUrl) {
    return { platformKey: 'tiktok', mode: 'handle' as SocialLinkInputMode };
  }

  if (targetUrl.startsWith('http://')) {
    return { platformKey: 'website', mode: 'url' as SocialLinkInputMode };
  }

  for (const platform of socialPlatforms) {
    if (platform.baseUrl && targetUrl.startsWith(platform.baseUrl)) {
      const mode: SocialLinkInputMode = platform.key === 'website' ? 'url' : 'handle';
      return { platformKey: platform.key, mode };
    }
  }

  return { platformKey: 'tiktok', mode: 'url' as SocialLinkInputMode };
};

export const settingsSchema = z.object({
  accessType: z.enum(['profile', 'redirect', 'text', 'inactive']),
  fanmarkName: z.string().min(1, 'validation.fanmarkNameRequired'),
  targetUrl: z.string().trim().optional(),
  textContent: z.string().optional(),
  createProfile: z.boolean().default(false),
  isPasswordProtected: z.boolean().default(false),
  accessPassword: z.string().optional(),
  is_public: z.boolean().default(false),
  redirectLinkType: z.enum(['url', 'phone']).default('url'),
  redirectPhoneNumber: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.accessType === 'redirect') {
    if (data.redirectLinkType === 'url') {
      if (!data.targetUrl) {
        ctx.addIssue({
          path: ['targetUrl'],
          code: z.ZodIssueCode.custom,
          message: 'validation.urlRequired',
        });
      } else if (!isValidHttpUrl(data.targetUrl)) {
        ctx.addIssue({
          path: ['targetUrl'],
          code: z.ZodIssueCode.custom,
          message: 'validation.invalidUrl',
        });
      }
    } else {
      const sanitized = sanitizePhoneInput(data.redirectPhoneNumber);
      if (!sanitized) {
        ctx.addIssue({
          path: ['redirectPhoneNumber'],
          code: z.ZodIssueCode.custom,
          message: 'validation.phoneRequired',
        });
      } else {
        const expectedTel = `tel:${sanitized}`;
        if (!data.targetUrl || data.targetUrl !== expectedTel) {
          ctx.addIssue({
            path: ['redirectPhoneNumber'],
            code: z.ZodIssueCode.custom,
            message: 'validation.invalidPhoneNumber',
          });
        }
      }
    }
  }

  if (data.accessType !== 'inactive' && data.isPasswordProtected && data.accessPassword && !/^\d{4}$/.test(data.accessPassword)) {
    ctx.addIssue({
      path: ['accessPassword'],
      code: z.ZodIssueCode.custom,
      message: 'validation.passwordMustBe4Digits',
    });
  }
});

export type SettingsFormData = z.infer<typeof settingsSchema>;
export type RestoredSettingsState = Partial<SettingsFormData> & { isEditingPassword?: boolean };
export const SETTINGS_DRAFT_TTL = 24 * 60 * 60 * 1000;

export interface Fanmark {
  id: string;
  user_input_fanmark: string;
  emoji_ids?: string[];
  fanmark?: string;
  fanmark_name: string | null;
  access_type: AccessType;
  target_url?: string;
  text_content?: string;
  is_password_protected?: boolean;
  status: string;
  short_id: string;
  license_id: string;
  is_public?: boolean;
}

export interface FanmarkSettingsProps {
  fanmark: Fanmark | null;
  mode?: 'dialog' | 'page';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  onSuccess?: () => void;
  restoreEditingState?: RestoredSettingsState;
}
