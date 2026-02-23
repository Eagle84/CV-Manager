import { prisma } from "../lib/prisma.js";

export interface ResetTrackingStats {
  emailsDeleted: number;
  applicationsDeleted: number;
  checkpointsReset: number;
}

export const resetTrackingData = async (userEmail: string): Promise<ResetTrackingStats> => {
  const [emailsResult, applicationsResult, checkpointsResult] = await prisma.$transaction([
    (prisma as any).emailMessage.deleteMany({ where: { userEmail } }),
    (prisma as any).application.deleteMany({ where: { userEmail } }),
    (prisma as any).gmailAccount.updateMany({
      where: { email: userEmail },
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
