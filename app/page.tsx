import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Users, Calendar, FileText } from "lucide-react";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="z-10 w-full max-w-6xl">
        <div className="text-center mb-12">
          <h1 className="text-6xl font-bold mb-4">
            LifeOR<span className="text-primary">2</span>
          </h1>
          <p className="text-xl text-muted-foreground mb-8">
            Life & Finance Arrangements System
          </p>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            A comprehensive data model for tracking entities, relationships, events, and finances
            with temporal validity and double-entry accounting.
          </p>
          <div className="flex gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg">Sign Up</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">
                Log In
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mt-16">
          <Card>
            <CardHeader>
              <Users className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Entities</CardTitle>
              <CardDescription>
                Track people, organizations, and things
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <FileText className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Arrangements</CardTitle>
              <CardDescription>
                Model relationships with temporal validity
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Calendar className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Events</CardTitle>
              <CardDescription>
                Record occurrences and activities
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <DollarSign className="h-8 w-8 mb-2 text-primary" />
              <CardTitle>Finance</CardTitle>
              <CardDescription>
                Double-entry accounting & reporting
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </main>
  );
}
