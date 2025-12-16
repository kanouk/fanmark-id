-- Delete the orphaned user_subscriptions record for the cancelled subscription
DELETE FROM public.user_subscriptions 
WHERE id = '0472d065-6332-4839-adc0-9b5f13707006';