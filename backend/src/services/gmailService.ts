import { google, gmail_v1 } from "googleapis";
import type { GmailAccount } from "@prisma/client";
import { config, hasGoogleConfig } from "../config.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/userinfo.email",
];

const createOAuth2Client = () => {
  if (!hasGoogleConfig) {
    throw new Error("Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI,
  );
};

export const getGoogleAuthUrl = (state?: string): string => {
  const oauth2Client = createOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    scope: SCOPES,
    state,
  });
};

const encryptToken = (token: string | null | undefined): string | null => {
  if (!token) {
    return null;
  }
  return encrypt(token, config.ENCRYPTION_KEY);
};

const decryptToken = (token: string | null | undefined): string | undefined => {
  if (!token) {
    return undefined;
  }
  return decrypt(token, config.ENCRYPTION_KEY);
};

export const handleGoogleOAuthCallback = async (code: string): Promise<GmailAccount> => {
  const oauth2Client = createOAuth2Client();
  const tokenResponse = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokenResponse.tokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress?.toLowerCase();

  if (!email) {
    throw new Error("Unable to resolve connected Gmail account");
  }

  if (!tokenResponse.tokens.refresh_token) {
    const existing = await prisma.gmailAccount.findUnique({ where: { email } });
    if (!existing?.refreshToken) {
      throw new Error("Google did not return a refresh token. Revoke app access and reconnect.");
    }
  }

  const account = await prisma.gmailAccount.upsert({
    where: { email },
    update: {
      accessToken: encryptToken(tokenResponse.tokens.access_token),
      refreshToken: encryptToken(tokenResponse.tokens.refresh_token) ?? undefined,
      tokenExpiry: tokenResponse.tokens.expiry_date
        ? new Date(tokenResponse.tokens.expiry_date)
        : undefined,
    },
    create: {
      email,
      accessToken: encryptToken(tokenResponse.tokens.access_token),
      refreshToken: encryptToken(tokenResponse.tokens.refresh_token) ?? "",
      tokenExpiry: tokenResponse.tokens.expiry_date
        ? new Date(tokenResponse.tokens.expiry_date)
        : null,
    },
  });

  logger.info("Connected Gmail account", { email });
  return account;
};


export const getConnectedAccount = async (email: string): Promise<GmailAccount | null> => {
  return prisma.gmailAccount.findUnique({ where: { email } });
};

export const listConnectedAccounts = async (): Promise<GmailAccount[]> => {
  return prisma.gmailAccount.findMany({ orderBy: { createdAt: "asc" } });
};

export const getActiveAccount = async (activeEmail: string | null): Promise<GmailAccount | null> => {
  if (activeEmail) {
    return prisma.gmailAccount.findUnique({ where: { email: activeEmail } });
  }
  // Fallback: return first known account
  return prisma.gmailAccount.findFirst({ orderBy: { createdAt: "asc" } });
};

export const disconnectGoogleAccount = async (email: string): Promise<void> => {
  await prisma.gmailAccount.deleteMany({ where: { email } });
};


export const getGmailClientForAccount = (account: GmailAccount): gmail_v1.Gmail => {
  const oauth2Client = createOAuth2Client();

  oauth2Client.setCredentials({
    access_token: decryptToken(account.accessToken),
    refresh_token: decryptToken(account.refreshToken),
    expiry_date: account.tokenExpiry?.getTime(),
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
};

interface FetchInboxMessageIdsResult {
  messageIds: string[];
  newestHistoryId: string | null;
  source: "history" | "full_scan" | "query";
}

interface FetchMessagesByIdsResult {
  messages: gmail_v1.Schema$Message[];
  quotaLimited: boolean;
}

const LIST_PAGE_SIZE = 500;
const GET_REQUEST_DELAY_MS = 1200;

const fetchByHistory = async (
  gmail: gmail_v1.Gmail,
  startHistoryId: string,
): Promise<{ ids: string[]; newestHistoryId: string | null }> => {
  const ids = new Set<string>();
  let newestHistoryId: string | null = null;
  let pageToken: string | undefined;

  do {
    const historyResponse = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
      labelId: "INBOX",
      maxResults: LIST_PAGE_SIZE,
      pageToken,
    });

    newestHistoryId = historyResponse.data.historyId ?? newestHistoryId;
    for (const entry of historyResponse.data.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) {
          ids.add(added.message.id);
        }
      }
    }
    pageToken = historyResponse.data.nextPageToken ?? undefined;
  } while (pageToken);

  return {
    ids: Array.from(ids),
    newestHistoryId,
  };
};

const fetchAllInboxIds = async (gmail: gmail_v1.Gmail): Promise<string[]> => {
  const ids = new Set<string>();
  let pageToken: string | undefined;

  do {
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      maxResults: LIST_PAGE_SIZE,
      pageToken,
    });
    for (const message of listResponse.data.messages ?? []) {
      if (message.id) {
        ids.add(message.id);
      }
    }
    pageToken = listResponse.data.nextPageToken ?? undefined;
  } while (pageToken);

  return Array.from(ids);
};

const fetchInboxIdsByQuery = async (gmail: gmail_v1.Gmail, query: string): Promise<string[]> => {
  const ids = new Set<string>();
  let pageToken: string | undefined;

  do {
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      q: query,
      maxResults: LIST_PAGE_SIZE,
      pageToken,
    });
    for (const message of listResponse.data.messages ?? []) {
      if (message.id) {
        ids.add(message.id);
      }
    }
    pageToken = listResponse.data.nextPageToken ?? undefined;
  } while (pageToken);

  return Array.from(ids);
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isQuotaExceededError = (error: unknown): boolean => {
  const withMeta = error as {
    code?: number | string;
    status?: number | string;
    message?: string;
    cause?: { code?: number | string; status?: number | string; message?: string };
    response?: { status?: number | string; data?: { error?: { message?: string; status?: string } } };
  };

  const codeCandidates = [
    withMeta?.code,
    withMeta?.status,
    withMeta?.cause?.code,
    withMeta?.cause?.status,
    withMeta?.response?.status,
  ];
  const has403 = codeCandidates.some((value) => Number(value) === 403);

  const details = [
    withMeta?.message,
    withMeta?.cause?.message,
    withMeta?.response?.data?.error?.message,
    withMeta?.response?.data?.error?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return has403 && (details.includes("quota") || details.includes("rate limit"));
};

export const fetchInboxMessageIds = async (
  account: GmailAccount,
): Promise<FetchInboxMessageIdsResult> => {
  const gmail = getGmailClientForAccount(account);

  let messageIds: string[] = [];
  let newestHistoryId: string | null = null;
  let source: FetchInboxMessageIdsResult["source"] = "full_scan";

  if (account.lastHistoryId) {
    try {
      const byHistory = await fetchByHistory(gmail, account.lastHistoryId);
      messageIds = byHistory.ids;
      newestHistoryId = byHistory.newestHistoryId;
      source = "history";
    } catch (error) {
      logger.warn("History fetch failed, falling back to full inbox scan", error);
    }
  }

  if (messageIds.length === 0) {
    messageIds = await fetchAllInboxIds(gmail);
    const profile = await gmail.users.getProfile({ userId: "me" });
    newestHistoryId = profile.data.historyId ?? null;
    source = "full_scan";
  }

  return { messageIds, newestHistoryId, source };
};

export const fetchInboxMessageIdsByQuery = async (
  account: GmailAccount,
  query: string,
): Promise<FetchInboxMessageIdsResult> => {
  const gmail = getGmailClientForAccount(account);
  const messageIds = await fetchInboxIdsByQuery(gmail, query);
  const profile = await gmail.users.getProfile({ userId: "me" });

  return {
    messageIds,
    newestHistoryId: profile.data.historyId ?? null,
    source: "query",
  };
};

export const fetchMessagesByIds = async (
  account: GmailAccount,
  ids: string[],
): Promise<FetchMessagesByIdsResult> => {
  const gmail = getGmailClientForAccount(account);
  const messages: gmail_v1.Schema$Message[] = [];
  let quotaLimited = false;

  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    try {
      const response = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      }, { retry: false });
      if (response.data.id) {
        messages.push(response.data);
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        quotaLimited = true;
        logger.warn("Gmail API quota exceeded while fetching messages; stopping this sync run", {
          fetched: messages.length,
          requested: ids.length,
        });
        break;
      }

      const err = error as {
        code?: number | string;
        status?: number | string;
        message?: string;
        response?: { status?: number | string; data?: { error?: { message?: string } } };
      };

      logger.warn("Failed to fetch Gmail message", {
        messageId: id,
        code: Number(err.code ?? err.status ?? err.response?.status ?? 0),
        reason: err.response?.data?.error?.message ?? err.message ?? "unknown error",
      });
    }

    if (index < ids.length - 1) {
      await sleep(GET_REQUEST_DELAY_MS);
    }
  }

  return { messages, quotaLimited };
};

export const sendRawEmail = async (
  account: GmailAccount,
  to: string,
  subject: string,
  textBody: string,
): Promise<void> => {
  const gmail = getGmailClientForAccount(account);

  const message = [
    `From: ${account.email}`,
    `To: ${to}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
    `Subject: ${subject}`,
    "",
    textBody,
  ].join("\r\n");

  const encoded = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
    },
  });
};

export const updateAccountCheckpoint = async (
  accountId: string,
  newestHistoryId: string | null,
): Promise<void> => {
  if (!newestHistoryId) {
    return;
  }

  await prisma.gmailAccount.update({
    where: { id: accountId },
    data: { lastHistoryId: newestHistoryId },
  });
};
