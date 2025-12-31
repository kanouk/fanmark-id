-- Fix foreign key constraints for created_by columns to allow user deletion
-- These columns should be set to NULL when the creating user is deleted

-- Drop existing constraints
ALTER TABLE public.fanmark_availability_rules 
DROP CONSTRAINT IF EXISTS fanmark_availability_rules_created_by_fkey;

ALTER TABLE public.user_roles 
DROP CONSTRAINT IF EXISTS user_roles_created_by_fkey;

ALTER TABLE public.notification_rules 
DROP CONSTRAINT IF EXISTS notification_rules_created_by_fkey;

-- Re-add constraints with ON DELETE SET NULL
ALTER TABLE public.fanmark_availability_rules 
ADD CONSTRAINT fanmark_availability_rules_created_by_fkey 
FOREIGN KEY (created_by) 
REFERENCES auth.users(id) 
ON DELETE SET NULL;

ALTER TABLE public.user_roles 
ADD CONSTRAINT user_roles_created_by_fkey 
FOREIGN KEY (created_by) 
REFERENCES auth.users(id) 
ON DELETE SET NULL;

ALTER TABLE public.notification_rules 
ADD CONSTRAINT notification_rules_created_by_fkey 
FOREIGN KEY (created_by) 
REFERENCES auth.users(id) 
ON DELETE SET NULL;

-- Add comments
COMMENT ON CONSTRAINT fanmark_availability_rules_created_by_fkey ON public.fanmark_availability_rules IS 'Set created_by to NULL when user is deleted';
COMMENT ON CONSTRAINT user_roles_created_by_fkey ON public.user_roles IS 'Set created_by to NULL when user is deleted';
COMMENT ON CONSTRAINT notification_rules_created_by_fkey ON public.notification_rules IS 'Set created_by to NULL when user is deleted';