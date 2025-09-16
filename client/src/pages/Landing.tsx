import { Mail, Zap, Eye, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Landing() {
  const handleLogin = () => {
    window.location.href = '/api/login';
    console.log('Redirecting to login');
  };

  const features = [
    {
      icon: Mail,
      title: "Dual-Pane Interface",
      description: "Efficient email management with folders, message list, and viewer in one seamless interface."
    },
    {
      icon: Zap,
      title: "Smart Prioritization",
      description: "AI-powered priority system with custom rules to automatically highlight important emails."
    },
    {
      icon: Eye,
      title: "Reading Mode",
      description: "Immersive full-screen reading experience with beautiful backgrounds and distraction-free design."
    },
    {
      icon: Shield,
      title: "Secure Connections",
      description: "Connect to IMAP and Exchange EWS servers with encrypted credential storage and OAuth support."
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">PrismMail</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button onClick={handleLogin} data-testid="button-login" className="hover-elevate active-elevate-2">
              Sign In
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-24 text-center">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Priority Web Mail
            <span className="block text-2xl md:text-3xl font-normal text-muted-foreground mt-2">
              Sophisticated email management with IMAP/EWS connectivity
            </span>
          </h2>
          
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Experience email like never before with our dual-pane interface, smart prioritization, 
            and immersive reading mode. Connect to any IMAP or Exchange server securely.
          </p>
          
          <Button 
            size="lg" 
            onClick={handleLogin} 
            data-testid="button-get-started"
            className="text-lg px-8 py-3 hover-elevate active-elevate-2"
          >
            Get Started
          </Button>
        </div>
      </section>

      {/* Features Grid */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h3 className="text-3xl font-bold mb-4">Powerful Features</h3>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need for professional email management in one beautiful application.
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => {
            const IconComponent = feature.icon;
            return (
              <Card key={index} className="hover-elevate">
                <CardHeader className="text-center">
                  <div className="mx-auto w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                    <IconComponent className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-center">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-24">
        <div className="max-w-2xl mx-auto text-center">
          <h3 className="text-3xl font-bold mb-4">Ready to Transform Your Email Experience?</h3>
          <p className="text-lg text-muted-foreground mb-8">
            Join professionals who rely on PrismMail for efficient, secure, and beautiful email management.
          </p>
          <Button 
            size="lg" 
            onClick={handleLogin} 
            data-testid="button-cta"
            className="text-lg px-8 py-3 hover-elevate active-elevate-2"
          >
            Start Using PrismMail
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-muted/20 py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>&copy; 2025 PrismMail. Built for modern email management.</p>
        </div>
      </footer>
    </div>
  );
}