import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

  // Verify admin status with enhanced security
  const verifyAdminAccess = async () => {
    try {
      setVerifying(true);
      
      // Call the enhanced super admin function
      const { data: isValidAdmin, error } = await supabase.rpc('is_super_admin');
      
      if (error) {
        console.error('Admin verification error:', error);
        toast({
          title: 'Access Denied',
          description: 'Unable to verify admin credentials',
          variant: 'destructive',
        });
        return false;
      }

      setIsAdmin(isValidAdmin);
      return isValidAdmin;
    } catch (error) {
      console.error('Admin verification failed:', error);
      setIsAdmin(false);
      return false;
    } finally {
      setVerifying(false);
    }
  };

  // Load waitlist data securely
  const loadWaitlistData = async () => {
    try {
      const { data, error } = await supabase.rpc('get_waitlist_secure', {
        p_limit: 100,
        p_offset: 0
      });

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

  // Load security logs
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

  // Reveal actual email (with strict logging)
  const revealEmail = async (waitlistId: string) => {
    try {
      const { data: email, error } = await supabase.rpc('get_waitlist_email_by_id', {
        waitlist_id: waitlistId
      });

      if (error) throw error;

      setActualEmails(prev => new Map(prev).set(waitlistId, email));
      setRevealedEmails(prev => new Set(prev).add(waitlistId));
      
      toast({
        title: 'Email Revealed',
        description: 'This action has been logged for security purposes',
        variant: 'default',
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

  // Export waitlist data (hashed emails only)
  const exportWaitlistData = () => {
    const csvContent = [
      ['ID', 'Email Hash', 'Referral Source', 'Status', 'Created At'].join(','),
      ...waitlistData.map(entry => [
        entry.id,
        entry.email_hash,
        entry.referral_source || '',
        entry.status,
        entry.created_at
      ].join(','))
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
        await Promise.all([
          loadWaitlistData(),
          loadSecurityLogs()
        ]);
      }
      setLoading(false);
    };

    initializeAdmin();
  }, []);

  if (verifying) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          Verifying admin credentials...
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-destructive mb-2">Access Denied</h3>
          <p className="text-sm text-muted-foreground">
            You do not have administrator privileges to access waitlist data.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Security Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-semibold">Secure Waitlist Administration</h2>
          <Badge variant="outline" className="text-green-600 border-green-600">
            Enhanced Security
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={exportWaitlistData} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export (Hashed)
          </Button>
          <Button onClick={loadWaitlistData} variant="outline" size="sm">
            Refresh
          </Button>
        </div>
      </div>

      {/* Security Notice */}
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800">Security Features Active</p>
              <ul className="text-amber-700 mt-1 list-disc list-inside space-y-1">
                <li>Email addresses are hashed by default for privacy protection</li>
                <li>All access attempts are logged and monitored</li>
                <li>Admin session validation is enforced (4-hour limit)</li>
                <li>Email reveal actions require additional verification</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Waitlist Data */}
      <Card>
        <CardHeader>
          <CardTitle>Waitlist Entries ({waitlistData.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {waitlistData.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No waitlist entries found</p>
          ) : (
            <div className="space-y-3">
              {waitlistData.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm bg-muted px-2 py-1 rounded">
                        {revealedEmails.has(entry.id) 
                          ? actualEmails.get(entry.id) 
                          : `Hash: ${entry.email_hash.substring(0, 16)}...`
                        }
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
                          <Button variant="outline" size="sm">
                            <Eye className="h-4 w-4 mr-2" />
                            Reveal Email
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Reveal Email Address</DialogTitle>
                            <DialogDescription>
                              This action will reveal the actual email address and will be logged for security purposes. 
                              Only proceed if you have a legitimate business need to access this information.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="flex gap-3 mt-4">
                            <Button 
                              variant="outline" 
                              onClick={() => {}}
                              className="flex-1"
                            >
                              Cancel
                            </Button>
                            <Button 
                              onClick={() => revealEmail(entry.id)}
                              className="flex-1"
                            >
                              Confirm Reveal
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        <EyeOff className="h-4 w-4 mr-2" />
                        Revealed
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Logs */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Security Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {securityLogs.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No security logs found</p>
          ) : (
            <div className="space-y-2">
              {securityLogs.slice(0, 10).map((log) => (
                <div key={log.id} className="flex items-center justify-between p-3 text-sm border rounded">
                  <div className="flex items-center gap-3">
                    <Badge 
                      variant={
                        log.action.includes('UNAUTHORIZED') ? 'destructive' : 
                        log.action.includes('ADMIN') ? 'default' : 'secondary'
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
    </div>
  );
};