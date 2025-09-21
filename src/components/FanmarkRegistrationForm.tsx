import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

const registrationSchema = z.object({
  emojiCombination: z.string().min(1, 'Emoji combination is required'),
  accessType: z.enum(['profile', 'redirect', 'text', 'inactive']),
  displayName: z.string().min(1, 'Display name is required'),
  targetUrl: z.string().url().optional().or(z.literal('')),
  textContent: z.string().optional(),
  createProfile: z.boolean().default(false),
  isTransferable: z.boolean().default(true),
}).refine((data) => {
  if (data.accessType === 'redirect' && !data.targetUrl) {
    return false;
  }
  if (data.accessType === 'text' && !data.textContent) {
    return false;
  }
  return true;
}, {
  message: 'Please fill in required fields for selected access type',
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

interface FanmarkRegistrationFormProps {
  prefilledEmoji?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const FanmarkRegistrationForm = ({ 
  prefilledEmoji, 
  onSuccess, 
  onCancel 
}: FanmarkRegistrationFormProps) => {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      emojiCombination: prefilledEmoji || '',
      accessType: 'inactive',
      displayName: '',
      targetUrl: '',
      textContent: '',
      createProfile: false,
      isTransferable: true,
    },
  });

  const accessType = watch('accessType');
  const createProfile = watch('createProfile');

  const onSubmit = async (data: RegistrationFormData) => {
    if (!user) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to register a fanmark',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: result, error } = await supabase.functions.invoke('register-fanmark', {
        body: {
          emoji: data.emojiCombination,
          accessType: data.accessType,
          displayName: data.displayName,
          targetUrl: data.targetUrl || null,
          textContent: data.textContent || null,
          createProfile: data.createProfile,
          isTransferable: data.isTransferable,
        },
      });

      if (error) throw error;

      if (result.success) {
        toast({
          title: 'Your fanmark is ready! 🎉✨',
          description: 'Great choice! This could be valuable later! 💎',
        });
        onSuccess?.();
      } else {
        throw new Error(result.error || 'Registration failed');
      }
    } catch (error) {
      console.error('Registration error:', error);
      toast({
        title: 'Registration failed',
        description: error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl text-center">
          ✨ Register Your Fanmark ✨
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Emoji Combination */}
          <div className="space-y-2">
            <Label htmlFor="emojiCombination" className="text-lg">
              🎯 Emoji Combination
            </Label>
            <Input
              id="emojiCombination"
              {...register('emojiCombination')}
              placeholder="Enter your emoji combination"
              className="text-2xl text-center border-2 border-dashed"
              disabled={!!prefilledEmoji}
            />
            {errors.emojiCombination && (
              <p className="text-sm text-red-500">{errors.emojiCombination.message}</p>
            )}
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName" className="text-lg">
              ✨ Display Name
            </Label>
            <Input
              id="displayName"
              {...register('displayName')}
              placeholder="Choose a cute display name"
              className="border-2 border-dotted border-pink-300"
            />
            {errors.displayName && (
              <p className="text-sm text-red-500">{errors.displayName.message}</p>
            )}
          </div>

          {/* Access Type */}
          <div className="space-y-3">
            <Label className="text-lg">🎮 Access Type</Label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { value: 'profile', label: '📄 Profile Page', desc: 'Create a personal page' },
                { value: 'redirect', label: '🔗 URL Redirect', desc: 'Redirect to any URL' },
                { value: 'text', label: '📝 Text Display', desc: 'Show custom text' },
                { value: 'inactive', label: '😴 Inactive', desc: 'Reserve for later' },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex items-center space-x-2 p-3 border-2 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors"
                >
                  <input
                    type="radio"
                    value={option.value}
                    {...register('accessType')}
                    className="radio radio-primary"
                  />
                  <div>
                    <div className="font-medium">{option.label}</div>
                    <div className="text-sm text-gray-500">{option.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Target URL (for redirect) */}
          {accessType === 'redirect' && (
            <div className="space-y-2">
              <Label htmlFor="targetUrl" className="text-lg">
                🔗 Target URL
              </Label>
              <Input
                id="targetUrl"
                {...register('targetUrl')}
                placeholder="https://example.com"
                type="url"
              />
              {errors.targetUrl && (
                <p className="text-sm text-red-500">{errors.targetUrl.message}</p>
              )}
            </div>
          )}

          {/* Text Content (for text display) */}
          {accessType === 'text' && (
            <div className="space-y-2">
              <Label htmlFor="textContent" className="text-lg">
                📝 Text Content
              </Label>
              <Textarea
                id="textContent"
                {...register('textContent')}
                placeholder="Enter the text to display"
                rows={4}
              />
              {errors.textContent && (
                <p className="text-sm text-red-500">{errors.textContent.message}</p>
              )}
            </div>
          )}

          {/* Create Profile Option */}
          {(accessType === 'profile' || accessType === 'inactive') && (
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="createProfile"
                {...register('createProfile')}
                className="checkbox checkbox-primary"
              />
              <Label htmlFor="createProfile" className="text-lg">
                🎨 Create profile page (auto-generates basic profile)
              </Label>
            </div>
          )}

          {/* Transferability */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="isTransferable"
              {...register('isTransferable')}
              className="toggle toggle-primary"
            />
            <Label htmlFor="isTransferable" className="text-lg">
              🔄 Allow transfers (default: enabled)
            </Label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-gradient-to-r from-pink-400 to-purple-400 hover:from-pink-500 hover:to-purple-500"
            >
              {isSubmitting ? (
                <>
                  <span className="loading loading-spinner loading-sm mr-2"></span>
                  Registering...
                </>
              ) : (
                '🎉 Register Fanmark'
              )}
            </Button>
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
};