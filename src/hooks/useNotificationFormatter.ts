import { useCallback } from 'react';
import { useTranslation } from './useTranslation';

export const useNotificationFormatter = () => {
    const { t } = useTranslation();

    const formatDeadline = useCallback((iso: string | undefined | null) => {
        if (!iso) return null;
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
            return null;
        }

        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).format(date);
    }, []);

    const formatNotificationContent = useCallback(
        (notification: any) => {
            const metadata = notification?.payload?.metadata ?? {};
            const fanmark = metadata.fanmark_name || metadata.fanmark || '—';

            if (metadata.grace_expires_at) {
                const deadline = formatDeadline(metadata.grace_expires_at);

                return {
                    title: t('notifications.graceProcessingTitle'),
                    body: deadline
                        ? t('notifications.graceProcessingBodyWithDeadline', { fanmark, deadline })
                        : t('notifications.graceProcessingBody', { fanmark }),
                    summary: t('notifications.graceProcessingSummary'),
                };
            }

            return {
                title: notification?.payload?.title ?? t('notifications.fallbackTitle'),
                body: notification?.payload?.body ?? '',
                summary: notification?.payload?.summary ?? null,
            };
        },
        [formatDeadline, t],
    );

    return { formatNotificationContent };
};
