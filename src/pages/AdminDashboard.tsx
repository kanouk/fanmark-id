import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminSettings } from "@/components/AdminSettings";
import { SecureWaitlistAdmin } from "@/components/SecureWaitlistAdmin";
import { AdminPatternRules } from "@/components/AdminPatternRules";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

const AdminDashboard = () => {
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">ファンマーク管理画面</h1>
          <Button variant="outline" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" />
            ログアウト
          </Button>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="settings" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="settings">システム設定</TabsTrigger>
            <TabsTrigger value="waitlist">ウェイトリスト</TabsTrigger>
            <TabsTrigger value="patterns">パターンルール</TabsTrigger>
            <TabsTrigger value="analytics">統計情報</TabsTrigger>
          </TabsList>
          
          <TabsContent value="settings">
            <AdminSettings />
          </TabsContent>
          
          <TabsContent value="waitlist">
            <Card>
              <CardHeader>
                <CardTitle>ウェイトリスト管理</CardTitle>
              </CardHeader>
              <CardContent>
                <SecureWaitlistAdmin />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="patterns">
            <Card>
              <CardHeader>
                <CardTitle>パターンルール管理</CardTitle>
              </CardHeader>
              <CardContent>
                <AdminPatternRules />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="analytics">
            <Card>
              <CardHeader>
                <CardTitle>統計情報</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">統計情報は今後実装予定です。</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminDashboard;