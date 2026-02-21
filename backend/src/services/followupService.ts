import type { Application } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const TERMINAL_STATUSES = new Set<Application["status"]>(["rejected", "offer", "withdrawn"]);

export const refreshFollowupForApplication = async (
  application: Application,
  followupAfterDays: number,
): Promise<void> => {
  const openTask = await prisma.followupTask.findFirst({
    where: {
      applicationId: application.id,
      state: "open",
    },
    orderBy: { dueAt: "asc" },
  });

  if (TERMINAL_STATUSES.has(application.status)) {
    if (openTask) {
      await prisma.followupTask.update({
        where: { id: openTask.id },
        data: { state: "done" },
      });
    }
    return;
  }

  const dueAt = new Date(application.lastActivityAt);
  dueAt.setDate(dueAt.getDate() + followupAfterDays);

  if (!openTask) {
    await prisma.followupTask.create({
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
    await prisma.followupTask.update({
      where: { id: openTask.id },
      data: {
        dueAt,
        reason: `No update for ${followupAfterDays} days`,
      },
    });
  }
};

export const listFollowups = async (state?: "open" | "done" | "snoozed") => {
  return prisma.followupTask.findMany({
    where: state ? { state } : undefined,
    include: {
      application: true,
    },
    orderBy: [{ state: "asc" }, { dueAt: "asc" }],
  });
};

export const completeFollowup = async (id: string) => {
  return prisma.followupTask.update({
    where: { id },
    data: { state: "done" },
  });
};
