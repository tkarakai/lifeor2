"use client";

import { DatasetProvider } from "@/lib/dataset";
import { Sidebar } from "@/components/sidebar";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useConvexAuth } from "convex/react";
import { useEffect } from "react";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const { isLoading: convexLoading, isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (!isPending && !session) {
      router.push("/login");
    }
  }, [session, isPending, router]);

  // Show loading state while checking authentication
  if (isPending || (session && convexLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-lg">Loading...</div>
        </div>
      </div>
    );
  }

  // If not authenticated, don't render the dashboard (redirect is happening)
  if (!session || !isAuthenticated) {
    return null;
  }

  return (
    <DatasetProvider>
      <div className="h-full relative">
        <div className="hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 z-80">
          <Sidebar />
        </div>
        <div className="border-b md:hidden">
          <details>
            <summary className="cursor-pointer p-4 font-semibold">
              LifeOR2 · Menu
            </summary>
            <Sidebar />
          </details>
        </div>
        <main className="md:pl-72 h-full">
          <div className="p-4 sm:p-8 h-full">{children}</div>
        </main>
      </div>
    </DatasetProvider>
  );
}
