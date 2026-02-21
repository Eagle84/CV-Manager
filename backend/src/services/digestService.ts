import dayjs from "dayjs";
import { prisma } from "../lib/prisma.js";
import { getConnectedAccount, sendRawEmail } from "./gmailService.js";

const formatLine = (label: string, value: string): string => `${label}: ${value}`;

export const buildDigestBody = async (): Promise<string> => {
  const since = dayjs().subtract(1, "day").toDate();

  const [newApplications, changedEvents, dueFollowups] = await Promise.all([
    prisma.application.findMany({
      where: {
        createdAt: {
          gte: since,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    prisma.applicationEvent.findMany({
      where: {
        createdAt: {
          gte: since,
        },
        eventType: {
          in: ["status_changed", "manual_update"],
        },
      },
      include: {
        application: true,
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.followupTask.findMany({
      where: {
        state: "open",
        dueAt: {
          lte: new Date(),
        },
      },
      include: {
        application: true,
      },
      orderBy: { dueAt: "asc" },
      take: 40,
    }),
  ]);

  const lines: string[] = [];
  lines.push("CV Tracker Daily Digest");
  lines.push(`Generated at ${dayjs().format("YYYY-MM-DD HH:mm")}`);
  lines.push("");

  lines.push(`New applications: ${newApplications.length}`);
  for (const item of newApplications) {
    lines.push(
      `- ${item.companyName} | ${item.roleTitle} | ${item.status} | ${dayjs(item.lastActivityAt).format("YYYY-MM-DD")}`,
    );
  }

  lines.push("");
  lines.push(`Status updates: ${changedEvents.length}`);
  for (const event of changedEvents) {
    lines.push(
      `- ${event.application.companyName} | ${event.application.roleTitle} | ${event.eventType} | ${dayjs(event.eventAt).format("YYYY-MM-DD HH:mm")}`,
    );
  }

  lines.push("");
  lines.push(`Follow-ups due: ${dueFollowups.length}`);
  for (const task of dueFollowups) {
    lines.push(
      `- ${formatLine("Company", task.application.companyName)} | ${formatLine("Role", task.application.roleTitle)} | ${formatLine("Due", dayjs(task.dueAt).format("YYYY-MM-DD"))}`,
    );
  }

  return lines.join("\n");
};

export const sendDigest = async (): Promise<{ sent: boolean; reason?: string }> => {
  const account = await getConnectedAccount();
  if (!account) {
    return { sent: false, reason: "No connected Gmail account" };
  }

  const body = await buildDigestBody();
  await sendRawEmail(account, account.email, "CV Tracker Daily Digest", body);
  return { sent: true };
};
