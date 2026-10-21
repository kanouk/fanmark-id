import { useState } from 'react';

import { useAuth } from '@/hooks/useAuth';

import { deleteStorageObject, uploadStorageObject } from '@/lib/storage-api';
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
      // Resize image if needed
      const resizedFile = await resizeImage(file, 256, 256);

      {
        const { publicUrl } = await uploadStorageObject('avatars', user.id, resizedFile);
        return publicUrl;
      }




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
      {
        await deleteStorageObject('avatars', user.id, avatarUrl);
        return;
      }

      // Extract file path from URL


    } catch (error) {
      console.error('Error deleting avatar:', error);
      throw error;
    }
  };

  return { uploadAvatar, deleteAvatar, uploading };
};
