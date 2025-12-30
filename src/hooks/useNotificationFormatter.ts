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
            
            // データベースの body を取得
            let body = notification?.payload?.body ?? '';
            
            // プレースホルダーをフォーマット済み日時で置換
            if (metadata.grace_expires_at) {
                const deadline = formatDeadline(metadata.grace_expires_at);
                if (deadline) {
                    body = body.replace(/\{\{grace_expires_at\}\}/g, deadline);
                }
            }
            if (metadata.license_end) {
                const licenseEnd = formatDeadline(metadata.license_end);
                if (licenseEnd) {
                    body = body.replace(/\{\{license_end\}\}/g, licenseEnd);
                }
            }

            return {
                title: notification?.payload?.title ?? t('notifications.fallbackTitle'),
                body: body,
                summary: notification?.payload?.summary ?? null,
            };
        },
        [formatDeadline, t],
    );

    return { formatNotificationContent };
};
