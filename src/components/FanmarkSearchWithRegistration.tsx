import { useState } from 'react';
import FanmarkSearch from '@/components/FanmarkSearch';
import { FanmarkRegistrationForm } from '@/components/FanmarkRegistrationForm';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface FanmarkSearchWithRegistrationProps {
  onSignupPrompt?: () => void;
}

export const FanmarkSearchWithRegistration = ({ onSignupPrompt }: FanmarkSearchWithRegistrationProps) => {
  const { user } = useAuth();
  const [showRegistrationForm, setShowRegistrationForm] = useState(false);

  const handleRegistrationSuccess = () => {
    setShowRegistrationForm(false);
    // Optionally navigate to dashboard or show success message
  };

  const handleRegistrationCancel = () => {
    setShowRegistrationForm(false);
  };

  return (
    <div className="space-y-8">
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="text-3xl text-center">
            🔍 Search & Register Your Fanmark
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FanmarkSearch onSignupPrompt={onSignupPrompt} />
          
          {user && (
            <div className="mt-6 text-center border-t pt-6">
              <p className="text-gray-600 mb-4">Want to register a custom fanmark?</p>
              <Button 
                onClick={() => setShowRegistrationForm(true)}
                className="gap-2 bg-gradient-to-r from-pink-400 to-purple-400 hover:from-pink-500 hover:to-purple-500"
              >
                <span>✨</span>
                Register Custom Fanmark
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Registration Form Dialog */}
      <Dialog open={showRegistrationForm} onOpenChange={setShowRegistrationForm}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Register Your Fanmark</DialogTitle>
          </DialogHeader>
          <FanmarkRegistrationForm
            onSuccess={handleRegistrationSuccess}
            onCancel={handleRegistrationCancel}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};