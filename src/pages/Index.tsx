import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import TopBar from "@/components/dashboard/TopBar";
import KPICards from "@/components/dashboard/KPICards";
import RiskDistribution from "@/components/dashboard/RiskDistribution";
import PredictiveInsights from "@/components/dashboard/PredictiveInsights";
import ChildProfile from "@/components/dashboard/ChildProfile";
import InterventionEngine from "@/components/dashboard/InterventionEngine";
import CaregiverEngagement from "@/components/dashboard/CaregiverEngagement";
import FieldAnalytics from "@/components/dashboard/FieldAnalytics";
import LongitudinalImpact from "@/components/dashboard/LongitudinalImpact";
import DataGovernance from "@/components/dashboard/DataGovernance";
import { ECDDataProvider, useECDData } from "@/contexts/ECDDataContext";

function DashboardContent() {
  const { loading, error } = useECDData();

  if (loading) {
    return (
      <div className="ml-16 flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading ECD Intelligence Data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ml-16 flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <p className="text-sm font-semibold text-destructive">Failed to load data</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ml-16">
      <TopBar />
      <main className="p-6 space-y-8 max-w-[1400px] mx-auto">
        <KPICards />
        <RiskDistribution />
        <PredictiveInsights />
        <ChildProfile />
        <InterventionEngine />
        <CaregiverEngagement />
        <FieldAnalytics />
        <LongitudinalImpact />
        <DataGovernance />
        <footer className="text-center py-6">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
            Government of Andhra Pradesh · Women Development & Child Welfare Department · AI-Based ECD Innovation Challenge
          </p>
        </footer>
      </main>
    </div>
  );
}

const Index = () => {
  return (
    <ECDDataProvider>
      <div className="min-h-screen bg-background grid-bg">
        <DashboardSidebar />
        <DashboardContent />
      </div>
    </ECDDataProvider>
  );
};

export default Index;
