import type { Application } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const TERMINAL_STATUSES = new Set<string>(["rejected", "offer", "withdrawn"]);

export const refreshFollowupForApplication = async (
  application: Application,
  followupAfterDays: number,
): Promise<void> => {
  const openTask = await (prisma as any).followupTask.findFirst({
    where: {
      applicationId: application.id,
      state: "open",
    },
    orderBy: { dueAt: "asc" },
  });

  if (TERMINAL_STATUSES.has(application.status)) {
    if (openTask) {
      await (prisma as any).followupTask.update({
        where: { id: openTask.id },
        data: { state: "done" },
      });
    }
    return;
  }

  const dueAt = new Date(application.lastActivityAt);
  dueAt.setDate(dueAt.getDate() + followupAfterDays);

  if (!openTask) {
    await (prisma as any).followupTask.create({
      data: {
        applicationId: application.id,
        dueAt,
        reason: `No update for ${followupAfterDays} days`,
        state: "open",
      },
    });
    return;
  }

  if (Math.abs(openTask.dueAt.getTime() - dueAt.getTime()) > 1000) {
    await (prisma as any).followupTask.update({
      where: { id: openTask.id },
      data: {
        dueAt,
        reason: `No update for ${followupAfterDays} days`,
      },
    });
  }
};

export const listFollowups = async (userEmail: string, state?: "open" | "done" | "snoozed") => {
  return (prisma as any).followupTask.findMany({
    where: {
      state: state || undefined,
      application: { userEmail },
    },
    include: {
      application: true,
    },
    orderBy: [{ state: "asc" }, { dueAt: "asc" }],
  });
};

export const completeFollowup = async (userEmail: string, id: string) => {
  return (prisma as any).followupTask.updateMany({
    where: {
      id,
      application: { userEmail }
    },
    data: { state: "done" },
  });
};
