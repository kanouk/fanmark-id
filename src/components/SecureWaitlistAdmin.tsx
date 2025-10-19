import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { useTranslation } from '@/hooks/useTranslation';
import { Loader2, Shield, Eye, EyeOff, AlertTriangle, Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface WaitlistEntry {
  id: string;
  email_hash: string;
  referral_source?: string;
  status: string;
  created_at: string;
}

interface SecurityLog {
  id: string;
  user_id?: string;
  action: string;
  resource_type: string;
  metadata: any;
  created_at: string;
}

export const SecureWaitlistAdmin = () => {
  const { t } = useTranslation();
  const [waitlistData, setWaitlistData] = useState<WaitlistEntry[]>([]);
  const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [revealedEmails, setRevealedEmails] = useState<Set<string>>(new Set());
  const [actualEmails, setActualEmails] = useState<Map<string, string>>(new Map());

  const verifyAdminAccess = async () => {
    try {
      setVerifying(true);
      const { data: isValidAdmin, error } = await supabase.rpc('is_super_admin');

      if (error) {
        console.error('Admin verification error:', error);
        if ((error as { code?: string }).code !== '22P02') {
          toast({
            title: 'Access Denied',
            description: 'Unable to verify admin credentials',
            variant: 'destructive',
          });
        }
        setIsAdmin(false);
        return false;
      }

      setIsAdmin(Boolean(isValidAdmin));
      return Boolean(isValidAdmin);
    } catch (error) {
      console.error('Admin verification failed:', error);
      setIsAdmin(false);
      return false;
    } finally {
      setVerifying(false);
    }
  };

  const loadWaitlistData = async () => {
    try {
      const { data, error } = await supabase.rpc('get_waitlist_secure', { p_limit: 100, p_offset: 0 });
      if (error) throw error;
      setWaitlistData(data || []);
    } catch (error) {
      console.error('Error loading waitlist:', error);
      toast({
        title: 'Error',
        description: 'Failed to load waitlist data',
        variant: 'destructive',
      });
    }
  };

  const loadSecurityLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .in('resource_type', ['waitlist', 'system'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setSecurityLogs(data || []);
    } catch (error) {
      console.error('Error loading security logs:', error);
    }
  };

  const revealEmail = async (waitlistId: string) => {
    try {
      const { data: email, error } = await supabase.rpc('get_waitlist_email_by_id', {
        waitlist_id: waitlistId,
      });

      if (error) throw error;

      setActualEmails((prev) => new Map(prev).set(waitlistId, email));
      setRevealedEmails((prev) => new Set(prev).add(waitlistId));

      toast({
        title: 'Email Revealed',
        description: 'This action has been logged for security purposes',
      });
    } catch (error) {
      console.error('Error revealing email:', error);
      toast({
        title: 'Access Denied',
        description: 'Failed to reveal email address',
        variant: 'destructive',
      });
    }
  };

  const exportWaitlistData = () => {
    const csvContent = [
      ['ID', 'Email Hash', 'Referral Source', 'Status', 'Created At'].join(','),
      ...waitlistData.map((entry) => [
        entry.id,
        entry.email_hash,
        entry.referral_source || '',
        entry.status,
        entry.created_at,
      ].join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `waitlist_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Export Complete',
      description: 'Waitlist data exported with hashed emails for privacy',
    });
  };

  useEffect(() => {
    const initializeAdmin = async () => {
      const hasAccess = await verifyAdminAccess();
      if (hasAccess) {
        await Promise.all([loadWaitlistData(), loadSecurityLogs()]);
      }
      setLoading(false);
    };

    initializeAdmin();
  }, []);

  if (verifying) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        {t('admin.invitation.waitlistVerifying')}
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-destructive" />
          <h3 className="mb-2 text-lg font-semibold text-destructive">{t('admin.invitation.waitlistDeniedTitle')}</h3>
          <CardDescription>{t('admin.invitation.waitlistDeniedDescription')}</CardDescription>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="space-y-3 p-6 pb-4 sm:flex sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            <div className="flex flex-col text-left">
              <CardTitle className="text-xl font-semibold">{t('admin.invitation.waitlistHeading')}</CardTitle>
              <CardDescription>{t('admin.invitation.waitlistSecurity')}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={exportWaitlistData} variant="outline" size="sm" className="rounded-full border-primary/20">
              <Download className="mr-2 h-4 w-4" />
              {t('admin.invitation.waitlistExport')}
            </Button>
            <Button onClick={loadWaitlistData} variant="outline" size="sm" className="rounded-full border-primary/20">
              {t('admin.invitation.waitlistRefresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-6 pt-0">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
              <div className="space-y-1 text-left">
                <p className="font-medium text-amber-800">{t('admin.invitation.waitlistSecurityTitle')}</p>
                <ul className="list-disc space-y-1 pl-4 text-amber-700">
                  <li>{t('admin.invitation.waitlistSecurityItem1')}</li>
                  <li>{t('admin.invitation.waitlistSecurityItem2')}</li>
                  <li>{t('admin.invitation.waitlistSecurityItem3')}</li>
                  <li>{t('admin.invitation.waitlistSecurityItem4')}</li>
                </ul>
              </div>
            </div>
          </div>

          <Card className="border border-primary/15">
            <CardHeader className="space-y-1 px-6 py-4">
              <CardTitle>{t('admin.invitation.waitlistEntries', { count: waitlistData.length })}</CardTitle>
              <CardDescription>{t('admin.invitation.waitlistDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-0">
              {waitlistData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t('admin.invitation.waitlistEmpty')}
                </p>
              ) : (
                <div className="space-y-3">
                  {waitlistData.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between rounded-2xl border border-border/60 bg-card px-4 py-4">
                      <div className="flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
                            {revealedEmails.has(entry.id)
                              ? actualEmails.get(entry.id)
                              : `Hash: ${entry.email_hash.substring(0, 16)}...`}
                          </span>
                          <Badge variant={entry.status === 'waiting' ? 'secondary' : 'default'}>
                            {entry.status}
                          </Badge>
                        </div>
                        {entry.referral_source && (
                          <p className="text-xs text-muted-foreground">
                            Source: {entry.referral_source}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {new Date(entry.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {!revealedEmails.has(entry.id) ? (
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm" className="rounded-full border-primary/20">
                                <Eye className="mr-2 h-4 w-4" />
                                {t('admin.invitation.waitlistRevealButton')}
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>{t('admin.invitation.waitlistRevealTitle')}</DialogTitle>
                                <DialogDescription>{t('admin.invitation.waitlistRevealDesc')}</DialogDescription>
                              </DialogHeader>
                              <div className="mt-4 flex gap-3">
                                <Button variant="outline" className="flex-1">
                                  {t('common.cancel')}
                                </Button>
                                <Button className="flex-1" onClick={() => revealEmail(entry.id)}>
                                  {t('admin.invitation.waitlistRevealConfirm')}
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <Button variant="outline" size="sm" disabled className="rounded-full">
                            <EyeOff className="mr-2 h-4 w-4" />
                            {t('admin.invitation.waitlistRevealDone')}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border border-primary/15">
            <CardHeader className="px-6 py-4">
              <CardTitle>{t('admin.invitation.waitlistSecurityLogTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-0">
              {securityLogs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {t('admin.invitation.waitlistSecurityLogEmpty')}
                </p>
              ) : (
                <div className="space-y-2">
                  {securityLogs.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-sm">
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={
                            log.action.includes('UNAUTHORIZED')
                              ? 'destructive'
                              : log.action.includes('ADMIN')
                                ? 'default'
                                : 'secondary'
                          }
                        >
                          {log.action}
                        </Badge>
                        <span className="text-muted-foreground">{log.resource_type}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
};
