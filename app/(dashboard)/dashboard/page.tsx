import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome to your LifeOR2 dashboard
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Entities</CardTitle>
            <CardDescription>People, organizations, and things</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">No entities yet</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Arrangements</CardTitle>
            <CardDescription>Relationships and agreements</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">No arrangements yet</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Events</CardTitle>
            <CardDescription>Recorded activities</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">0</div>
            <p className="text-xs text-muted-foreground">No events yet</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest events and changes</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No recent activity</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Financial Summary</CardTitle>
            <CardDescription>Account balances and cash flow</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No financial data yet</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
