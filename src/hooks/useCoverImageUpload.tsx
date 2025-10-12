import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from './useTranslation';

export const useCoverImageUpload = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);

  const uploadCoverImage = async (file: File): Promise<{ url: string; width: number; height: number }> => {
    if (!user) throw new Error(t('common.userNotAuthenticated'));
    
    setUploading(true);
    try {
      // Create a unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}_cover.${fileExt}`;

      // Resize image for cover images (larger dimensions, maintain aspect ratio)
      const resized = await resizeCoverImage(file, 2400, 1200);

      // Upload to Supabase Storage (cover-images bucket)
      const { data, error } = await supabase.storage
        .from('cover-images')
        .upload(fileName, resized.file, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) throw error;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('cover-images')
        .getPublicUrl(data.path);

      return {
        url: publicUrl,
        width: resized.width,
        height: resized.height,
      };
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
      // Extract file path from URL
      const url = new URL(coverImageUrl);
      const pathSegments = url.pathname.split('/');
      const fileName = pathSegments[pathSegments.length - 1];
      const filePath = `${user.id}/${fileName}`;

      // Delete from Supabase Storage
      const { error } = await supabase.storage
        .from('cover-images')
        .remove([filePath]);

      if (error) throw error;
    } catch (error) {
      console.error('Error deleting cover image:', error);
      throw error;
    }
  };

  return { uploadCoverImage, deleteCoverImage, uploading };
};