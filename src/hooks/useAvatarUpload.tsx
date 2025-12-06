import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from './useTranslation';

export const useAvatarUpload = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const MAX_AVATAR_SIZE = 1 * 1024 * 1024; // 1MB

  const uploadAvatar = async (file: File): Promise<string> => {
    if (!user) throw new Error(t('common.userNotAuthenticated'));
    if (file.size > MAX_AVATAR_SIZE) {
      throw new Error(t('userSettings.avatarSizeLimit'));
    }
    
    setUploading(true);
    try {
      // Create a unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      // Resize image if needed
      const resizedFile = await resizeImage(file, 256, 256);

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('avatars')
        .upload(fileName, resizedFile, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) throw error;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(data.path);

      return publicUrl;
    } finally {
      setUploading(false);
    }
  };

  const resizeImage = (file: File, maxWidth: number, maxHeight: number): Promise<File> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();

      img.onload = () => {
        // Calculate new dimensions
        let { width, height } = img;
        if (width > height) {
          if (width > maxWidth) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        // Draw resized image
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            const resizedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            });
            resolve(resizedFile);
          }
        }, file.type, 0.9);
      };

      img.src = URL.createObjectURL(file);
    });
  };

  const deleteAvatar = async (avatarUrl: string): Promise<void> => {
    if (!user) throw new Error(t('common.userNotAuthenticated'));
    
    try {
      // Extract file path from URL
      const url = new URL(avatarUrl);
      const pathSegments = url.pathname.split('/');
      const fileName = pathSegments[pathSegments.length - 1];
      const filePath = `${user.id}/${fileName}`;

      // Delete from Supabase Storage
      const { error } = await supabase.storage
        .from('avatars')
        .remove([filePath]);

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting avatar:', error);
      throw error;
    }
  };

  return { uploadAvatar, deleteAvatar, uploading };
};
