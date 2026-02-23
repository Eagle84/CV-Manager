import { prisma } from "../lib/prisma.js";
import { randomBytes } from "crypto";

export interface SessionInfo {
    token: string;
    userEmail: string;
    expiresAt: Date;
}

const SESSION_EXPIRY_DAYS = 30;

export const createSession = async (userEmail: string): Promise<SessionInfo> => {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRY_DAYS);

    const session = await (prisma as any).session.create({
        data: {
            token,
            userEmail: userEmail.toLowerCase(),
            expiresAt,
        },
    });

    return {
        token: session.token,
        userEmail: session.userEmail,
        expiresAt: session.expiresAt,
    };
};

export const validateSession = async (token: string): Promise<string | null> => {
    const session = await (prisma as any).session.findUnique({
        where: { token },
    });

    if (!session) {
        return null;
    }

    if (session.expiresAt < new Date()) {
        console.warn(`Session expired for user: ${session.userEmail}`);
        await (prisma as any).session.delete({ where: { id: session.id } });
        return null;
    }

    return session.userEmail;
};

export const destroySession = async (token: string): Promise<void> => {
    await (prisma as any).session.deleteMany({
        where: { token },
    });
};

export const cleanupExpiredSessions = async (): Promise<void> => {
    await (prisma as any).session.deleteMany({
        where: {
            expiresAt: {
                lt: new Date(),
            },
        },
    });
};
