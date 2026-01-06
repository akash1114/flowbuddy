import type { ResolutionResponse } from "../src/api/resolutions";

export type RootStackParamList = {
  Home: undefined;
  BrainDump: undefined;
  DraftPlans: undefined;
  MyWeek: undefined;
  Dashboard: undefined;
  SettingsPermissions: undefined;
  AgentLog: undefined;
  ResolutionCreate: undefined;
  PlanReview: {
    resolutionId: string;
    initialResolution?: ResolutionResponse;
  };
  ResolutionDashboardDetail: {
    resolutionId: string;
  };
};
