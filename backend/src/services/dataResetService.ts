import { prisma } from "../lib/prisma.js";

export interface ResetTrackingStats {
  emailsDeleted: number;
  applicationsDeleted: number;
  checkpointsReset: number;
}

export const resetTrackingData = async (): Promise<ResetTrackingStats> => {
  const [emailsResult, applicationsResult, checkpointsResult] = await prisma.$transaction([
    prisma.emailMessage.deleteMany(),
    prisma.application.deleteMany(),
    prisma.gmailAccount.updateMany({
      data: {
        lastHistoryId: null,
      },
    }),
  ]);

  return {
    emailsDeleted: emailsResult.count,
    applicationsDeleted: applicationsResult.count,
    checkpointsReset: checkpointsResult.count,
  };
};
