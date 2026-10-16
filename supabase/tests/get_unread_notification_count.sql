BEGIN;

SELECT plan(4);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.get_unread_notification_count(uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute the private unread-count function'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_unread_notification_count(uuid)',
    'EXECUTE'
  ),
  'authenticated callers retain unread-count access'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

SELECT is(
  public.get_unread_notification_count('11111111-1111-4111-8111-111111111111'::uuid),
  0,
  'an authenticated caller can read their own empty inbox count'
);

SELECT throws_ok(
  $$SELECT public.get_unread_notification_count('22222222-2222-4222-8222-222222222222'::uuid)$$,
  'P0001',
  'Unauthorized: can only read own notification count',
  'an authenticated caller cannot read another account count'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
