import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLayout } from "@/components/AuthLayout";

const AdminAuth = () => {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">管理者ログイン</CardTitle>
        </CardHeader>
        <CardContent>
          <AuthLayout 
            title="管理者ログイン"
            description="認証された管理者のみアクセス可能です"
          >
            <p className="text-center text-sm text-muted-foreground">
              kanouk@gmail.com でログインしてください
            </p>
          </AuthLayout>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminAuth;