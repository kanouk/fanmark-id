import { useState } from 'react';

import { useAuth } from '@/hooks/useAuth';

import { deleteStorageObject, uploadStorageObject } from '@/lib/storage-api';
import { useTranslation } from './useTranslation';

export const useCoverImageUpload = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const MAX_COVER_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

  const uploadCoverImage = async (file: File): Promise<{ url: string; width: number; height: number }> => {
    if (!user) throw new Error(t('common.userNotAuthenticated'));
    if (file.size > MAX_COVER_IMAGE_SIZE) {
      throw new Error(t('common.coverImageSizeLimit'));
    }

    setUploading(true);
    try {
      // Resize image for cover images (larger dimensions, maintain aspect ratio)
      const resized = await resizeCoverImage(file, 2400, 1200);

      {
        const { publicUrl } = await uploadStorageObject('cover-images', user.id, resized.file);
        return {
          url: publicUrl,
          width: resized.width,
          height: resized.height,
        };
      }




    } finally {
      setUploading(false);
    }
  };

  const resizeCoverImage = (file: File, maxWidth: number, maxHeight: number): Promise<{ file: File; width: number; height: number }> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      const img = new Image();

      img.onload = () => {
        // Calculate new dimensions maintaining aspect ratio
        let { width, height } = img;

        // Calculate scale to fit within max dimensions while maintaining aspect ratio
        const scaleX = maxWidth / width;
        const scaleY = maxHeight / height;
        const scale = Math.min(scaleX, scaleY, 1); // Don't upscale

        // Only resize if the image is larger than max dimensions
        if (scale < 1) {
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;

        // Draw resized image with high quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            const resizedFile = new File([blob], file.name, {
              type: file.type,
              lastModified: Date.now(),
            });
            resolve({ file: resizedFile, width, height });
          }
        }, file.type, 0.95); // Higher quality (95%) for cover images
      };

      img.src = URL.createObjectURL(file);
    });
  };

  const deleteCoverImage = async (coverImageUrl: string): Promise<void> => {
    if (!user) throw new Error(t('common.userNotAuthenticated'));

    try {
      {
        await deleteStorageObject('cover-images', user.id, coverImageUrl);
        return;
      }

      // Extract file path from URL


    } catch (error) {
      console.error('Error deleting cover image:', error);
      throw error;
    }
  };

  return { uploadCoverImage, deleteCoverImage, uploading };
};
