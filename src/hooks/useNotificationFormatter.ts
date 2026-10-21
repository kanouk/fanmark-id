import type { UserNotification } from '@/lib/notifications-api';
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
        (notification: Pick<UserNotification, 'payload'>) => {
            const rawMetadata = notification.payload.metadata;
            const metadata = rawMetadata && typeof rawMetadata === 'object' ? rawMetadata as Record<string, unknown> : {};

            // データベースの body を取得
            let body = typeof notification.payload.body === 'string' ? notification.payload.body : '';

            // プレースホルダーをフォーマット済み日時で置換
            if (typeof metadata.grace_expires_at === 'string') {
                const deadline = formatDeadline(metadata.grace_expires_at);
                if (deadline) {
                    body = body.replace(/\{\{grace_expires_at\}\}/g, deadline);
                }
            }
            if (typeof metadata.license_end === 'string') {
                const licenseEnd = formatDeadline(metadata.license_end);
                if (licenseEnd) {
                    body = body.replace(/\{\{license_end\}\}/g, licenseEnd);
                }
            }

            return {
                title: typeof notification.payload.title === 'string' ? notification.payload.title : t('notifications.fallbackTitle'),
                body: body,
                summary: typeof notification.payload.summary === 'string' ? notification.payload.summary : null,
            };
        },
        [formatDeadline, t],
    );

    return { formatNotificationContent };
};
