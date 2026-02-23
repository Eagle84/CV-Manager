import dayjs from "dayjs";
import { prisma } from "../lib/prisma.js";
import { sendRawEmail } from "./gmailService.js";

const formatLine = (label: string, value: string): string => `${label}: ${value}`;

export const buildDigestBody = async (userEmail: string): Promise<string> => {
  const since = dayjs().subtract(1, "day").toDate();

  const [newApplications, changedEvents, dueFollowups] = await Promise.all([
    (prisma as any).application.findMany({
      where: {
        userEmail,
        createdAt: {
          gte: since,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    (prisma as any).applicationEvent.findMany({
      where: {
        application: { userEmail },
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
    (prisma as any).followupTask.findMany({
      where: {
        application: { userEmail },
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
  ]) as [any[], any[], any[]];

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
  const accounts = await prisma.gmailAccount.findMany();
  if (accounts.length === 0) {
    return { sent: false, reason: "No connected Gmail accounts" };
  }

  let sentCount = 0;
  for (const account of accounts) {
    try {
      const body = await buildDigestBody(account.email);
      await sendRawEmail(account, account.email, "CV Tracker Daily Digest", body);
      sentCount++;
    } catch (err) {
      console.error(`Failed to send digest to ${account.email}:`, err);
    }
  }

  return { sent: true, reason: `Sent ${sentCount} digests` };
};
