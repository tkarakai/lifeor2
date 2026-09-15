import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { DollarSign, FileText, BarChart3, Repeat } from "lucide-react";

export default function FinancePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Finance</h1>
        <p className="text-muted-foreground">
          Double-entry accounting, reconciliation, and financial reporting
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              <CardTitle>Chart of Accounts</CardTitle>
            </div>
            <CardDescription>
              Manage your ledger accounts and account hierarchy
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/finance/accounts">
              <Button>View Accounts</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <CardTitle>Journal Entries</CardTitle>
            </div>
            <CardDescription>
              Record financial transactions with double-entry validation
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/finance/entries">
              <Button>View Entries</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              <CardTitle>Financial Reports</CardTitle>
            </div>
            <CardDescription>
              Trial balance, income statement, and balance sheet
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/finance/reports">
              <Button>View Reports</Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Repeat className="h-5 w-5" />
              <CardTitle>Reconciliation</CardTitle>
            </div>
            <CardDescription>
              Match bank statements with journal entries
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/dashboard/finance/reconciliation">
              <Button>View Reconciliations</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
