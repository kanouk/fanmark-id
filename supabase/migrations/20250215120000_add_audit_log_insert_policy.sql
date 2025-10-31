-- Allow admin users (and service_role) to record audit logs
CREATE POLICY "Admins can write audit logs"
ON public.audit_logs
FOR INSERT
USING (public.is_admin() OR auth.role() = 'service_role')
WITH CHECK (public.is_admin() OR auth.role() = 'service_role');

-- Ensure default admin user has the admin role in user_roles
INSERT INTO public.user_roles (user_id, role, created_by)
SELECT u.id, 'admin'::public.app_role, u.id
FROM auth.users u
WHERE u.email = 'kanouk@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
