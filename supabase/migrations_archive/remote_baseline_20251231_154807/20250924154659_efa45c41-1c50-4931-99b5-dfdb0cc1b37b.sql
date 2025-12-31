-- Create cover-images storage bucket for high-quality cover image uploads
INSERT INTO storage.buckets (id, name, public) VALUES ('cover-images', 'cover-images', true);

-- Create storage policies for cover images
CREATE POLICY "Cover images are publicly accessible" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'cover-images');

CREATE POLICY "Users can upload their own cover images" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'cover-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own cover images" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'cover-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own cover images" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'cover-images' AND auth.uid()::text = (storage.foldername(name))[1]);