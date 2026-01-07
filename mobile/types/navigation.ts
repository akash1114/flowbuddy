import type { ResolutionResponse } from "../src/api/resolutions";

export type RootStackParamList = {
  Home: undefined;
  BrainDump: undefined;
  DraftPlans: undefined;
  MyWeek: undefined;
  Dashboard: undefined;
  SettingsPermissions: undefined;
  AgentLog: undefined;
  AgentLogDetail: { logId: string };
  ResolutionCreate: undefined;
  WeeklyPlan: undefined;
  Interventions: undefined;
  WeeklyPlanHistory: undefined;
  WeeklyPlanHistoryDetail: { logId: string };
  InterventionsHistory: undefined;
  InterventionsHistoryDetail: { logId: string };
  PlanReview: {
    resolutionId: string;
    initialResolution?: ResolutionResponse;
  };
  ResolutionDashboardDetail: {
    resolutionId: string;
  };
  TaskEdit: {
    taskId: string;
  };
};
