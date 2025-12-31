-- Fix fanmarks UPDATE policy to allow status changes
DROP POLICY IF EXISTS "Users can update their own fanmarks" ON public.fanmarks;

-- Create new UPDATE policy that allows status changes
CREATE POLICY "Users can update their own fanmarks" 
ON public.fanmarks 
FOR UPDATE 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Also update SELECT policy to allow users to see their own fanmarks regardless of status
DROP POLICY IF EXISTS "Anyone can view active fanmarks" ON public.fanmarks;

-- Create separate policies for public viewing and owner viewing
CREATE POLICY "Anyone can view active fanmarks" 
ON public.fanmarks 
FOR SELECT 
USING (status = 'active');

CREATE POLICY "Users can view their own fanmarks" 
ON public.fanmarks 
FOR SELECT 
USING (auth.uid() = user_id);